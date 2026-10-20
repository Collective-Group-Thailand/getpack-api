import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FileText, Prisma } from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type FileSearchHitDto,
  type FileSearchMatchDto,
  type FileSearchResponseDto,
  type FileTextStateDto,
} from './file-search.dto';
import { type SearchSurface } from './file-search.sources';
import { FILE_TEXT_EMBEDDINGS, type FileTextEmbeddings, vectorLiteral } from './text-embeddings';
import { fold, likeEscape, skeleton, snippetOf } from './text-fold';

/** Files ranked at most (the list is paged inside this). */
const MAX_FILES = 200;
/** Chunks taken from each list before ranking. */
const KEYWORD_CHUNKS = 400;
const MEANING_CHUNKS = 120;
/** Reciprocal-rank fusion constant (the usual 60). */
const RRF_K = 60;
/** Passages shown per file. */
const MATCHES = 3;

export interface FileSearchScope {
  surface: SearchSurface;
  /** The caller's permissions: a usage shows when its surface's permission is among them. */
  permissions: ReadonlySet<string>;
  /** Partner surface: the factory (internal id) whose files these are. */
  factoryId?: bigint;
}

export interface FileSearchQuery {
  q: string;
  mode?: 'hybrid' | 'keyword' | 'meaning';
  sources?: string[];
  allVersions?: boolean;
  archived?: boolean;
  page: number;
  perPage: number;
}

interface ChunkHit {
  id: bigint;
  file_object_id: bigint;
  page: number | null;
  sheet: string | null;
  ocr: boolean;
  content: string;
  score: number;
  exact: boolean;
}

interface UsageRow {
  source: string;
  file_id: bigint;
  subject_id: string | null;
  parent_id: string | null;
  code: string | null;
  title: string | null;
  version: number | null;
  current: boolean;
  used_at: Date;
}

/**
 * Content search over stored files (D-427, ADR-0013): keyword (folded substring, else pg_trgm word similarity —
 * tolerant of OCR misreadings) and, when embeddings are on, by meaning (pgvector cosine), fused by reciprocal rank
 * with exact matches first. Only files the caller may see on this surface take part: the allowlist view says, per
 * usage, the permission each surface needs, and the partner surface is limited to its own factory.
 */
@Injectable()
export class FileSearchService {
  private readonly logger = new Logger(FileSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_TEXT_EMBEDDINGS) private readonly embeddings: FileTextEmbeddings | null,
  ) {}

  private iterative: Promise<boolean> | null = null;

  /** pgvector 0.8 or later (iterative index scans). */
  private iterativeScan(): Promise<boolean> {
    this.iterative ??= this.prisma.$queryRaw<{ v: string }[]>`
      SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'`
      .then(([row]) => {
        const [major = 0, minor = 0] = (row?.v ?? '0.0').split('.').map(Number);
        return major > 0 || minor >= 8;
      })
      .catch(() => false);
    return this.iterative;
  }

  get meaningOn(): boolean {
    return this.embeddings !== null;
  }

  /** The usages the caller may see (a SQL fragment over `search.file_usages u`). */
  private visible(
    scope: FileSearchScope,
    query: Pick<FileSearchQuery, 'sources' | 'allVersions' | 'archived'>,
  ) {
    const perms = [...scope.permissions];
    const surface =
      scope.surface === 'partner'
        ? Prisma.sql`u.factory_id = ${scope.factoryId ?? -1n} AND u.partner_permission = ANY(${perms}::text[])`
        : Prisma.sql`u.admin_permission = ANY(${perms}::text[])`;
    const sources = query.sources?.length
      ? Prisma.sql`AND u.source = ANY(${query.sources}::text[])`
      : Prisma.empty;
    const versions = query.allVersions ? Prisma.empty : Prisma.sql`AND u.current`;
    const archived = query.archived ? Prisma.empty : Prisma.sql`AND u.active`;
    return Prisma.sql`${surface} ${sources} ${versions} ${archived}`;
  }

  async search(scope: FileSearchScope, query: FileSearchQuery): Promise<FileSearchResponseDto> {
    const q = query.q.trim();
    const folded = fold(q);
    if (folded.length < 2)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'q', code: 'minLength', message: 'At least two letters or digits' }],
      });
    const mode = query.mode ?? 'hybrid';
    const visible = this.visible(scope, query);
    const [keyword, meaning, indexing] = await Promise.all([
      mode === 'meaning' ? Promise.resolve([]) : this.keyword(folded, visible),
      mode === 'keyword' || !this.embeddings ? Promise.resolve([]) : this.meaning(q, visible),
      this.indexing(visible),
    ]);

    // Rank files: exact matches first, then reciprocal-rank fusion of the two lists (best chunk per file).
    const files = new Map<
      bigint,
      { exact: boolean; rrf: number; chunks: { hit: ChunkHit; by: 'keyword' | 'meaning' }[] }
    >();
    const add = (hits: ChunkHit[], by: 'keyword' | 'meaning') => {
      const seen = new Set<bigint>();
      let rank = 0;
      for (const hit of hits) {
        const f = files.get(hit.file_object_id) ?? { exact: false, rrf: 0, chunks: [] };
        if (!seen.has(hit.file_object_id)) {
          seen.add(hit.file_object_id);
          f.rrf += 1 / (RRF_K + ++rank);
        }
        f.exact ||= hit.exact;
        if (!f.chunks.some((c) => c.hit.id === hit.id)) f.chunks.push({ hit, by });
        files.set(hit.file_object_id, f);
      }
    };
    add(keyword, 'keyword');
    add(meaning, 'meaning');
    const ranked = [...files.entries()]
      .sort(([, a], [, b]) => Number(b.exact) - Number(a.exact) || b.rrf - a.rrf)
      .slice(0, MAX_FILES);
    const total = ranked.length;
    const pageRows = ranked.slice((query.page - 1) * query.perPage, query.page * query.perPage);
    const ids = pageRows.map(([id]) => id);

    const [usages, fileRows] = ids.length
      ? await Promise.all([
          this.prisma.$queryRaw<UsageRow[]>`
            SELECT u.source, u.file_id, u.subject_id::text AS subject_id, u.parent_id::text AS parent_id, u.code, u.title, u.version, u.current, u.used_at
              FROM search.file_usages u
             WHERE u.file_id = ANY(${ids}::bigint[]) AND ${visible}
             ORDER BY u.used_at DESC`,
          this.prisma.fileObject.findMany({ where: { id: { in: ids } }, include: { text: true } }),
        ])
      : [[], []];

    const data: FileSearchHitDto[] = [];
    for (const [id, f] of pageRows) {
      const file = fileRows.find((r) => r.id === id);
      if (!file) continue;
      const chunks = f.chunks
        .sort((a, b) => Number(b.hit.exact) - Number(a.hit.exact) || b.hit.score - a.hit.score)
        .slice(0, MATCHES);
      data.push({
        file: {
          id: file.publicId,
          name: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: Number(file.sizeBytes),
        },
        usages: usages
          .filter((u) => u.file_id === id)
          .map((u) => ({
            source: u.source,
            subjectId: u.subject_id,
            parentId: u.parent_id,
            code: u.code,
            title: u.title,
            version: u.version,
            current: u.current,
            usedAt: toBangkokIso(u.used_at),
          })),
        matches: chunks.map(({ hit, by }): FileSearchMatchDto => {
          const s = snippetOf(hit.content, q);
          return {
            page: hit.page,
            sheet: hit.sheet,
            ocr: hit.ocr,
            snippet: s.text,
            highlights: s.highlights,
            by,
          };
        }),
        exact: f.exact,
        text: {
          method: file.text?.method ?? null,
          pageCount: file.text?.pageCount ?? null,
          ocrPages: file.text?.ocrPages ?? 0,
          ocrConfidence: file.text?.ocrConfidence ? Number(file.text.ocrConfidence) : null,
        },
      });
    }
    return {
      data,
      meta: { page: query.page, perPage: query.perPage, total, meaning: this.meaningOn, indexing },
    };
  }

  /**
   * Keyword, in three tiers: the folded query inside the folded text (exact, score 1 + how often); the same without
   * Thai vowel signs and tone marks (0.95 — marks left out or misread by OCR); else trigram word similarity of the
   * skeletons over pg_trgm's threshold (0.6 — a letter or two misread). Queries under three characters match only
   * the first two tiers.
   */
  private async keyword(folded: string, visible: Prisma.Sql): Promise<ChunkHit[]> {
    const like = `%${likeEscape(folded)}%`;
    const bare = skeleton(folded);
    const likeBare = `%${likeEscape(bare)}%`;
    const fuzzy = bare.length >= 3 ? Prisma.sql`OR ${bare} <% c.search_skeleton` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<(Omit<ChunkHit, 'score'> & { score: number })[]>`
      SELECT c.id, c.file_object_id, c.page, c.sheet, c.ocr, c.content,
             (c.search_text LIKE ${like} ESCAPE '\\') AS exact,
             CASE WHEN c.search_text LIKE ${like} ESCAPE '\\'
                    THEN 1 + (length(c.search_text) - length(replace(c.search_text, ${folded}, '')))
                             / length(${folded})::float / 100
                  WHEN c.search_skeleton LIKE ${likeBare} ESCAPE '\\' THEN 0.95
                  ELSE 0.9 * word_similarity(${bare}, c.search_skeleton) END AS score
        FROM file_text_chunks c
       WHERE c.file_object_id IN (
               SELECT u.file_id FROM search.file_usages u JOIN file_objects f ON f.id = u.file_id
                WHERE f.purged_at IS NULL AND f.scan_status = 'clean' AND ${visible})
         AND (c.search_text LIKE ${like} ESCAPE '\\' OR c.search_skeleton LIKE ${likeBare} ESCAPE '\\' ${fuzzy})
       ORDER BY score DESC, c.id
       LIMIT ${KEYWORD_CHUNKS}`;
    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  }

  /** By meaning: nearest chunks by cosine distance (HNSW, widened search for the scope filter), above the model's floor. */
  private async meaning(q: string, visible: Prisma.Sql): Promise<ChunkHit[]> {
    const model = this.embeddings!;
    let vector: number[];
    try {
      [vector] = (await model.embed([q], 'query')) as [number[]];
    } catch (error) {
      // Search by meaning is a bonus: keyword results still answer when the model cannot run.
      this.logger.warn(`query embedding failed: ${error instanceof Error ? error.message : 'error'}`);
      return [];
    }
    const literal = vectorLiteral(vector);
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('hnsw.ef_search', '400', true)`;
      // pgvector ≥ 0.8 keeps scanning the graph until enough rows pass the filter (older ones reject the name).
      if (await this.iterativeScan())
        await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
      return tx.$queryRaw<(Omit<ChunkHit, 'score' | 'exact'> & { similarity: number })[]>`
        SELECT c.id, c.file_object_id, c.page, c.sheet, c.ocr, c.content,
               1 - (e.embedding <=> ${literal}::vector) AS similarity
          FROM search.file_text_embeddings e
          JOIN file_text_chunks c ON c.id = e.chunk_id
         WHERE e.model = ${model.model} AND e.model_version = ${model.modelVersion}
           AND c.file_object_id IN (
                 SELECT u.file_id FROM search.file_usages u JOIN file_objects f ON f.id = u.file_id
                  WHERE f.purged_at IS NULL AND f.scan_status = 'clean' AND ${visible})
         ORDER BY e.embedding <=> ${literal}::vector
         LIMIT ${MEANING_CHUNKS}`;
    });
    return rows
      .map((r) => ({ ...r, score: Number(r.similarity), exact: false }))
      .filter((r) => r.score >= model.minSimilarity);
  }

  /** Files of the caller's scope still waiting to be read, and those that could not be. */
  private async indexing(visible: Prisma.Sql): Promise<{ pending: number; failed: number }> {
    const [row] = await this.prisma.$queryRaw<{ pending: bigint; failed: bigint }[]>`
      SELECT count(*) FILTER (WHERE t.id IS NULL OR t.status = 'pending') AS pending,
             count(*) FILTER (WHERE t.status = 'failed') AS failed
        FROM (SELECT DISTINCT u.file_id FROM search.file_usages u JOIN file_objects f ON f.id = u.file_id
               WHERE f.purged_at IS NULL AND f.scan_status = 'clean' AND ${visible}) s
        LEFT JOIN file_texts t ON t.file_object_id = s.file_id`;
    return { pending: Number(row?.pending ?? 0), failed: Number(row?.failed ?? 0) };
  }

  /** How a file's text stands, for a document page ("searchable", "being read", "could not be read"). */
  async state(fileIds: bigint[]): Promise<Map<bigint, FileTextStateDto>> {
    const rows = await this.prisma.fileText.findMany({ where: { fileObjectId: { in: fileIds } } });
    return new Map(fileIds.map((id) => [id, textStateOf(rows.find((r) => r.fileObjectId === id) ?? null)]));
  }
}

/** A file's text state for the API; no row yet = still to be read. */
export function textStateOf(t: FileText | null): FileTextStateDto {
  return {
    status: t?.status ?? 'pending',
    method: t?.method ?? null,
    pageCount: t?.pageCount ?? null,
    ocrPages: t?.ocrPages ?? 0,
    skippedPages: t?.skippedPages ?? 0,
    ocrConfidence: t?.ocrConfidence ? Number(t.ocrConfidence) : null,
    charCount: t?.charCount ?? 0,
    meaning: Boolean(t?.embeddedModel),
    readAt: t?.extractedAt ? toBangkokIso(t.extractedAt) : null,
    error: t && (t.status === 'failed' || t.status === 'unsupported') ? (t.lastError ?? null) : null,
  };
}
