import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  postcodes,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

type Spec = { key: string; labelTh: string; valueTh: string; valueEn: string };
type Summary = {
  product: { slug: string } | null;
  productTypeNameEn: string;
  unit: string;
  specs: Spec[];
};

/** U-B0.1 slice 3: line summaries on quotes, cart items and orders; configurator unit, quantities, design, content. */
describe('line summaries and configurator content (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let admin: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    admin = await staffToken(ctx, 'admin');
    const product = await ctx.prisma.catalogProduct.findUniqueOrThrow({
      where: { slug: 'dev-tuck-end-box' },
    });
    productId = product.publicId;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('publishes the sales unit, admin quantity limits, design options and option content', async () => {
    const api = as(ctx, admin);
    const current = await api.get(`/v1/admin/catalog/catalog-products/${productId}`).expect(200);
    const bad = await api
      .patch(`/v1/admin/catalog/catalog-products/${productId}`, {
        quantityMin: 500,
        quantityPresets: [100, 1000],
      })
      .set('If-Match', current.headers['etag'] as string)
      .expect(422);
    expect(bad.body.errors[0].path).toBe('quantityPresets[0]');
    const updated = await api
      .patch(`/v1/admin/catalog/catalog-products/${productId}`, {
        quantityMin: 500,
        quantityMax: 20000,
        quantityDefault: 1000,
        quantityPresets: [3000, 500, 1000],
      })
      .set('If-Match', current.headers['etag'] as string)
      .expect(200);
    expect(updated.body.quantityPresets).toEqual([500, 1000, 3000]);

    const material = await api.get(`/v1/admin/catalog/materials/${fixture.materialPublicId}`).expect(200);
    await api
      .patch(`/v1/admin/catalog/materials/${fixture.materialPublicId}`, { descriptionTh: 'ผิวเรียบ (ทดสอบ)' })
      .set('If-Match', material.headers['etag'] as string)
      .expect(200);
    const ink = await api.get(`/v1/admin/catalog/ink-colours/${fixture.inkColourPublicId}`).expect(200);
    await api
      .patch(`/v1/admin/catalog/ink-colours/${fixture.inkColourPublicId}`, { swatchHex: '#00a0e9' })
      .set('If-Match', ink.headers['etag'] as string)
      .expect(422);
    await api
      .patch(`/v1/admin/catalog/ink-colours/${fixture.inkColourPublicId}`, { swatchHex: '#00A0E9' })
      .set('If-Match', ink.headers['etag'] as string)
      .expect(200);

    const product = await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { publicId: productId } });
    const inkRow = await ctx.prisma.inkColour.findUniqueOrThrow({
      where: { publicId: fixture.inkColourPublicId },
    });
    await ctx.prisma.catalogProductOption.upsert({
      where: {
        catalogProductId_optionKind_optionId: {
          catalogProductId: product.id,
          optionKind: 'ink_colour',
          optionId: inkRow.id,
        },
      },
      create: { catalogProductId: product.id, optionKind: 'ink_colour', optionId: inkRow.id },
      update: {},
    });
    const res = await request(ctx.server)
      .get('/v1/store/catalog/products/dev-tuck-end-box/configurator')
      .expect(200);
    expect(res.body).toMatchObject({
      unit: 'piece',
      quantity: { min: 500, max: 20000, default: 1000, presets: [500, 1000, 3000], maxTiers: 10 },
      design: { options: ['own_file', 'online_designer', 'hired_design'], default: 'own_file' },
    });
    const groups = res.body.optionGroups as { kind: string; options: { id: string }[] }[];
    const option = (kind: string, id: string) =>
      groups.find((g) => g.kind === kind)?.options.find((o) => o.id === id);
    expect(option('material', fixture.materialPublicId)).toMatchObject({ descriptionTh: 'ผิวเรียบ (ทดสอบ)' });
    expect(option('ink_colour', fixture.inkColourPublicId)).toMatchObject({ swatchHex: '#00A0E9' });
  });

  it('freezes readable spec lines on the quote and shows them on the cart item and the order', async () => {
    const { token } = await customerToken(ctx, 1);
    const customer = as(ctx, token);
    const saved = await customer
      .post('/v1/store/quotes', {
        productTypeCode: 'folding_carton',
        configuration: { ...foldingConfiguration(fixture, [1000]), catalogProductId: productId },
      })
      .expect(201);
    const summary = saved.body.summary as Summary;
    expect(summary).toMatchObject({ product: { slug: 'dev-tuck-end-box' }, unit: 'piece' });
    const keys = summary.specs.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['style', 'size', 'material', 'print_front', 'coating_front', 'diecut']),
    );
    // The size names its measurement basis (D-182): the dev style is a flat product, measured finished.
    expect(summary.specs.find((s) => s.key === 'size')).toMatchObject({
      valueEn: '200 × 300 × 50 mm (finished size)',
    });
    expect(saved.body.options[0]).toHaveProperty('toolingAmount');

    // Renaming the material later does not rewrite what the customer was quoted.
    const material = await ctx.prisma.material.findUniqueOrThrow({
      where: { publicId: fixture.materialPublicId },
    });
    await ctx.prisma.material.update({
      where: { id: material.id },
      data: { nameEn: `${material.nameEn} (renamed)` },
    });
    try {
      const again = await customer.get(`/v1/store/quotes/${saved.body.id}`).expect(200);
      expect(again.body.summary).toEqual(summary);

      const address = await addAddress(ctx, token, postcode);
      const cart = await customer.get('/v1/store/cart').expect(200);
      const added = await customer
        .post('/v1/store/cart/items', {
          quoteId: saved.body.id,
          quoteOptionId: saved.body.options[0].id,
          designOption: 'own_file',
          destinations: [{ addressId: address.id, quantity: 1000 }],
        })
        .set('If-Match', cart.headers['etag'] as string)
        .expect(201);
      expect(added.body.items[0].summary).toEqual(summary);

      const placed = await customer
        .post('/v1/store/checkout', {})
        .set('Idempotency-Key', crypto.randomUUID())
        .expect(201);
      const order = await customer.get(`/v1/store/orders/${placed.body.orders[0].id}`).expect(200);
      expect(order.body.summary).toEqual(summary);
    } finally {
      await ctx.prisma.material.update({ where: { id: material.id }, data: { nameEn: material.nameEn } });
    }
  });
});
