import { envelopeCovers, type EnvelopeFacts, mergeEnvelopes, parseEnvelope } from './tier-b-envelope';

const PT = '019a0000-0000-7000-8000-000000000001';
const PT2 = '019a0000-0000-7000-8000-000000000002';
const STD = '019a0000-0000-7000-8000-0000000000a1';
const ART = '019a0000-0000-7000-8000-0000000000b1';
const KRAFT = '019a0000-0000-7000-8000-0000000000b2';
const SKU = '019a0000-0000-7000-8000-0000000000c1';

const facts = (over: Partial<EnvelopeFacts> = {}): EnvelopeFacts => ({
  patternId: null,
  materialIds: [ART],
  size: { w: 200, l: 300, d: 50 },
  standardSizeIds: [],
  stockProductId: null,
  catalogProductId: null,
  ...over,
});

describe('tier-B envelope (D-043, D-234)', () => {
  it('accepts only the dimensions the calculator carries, and at least one', () => {
    expect(
      parseEnvelope('folding', { materialIds: [ART], quantity: { min: 500, max: null } }).errors,
    ).toEqual([]);
    expect(parseEnvelope('label', { patternIds: [ART] }).errors[0]).toMatchObject({
      path: 'envelope.patternIds',
    });
    expect(parseEnvelope('standard_product', { sizeRanges: [{ wMax: 10 }] }).errors[0]!.path).toBe(
      'envelope.sizeRanges',
    );
    expect(parseEnvelope('service', {}).errors[0]!.message).toMatch(/at least one dimension/);
    expect(parseEnvelope('folding', []).errors[0]!.message).toBe('must be an object');
  });

  it('checks bands, uuids and duplicates', () => {
    const { errors } = parseEnvelope('corrugate', {
      quantity: { min: 1000, max: 10 },
      sizeRanges: [{ wMin: 300, wMax: 200 }, {}],
      materialIds: ['not-a-uuid'],
      printTypeIds: [PT, PT],
    });
    expect(errors.map((e) => e.path)).toEqual([
      'envelope.quantity.max',
      'envelope.sizeRanges[0].wMax',
      'envelope.sizeRanges[1]',
      'envelope.printTypeIds',
      'envelope.materialIds',
    ]);
  });

  it('normalises ids to lower case and open bounds to null', () => {
    const { envelope } = parseEnvelope('folding', {
      sizeRanges: [{ wMax: 250 }],
      printTypeIds: [PT.toUpperCase()],
    });
    expect(envelope).toEqual({
      sizeRanges: [{ wMin: null, wMax: 250, lMin: null, lMax: null, dMin: null, dMax: null }],
      printTypeIds: [PT],
    });
  });

  it('covers a configuration only when every restricted dimension matches', () => {
    const envelope = parseEnvelope('folding', {
      quantity: { min: 500, max: 5000 },
      printTypeIds: [PT],
      materialIds: [ART],
      sizeRanges: [{ wMin: 100, wMax: 250, lMin: 100, lMax: 350 }],
    }).envelope;
    expect(envelopeCovers(envelope, facts(), 1000, PT)).toBe(true);
    expect(envelopeCovers(envelope, facts(), 100, PT)).toBe(false);
    expect(envelopeCovers(envelope, facts(), 1000, PT2)).toBe(false);
    expect(envelopeCovers(envelope, facts({ materialIds: [KRAFT] }), 1000, PT)).toBe(false);
    expect(envelopeCovers(envelope, facts({ size: { w: 260, l: 300, d: 50 } }), 1000, PT)).toBe(false);
    // A dimension the configuration cannot answer is not covered (fail closed).
    expect(envelopeCovers(envelope, facts({ size: null }), 1000, PT)).toBe(false);
  });

  it('treats size ranges and standard sizes as one dimension', () => {
    const envelope = parseEnvelope('corrugate', {
      sizeRanges: [{ wMax: 150, dMin: 10, dMax: 60 }],
      standardSizeIds: [STD],
    }).envelope;
    expect(envelopeCovers(envelope, facts({ size: { w: 120, l: 900, d: 40 } }), 1, PT)).toBe(true);
    expect(envelopeCovers(envelope, facts({ size: { w: 120, l: 900, d: null } }), 1, PT)).toBe(false);
    expect(envelopeCovers(envelope, facts({ standardSizeIds: [STD] }), 1, PT)).toBe(true);
    expect(envelopeCovers(envelope, facts(), 1, PT)).toBe(false);
  });

  it('covers stock products and service items by id', () => {
    const stock = parseEnvelope('standard_product', { stockProductIds: [SKU] }).envelope;
    expect(envelopeCovers(stock, facts({ stockProductId: SKU }), 10, PT)).toBe(true);
    expect(envelopeCovers(stock, facts(), 10, PT)).toBe(false);
  });

  it('summarises only what every path restricts, with no factory identity', () => {
    const a = parseEnvelope('folding', { materialIds: [ART], quantity: { min: 500, max: 2000 } }).envelope;
    const b = parseEnvelope('folding', { materialIds: [KRAFT], quantity: { min: 1000, max: null } }).envelope;
    const c = parseEnvelope('folding', { standardSizeIds: [STD] }).envelope;
    expect(mergeEnvelopes([a, b])).toEqual({
      materialIds: [ART, KRAFT].sort(),
      quantity: { min: 500, max: null },
    });
    expect(mergeEnvelopes([a, c])).toEqual({});
    expect(mergeEnvelopes([])).toEqual({});
  });
});
