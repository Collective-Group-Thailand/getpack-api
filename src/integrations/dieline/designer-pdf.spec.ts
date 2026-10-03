import { inspectDesignerPdf } from '../../../test/support/designer-pdf-inspect';
import { type DesignerPdfInput, writeDesignerPdf } from './designer-pdf';

const PT = 72 / 25.4;
const base = (over: Partial<DesignerPdfInput> = {}): DesignerPdfInput => ({
  widthMm: 200,
  heightMm: 100,
  strokes: {
    cut: [
      [
        { from: [0, 0], to: [200, 0] },
        { from: [200, 0], c1: [205, 0], c2: [205, 100], to: [200, 100] },
        { from: [200, 100], to: [0, 100] },
        { from: [0, 100], to: [0, 0] },
      ],
    ],
    crease: [[{ from: [50, 0], to: [50, 100] }]],
    perforation: [[{ from: [100, 0], to: [100, 100] }]],
    glue_area: [[{ from: [190, 0], to: [190, 100] }]],
  },
  bleed: [
    [
      [-3, -3],
      [203, -3],
      [203, 103],
      [-3, 103],
    ],
  ],
  safe: [
    [
      [3, 3],
      [197, 3],
      [197, 97],
      [3, 97],
    ],
  ],
  title: 'PK-TE-01-A กล่องฝาเสียบ 60×40×120 mm (inside)',
  styleCode: 'PK-TE-01-A',
  producer: 'Packio designer PDF (test)',
  bleedMm: 3,
  safeMm: 3,
  ...over,
});

/** U5.B4 / D-302: what Illustrator and Acrobat show of the designer dieline PDF. */
describe('designer dieline PDF (D-302)', () => {
  it('names every layer and its spot swatch exactly, half-cut only when the structure has one', async () => {
    const pdf = await inspectDesignerPdf(writeDesignerPdf(base()));
    expect(pdf.layers).toEqual(['Safe', 'Bleed', 'Glue', 'Perf', 'Crease', 'CutContour']);
    expect(pdf.swatches).toEqual(['Safe', 'Bleed', 'Glue', 'Perf', 'Crease', 'CutContour']);

    const withHalfCut = await inspectDesignerPdf(
      writeDesignerPdf(
        base({ strokes: { ...base().strokes, half_cut: [[{ from: [10, 10], to: [20, 10] }]] } }),
      ),
    );
    expect(withHalfCut.layers).toContain('HalfCut');
    expect(withHalfCut.swatches).toContain('HalfCut');
  });

  it('keeps the six layers a designer expects even when a role has no lines', async () => {
    const pdf = await inspectDesignerPdf(writeDesignerPdf(base({ strokes: { cut: base().strokes.cut! } })));
    expect(pdf.layers).toEqual(
      expect.arrayContaining(['CutContour', 'Crease', 'Perf', 'Bleed', 'Safe', 'Glue']),
    );
  });

  it('puts the style code in the title, the Info dictionary and XMP (Thai titles survive)', async () => {
    const pdf = await inspectDesignerPdf(writeDesignerPdf(base()));
    expect(pdf.title).toBe('PK-TE-01-A กล่องฝาเสียบ 60×40×120 mm (inside)');
    expect(pdf.subject).toBe('PK-TE-01-A');
    expect(pdf.styleCode).toBe('PK-TE-01-A');
    expect(pdf.keywords).toContain('CutContour');
    expect(pdf.xmp).toContain('<packio:styleCode>PK-TE-01-A</packio:styleCode>');
    expect(pdf.xmp).toContain(
      '<rdf:li xml:lang="x-default">PK-TE-01-A กล่องฝาเสียบ 60×40×120 mm (inside)</rdf:li>',
    );
    expect(pdf.xmp).toContain('<packio:layers>Safe,Bleed,Glue,Perf,Crease,CutContour</packio:layers>');
  });

  it('sets the trim box to the dieline and the bleed box to the bleed, and is deterministic', async () => {
    const bytes = writeDesignerPdf(base());
    const pdf = await inspectDesignerPdf(bytes);
    const r = (v: number) => Math.round(v * PT * 100) / 100;
    const close = (got: number[], want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 1));
    close(pdf.trimBox, [r(10), r(10), r(210), r(110)]);
    close(pdf.bleedBox, [r(7), r(7), r(213), r(113)]);
    expect(writeDesignerPdf(base()).equals(bytes)).toBe(true);
    // Escapes what XML must not carry raw.
    expect((await inspectDesignerPdf(writeDesignerPdf(base({ title: 'A & <B>' })))).xmp).toContain(
      'A &amp; &lt;B&gt;',
    );
  });
});
