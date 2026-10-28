import { DomainException } from '@common/errors/domain.exception';

import {
  checkSide,
  defaultSelection,
  type InkKind,
  limitSide,
  type PrintLimits,
  type PrintModel,
  type PrintSelection,
  type PrintSideConfig,
  selectionOf,
  storePrintModel,
  toCorrugateColours,
  validatePrintModel,
} from './print-model';
import { modelInForce, versionInForce } from './print-model-versions';
import { assertPrintCombination, printCombinationErrors } from './print-rules';

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

/** The seeded `catalog.print_limits` (B-API-6): 1 spot colour per side, no CMYK + spot add-on. */
const SEEDED_LIMITS: PrintLimits = { maxSpotColoursPerSide: 1, cmykSpotAddOnEnabled: false };
/** A `settings` row with one approved version, as `SettingsService` reads it (null: no setting). */
const limitsSetting = (limits: PrintLimits | null) =>
  limits && {
    id: 1n,
    versions: [{ id: 2n, versionNo: 1, effectiveFrom: new Date('2026-01-01T00:00:00Z'), value: limits }],
  };

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
    const db = (printModel: unknown, limits: PrintLimits | null = null) =>
      ({
        catalogProductPrintModel: {
          findFirst: jest.fn().mockResolvedValue(printModel === null ? null : { model: printModel }),
        },
        setting: { findFirst: jest.fn().mockResolvedValue(limitsSetting(limits)) },
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

  describe('B-API-6: what the engine can price (catalog.print_limits)', () => {
    const wide: PrintModel = {
      outside: side({
        spot: { maxColours: 2, inkColourIds: [BLACK, RED] },
        cmyk: { inkColourId: CMYK, addOn: { enabled: true, maxColours: 1 } },
      }),
      inside: side(),
    };

    it('caps N at the limit and turns the CMYK add-on off while the limits disable it', () => {
      expect(limitSide(wide.outside, SEEDED_LIMITS)).toEqual({
        methods: ['none', 'spot', 'cmyk'],
        spot: { maxColours: 1, inkColourIds: [BLACK, RED] },
        cmyk: { inkColourId: CMYK, addOn: { enabled: false, maxColours: 0 } },
      });
      expect(limitSide(wide.outside, { maxSpotColoursPerSide: 2, cmykSpotAddOnEnabled: true })).toEqual(
        wide.outside,
      );
      expect(limitSide(wide.outside, null)).toBe(wide.outside);
    });

    it('the configurator does not offer combinations beyond the limits', () => {
      const view = storePrintModel(wide, null, kindOf, null, SEEDED_LIMITS);
      expect(view.outside.spot).toEqual({ minColours: 1, maxColours: 1, inkColourIds: [BLACK, RED] });
      expect(view.outside.cmyk?.addOn).toEqual({ enabled: false, minColours: 0, maxColours: 0 });
    });

    it('refuses 2 spot colours and CMYK + spot on a side under the seeded limits, even when the model allows them', () => {
      expect(checkSide(wide.outside, [BLACK, RED], kindOf, SEEDED_LIMITS)?.code).toBe('spot_count');
      expect(checkSide(wide.outside, [CMYK, RED], kindOf, SEEDED_LIMITS)?.code).toBe('cmyk_with_spot');
      expect(checkSide(wide.outside, [BLACK, RED], kindOf, null)).toBeNull();
      // Without a model too.
      expect(checkSide(null, [BLACK, RED], kindOf, SEEDED_LIMITS)?.code).toBe('spot_count');
      expect(checkSide(null, [BLACK], kindOf, SEEDED_LIMITS)).toBeNull();
    });

    it('the admin cannot save a model beyond the limits', () => {
      const offered = new Map<string, InkKind>(KINDS);
      expect(validatePrintModel(wide, offered, SEEDED_LIMITS)).toEqual([
        expect.objectContaining({ path: 'printModel.outside.spot.maxColours', code: 'spot_count' }),
        expect.objectContaining({ path: 'printModel.outside.cmyk.addOn.enabled', code: 'add_on_count' }),
      ]);
      expect(validatePrintModel(MODEL, offered, SEEDED_LIMITS)).toEqual([]);
    });

    it('reads the limits from the setting in force (no limits while it has no version)', async () => {
      const cfg = {
        catalogProductId: 'product-1',
        parts: [{ printFront: [{ inkColourId: BLACK }, { inkColourId: RED }] }],
      };
      const dbFor = (limits: PrintLimits | null) =>
        ({
          catalogProductPrintModel: { findFirst: jest.fn().mockResolvedValue({ model: wide }) },
          setting: { findFirst: jest.fn().mockResolvedValue(limitsSetting(limits)) },
          inkColour: {
            findMany: jest
              .fn()
              .mockResolvedValue([...KINDS].map(([publicId, colourKind]) => ({ publicId, colourKind }))),
          },
        }) as never;
      expect(await printCombinationErrors(dbFor(SEEDED_LIMITS), 'corrugate', cfg)).toEqual([
        expect.objectContaining({ path: 'configuration.parts[0].printFront', code: 'spot_count' }),
      ]);
      expect(await printCombinationErrors(dbFor(null), 'corrugate', cfg)).toEqual([]);
    });
  });

  describe('B-API-6: effective-dated print model (ADR-0005)', () => {
    const v = (versionNo: number, from: string, model: unknown) => ({
      versionNo,
      effectiveFrom: new Date(from),
      model,
    });
    const versions = [
      v(1, '2026-10-01T00:00:00Z', MODEL),
      v(2, '2026-11-01T00:00:00Z', null),
      v(3, '2026-11-01T00:00:00Z', { outside: side({ methods: ['none'] }), inside: side() }),
    ];

    it('uses the version in force: greatest effectiveFrom ≤ at, ties by version number', () => {
      expect(versionInForce(versions, new Date('2026-09-30T00:00:00Z'))).toBeNull();
      expect(versionInForce(versions, new Date('2026-10-26T00:00:00Z'))?.versionNo).toBe(1);
      expect(versionInForce(versions, new Date('2026-11-02T00:00:00Z'))?.versionNo).toBe(3);
    });

    it('a future version does not change today’s model; a cleared version means no model', () => {
      expect(modelInForce(versions, new Date('2026-10-26T00:00:00Z'))).toEqual(MODEL);
      expect(modelInForce([v(1, '2026-10-01T00:00:00Z', null)], new Date('2026-10-26T00:00:00Z'))).toBeNull();
    });

    it('the store rule reads the version in force at the time it is given', async () => {
      const findFirst = jest.fn().mockResolvedValue({ model: MODEL });
      const at = new Date('2026-10-26T03:00:00Z');
      await printCombinationErrors(
        {
          catalogProductPrintModel: { findFirst },
          setting: { findFirst: jest.fn().mockResolvedValue(null) },
          inkColour: { findMany: jest.fn().mockResolvedValue([]) },
        } as never,
        'corrugate',
        { catalogProductId: 'product-1', parts: [{ printFront: [] }] },
        at,
      );
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { catalogProduct: { publicId: 'product-1' }, effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        }),
      );
    });
  });
});

describe('C0b: more colours than priced go to the quote path (DECISIONS-STAGE-A §9.5)', () => {
  it('offers up to the side’s spot inks beyond the priced count, without changing the limits', () => {
    const view = storePrintModel(MODEL, null, kindOf, null, SEEDED_LIMITS);
    expect(view.outside.spot?.maxColours).toBe(1);
    expect(view.outside.cmyk?.addOn).toEqual({ enabled: false, minColours: 0, maxColours: 0 });
    expect(view.outside.quote).toEqual({ spotMaxColours: 2, cmykAddOnMaxColours: 2 });
  });

  it('has nothing beyond when every offered ink is priced or no spot ink is offered', () => {
    const one: PrintModel = {
      outside: side({
        spot: { maxColours: 1, inkColourIds: [BLACK] },
        cmyk: null,
        methods: ['none', 'spot'],
      }),
      inside: side({ spot: null, methods: ['none', 'cmyk'] }),
    };
    const view = storePrintModel(one, null, kindOf, null, SEEDED_LIMITS);
    expect(view.outside.quote).toBeNull();
    expect(view.inside.quote).toBeNull();
  });
});
