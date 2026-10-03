import { randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  postcodes,
  seedShipping,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

type Step = {
  quantity: number;
  instant: boolean;
  unitPrice: string | null;
  grossAmount: string | null;
  shippingAmount: string | null;
};
/** The product price of a step: its gross without the shipping priced with it. */
const productGross = (s: Step) => (Number(s.grossAmount) - Number(s.shippingAmount ?? 0)).toFixed(2);

/** A small deterministic generator (mulberry32): the property runs reproduce. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** U4.B2 quote from design (D-277): spec hash, cache, change reasons, saved quotation and checkout parity. */
describe('studio quotes (e2e, U4.B2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let productId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
    token = (await customerToken(ctx, 71)).token;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** A studio design whose box is the folding configuration's (sizes, material, outside print). */
  async function design(
    spec: Record<string, unknown>,
    title = 'สตูดิโอราคา (fake)',
    box: Record<string, unknown> = spec,
  ) {
    const res = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        patternId: fixture.patternPublicId,
        title,
        schemaVersion: 1,
        document: { faces: {} },
        lengthMm: box['l'],
        widthMm: box['w'],
        heightMm: box['d'],
        // The dev folding style is flat: its sizes are product sizes (D-182).
        measurementBasis: 'product',
        materialId: fixture.materialPublicId,
        printMethod: 'offset',
        printSides: 'outside',
        spec,
      })
      .expect(201);
    return { id: res.body.id as string, etag: res.headers['etag'] as string };
  }

  const specOf = (overrides: Record<string, unknown> = {}) => {
    const { quantities: _q, ...spec } = foldingConfiguration(fixture, [1000]);
    void _q;
    return { ...spec, ...overrides };
  };

  it('prices a design like store.quotes.calculate, with a spec hash served from its snapshot', async () => {
    const d = await design(specOf());
    const first = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [3000, 1000] })
      .expect(200);
    expect(first.body).toMatchObject({ mode: 'instant', versionNo: 1, cached: false, reasons: [] });
    expect(first.body.specHash).toMatch(/^[0-9a-f]{64}$/);
    const direct = await as(ctx, token)
      .post('/v1/store/quotes/actions/calculate', {
        productTypeCode: 'folding_carton',
        configuration: { ...foldingConfiguration(fixture, [1000, 3000]), basis: 'product' },
      })
      .expect(200);
    const prices = (steps: Step[]) => steps.map((s) => [s.quantity, s.unitPrice, s.grossAmount]);
    expect(prices(first.body.calculation.steps as Step[])).toEqual(prices(direct.body.steps as Step[]));
    const again = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000, 3000] })
      .expect(200);
    expect(again.body).toMatchObject({ specHash: first.body.specHash, cached: true });
  });

  it('explains a price change against the previous spec hash', async () => {
    const d = await design(specOf(), 'เปลี่ยนราคา (fake)');
    const before = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000] })
      .expect(200);
    // The customer drops a colour: a new version with another spec.
    const fewer = specOf({
      parts: [
        {
          ...(specOf()['parts'] as Record<string, unknown>[])[0],
          printFront: [{ inkColourId: fixture.inkColourPublicId, percent: 100 }],
        },
      ],
    });
    await as(ctx, token)
      .patch(`/v1/store/designs/${d.id}/document`)
      .set('If-Match', d.etag)
      .send({ operations: [{ op: 'add', path: '/note', value: 1 }], spec: fewer })
      .expect(200);
    const after = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, {
        quantities: [1000, 2000],
        previousSpecHash: before.body.specHash,
      })
      .expect(200);
    expect(after.body).toMatchObject({
      versionNo: 2,
      previousSpecHash: before.body.specHash,
      reasons: ['print_changed', 'quantity_changed'],
    });
    expect(after.body.changes).toEqual([
      expect.objectContaining({
        quantity: 1000,
        previousUnitPrice: (before.body.calculation.steps as Step[])[0]!.unitPrice,
      }),
    ]);
  });

  it('refuses a spec that is not the box, and a design without a spec', async () => {
    const d = await design(specOf({ l: 999 }), 'ไม่ตรง (fake)', specOf());
    const res = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000] })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'studio.spec_mismatch', errors: [{ path: 'spec.l' }] });
    const bare = await as(ctx, token)
      .post('/v1/store/designs', { catalogProductId: productId, title: 'ว่าง (fake)', document: {} })
      .expect(201);
    const none = await as(ctx, token)
      .post(`/v1/store/studio/${bare.body.id}/quote`, { quantities: [1000] })
      .expect(422);
    expect(none.body.code).toBe('studio.spec_missing');
    const other = (await customerToken(ctx, 72)).token;
    await as(ctx, other)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000] })
      .expect(404);
  });

  it('charges at checkout exactly the studio price of the same spec hash (spec §1)', async () => {
    const d = await design(specOf(), 'สั่งผลิต (fake)');
    const studio = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000], deliveryPostcode: code })
      .expect(200);
    const saved = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/quote/actions/save`, { quantities: [1000], deliveryPostcode: code })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const row = await ctx.prisma.quote.findUniqueOrThrow({ where: { publicId: saved.body.id as string } });
    expect(Buffer.from(row.specHash!).toString('hex')).toBe(studio.body.specHash);
    const step = (studio.body.calculation.steps as Step[])[0]!;
    expect(saved.body.options[0]).toMatchObject({ quantity: 1000, unitPrice: step.unitPrice });
    const address = await addAddress(ctx, token, code);
    const cart = await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: saved.body.id,
        quoteOptionId: saved.body.options[0].id,
        destinations: [{ addressId: address.id, quantity: 1000 }],
        designOption: 'online_designer',
        designDocumentId: d.id,
      })
      .expect(201);
    const item = (cart.body.items as { productGrossAmount: string; designVersionNo: number }[]).at(-1)!;
    expect(item).toMatchObject({ designVersionNo: 1, productGrossAmount: productGross(step) });
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: (placed.body.orders as { id: string }[]).at(-1)!.id },
      include: { lines: true },
    });
    const product = order.lines.filter((l) => l.lineType !== 'shipping');
    const gross = product.reduce((n, l) => n + Number(l.grossAmount), 0);
    expect(gross.toFixed(2)).toBe(productGross(step));
  });

  it('property: over random specs the saved quotation always equals the studio quote of the same hash', async () => {
    const next = rng(20261003);
    for (let i = 0; i < 6; i++) {
      const spec = specOf({
        w: 80 + Math.floor(next() * 200),
        l: 80 + Math.floor(next() * 300),
        d: 20 + Math.floor(next() * 80),
      });
      const quantities = [500 + Math.floor(next() * 20) * 100];
      const d = await design(spec, `สุ่ม ${i} (fake)`);
      const studio = await as(ctx, token).post(`/v1/store/studio/${d.id}/quote`, { quantities }).expect(200);
      const step = (studio.body.calculation.steps as Step[])[0]!;
      if (!step.instant) continue;
      const saved = await as(ctx, token)
        .post(`/v1/store/studio/${d.id}/quote/actions/save`, { quantities })
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      expect(saved.body.options[0]).toMatchObject({ quantity: quantities[0], unitPrice: step.unitPrice });
    }
  });

  it('asks for a quotation of a non-instant type with the design version', async () => {
    const d = await design(specOf(), 'ขอราคา (fake)');
    await foldingBackToRfq(ctx);
    try {
      const quote = await as(ctx, token)
        .post(`/v1/store/studio/${d.id}/quote`, { quantities: [1000] })
        .expect(200);
      expect(quote.body).toMatchObject({ mode: 'rfq', calculation: null });
      const rfq = await as(ctx, token)
        .post(`/v1/store/studio/${d.id}/rfq`, { quantities: [1000], deliveryPostcode: code, spec: {} })
        .set('Idempotency-Key', randomUUID());
      if (rfq.status === 201) {
        expect(rfq.body).toMatchObject({
          design: { designId: d.id, versionNo: 1 },
          lengthMm: 300,
          widthMm: 200,
        });
      } else {
        // The dev folding form may require answers: the refusal is the form's, never the studio's.
        expect(rfq.body.code).toBe('validation.failed');
        expect((rfq.body.errors as { path: string }[]).every((e) => e.path.startsWith('spec'))).toBe(true);
      }
    } finally {
      await foldingReady(ctx);
    }
  });
});
