import { DomainException } from '@common/errors/domain.exception';

import {
  checkSide,
  defaultSelection,
  type InkKind,
  type PrintModel,
  type PrintSelection,
  type PrintSideConfig,
  selectionOf,
  storePrintModel,
  toCorrugateColours,
  validatePrintModel,
} from './print-model';
import { assertPrintCombination } from './print-rules';

// Fake ids (D-443 tests): two spot colours, one process set.
const BLACK = 'ink-black';
const RED = 'ink-red';
const CMYK = 'ink-cmyk';
const KINDS = new Map<string, InkKind>([
  [BLACK, 'spot'],
  [RED, 'spot'],
  [CMYK, 'process'],
]);
const kindOf = (id: string) => KINDS.get(id);

const side = (over: Partial<PrintSideConfig> = {}): PrintSideConfig => ({
  methods: ['none', 'spot', 'cmyk'],
  spot: { maxColours: 1, inkColourIds: [BLACK, RED] },
  cmyk: { inkColourId: CMYK, addOn: { enabled: false, maxColours: 0 } },
  ...over,
});
const MODEL: PrintModel = { outside: side(), inside: side() };

const reference = (parts: unknown[]) => ({
  patternId: 'pattern',
  l: 140,
  w: 97.5,
  d: 60,
  quantities: [300],
  parts,
});

describe('print model per side (D-443)', () => {
  describe('default', () => {
    it('opens the inside on ไม่พิมพ์ when the default spec prints outside only', () => {
      const spec = reference([{ printFront: [{ inkColourId: CMYK, area: 'top' }] }]);
      expect(defaultSelection(MODEL.outside, 'outside', spec, kindOf, BLACK)).toEqual({
        method: 'cmyk',
        spotInkColourIds: [],
        cmykAddOnInkColourIds: [],
      });
      expect(defaultSelection(MODEL.inside, 'inside', spec, kindOf, BLACK).method).toBe('none');
    });

    it('never applies the side-less default ink flag to the inside (no default spec)', () => {
      expect(defaultSelection(MODEL.outside, 'outside', null, kindOf, CMYK).method).toBe('cmyk');
      expect(defaultSelection(MODEL.inside, 'inside', null, kindOf, CMYK).method).toBe('none');
    });

    it('follows the default spec inside when it prints inside', () => {
      const spec = reference([{ printBack: [{ inkColourId: BLACK, area: 'top' }] }]);
      expect(defaultSelection(MODEL.inside, 'inside', spec, kindOf, null)).toEqual({
        method: 'spot',
        spotInkColourIds: [BLACK],
        cmykAddOnInkColourIds: [],
      });
    });

    it('falls back to ไม่พิมพ์ when the default spec is not a valid choice of the model', () => {
      const spec = reference([{ printFront: [{ inkColourId: BLACK }, { inkColourId: CMYK }] }]);
      expect(defaultSelection(MODEL.outside, 'outside', spec, kindOf, null).method).toBe('none');
    });

    it('the configurator view carries both defaults and the counters', () => {
      const spec = reference([{ printFront: [{ inkColourId: CMYK, area: 'top' }] }]);
      const view = storePrintModel(MODEL, spec, kindOf, BLACK);
      expect(view.outside).toMatchObject({ field: 'printFront', default: { method: 'cmyk' } });
      expect(view.inside).toMatchObject({
        field: 'printBack',
        methods: ['none', 'spot', 'cmyk'],
        spot: { minColours: 1, maxColours: 1, inkColourIds: [BLACK, RED] },
        cmyk: { inkColourId: CMYK, addOn: { enabled: false, minColours: 0, maxColours: 0 } },
        default: { method: 'none', spotInkColourIds: [], cmykAddOnInkColourIds: [] },
      });
    });

    it('drops colours the product no longer offers from the view', () => {
      const view = storePrintModel(MODEL, null, (id) => (id === RED ? undefined : kindOf(id)), null);
      expect(view.outside.spot?.inkColourIds).toEqual([BLACK]);
      const noCmyk = storePrintModel(MODEL, null, (id) => (id === CMYK ? undefined : kindOf(id)), null);
      expect(noCmyk.outside.methods).toEqual(['none', 'spot']);
      expect(noCmyk.outside.cmyk).toBeNull();
    });
  });

  describe('combinations', () => {
    it('refuses ดำ + CMYK as two inks on one side, with or without a model', () => {
      expect(checkSide(MODEL.outside, [BLACK, CMYK], kindOf)?.code).toBe('cmyk_with_spot');
      expect(checkSide(null, [CMYK, BLACK], kindOf)?.code).toBe('cmyk_with_spot');
      expect(checkSide(null, [CMYK, CMYK], kindOf)?.code).toBe('process_repeated');
    });

    it('accepts one method per side without a model', () => {
      expect(checkSide(null, [], kindOf)).toBeNull();
      expect(checkSide(null, [CMYK], kindOf)).toBeNull();
      expect(checkSide(null, [BLACK], kindOf)).toBeNull();
    });

    it('keeps the spot count within 1..N, distinct and allowed', () => {
      expect(checkSide(MODEL.outside, [BLACK], kindOf)).toBeNull();
      expect(checkSide(MODEL.outside, [BLACK, RED], kindOf)?.code).toBe('spot_count');
      const two = side({ spot: { maxColours: 2, inkColourIds: [BLACK, RED] } });
      expect(checkSide(two, [BLACK, RED], kindOf)).toBeNull();
      expect(checkSide(two, [BLACK, BLACK], kindOf)?.code).toBe('colour_repeated');
      const blackOnly = side({ spot: { maxColours: 1, inkColourIds: [BLACK] } });
      expect(checkSide(blackOnly, [RED], kindOf)?.code).toBe('colour_not_allowed');
    });

    it('allows "+ สีพิเศษ" beside CMYK only when enabled, up to M', () => {
      expect(checkSide(MODEL.outside, [CMYK, RED], kindOf)?.code).toBe('cmyk_with_spot');
      const addOn = side({ cmyk: { inkColourId: CMYK, addOn: { enabled: true, maxColours: 1 } } });
      expect(checkSide(addOn, [CMYK, RED], kindOf)).toBeNull();
      expect(checkSide(addOn, [CMYK, RED, BLACK], kindOf)?.code).toBe('add_on_count');
    });

    it('refuses a method the side does not offer', () => {
      const outsideOnly = side({ methods: ['none'], spot: null, cmyk: null });
      expect(checkSide(outsideOnly, [CMYK], kindOf)?.code).toBe('method_not_offered');
      expect(checkSide(side({ methods: ['spot'] }), [], kindOf)?.code).toBe('method_not_offered');
    });

    it('reads a side into a method', () => {
      expect(selectionOf([], kindOf)).toMatchObject({ method: 'none' });
      expect(selectionOf([BLACK, RED], kindOf)).toMatchObject({
        method: 'spot',
        spotInkColourIds: [BLACK, RED],
      });
      expect(selectionOf([CMYK, RED], kindOf)).toMatchObject({
        method: 'cmyk',
        cmykAddOnInkColourIds: [RED],
      });
    });
  });

  describe('engine inputs', () => {
    it('maps each method to the corrugate ink entries the engine takes (CMYK set = one entry)', () => {
      const addOn = side({ cmyk: { inkColourId: CMYK, addOn: { enabled: true, maxColours: 1 } } });
      const none: PrintSelection = { method: 'none', spotInkColourIds: [], cmykAddOnInkColourIds: [] };
      expect(toCorrugateColours(addOn, { ...none }, 'top')).toEqual([]);
      expect(
        toCorrugateColours(addOn, { ...none, method: 'spot', spotInkColourIds: [BLACK, RED] }, 'top'),
      ).toEqual([
        { inkColourId: BLACK, area: 'top' },
        { inkColourId: RED, area: 'top' },
      ]);
      expect(
        toCorrugateColours(addOn, { ...none, method: 'cmyk', cmykAddOnInkColourIds: [RED] }, 'all_round'),
      ).toEqual([
        { inkColourId: CMYK, area: 'all_round' },
        { inkColourId: RED, area: 'all_round' },
      ]);
    });
  });

  describe('admin model', () => {
    const offered = new Map<string, InkKind>(KINDS);

    it('accepts a consistent model', () => {
      expect(validatePrintModel(MODEL, offered)).toEqual([]);
    });

    it('refuses colours of the wrong kind or not offered, N above the colours listed and a bare add-on', () => {
      const bad: PrintModel = {
        outside: side({
          spot: { maxColours: 3, inkColourIds: [BLACK, CMYK] },
          cmyk: { inkColourId: BLACK, addOn: { enabled: true, maxColours: 0 } },
        }),
        inside: side({ methods: ['spot', 'cmyk'], spot: null, cmyk: null }),
      };
      const codes = validatePrintModel(bad, offered).map((e) => `${e.path}:${e.code}`);
      expect(codes).toEqual(
        expect.arrayContaining([
          'printModel.outside.spot.inkColourIds[1]:colour_not_allowed',
          'printModel.outside.spot.maxColours:spot_count',
          'printModel.outside.cmyk.inkColourId:colour_not_allowed',
          'printModel.outside.cmyk.addOn:add_on_count',
          'printModel.inside.spot:required',
          'printModel.inside.cmyk:required',
        ]),
      );
    });
  });

  describe('store rule (store.quotes.calculate)', () => {
    const db = (printModel: unknown) =>
      ({
        catalogProduct: { findUnique: jest.fn().mockResolvedValue({ printModel }) },
        inkColour: {
          findMany: jest
            .fn()
            .mockResolvedValue([...KINDS].map(([publicId, colourKind]) => ({ publicId, colourKind }))),
        },
      }) as never;
    const config = (parts: unknown[]) => ({ catalogProductId: 'product-1', parts });

    it('refuses ดำ + CMYK on one side with pricing.print_combination_invalid', async () => {
      const error = await assertPrintCombination(
        db(null),
        'corrugate',
        config([{ printFront: [{ inkColourId: BLACK }, { inkColourId: CMYK }] }]),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('pricing.print_combination_invalid');
      expect((error as DomainException).errors).toEqual([
        expect.objectContaining({ path: 'configuration.parts[0].printFront', code: 'cmyk_with_spot' }),
      ]);
    });

    it('accepts CMYK outside and ไม่พิมพ์ inside, and leaves other calculators alone', async () => {
      await expect(
        assertPrintCombination(db(MODEL), 'corrugate', config([{ printFront: [{ inkColourId: CMYK }] }])),
      ).resolves.toBeUndefined();
      await expect(
        assertPrintCombination(
          db(MODEL),
          'folding',
          config([{ printFront: [{ inkColourId: BLACK }, { inkColourId: CMYK }] }]),
        ),
      ).resolves.toBeUndefined();
    });

    it('checks each side against its own model', async () => {
      const insideNone: PrintModel = {
        outside: side(),
        inside: side({ methods: ['none'], spot: null, cmyk: null }),
      };
      const error = await assertPrintCombination(
        db(insideNone),
        'corrugate',
        config([{ printFront: [{ inkColourId: CMYK }], printBack: [{ inkColourId: CMYK }] }]),
      ).catch((e: unknown) => e as DomainException);
      expect((error as DomainException).errors).toEqual([
        expect.objectContaining({ path: 'configuration.parts[0].printBack', code: 'method_not_offered' }),
      ]);
    });
  });
});
