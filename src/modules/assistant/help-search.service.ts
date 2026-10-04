import { createHash } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { HELP_EMBEDDINGS, type HelpEmbeddings } from './embeddings';

/** Longest chunk of an article embedded at once (characters). */
const CHUNK = 800;

/** All text strings of an article body (rich text JSON), in order. */
export function bodyText(body: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        if ((k === 'text' || k === 'content' || k === 'value') && typeof v === 'string') out.push(v);
        else walk(v);
      }
  };
  walk(body);
  return out.join('\n');
}

export function chunks(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const para of text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (current && current.length + para.length + 1 > CHUNK) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n${para}` : para.slice(0, CHUNK);
  }
  if (current) out.push(current);
  return out;
}

const literal = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`;

/**
 * D-304 help search over Packio's own published `public` articles and FAQs (partner articles never, D-295): chunks are
 * embedded per model and re-embedded only when their text changes; search is exact cosine distance (pgvector; the
 * corpus is small — no HNSW index, see migration `20261127000001_assistant`).
 */
@Injectable()
export class HelpSearchService {
  private readonly logger = new Logger(HelpSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HELP_EMBEDDINGS) private readonly embeddings: HelpEmbeddings,
  ) {}

  @ScheduledJob({ name: 'assistant.index_help', every: 15 * 60_000 })
  async index(): Promise<number> {
    const [articles, faqs] = await Promise.all([
      this.prisma.article.findMany({
        where: { status: 'published', audience: 'public', deletedAt: null },
        select: { id: true, titleTh: true, body: true },
      }),
      this.prisma.faq.findMany({
        where: { status: 'published', deletedAt: null },
        select: { id: true, questionTh: true, answerTh: true },
      }),
    ]);
    const docs = [
      ...articles.map((a) => ({
        type: 'article',
        id: a.id,
        parts: chunks(`${a.titleTh}\n${bodyText(a.body)}`),
      })),
      ...faqs.map((f) => ({ type: 'faq', id: f.id, parts: [`${f.questionTh}\n${f.answerTh}`] })),
    ];
    const { model, modelVersion } = this.embeddings;
    let written = 0;
    for (const doc of docs) {
      const existing = await this.prisma.helpEmbedding.findMany({
        where: { subjectType: doc.type, subjectId: doc.id, model, modelVersion },
        select: { chunkIndex: true, contentSha256: true },
      });
      const shas = doc.parts.map((p) => createHash('sha256').update(p).digest());
      const unchanged =
        existing.length === doc.parts.length &&
        existing.every((e) => shas[e.chunkIndex]?.equals(Buffer.from(e.contentSha256)));
      if (unchanged) continue;
      const vectors = await this.embeddings.embed(doc.parts);
      await this.prisma.withTx(async (tx) => {
        await tx.helpEmbedding.deleteMany({
          where: { subjectType: doc.type, subjectId: doc.id, model, modelVersion },
        });
        for (const [i, part] of doc.parts.entries())
          await tx.$executeRaw`
            INSERT INTO help_embeddings (subject_type, subject_id, chunk_index, model, model_version, content_sha256,
              content, embedding)
            VALUES (${doc.type}, ${doc.id}, ${i}, ${model}, ${modelVersion}, ${shas[i]!}, ${part},
              ${literal(vectors[i]!)}::vector)`;
      });
      written += doc.parts.length;
    }
    // Withdrawn content leaves the index.
    const live = { article: articles.map((a) => a.id), faq: faqs.map((f) => f.id) };
    await this.prisma.helpEmbedding.deleteMany({
      where: {
        OR: [
          { subjectType: 'article', subjectId: { notIn: live.article.length ? live.article : [-1n] } },
          { subjectType: 'faq', subjectId: { notIn: live.faq.length ? live.faq : [-1n] } },
        ],
      },
    });
    if (written) this.logger.log(`help index: ${written} chunks embedded`);
    return written;
  }

  async search(query: string, limit: number): Promise<{ source: string; title: string; passage: string }[]> {
    if (!query.trim()) return [];
    const [vector] = await this.embeddings.embed([query]);
    const rows = await this.prisma.$queryRaw<
      { subject_type: string; subject_id: bigint; content: string; distance: number }[]
    >`
      SELECT subject_type, subject_id, content, embedding <=> ${literal(vector!)}::vector AS distance
        FROM help_embeddings
       WHERE model = ${this.embeddings.model} AND model_version = ${this.embeddings.modelVersion}
       ORDER BY distance
       LIMIT ${limit}`;
    // Close enough only (cosine distance below 0.9 with the fake; a real model is tuned in the evaluation).
    const near = rows.filter((r) => r.distance < 0.9);
    const articles = await this.prisma.article.findMany({
      where: { id: { in: near.filter((r) => r.subject_type === 'article').map((r) => r.subject_id) } },
      select: { id: true, slug: true, titleTh: true },
    });
    return near.map((r) => {
      const a = articles.find((x) => x.id === r.subject_id);
      return {
        source: r.subject_type === 'article' ? `article:${a?.slug ?? ''}` : 'faq',
        title: r.subject_type === 'article' ? (a?.titleTh ?? '') : r.content.split('\n')[0]!,
        passage: r.content,
      };
    });
  }
}
