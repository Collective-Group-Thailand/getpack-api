import { MoneyDecimal } from '@common/money/money';
import { type SheetRows } from '@modules/catalog/imports/workbook';

import { bandAmount, bandMatches, matchBand, type RateBand } from './rate-bands';
import { parseRateSheet, ratePreviewSha, rateSheetHeaders, rateSheetRows } from './rate-sheet';

const band = (over: Partial<RateBand> & { id: bigint }): RateBand => ({
  zoneId: 1n,
  postcode: null,
  weightMinG: 0,
  weightMaxG: null,
  volumeMinCm3: null,
  volumeMaxCm3: null,
  amount: new MoneyDecimal('100.00'),
  perExtraKg: null,
  ...over,
});

describe('rate bands (D-013)', () => {
  it('matches half-open weight bands; a null upper bound is open', () => {
    const b = band({ id: 1n, weightMinG: 1000, weightMaxG: 5000 });
    expect(bandMatches(b, { weightG: 999, volumeCm3: null })).toBe(false);
    expect(bandMatches(b, { weightG: 1000, volumeCm3: null })).toBe(true);
    expect(bandMatches(b, { weightG: 4999, volumeCm3: null })).toBe(true);
    expect(bandMatches(b, { weightG: 5000, volumeCm3: null })).toBe(false);
    expect(bandMatches(band({ id: 2n, weightMinG: 5000 }), { weightG: 900_000, volumeCm3: null })).toBe(true);
  });

  it('needs a known volume only for bands with volume bounds', () => {
    const any = band({ id: 1n });
    const sized = band({ id: 2n, volumeMinCm3: 0n, volumeMaxCm3: 50_000n });
    expect(bandMatches(any, { weightG: 10, volumeCm3: null })).toBe(true);
    expect(bandMatches(sized, { weightG: 10, volumeCm3: null })).toBe(false);
    expect(bandMatches(sized, { weightG: 10, volumeCm3: 49_999 })).toBe(true);
    expect(bandMatches(sized, { weightG: 10, volumeCm3: 50_000 })).toBe(false);
  });

  it('prefers a postcode row over its zone rows and ignores other zones', () => {
    const bands = [
      band({ id: 1n, amount: new MoneyDecimal('100.00') }),
      band({ id: 2n, postcode: '10110', amount: new MoneyDecimal('80.00') }),
      band({ id: 3n, zoneId: 2n, amount: new MoneyDecimal('300.00') }),
    ];
    expect(matchBand(bands, 1n, '10110', { weightG: 10, volumeCm3: null })?.id).toBe(2n);
    expect(matchBand(bands, 1n, '10120', { weightG: 10, volumeCm3: null })?.id).toBe(1n);
    expect(matchBand(bands, 2n, '50000', { weightG: 10, volumeCm3: null })?.id).toBe(3n);
    expect(matchBand(bands, 3n, '90000', { weightG: 10, volumeCm3: null })).toBeNull();
  });

  it('falls back to the zone rows when no postcode row matches the weight', () => {
    const bands = [
      band({ id: 1n, weightMinG: 0 }),
      band({ id: 2n, postcode: '10110', weightMinG: 0, weightMaxG: 1000 }),
    ];
    expect(matchBand(bands, 1n, '10110', { weightG: 2000, volumeCm3: null })?.id).toBe(1n);
  });

  it('adds per-extra-kg for every started kilogram above the band minimum', () => {
    const b = band({
      id: 1n,
      weightMinG: 5000,
      amount: new MoneyDecimal('200.00'),
      perExtraKg: new MoneyDecimal('10.5'),
    });
    expect(bandAmount(b, 5000).toFixed(2)).toBe('200.00');
    expect(bandAmount(b, 5001).toFixed(2)).toBe('210.50');
    expect(bandAmount(b, 7300).toFixed(2)).toBe('231.50');
    expect(bandAmount(band({ id: 2n }), 12_345).toFixed(2)).toBe('100.00');
  });
});

describe('rate sheet', () => {
  const layout = { amountColumn: 'price_amount' };
  const sheet = (
    rows: Record<string, string | number | null>[],
    headers = rateSheetHeaders(layout),
  ): SheetRows[] => [{ name: 'rates', headers, rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })) }];

  it('parses rows and pads numeric postcodes', () => {
    const parsed = parseRateSheet(
      sheet([
        {
          zone_code: 'bkk',
          postcode: null,
          weight_min_g: 0,
          weight_max_g: 5000,
          volume_min_cm3: null,
          volume_max_cm3: null,
          price_amount: '120',
          per_extra_kg: null,
        },
        {
          zone_code: 'north',
          postcode: 1234,
          weight_min_g: 0,
          weight_max_g: null,
          volume_min_cm3: null,
          volume_max_cm3: null,
          price_amount: 150.5,
          per_extra_kg: '12.25',
        },
      ]),
      layout,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rates[1]).toMatchObject({
      zoneCode: 'north',
      postcode: '01234',
      amount: '150.5',
      perExtraKg: '12.25',
    });
    expect(rateSheetRows(layout, parsed.rates)[0]).toMatchObject({ zone_code: 'bkk', price_amount: '120' });
  });

  it('reports missing sheets, headers and invalid cells with row numbers', () => {
    expect(parseRateSheet([], layout).errors[0]).toMatchObject({ code: 'sheet' });
    expect(parseRateSheet(sheet([], ['zone_code']), layout).errors.map((e) => e.column)).toContain(
      'price_amount',
    );
    const parsed = parseRateSheet(
      sheet([
        {
          zone_code: null,
          postcode: 'abc',
          weight_min_g: -1,
          weight_max_g: 0,
          volume_min_cm3: null,
          volume_max_cm3: null,
          price_amount: '-5',
          per_extra_kg: null,
        },
      ]),
      layout,
    );
    expect(parsed.rates).toEqual([]);
    expect(parsed.errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [2, 'zone_code', 'required'],
      [2, 'postcode', 'pattern'],
      [2, 'weight_min_g', 'int'],
      [2, 'price_amount', 'decimal'],
      [2, 'weight_max_g', 'range'],
    ]);
  });

  it('fingerprints the version, the file and the plan', () => {
    const parsed = parseRateSheet(sheet([]), layout);
    const a = ratePreviewSha('v1', 'f1', parsed);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(ratePreviewSha('v2', 'f1', parsed)).not.toBe(a);
    expect(ratePreviewSha('v1', 'f2', parsed)).not.toBe(a);
  });
});
