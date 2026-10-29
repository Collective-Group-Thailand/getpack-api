import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STUDIO_PRINT_RULES } from '../../../prisma/seed/data/studio';
import { activeRules, documentInks, evaluateDocument, type PrintRule } from './print-rules';

const rules = (printMethod: string | null = 'digital') =>
  activeRules(STUDIO_PRINT_RULES, { printMethod, materialClass: 'paperboard' });

describe('studio print rules (D-278)', () => {
  it('publishes the same rule ids the web tests against (contract/studio-rules.json)', () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), 'contract', 'studio-rules.json'), 'utf8'),
    ) as {
      rules: PrintRule[];
    };
    expect(fixture).toEqual(STUDIO_PRINT_RULES);
    const ids = STUDIO_PRINT_RULES.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps rules without thresholds off and applies print-method rules only to their method', () => {
    const ids = rules().map((r) => r.id);
    expect(ids).toContain('image_resolution');
    expect(ids).not.toContain('min_text_size');
    expect(ids).not.toContain('spot_colour_count');
    expect(rules('flexo').map((r) => r.id)).not.toContain('rgb_out_of_gamut');
  });

  it('checks images, hairlines and barcodes on the document', () => {
    const doc = {
      spec: {},
      content: {
        pattern: { kind: 'none' },
        elements: [
          // 600 px over 100 mm = 152 ppi: warn; 300 px over 100 mm = 76 ppi: block.
          { id: 'a', type: 'image', assetId: 'f1', width: 100, height: 100, scaleX: 1, scaleY: 1 },
          {
            id: 'b',
            type: 'image',
            naturalWidth: 300,
            naturalHeight: 300,
            width: 100,
            height: 100,
            scaleX: 1,
            scaleY: 1,
          },
          {
            id: 'c',
            type: 'image',
            naturalWidth: 4000,
            naturalHeight: 4000,
            width: 100,
            height: 100,
            scaleX: 1,
            scaleY: 1,
          },
          {
            id: 'd',
            type: 'rect',
            stroke: '#000000',
            strokeWidth: 0.05,
            width: 10,
            height: 10,
            scaleX: 1,
            scaleY: 1,
          },
          { id: 'e', type: 'code', kind: 'ean13', value: '8851234567890', width: 40, scaleX: 1 },
          { id: 'f', type: 'code', kind: 'ean13', value: '8851234567898', width: 20, scaleX: 1 },
        ],
      },
    };
    const found = evaluateDocument(doc, rules(), {
      assetPx: new Map([['f1', { widthPx: 600, heightPx: 600 }]]),
    }).map((f) => [f.ruleId, f.severity, f.elementId]);
    expect(found).toEqual([
      ['image_resolution', 'warn', 'a'],
      ['image_resolution', 'block', 'b'],
      ['hairline', 'warn', 'd'],
      ['barcode_invalid', 'block', 'e'],
      ['barcode_invalid', 'block', 'f'],
    ]);
  });

  it('counts flexo colours once Prepress sets the limit, and reads nothing from an unknown document', () => {
    const catalogue = {
      rules: STUDIO_PRINT_RULES.rules.map((r) =>
        r.id === 'spot_colour_count' ? { ...r, thresholds: { maxColours: 2 } } : r,
      ),
    };
    const flexo = activeRules(catalogue, { printMethod: 'flexo', materialClass: null });
    const doc = {
      content: {
        pattern: { kind: 'dots', color: '#FF0000', background: '#ffffff' },
        elements: [{ id: 'a', type: 'text', fill: '#000000', fontSize: 5 }],
      },
    };
    expect(evaluateDocument(doc, flexo, { assetPx: new Map() })).toEqual([
      { ruleId: 'spot_colour_count', severity: 'warn', elementId: '', details: { colours: 3, max: 2 } },
    ]);
    expect(evaluateDocument({ pages: [] }, flexo, { assetPx: new Map() })).toEqual([]);
  });

  describe('D-459 (C8-1): hidden elements, gradients and one-ink images', () => {
    const catalogue = {
      rules: STUDIO_PRINT_RULES.rules.map((r) =>
        r.id === 'spot_colour_count'
          ? { ...r, thresholds: { maxColours: 2 } }
          : r.id === 'min_text_size'
            ? { ...r, thresholds: { minPt: 6 } }
            : r,
      ),
    };
    const flexo = activeRules(catalogue, { printMethod: 'flexo', materialClass: null });
    const evaluate = (elements: unknown[], pattern: unknown = { kind: 'none' }) =>
      evaluateDocument({ content: { pattern, elements } }, flexo, { assetPx: new Map() }).filter(
        (f) => f.ruleId === 'spot_colour_count' || f.ruleId === 'min_text_size',
      );

    it('skips hidden elements in every check and in the ink count', () => {
      expect(
        evaluate([
          { id: 'a', type: 'text', fill: '#000000', fontSize: 5 },
          { id: 'h1', type: 'text', fill: '#ff0000', fontSize: 0.5, hidden: true },
          { id: 'h2', type: 'rect', fill: '#00ff00', stroke: '#0000ff', strokeWidth: 1, hidden: true },
        ]),
      ).toEqual([]);
    });

    it('counts a gradient’s two ends and asks for process printing', () => {
      expect(
        evaluate([
          { id: 'g', type: 'rect', fill: '#000000', fillGradient: { from: '#ff0000', to: '#0000ff' } },
        ]),
      ).toEqual([
        {
          ruleId: 'spot_colour_count',
          severity: 'warn',
          elementId: '',
          details: { colours: 2, max: 2, process: true },
        },
      ]);
    });

    it('counts a one-ink image as one ink; a colour image needs process printing', () => {
      expect(
        evaluate([
          { id: 'm', type: 'image', mono: true },
          { id: 't', type: 'text', fill: '#000000' },
        ]),
      ).toEqual([]);
      expect(evaluate([{ id: 'p', type: 'image' }])[0]?.details).toEqual({
        colours: 0,
        max: 2,
        process: true,
      });
    });

    it('does not print an open path’s fill or a stroke of width 0', () => {
      expect(
        evaluate([
          { id: 'o', type: 'shape', open: true, fill: '#ff0000', stroke: '#000000', strokeWidth: 1 },
          { id: 'r', type: 'rect', fill: '#00ff00', stroke: '#0000ff', strokeWidth: 0 },
        ]),
      ).toEqual([]);
      expect(
        documentInks([{ type: 'rect', fill: '#00ff00', stroke: '#0000ff' }], {
          kind: 'solid',
          color: '#ffffff',
        }),
      ).toEqual({ colours: new Set(['#00ff00', '#0000ff', '#ffffff']), process: false });
    });
  });
});
