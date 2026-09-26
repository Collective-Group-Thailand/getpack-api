import { type Tx } from '@database/prisma.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';

import { dimensionBand, quantityBand, specErrors } from './rfq-spec';
import { UnmetDemandSubscriber } from './unmet-demand.subscriber';

describe('RFQ spec and bands (D-100, D-102)', () => {
  const schema = {
    type: 'object',
    required: ['material'],
    properties: { material: { type: 'string' }, colours: { type: 'integer', maximum: 4 } },
  };

  it('accepts any object without a schema and validates against one', () => {
    expect(specErrors(null, { anything: 1 })).toEqual([]);
    expect(specErrors(schema, { material: 'kraft' })).toEqual([]);
    expect(
      specErrors(schema, { colours: 9 })
        .map((e) => e.path)
        .sort(),
    ).toEqual(['spec.colours', 'spec.material']);
    expect(specErrors(schema, [])).toEqual([
      { path: 'spec', code: 'type', message: 'spec must be a JSON object' },
    ]);
    expect(specErrors({ type: 'nope' }, {})[0]!.code).toBe('schema');
  });

  it('bands quantities and dimensions', () => {
    expect([1, 99, 100, 999, 1000, 4999, 5000, 60_000].map(quantityBand)).toEqual([
      '0-99',
      '0-99',
      '100-499',
      '500-999',
      '1000-4999',
      '1000-4999',
      '5000-9999',
      '50000+',
    ]);
    expect([dimensionBand(249.9), dimensionBand(250), dimensionBand(null)]).toEqual([200, 250, null]);
  });
});

describe('unmet demand from calculations (D-102)', () => {
  const created: unknown[] = [];
  const tx = {
    unmetDemandRecord: {
      findUnique: () => Promise.resolve(created.length > 0 ? { id: 1n } : null),
      create: (args: { data: unknown }) => {
        created.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    geoSubdistrict: { findFirst: () => Promise.resolve({ district: { provinceId: 7n } }) },
  } as unknown as Tx;
  const event = (payload: Record<string, unknown>): DomainEventEnvelope =>
    ({
      id: 'e1',
      type: 'quote.calculated',
      occurredAt: '2026-10-01T02:00:00Z',
      payload,
    }) as unknown as DomainEventEnvelope;

  it('records calculations without an instant price once, banded', async () => {
    const subscriber = new UnmetDemandSubscriber();
    await subscriber.onCalculated(event({ instant: true, reasons: [] }), tx);
    expect(created).toHaveLength(0);
    const payload = {
      instant: false,
      reasons: ['capacity_unavailable'],
      productTypeId: '3',
      quantities: [800, 1200],
      dimensionsMm: { w: 120, l: 180, d: 60 },
      deliveryPostcode: '10110',
      calculateLogId: '42',
      occurredAt: '2026-10-01T02:00:00Z',
    };
    await subscriber.onCalculated(event(payload), tx);
    await subscriber.onCalculated(event(payload), tx);
    expect(created).toEqual([
      expect.objectContaining({
        source: 'capacity_limited',
        productTypeId: 3n,
        quantityBand: '1000-4999',
        provinceId: 7n,
        calculateLogId: 42n,
        specBand: { widthMm: 100, lengthMm: 150, heightMm: 50 },
        domainEventId: 'e1',
      }),
    ]);
  });
});
