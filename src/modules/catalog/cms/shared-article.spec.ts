import { articleGraphs, sameShape, validateArticle } from '@collective/content';

import { publishProblems, sectionsOf, sharedArticles } from './shared-article';

const text = (t: string) => ({ type: 'text', text: t });
const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [text('กล่องไปรษณีย์มีหลายแบบ')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Choosing the flute')] },
    { type: 'paragraph', content: [text('ลอน B เหมาะกับสินค้าเบา')] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [text('ลอน B')] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [text('ลอน C')] }] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [text('ขนาด')] },
    { type: 'heading', attrs: { level: 3 }, content: [text('วัดด้านใน')] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [text('วัดขนาดภายในเสมอ')] }] },
    { type: 'image', attrs: { src: 'https://example.invalid/a.png' } },
  ],
};

const article = {
  slug: 'how-to-choose-a-mailer-box',
  titleTh: 'เลือกกล่องไปรษณีย์อย่างไร',
  titleEn: 'How to choose a mailer box',
  excerptTh: 'ขนาด ลอน และการพิมพ์ที่ควรรู้',
  excerptEn: 'Size, flute and print',
  body: { th: doc, en: doc },
  publishedAt: new Date('2026-10-01T03:00:00Z'),
};

describe('getpack articles on @collective/content (D-437)', () => {
  it('turns rich text into sections: an opening section, headings, lists and quotes as blocks', () => {
    const sections = sectionsOf(doc, 'Title');
    expect(sections.map((s) => s.heading)).toEqual(['Title', 'Choosing the flute', 'วัดด้านใน']);
    expect(sections.map((s) => s.id)).toEqual(['intro', 'section-1', 'section-2']);
    expect(sections[1]!.blocks).toEqual([{ p: 'ลอน B เหมาะกับสินค้าเบา' }, { ul: ['ลอน B', 'ลอน C'] }]);
    expect(sections[2]!.blocks).toEqual([{ note: 'วัดขนาดภายในเสมอ', tone: 'info' }]);
  });

  it('maps both languages to valid shared articles of the same shape, with Article JSON-LD', () => {
    const [th, en] = sharedArticles(article, new Date('2026-10-25T03:00:00Z'));
    expect(th).toMatchObject({ locale: 'th', published: '2026-10-01', reviewed: '2026-10-25' });
    expect(en?.locale).toBe('en');
    expect(validateArticle(th).ok).toBe(true);
    expect(validateArticle(en).ok).toBe(true);
    expect(sameShape(th!, en!)).toBe(true);
    const graphs = articleGraphs(
      th!,
      {
        name: 'getpack',
        origin: 'https://getpack.co',
        logo: 'https://getpack.co/icon.svg',
        url: 'https://getpack.co/articles/x',
      },
      [{ name: 'หน้าแรก', url: 'https://getpack.co/' }, { name: th!.title }],
    );
    expect(graphs[0]).toMatchObject({ '@type': 'Article', headline: th!.title, inLanguage: 'th' });
    expect(publishProblems(article)).toEqual([]);
  });

  it('lists what keeps an article from being published, per language', () => {
    const problems = publishProblems({
      ...article,
      titleEn: null,
      excerptTh: null,
      body: { th: { type: 'doc', content: [] } },
    });
    expect(problems.some((p) => p.startsWith('th.summary'))).toBe(true);
    expect(problems.some((p) => p.startsWith('th.sections'))).toBe(true);
    expect(problems.some((p) => p.startsWith('en.'))).toBe(false); // no English version
    expect(publishProblems({ ...article, titleTh: 'ก'.repeat(121) })[0]).toMatch(/^th\.title/);
  });
});
