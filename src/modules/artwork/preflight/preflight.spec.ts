import { cmyk, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

import { apply, IDENTITY, interpret, multiply, parseContent, type ResourceResolver } from './content-stream';
import { type FileFacts, type PageFacts, PT_PER_MM } from './facts';
import { pdfFacts } from './pdf-facts';
import { rasterFacts } from './raster-facts';
import { evaluate, type PreflightRules, statusOf } from './rules';

const RULES: PreflightRules = {
  severities: {
    size_mismatch: 'block',
    missing_bleed: 'block',
    low_resolution: 'warn',
    rgb_colour: 'warn',
    fonts_not_embedded: 'info',
    safe_zone: 'info',
    thin_lines: 'info',
    overprint: 'info',
    ink_coverage: 'info',
  },
  bleedMm: '3',
  sizeToleranceMm: '1',
  minEffectivePpi: 300,
  safeZoneMm: '3',
  minLineWidthPt: '0.25',
  maxInkCoveragePct: 300,
};

const NO_RESOURCES: ResourceResolver = {
  colourSpace: () => null,
  xObject: () => null,
  extGState: () => null,
};
const mm = (v: number) => v * PT_PER_MM;

function page(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    page: 1,
    mediaBox: [0, 0, mm(106), mm(106)],
    trimBox: [mm(3), mm(3), mm(103), mm(103)],
    bleedBox: null,
    images: [],
    fonts: [],
    rgbPaintOps: 0,
    spotNames: [],
    minStrokeWidthPt: null,
    overprint: false,
    textOrigins: [],
    ...overrides,
  };
}
const pdf = (p: PageFacts): FileFacts => ({ kind: 'pdf', pages: [p], pageCount: 1, truncated: false });
const outcome = (facts: FileFacts, check: string, expected = { widthMm: 100, heightMm: 100 }) =>
  evaluate(facts, expected, RULES).find((r) => r.check === check)!;

describe('content stream (ADR-0009)', () => {
  it('tokenises operands, names with escapes, strings, arrays, dictionaries and inline images', () => {
    const src = Buffer.from(
      '/F#31 12 Tf (a\\) b (nested)) Tj [(x) -20 (y)] TJ << /OP true >> BDC\nBI /W 4 /H 2 /CS /RGB ID \x00\x01EI\x02 EI Q',
    );
    const ops = parseContent(src).map((i) => i.op);
    expect(ops).toEqual(['Tf', 'Tj', 'TJ', 'BDC', 'BI', 'Q']);
    expect(parseContent(src)[0]!.args[0]).toEqual({ t: 'name', v: 'F1' });
    expect(parseContent(src)[4]!.inline?.get('W')).toEqual({ t: 'num', v: 4 });
  });

  it('composes matrices like ISO 32000 (apply the left one first)', () => {
    const m = multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 10, 20]);
    expect(apply(m, 1, 1)).toEqual({ x: 12, y: 22 });
    expect(multiply(IDENTITY, m)).toEqual(m);
  });

  it('tracks placed images, stroke widths under scale, RGB paint and text origins', () => {
    const facts = interpret(
      Buffer.from(
        'q 144 0 0 72 10 10 cm /Im1 Do Q 0.5 w q 0.2 0 0 0.2 0 0 cm 0 0 10 10 re S Q 1 0 0 rg BT 1 0 0 1 50 60 Tm (hi) Tj ET',
      ),
      {
        ...NO_RESOURCES,
        xObject: (name) =>
          name === 'Im1'
            ? { kind: 'image', widthPx: 600, heightPx: 300, colour: { family: 'cmyk' }, imageMask: false }
            : null,
      },
    );
    expect(facts.images).toEqual([
      { name: 'Im1', widthPx: 600, heightPx: 300, placedWidthPt: 144, placedHeightPt: 72, colour: 'cmyk' },
    ]);
    expect(facts.minStrokeWidthPt).toBeCloseTo(0.1);
    expect(facts.rgbPaintOps).toBeGreaterThan(0);
    expect(facts.textOrigins).toEqual([{ x: 50, y: 60 }]);
  });

  it('follows forms with their matrix, once per nesting, and overprint in graphics states', () => {
    const form = {
      kind: 'form' as const,
      key: 'F1',
      matrix: [1, 0, 0, 1, 0, 0] as const,
      content: Buffer.from('/GS1 gs /Fm1 Do 0 w 0 0 m 1 1 l S'),
      resources: NO_RESOURCES,
    };
    const resources: ResourceResolver = {
      colourSpace: () => ({ family: 'spot', spotNames: ['PANTONE 186 C'] }),
      extGState: (n) => (n === 'GS1' ? { overprint: true } : null),
      xObject: (n) => (n === 'Fm1' ? { ...form, resources } : null),
    };
    const facts = interpret(Buffer.from('/CS0 cs 1 scn /Fm1 Do'), resources);
    expect(facts.overprint).toBe(true);
    expect(facts.minStrokeWidthPt).toBe(0);
    expect([...facts.spotNames]).toEqual(['PANTONE 186 C']);
  });
});

describe('PDF facts with pdf-lib (ADR-0009)', () => {
  it('reads boxes, fonts, images, colours and line widths of a generated PDF', async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([mm(106), mm(106)]);
    // pdf-lib takes x, y, width, height: a 97 × 100 mm trim (size mismatch) with 2 mm bleed on the left.
    p.setTrimBox(mm(3), mm(3), mm(97), mm(100));
    p.setBleedBox(mm(1), mm(1), mm(104), mm(104));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    p.drawText('getpack', { x: mm(50), y: mm(50), size: 10, font, color: cmyk(0, 0, 0, 1) });
    p.drawRectangle({ x: mm(10), y: mm(10), width: 20, height: 20, color: rgb(1, 0, 0) });
    p.drawLine({ start: { x: 0, y: 0 }, end: { x: 50, y: 50 }, thickness: 0.1, color: cmyk(0, 1, 0, 0) });
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    p.drawImage(await doc.embedPng(png), { x: mm(20), y: mm(20), width: 72, height: 72 });
    const facts = await pdfFacts(await doc.save());

    expect(facts.kind).toBe('pdf');
    if (facts.kind !== 'pdf') return;
    const [first] = facts.pages;
    expect(first!.trimBox?.map((v) => Math.round(v / PT_PER_MM))).toEqual([3, 3, 100, 103]);
    expect(first!.fonts).toEqual([{ name: 'Helvetica', subtype: 'Type1', embedded: false }]);
    expect(first!.images).toHaveLength(1);
    expect(first!.images[0]).toMatchObject({ widthPx: 30, heightPx: 30, colour: 'rgb' });
    expect(first!.images[0]!.placedWidthPt).toBeCloseTo(72);
    expect(first!.rgbPaintOps).toBeGreaterThan(0);
    expect(first!.minStrokeWidthPt).toBeCloseTo(0.1);
    expect(first!.textOrigins).toHaveLength(1);

    const results = evaluate(facts, { widthMm: 100, heightMm: 100 }, RULES);
    const failed = results
      .filter((r) => r.outcome === 'fail')
      .map((r) => r.check)
      .sort();
    expect(failed).toEqual([
      'fonts_not_embedded',
      'low_resolution',
      'missing_bleed',
      'rgb_colour',
      'size_mismatch',
      'thin_lines',
    ]);
    expect(statusOf(results)).toBe('blocked');
  });

  it('reports unreadable files instead of passing them', async () => {
    expect(await pdfFacts(Buffer.from('%PDF-1.7 not really'))).toEqual({
      kind: 'error',
      reason: 'unreadable',
    });
  });

  it('reads raster density and colour space with sharp', async () => {
    const png = await sharp({ create: { width: 1181, height: 1181, channels: 3, background: '#ffffff' } })
      .withMetadata({ density: 300 })
      .png()
      .toBuffer();
    const facts = await rasterFacts(png);
    expect(facts).toMatchObject({ kind: 'raster', densityPpi: 300 });
    // 1181 px at 300 ppi = 100 mm: no bleed around a 100 mm dieline, RGB, resolution fine.
    expect(outcome(facts, 'missing_bleed').outcome).toBe('fail');
    expect(outcome(facts, 'size_mismatch').outcome).toBe('pass');
    expect(outcome(facts, 'low_resolution').outcome).toBe('pass');
    expect(outcome(facts, 'rgb_colour').outcome).toBe('fail');
  });
});

describe('preflight rules (D-070)', () => {
  it('blocks a trim that differs from the dieline beyond the tolerance, either orientation', () => {
    expect(outcome(pdf(page()), 'size_mismatch').outcome).toBe('pass');
    expect(
      outcome(pdf(page({ trimBox: [mm(3), mm(3), mm(103), mm(203)] })), 'size_mismatch', {
        widthMm: 200,
        heightMm: 100,
      }).outcome,
    ).toBe('pass');
    const off = outcome(pdf(page({ trimBox: [mm(3), mm(3), mm(104.5), mm(103)] })), 'size_mismatch');
    expect(off).toMatchObject({ outcome: 'fail', severity: 'block' });
  });

  it('blocks missing bleed measured on the thinnest side', () => {
    expect(outcome(pdf(page()), 'missing_bleed').outcome).toBe('pass');
    const thin = outcome(pdf(page({ mediaBox: [mm(1), 0, mm(106), mm(106)] })), 'missing_bleed');
    expect(thin).toMatchObject({ outcome: 'fail', severity: 'block', measurements: { leastBleedMm: 2 } });
  });

  it('without a trim box, centres the dieline in the page', () => {
    const noTrim = page({ trimBox: null });
    expect(outcome(pdf(noTrim), 'missing_bleed').outcome).toBe('pass');
    expect(outcome(pdf({ ...noTrim, mediaBox: [0, 0, mm(100), mm(100)] }), 'missing_bleed').outcome).toBe(
      'fail',
    );
    expect(outcome(pdf({ ...noTrim, mediaBox: [0, 0, mm(90), mm(100)] }), 'size_mismatch').outcome).toBe(
      'fail',
    );
  });

  it('does not evaluate size and bleed without a dieline, nor anything in files it cannot read', () => {
    const results = evaluate(pdf(page({ trimBox: null })), null, RULES);
    expect(results.find((r) => r.check === 'size_mismatch')?.outcome).toBe('not_evaluated');
    expect(
      evaluate({ kind: 'error', reason: 'encrypted' }, null, RULES).every(
        (r) => r.outcome === 'not_evaluated',
      ),
    ).toBe(true);
  });

  it('warns on low effective resolution and RGB, reports the rest at the configured severity', () => {
    const facts = pdf(
      page({
        images: [
          {
            name: 'Im1',
            widthPx: 500,
            heightPx: 500,
            placedWidthPt: 144,
            placedHeightPt: 144,
            colour: 'cmyk',
          },
        ],
        rgbPaintOps: 2,
        fonts: [{ name: 'Sarabun', subtype: 'TrueType', embedded: false }],
        overprint: true,
        minStrokeWidthPt: 0.1,
        textOrigins: [{ x: mm(4), y: mm(50) }],
      }),
    );
    const results = evaluate(facts, { widthMm: 100, heightMm: 100 }, RULES);
    const byCheck = Object.fromEntries(results.map((r) => [r.check, [r.outcome, r.severity]]));
    expect(byCheck).toMatchObject({
      low_resolution: ['fail', 'warn'],
      rgb_colour: ['fail', 'warn'],
      fonts_not_embedded: ['fail', 'info'],
      safe_zone: ['fail', 'info'],
      thin_lines: ['fail', 'info'],
      overprint: ['fail', 'info'],
      ink_coverage: ['not_evaluated', 'info'],
    });
    expect(statusOf(results)).toBe('passed_with_warnings');
  });
});
