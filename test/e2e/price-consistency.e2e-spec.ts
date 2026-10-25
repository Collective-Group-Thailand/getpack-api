import { PriceHintsService } from '@modules/pricing/hints/price-hints.service';
import request from 'supertest';

import {
  as,
  bootCommerceApp,
  type CommerceApp,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';

type Label = { th: string; en: string };
type Spec = { key: string; valueTh: string };

/**
 * D-441 (pdp Phase 0, GLOBAL-RULES §5): one price and one spec label for the same spec everywhere. For EVERY
 * instant-price catalogue product with a starting price, the configurator's own price for its default spec at the
 * reference quantity (`store.quotes.calculate`) equals the starting price of the price hints, the product card,
 * the product page (and so its JSON-LD), and every surface names the same spec in the same words.
 */
describe('price consistency (e2e, D-441)', () => {
  let ctx: CommerceApp;
  let admin: ReturnType<typeof as>;
  let productId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    const fixture = await foldingReady(ctx);
    // Give the dev folding product a default spec (D-220), so at least one instant product has a starting price.
    admin = as(ctx, await staffToken(ctx, 'admin'));
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
    const current = await admin.get(`/v1/admin/catalog/catalog-products/${productId}`).expect(200);
    await admin
      .put(`/v1/admin/catalog/catalog-products/${productId}/reference-configuration`, {
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .set('If-Match', current.headers['etag'] as string)
      .expect(200);
    await ctx.app.get(PriceHintsService).refresh();
  });

  afterAll(async () => {
    // The e2e database is shared: leave the product without a reference, as the other suites expect.
    if (productId) {
      const current = await admin.get(`/v1/admin/catalog/catalog-products/${productId}`).expect(200);
      await admin
        .delete(`/v1/admin/catalog/catalog-products/${productId}/reference-configuration`)
        .set('If-Match', current.headers['etag'] as string)
        .expect(200);
      await ctx.app.get(PriceHintsService).refresh();
    }
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('prices the default spec the same on every surface, for every instant product', async () => {
    const instant = await ctx.prisma.catalogProduct.findMany({
      where: { status: 'active', productType: { status: 'active', quoteMode: 'instant' } },
      select: { slug: true, productType: { select: { code: true } } },
      orderBy: { slug: 'asc' },
    });
    const hints = (
      await request(ctx.server)
        .get(`/v1/store/catalog/price-hints?slugs=${instant.map((p) => p.slug).join(',')}`)
        .expect(200)
    ).body as {
      key: string;
      startingFromPerPiece: string | null;
      basis: { quantity: number; specs: Spec[]; label: Label } | null;
    }[];
    const priced = hints.filter((h) => h.startingFromPerPiece !== null);
    expect(priced.length).toBeGreaterThan(0);

    for (const hint of priced) {
      const type = instant.find((p) => p.slug === hint.key)!.productType.code;
      const configurator = (
        await request(ctx.server).get(`/v1/store/catalog/products/${hint.key}/configurator`).expect(200)
      ).body;
      const spec = configurator.defaultSpec;
      expect(spec).not.toBeNull();
      // The configurator opens on the default spec at the reference quantity.
      expect(configurator.quantity.default).toBe(hint.basis!.quantity);
      expect(spec.quantity).toBe(hint.basis!.quantity);

      const calc = (
        await request(ctx.server)
          .post('/v1/store/quotes/actions/calculate')
          .send({ productTypeCode: type, configuration: spec.configuration })
          .expect(200)
      ).body as { steps: { quantity: number; unitPrice: string }[]; specs: Spec[]; specLabel: Label };
      const step = calc.steps.find((s) => s.quantity === spec.quantity);
      expect(step?.unitPrice).toBe(hint.startingFromPerPiece);

      const detail = (await request(ctx.server).get(`/v1/store/catalog/products/${hint.key}`).expect(200))
        .body;
      expect(detail.startingPricePerPiece).toBe(hint.startingFromPerPiece);
      expect(detail.startingPriceAssumes.quantity).toBe(spec.quantity);

      // One spec label everywhere: calculation, configurator default, starting price basis, product page.
      expect(calc.specLabel).toEqual(spec.specLabel);
      expect(hint.basis!.label).toEqual(spec.specLabel);
      expect(detail.startingPriceAssumes.label).toEqual(spec.specLabel);
      const size = calc.specs.find((l) => l.key === 'size');
      if (size) expect(size).toMatchObject({ labelTh: 'ขนาด (ยาว × กว้าง × สูง)' });
    }
  });
});
