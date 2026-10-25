import { type Article, type ArticleBlock, estimateReadMinutes, validateArticle } from '@collective/content';
import { bangkokDate } from '@common/time/bangkok';

/**
 * getpack CMS articles on the shared article engine (D-437, `@collective/content`). getpack stores an article as rich
 * text per language (`body.th`, `body.en`, ProseMirror JSON); the shared model is sections of plain blocks. This maps
 * one onto the other — headings open sections, paragraphs / lists / quotes become blocks — so a public article is
 * checked by the same rules every Collective product publishes with (`validateArticle()`), and its JSON-LD can be built
 * with `articleGraphs()`.
 */

interface RichNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
}

export interface CmsArticleInput {
  slug: string;
  titleTh: string;
  titleEn: string | null;
  excerptTh: string | null;
  excerptEn: string | null;
  body: Record<string, unknown>;
  publishedAt: Date | null;
  updatedAt?: Date | null;
}

const textOf = (node: RichNode | undefined): string =>
  !node
    ? ''
    : node.type === 'text'
      ? (node.text ?? '')
      : node.type === 'hardBreak'
        ? ' '
        : (node.content ?? []).map(textOf).join('');

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

const items = (list: RichNode): string[] =>
  (list.content ?? []).map((item) => clean(textOf(item))).filter((t) => t.length > 0);

/** Rich text → sections: the text before the first heading is the article's opening section. */
export function sectionsOf(doc: unknown, title: string): Article['sections'] {
  const root = (doc && typeof doc === 'object' ? doc : {}) as RichNode;
  const sections: { heading: string; blocks: ArticleBlock[]; opening?: boolean }[] = [];
  let current: { heading: string; blocks: ArticleBlock[]; opening?: boolean } = {
    heading: title,
    blocks: [],
    opening: true,
  };
  for (const node of root.content ?? []) {
    switch (node.type) {
      case 'heading': {
        if (current.blocks.length > 0) sections.push(current);
        current = { heading: clean(textOf(node)) || title, blocks: [] };
        break;
      }
      case 'paragraph':
      case 'codeBlock': {
        const p = clean(textOf(node));
        if (p) current.blocks.push({ p });
        break;
      }
      case 'blockquote': {
        const note = clean(textOf(node));
        if (note) current.blocks.push({ note, tone: 'info' });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const list = items(node);
        if (list.length > 0) current.blocks.push(node.type === 'bulletList' ? { ul: list } : { ol: list });
        break;
      }
      default:
        break; // images and rules carry no text
    }
  }
  if (current.blocks.length > 0) sections.push(current);
  // Ids are positional, so both languages of one article share them (`sameShape`).
  let n = 0;
  return sections.map((s) => ({
    id: s.opening ? 'intro' : `section-${++n}`,
    heading: s.heading,
    blocks: s.blocks,
  }));
}

/** The shared articles of a CMS article: Thai always, English when it has an English title and body. */
export function sharedArticles(input: CmsArticleInput, now = new Date()): Article[] {
  const published = bangkokDate(input.publishedAt ?? now);
  const reviewed = bangkokDate(
    input.updatedAt && input.updatedAt > (input.publishedAt ?? now) ? input.updatedAt : now,
  );
  const locales: { locale: 'th' | 'en'; title: string; summary: string | null; doc: unknown }[] = [
    { locale: 'th', title: input.titleTh, summary: input.excerptTh, doc: input.body['th'] },
  ];
  if (input.titleEn && input.body['en']) {
    locales.push({ locale: 'en', title: input.titleEn, summary: input.excerptEn, doc: input.body['en'] });
  }
  return locales.map(({ locale, title, summary, doc }) => {
    const sections = sectionsOf(doc, title);
    const answer = clean(summary ?? '');
    return {
      slug: input.slug,
      locale,
      category: 'packaging',
      title: clean(title),
      summary: answer,
      answer,
      reviewed: reviewed < published ? published : reviewed,
      published,
      readMinutes: Math.min(60, estimateReadMinutes({ sections, answer: answer || title })),
      general: false,
      sections,
      faq: [],
      sources: [],
    };
  });
}

/** Problems that keep a public article from being published (D-437), as `<locale>.<path>: message` lines. */
export function publishProblems(input: CmsArticleInput, now = new Date()): string[] {
  return sharedArticles(input, now).flatMap((article) => {
    const result = validateArticle(article);
    return result.ok ? [] : result.problems.map((p) => `${article.locale}.${p}`);
  });
}
