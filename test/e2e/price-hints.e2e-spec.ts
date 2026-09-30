import { PriceHintsService } from '@modules/pricing/hints/price-hints.service';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';

type Hint = {
  key: string;
  startingFromPerPiece: string | null;
  basis: { quantity: number; includesVat: boolean; includesDelivery: boolean; specs: unknown[] } | null;
  leadTimeBusinessDays: { min: number; max: number } | null;
};

/** U-B0.1 slice 4: "starting from" prices from an admin reference configuration (D-220, D-181). */
describe('price hints (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let admin: string;
  let productId: string;
  const slug = 'dev-tuck-end-box';
  const hints = async () =>
    (await request(ctx.server).get(`/v1/store/catalog/price-hints?slugs=${slug}&skus=NO-SUCH-SKU`).expect(200))
      .body as Hint[];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    admin = await staffToken(ctx, 'admin');
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug } })).publicId;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const put = async (configuration: object, status: number) => {
    const api = as(ctx, admin);
    const current = await api.get(`/v1/admin/catalog/catalog-products/${productId}`).expect(200);
    return api
      .put(`/v1/admin/catalog/catalog-products/${productId}/reference-configuration`, { configuration })
      .set('If-Match', current.headers['etag'] as string)
      .expect(status);
  };

  it('has no hint without a reference configuration', async () => {
    const [hint] = await hints();
    expect(hint).toMatchObject({ key: slug, startingFromPerPiece: null, basis: null });
  });

  it('refuses a reference with more than one quantity', async () => {
    const res = await put(foldingConfiguration(fixture, [500, 1000]), 422);
    expect(res.body.errors[0].path).toBe('configuration.quantities');
  });

  it('prices the reference with the real calculator, rounded up, with its basis (D-220)', async () => {
    const logsBefore = await ctx.prisma.calculateLog.count();
    const saved = await put(foldingConfiguration(fixture, [1000]), 200);
    expect(saved.body.referenceConfiguration).toMatchObject({ quantities: [1000], catalogProductId: productId });
    expect(await ctx.prisma.calculateLog.count()).toBe(logsBefore); // not a customer calculation (D-102)

    const calc = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration: foldingConfiguration(fixture, [1000]) })
      .expect(200);
    const unitPrice = calc.body.steps[0].unitPrice as string;
    expect(calc.body.calculationId).toMatch(/^[0-9a-f-]{36}$/); // for routedFrom (U-B0.1)
    const [hint, stock] = await hints();
    expect(Number(hint!.startingFromPerPiece)).toBeGreaterThanOrEqual(Number(unitPrice));
    expect(Number(hint!.startingFromPerPiece) - Number(unitPrice)).toBeLessThan(0.01);
    expect(hint).toMatchObject({
      basis: { quantity: 1000, includesVat: true, includesDelivery: false },
      leadTimeBusinessDays: { min: calc.body.steps[0].leadTimeDays, max: calc.body.steps[0].leadTimeDays },
    });
    expect(hint!.basis!.specs.length).toBeGreaterThan(2);
    expect(JSON.stringify(hint)).not.toMatch(/factory|buyPrice|margin/i);
    expect(stock).toBeUndefined(); // unknown SKUs are not listed
  });

  it('drops the hint when the type goes back to RFQ, and when the reference is removed', async () => {
    await ctx.prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
    await ctx.app.get(PriceHintsService).refresh();
    expect((await hints())[0]).toMatchObject({ startingFromPerPiece: null });
    await ctx.prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'instant' } });
    await ctx.app.get(PriceHintsService).refresh();
    expect((await hints())[0]!.startingFromPerPiece).not.toBeNull();

    const api = as(ctx, admin);
    const current = await api.get(`/v1/admin/catalog/catalog-products/${productId}`).expect(200);
    await api
      .delete(`/v1/admin/catalog/catalog-products/${productId}/reference-configuration`)
      .set('If-Match', current.headers['etag'] as string)
      .expect(200);
    expect((await hints())[0]).toMatchObject({ startingFromPerPiece: null });
  });
});
