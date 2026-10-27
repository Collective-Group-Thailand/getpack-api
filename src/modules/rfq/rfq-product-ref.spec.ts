import { productOf } from './rfq-views';
import { RfqsService } from './rfqs.service';

/** C1 (DECISIONS-STAGE-A §4): an RFQ and a basket line keep the product they were asked from. */
describe('RFQ product reference', () => {
  const service = (catalog: unknown, stock: unknown) => {
    const prisma = {
      catalogProduct: { findFirst: jest.fn().mockResolvedValue(catalog) },
      stockProduct: { findFirst: jest.fn().mockResolvedValue(stock) },
    };
    const s = Reflect.construct(RfqsService, [prisma, ...Array<unknown>(11).fill({})]) as RfqsService;
    const ref = (input: { catalogProductSlug?: string; stockProductSku?: string }) =>
      (
        s as unknown as {
          productRef(
            type: bigint,
            input: unknown,
          ): Promise<{ catalogProductId: bigint | null; stockProductId: bigint | null }>;
        }
      ).productRef(7n, input);
    return { ref, prisma };
  };

  it('resolves an active catalogue product of the same type', async () => {
    const { ref, prisma } = service({ id: 11n }, null);
    await expect(ref({ catalogProductSlug: 'mailer-box-b' })).resolves.toEqual({
      catalogProductId: 11n,
      stockProductId: null,
    });
    expect(prisma.catalogProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'mailer-box-b', status: 'active', productTypeId: 7n } }),
    );
  });

  it('resolves an active stock product of the same type', async () => {
    const { ref } = service(null, { id: 21n });
    await expect(ref({ stockProductSku: 'PKO-BTL-0250' })).resolves.toEqual({
      catalogProductId: null,
      stockProductId: 21n,
    });
  });

  it('names no product when none is given', async () => {
    const { ref, prisma } = service(null, null);
    await expect(ref({})).resolves.toEqual({ catalogProductId: null, stockProductId: null });
    expect(prisma.catalogProduct.findFirst).not.toHaveBeenCalled();
  });

  it('refuses both at once, and a product of another type or inactive (422 on the field)', async () => {
    await expect(
      service(null, null).ref({ catalogProductSlug: 'a', stockProductSku: 'B' }),
    ).rejects.toMatchObject({
      code: 'validation.failed',
      errors: [expect.objectContaining({ path: 'stockProductSku', code: 'exclusive' })],
    });
    await expect(service(null, null).ref({ catalogProductSlug: 'other-type' })).rejects.toMatchObject({
      errors: [expect.objectContaining({ path: 'catalogProductSlug', code: 'exists' })],
    });
    await expect(service(null, null).ref({ stockProductSku: 'X' })).rejects.toMatchObject({
      errors: [expect.objectContaining({ path: 'stockProductSku', code: 'exists' })],
    });
  });

  it('shows the product by kind, key and names', () => {
    expect(
      productOf({
        catalogProduct: { slug: 'mailer-box-b', nameTh: 'กล่อง', nameEn: 'Box' },
        stockProduct: null,
      }),
    ).toEqual({ kind: 'catalog_product', key: 'mailer-box-b', nameTh: 'กล่อง', nameEn: 'Box' });
    expect(
      productOf({ catalogProduct: null, stockProduct: { sku: 'S-1', nameTh: 'ขวด', nameEn: 'Bottle' } }),
    ).toEqual({
      kind: 'stock_product',
      key: 'S-1',
      nameTh: 'ขวด',
      nameEn: 'Bottle',
    });
    expect(productOf({ catalogProduct: null, stockProduct: null })).toBeNull();
  });
});
