import { interpret, type ResourceResolver } from '../preflight/content-stream';
import { type FileFacts, isDieSpot, isNonPrintingSpot, type PageFacts, PT_PER_MM } from '../preflight/facts';
import { evaluate, type PreflightRules } from '../preflight/rules';
import { detect, type DetectionCandidate, sheetDelta, sheetOf } from './detection';
import { currentVersions, isPdfBytes, printOf } from './file-checks.service';
import { UPLOAD_CHECKS, uploadReport } from './report';

/** C9 (D-457): the own-file check before ordering — facts, detection, the 12-check report. */

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
const mm = (v: number) => v * PT_PER_MM;

function page(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    page: 1,
    mediaBox: [0, 0, mm(1041), mm(316)],
    trimBox: null,
    bleedBox: null,
    images: [],
    fonts: [],
    rgbPaintOps: 0,
    spotNames: ['CutContour', 'Crease'],
    minStrokeWidthPt: 0.7,
    overprint: false,
    textOrigins: [],
    texts: [],
    dieBox: [mm(3), mm(3), mm(1038), mm(313)],
    dieNames: ['Crease', 'CutContour'],
    processPaint: false,
    ...overrides,
  };
}
const pdf = (p: PageFacts): FileFacts => ({ kind: 'pdf', pages: [p], pageCount: 1, truncated: false });

const SEPARATION = (name: string) => ({ family: 'spot' as const, spotNames: [name] });
const RESOURCES: ResourceResolver = {
  colourSpace: (name) =>
    name === 'Cut' ? SEPARATION('CutContour') : name === 'Pms' ? SEPARATION('PANTONE 349 C') : null,
  xObject: () => null,
  extGState: (name) => (name === 'OP' ? { overprint: true } : null),
};

describe('C9 facts: die lines, text sizes and plates (content stream)', () => {
  it('finds the die box from paths stroked in a die spot colour and ignores their width and overprint', () => {
    const facts = interpret(
      Buffer.from('/OP gs /Cut CS 1 SCN 0.1 w 10 20 m 110 20 l 110 220 l S 0 0 1 rg 0 0 5 5 re f'),
      RESOURCES,
    );
    expect(facts.dieBox).toEqual([10, 20, 110, 220]);
    expect([...facts.dieNames]).toEqual(['CutContour']);
    expect(facts.minStrokeWidthPt).toBeNull();
    // Overprint counts on printed colour only; the die is overprinted by design (D-302).
    expect(facts.processPaint).toBe(true);
    expect(facts.overprint).toBe(true);
  });

  it('does not report overprint for a die drawn with overprint alone', () => {
    const facts = interpret(Buffer.from('/OP gs /Cut CS 1 SCN 0 0 m 10 0 l S'), RESOURCES);
    expect(facts.overprint).toBe(false);
    expect(facts.processPaint).toBe(false);
  });

  it('measures the effective text size and tells black-only from rich black', () => {
    const facts = interpret(
      Buffer.from(
        'BT /F1 10 Tf 0 0 0 1 k 0.5 0 0 0.5 100 100 Tm (a) Tj ET BT /F1 12 Tf 0.6 0.4 0.4 1 k 1 0 0 1 10 10 Tm (b) Tj ET',
      ),
      RESOURCES,
    );
    expect(facts.texts.map((t) => [t.sizePt, t.plates])).toEqual([
      [5, 'k'],
      [12, 'process'],
    ]);
    expect(facts.processPaint).toBe(true);
  });

  it('names die and helper spots without case, and only those', () => {
    expect(isDieSpot('CutContour')).toBe(true);
    expect(isDieSpot('crease')).toBe(true);
    expect(isDieSpot('PANTONE 349 C')).toBe(false);
    expect(isNonPrintingSpot('Bleed')).toBe(true);
    expect(isNonPrintingSpot('White')).toBe(false);
  });

  it('reads PDF bytes (and PDF-compatible AI) by their own header, not the name', () => {
    expect(isPdfBytes(Buffer.from('%PDF-1.7\n…'))).toBe(true);
    expect(isPdfBytes(Buffer.from('%!PS-Adobe-3.0 EPSF'))).toBe(false);
  });
});

const CANDIDATES: DetectionCandidate[] = [
  ['00', 140, 97.5, 60],
  ['C', 300, 200, 110],
  ['D', 350, 220, 140],
].map(([code, l, w, h]) => ({
  catalogProductId: 1n,
  productSlug: 'postal-box',
  productNameTh: 'กล่องไปรษณีย์',
  productNameEn: 'Postal box',
  sizeCode: code as string,
  sizeName: `เบอร์ ${code as string}`,
  lengthMm: l as number,
  widthMm: w as number,
  heightMm: h as number,
  // Obviously fake blanks (the fake engine's 2L + 2W × H + W).
  blankWidthMm: 2 * (l as number) + 2 * (w as number),
  blankHeightMm: (h as number) + (w as number),
}));

describe('C9 detection', () => {
  it('reads the sheet from the die lines first, else the TrimBox', () => {
    expect(sheetOf(pdf(page()))).toEqual({ widthMm: 1035, heightMm: 310, source: 'die' });
    expect(sheetOf(pdf(page({ dieBox: null, trimBox: [0, 0, mm(500), mm(300)] })))).toEqual({
      widthMm: 500,
      heightMm: 300,
      source: 'trim',
    });
    expect(sheetOf(pdf(page({ dieBox: null })))).toBeNull();
  });

  it('matches the product and size within the tolerance, in either orientation', () => {
    expect(detect({ widthMm: 1000.6, heightMm: 310.3, source: 'die' }, CANDIDATES, 1)?.sizeCode).toBe('C');
    expect(detect({ widthMm: 310, heightMm: 1000, source: 'die' }, CANDIDATES, 1)?.sizeCode).toBe('C');
    expect(sheetDelta({ widthMm: 310, heightMm: 1000 }, { widthMm: 1000, heightMm: 310 })).toBe(0);
  });

  it('matches nothing outside the tolerance — never the nearest guess', () => {
    expect(detect({ widthMm: 1003, heightMm: 310, source: 'die' }, CANDIDATES, 1)).toBeNull();
    expect(detect(null, CANDIDATES, 1)).toBeNull();
  });
});

describe('C9 report (the 12 checks)', () => {
  const expected = { widthMm: 1035, heightMm: 310 };

  it('lists the 12 checks in the page order, one item each', () => {
    const report = uploadReport(pdf(page()), expected, RULES, null);
    expect(report.items.map((i) => i.check)).toEqual([...UPLOAD_CHECKS]);
    expect(report.items).toHaveLength(12);
  });

  it('passes a file whose die matches with 3 mm bleed; unset Prepress rules stay "not checked"', () => {
    const report = uploadReport(pdf(page()), expected, RULES, { method: 'cmyk', spotColours: 0 });
    const level = Object.fromEntries(report.items.map((i) => [i.check, i.level]));
    expect(level['size_mismatch']).toBe('pass');
    expect(level['missing_bleed']).toBe('pass');
    expect(level['die_layer']).toBe('pass');
    expect(level['ink_count']).toBe('pass');
    expect(level['small_text']).toBe('not_checked');
    expect(level['small_text_black']).toBe('not_checked');
    expect(level['barcode']).toBe('not_checked');
    expect(report.blocking).toBe(false);
  });

  it('blocks on a size that does not match the file ("ไม่ตรงกับไฟล์") and on missing bleed', () => {
    const wrong = uploadReport(pdf(page()), { widthMm: 1150, heightMm: 360 }, RULES, null);
    expect(wrong.items.find((i) => i.check === 'size_mismatch')!.level).toBe('must_fix');
    expect(wrong.blocking).toBe(true);
    const noBleed = uploadReport(
      pdf(page({ mediaBox: [mm(3), mm(3), mm(1038), mm(313)] })),
      expected,
      RULES,
      null,
    );
    expect(noBleed.items.find((i) => i.check === 'missing_bleed')!.level).toBe('must_fix');
  });

  it('compares the inks with the print method (severity from the rules — none set → review)', () => {
    const colour = pdf(page({ processPaint: true }));
    expect(
      uploadReport(colour, expected, RULES, { method: 'spot', spotColours: 1 }).items.find(
        (i) => i.check === 'ink_count',
      )!.level,
    ).toBe('review');
    expect(
      uploadReport(colour, expected, RULES, null).items.find((i) => i.check === 'ink_count')!.level,
    ).toBe('not_checked');
    const spot = pdf(page({ spotNames: ['CutContour', 'PANTONE 349 C'] }));
    expect(
      uploadReport(spot, expected, RULES, { method: 'spot', spotColours: 1 }).items.find(
        (i) => i.check === 'ink_count',
      )!.level,
    ).toBe('pass');
    const blocking = { ...RULES, severities: { ...RULES.severities, ink_count: 'block' as const } };
    expect(uploadReport(colour, expected, blocking, { method: 'spot', spotColours: 1 }).blocking).toBe(true);
  });

  it('evaluates text size and black-only small text once Prepress sets the rules, with a marker position', () => {
    const rules = { ...RULES, minTextPt: '6', blackOnlyTextBelowPt: '8' };
    const texts = page({
      texts: [
        { x: 100, y: 50, sizePt: 4.5, plates: 'process' },
        { x: 300, y: 80, sizePt: 12, plates: 'k' },
      ],
    });
    const report = uploadReport(pdf(texts), expected, rules, null);
    const small = report.items.find((i) => i.check === 'small_text')!;
    expect(small.level).toBe('review');
    expect(small.at).toEqual({ x: 100, y: 50 });
    expect(report.items.find((i) => i.check === 'small_text_black')!.level).toBe('review');
  });

  it('an unreadable file blocks; an unsupported one is left to the team', () => {
    expect(uploadReport({ kind: 'error', reason: 'encrypted' }, expected, RULES, null).blocking).toBe(true);
    const old = uploadReport({ kind: 'unsupported', reason: 'type' }, expected, RULES, null);
    expect(old.blocking).toBe(false);
    expect(old.counts.not_checked).toBe(12);
  });

  it('keeps the post-order engine working on facts from before C9 (no die box, no texts)', () => {
    const legacy: PageFacts = { ...page(), trimBox: [mm(3), mm(3), mm(1038), mm(313)] };
    delete legacy.dieBox;
    delete legacy.texts;
    delete legacy.processPaint;
    const results = evaluate(pdf(legacy), expected, RULES);
    expect(results.find((r) => r.check === 'size_mismatch')!.outcome).toBe('pass');
    expect(results.find((r) => r.check === 'die_layer')!.outcome).toBe('not_evaluated');
  });
});

describe('C9 service helpers', () => {
  it('the current version of each variant is its latest not removed one', () => {
    const v = (variantNo: number, versionNo: number, removed = false) =>
      ({ variantNo, versionNo, removedAt: removed ? new Date() : null }) as never;
    const current = currentVersions({ versions: [v(1, 1), v(1, 2), v(2, 1, true), v(3, 1)] });
    expect(current.map((c: { variantNo: number; versionNo: number }) => [c.variantNo, c.versionNo])).toEqual([
      [1, 2],
      [3, 1],
    ]);
  });

  it('the print context needs a chosen method', () => {
    expect(printOf({ printMethod: null, printSpotColours: null })).toBeNull();
    expect(printOf({ printMethod: 'spot', printSpotColours: null })).toEqual({
      method: 'spot',
      spotColours: 1,
    });
  });
});
