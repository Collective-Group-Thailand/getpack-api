import { DomainException } from '@common/errors/domain.exception';

import { RfqBasketsService } from './rfq-baskets.service';

/** C1b (DECISIONS-STAGE-A §10.9, D-447): the signed-in quote tray is the draft basket — products wait for their form. */
describe('RFQ basket pending lines', () => {
  const actor = { type: 'user', audience: 'customer', userId: 9n } as never;
  const type = {
    publicId: 't',
    code: 'paper_bag',
    nameTh: 'ถุง',
    nameEn: 'Bag',
    category: { code: 'paper_packaging' },
  };
  const line = (over: Record<string, unknown> = {}) => ({
    id: 1n,
    publicId: 'item-1',
    sort: 0,
    productType: type,
    specification: { productTypeCode: 'paper_bag', catalogProductSlug: 'mailer-box-b' },
    formPending: true,
    designDocumentVersion: null,
    rfq: null,
    ...over,
  });
  const basket = (items: unknown[]) => ({
    id: 3n,
    publicId: 'basket-1',
    customerUserId: 9n,
    status: 'draft',
    basketCode: null,
    deliveryPostcode: '10110',
    targetDate: null,
    notes: '',
    conversation: null,
    submittedAt: null,
    createdAt: new Date('2026-10-28T02:00:00Z'),
    rowVersion: 1,
    items,
  });
  const setup = (items: unknown[], product: unknown = { productType: { id: 7n, code: 'paper_bag' } }) => {
    const row = basket(items);
    const tx = {
      rfqBasket: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
        createMany: jest.fn(),
      },
      rfqBasketItem: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...tx,
      withTx: (run: (t: unknown) => unknown) => run(tx),
      catalogProduct: {
        findFirst: jest.fn().mockResolvedValue(product),
        findMany: jest.fn().mockResolvedValue([{ slug: 'mailer-box-b', nameTh: 'กล่อง', nameEn: 'Box' }]),
      },
      stockProduct: {
        findFirst: jest.fn().mockResolvedValue(product),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const rfqs = { prepare: jest.fn().mockResolvedValue({ type: { id: 7n } }) };
    const s = new RfqBasketsService(
      prisma as never,
      rfqs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { s, tx, prisma, rfqs };
  };

  it('puts a product in as a pending line holding only its type and reference', async () => {
    const { s, tx } = setup([]);
    await s.addProduct(actor, { catalogProductSlug: 'mailer-box-b' });
    expect(tx.rfqBasketItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productTypeId: 7n,
        specification: { productTypeCode: 'paper_bag', catalogProductSlug: 'mailer-box-b' },
        formPending: true,
      }),
    });
  });

  it('does not add a product that is already waiting', async () => {
    const { s, tx } = setup([line()]);
    const view = await s.addProduct(actor, { catalogProductSlug: 'mailer-box-b' });
    expect(tx.rfqBasketItem.create).not.toHaveBeenCalled();
    expect(view.items[0]).toMatchObject({ formPending: true, categoryCode: 'paper_packaging' });
  });

  it('refuses both references, none, or an inactive product (422 on the field)', async () => {
    const { s } = setup([]);
    await expect(s.addProduct(actor, {})).rejects.toBeInstanceOf(DomainException);
    await expect(
      s.addProduct(actor, { catalogProductSlug: 'a', stockProductSku: 'B' }),
    ).rejects.toBeInstanceOf(DomainException);
    const inactive = setup([], null);
    await expect(inactive.s.addProduct(actor, { stockProductSku: 'GONE' })).rejects.toMatchObject({
      code: 'validation.failed',
    });
  });

  it("fills the waiting line when the same product's form is added", async () => {
    const { s, tx } = setup([line()]);
    await s.addItem(actor, {
      productTypeCode: 'paper_bag',
      catalogProductSlug: 'mailer-box-b',
      spec: { material: 'kraft (fake)' },
      quantities: [500],
    });
    expect(tx.rfqBasketItem.create).not.toHaveBeenCalled();
    expect(tx.rfqBasketItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1n }, data: expect.objectContaining({ formPending: false }) }),
    );
  });

  it('does not send a basket while a line waits for its form', async () => {
    const { s, rfqs } = setup([
      line({ formPending: false, specification: { quantities: [500] } }),
      line({ id: 2n }),
    ]);
    await expect(s.submit(actor)).rejects.toMatchObject({ code: 'validation.failed' });
    expect(rfqs.prepare).not.toHaveBeenCalled();
  });
});
