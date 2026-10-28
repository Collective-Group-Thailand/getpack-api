import { Prisma } from '@generated/prisma/client';

import { productsOf } from './styles-store.service';

/** C1 (products Phase 2): "สินค้าที่ใช้แบบนี้" — the active catalogue products of a style's pattern. */
describe('productsOf (style ↔ product mapping)', () => {
  const product = (slug: string, status: string, sort: number, price: string | null) => ({
    catalogProduct: {
      slug,
      status,
      nameTh: `ชื่อ ${slug}`,
      nameEn: `Name ${slug}`,
      sort,
      priceHint: price
        ? {
            unitPrice: new Prisma.Decimal(price),
            quantity: 300,
            computedAt: new Date('2026-10-01T02:00:00Z'),
            leadTimeDays: 5,
            specSummary: [],
          }
        : null,
    },
  });
  const row = (products: ReturnType<typeof product>[]) =>
    ({
      productType: {
        code: 'corrugated_box',
        calculatorKey: 'corrugate',
        quoteMode: 'instant',
        status: 'active',
      },
      pattern: { constraints: {}, catalogProducts: products },
    }) as never;

  it('lists active products, priced cheapest first, unpriced after in catalogue order', () => {
    const out = productsOf(
      row([
        product('c-unpriced', 'active', 2, null),
        product('b-dear', 'active', 1, '20.00'),
        product('a-cheap', 'active', 9, '15.70'),
        product('d-draft', 'draft', 0, '1.00'),
        product('e-unpriced', 'active', 1, null),
      ]),
    );
    expect(out.map((p) => p.slug)).toEqual(['a-cheap', 'b-dear', 'e-unpriced', 'c-unpriced']);
    expect(out[0]!.startingPrice).toMatchObject({
      unitPrice: '15.70',
      quantity: 300,
      catalogProductSlug: 'a-cheap',
    });
    expect(out[2]!.startingPrice).toBeNull();
  });

  it('is empty while the style has no pattern or no products', () => {
    expect(productsOf({ pattern: null, productType: null })).toEqual([]);
    expect(productsOf(row([]))).toEqual([]);
  });
});
