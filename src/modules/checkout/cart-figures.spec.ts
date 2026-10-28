import { MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import { goodsVat, tierHintOf } from './cart-figures';
import { priceOrderLines, type QuoteOptionInput, totalsOf } from './order-pricing';

/** An instant option like the folding engine produces: pieces + design fee incl. VAT, shipping VAT-exclusive. */
const instant: QuoteOptionInput = {
  source: 'instant',
  quantity: 1000,
  netAmount: '13134.95',
  vatAmount: '919.45',
  grossAmount: '14054.40',
  shippingAmount: '128.40',
  result: {
    productAmount: '13380.00',
    designFeeAmount: '546.00',
    structureDesignFeeAmount: '0.00',
    shippingNetAmount: '120.00',
    shippingVatAmount: '8.40',
  },
};

const ctx = { vatPct: '7', nature: 'sale_of_goods', productRevenue: 'made_to_order', wht: null } as const;

describe('goodsVat (D-452, C5 cart summary)', () => {
  it('is the VAT of the order lines checkout builds before shipping', () => {
    const lines = priceOrderLines(instant, new MoneyDecimal(0), ctx);
    expect(goodsVat(instant, '7').toFixed(2)).toBe(totalsOf(lines).vatAmount);
  });

  it('the ฿5,178.00 cart (฿17.26 × 300) carries ฿338.75 VAT (DECISIONS-STAGE-A §7)', () => {
    const option: QuoteOptionInput = {
      source: 'instant',
      quantity: 300,
      netAmount: '4839.25',
      vatAmount: '338.75',
      grossAmount: '5178.00',
      shippingAmount: null,
      result: {},
    };
    expect(goodsVat(option, '7').toFixed(2)).toBe('338.75');
  });

  it('leaves an RFQ quotation’s own shipping out', () => {
    const rfq: QuoteOptionInput = { ...instant, source: 'rfq' };
    const lines = priceOrderLines(rfq, null, ctx).filter((l) => l.lineType !== 'shipping');
    expect(goodsVat(rfq, '7').toFixed(2)).toBe(totalsOf(lines).vatAmount);
  });

  it('cart goods + destination shipping = the order checkout creates (any shipping)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (shipSatang) => {
        const ship = new MoneyDecimal(shipSatang).div(100);
        const order = totalsOf(priceOrderLines(instant, ship, ctx));
        const goodsGross = new MoneyDecimal(instant.grossAmount).sub(instant.shippingAmount!);
        // The order is the cart's goods (unchanged gross) plus shipping net and the VAT on it.
        const shippingGross = new MoneyDecimal(order.grossAmount).sub(goodsGross);
        expect(shippingGross.gte(ship)).toBe(true);
        expect(new MoneyDecimal(order.grossAmount).sub(shippingGross).toFixed(2)).toBe(goodsGross.toFixed(2));
      }),
    );
  });
});

describe('tierHintOf (D-452)', () => {
  const options = [
    { publicId: 'a', quantity: 300, unitPrice: '17.260000', grossAmount: '5178.00', shippingAmount: null },
    { publicId: 'b', quantity: 500, unitPrice: '17.260000', grossAmount: '8630.00', shippingAmount: null },
    {
      publicId: 'c',
      quantity: 1000,
      unitPrice: '14.960000',
      grossAmount: '15088.40',
      shippingAmount: '128.40',
    },
  ];

  it('names the smallest larger quantity that is cheaper per piece, without the quotation’s shipping', () => {
    expect(tierHintOf(options, { quantity: 300, unitPrice: '17.26' })).toEqual({
      quoteOptionId: 'c',
      quantity: 1000,
      unitPrice: '14.96',
      productGrossAmount: '14960.00',
    });
  });

  it('is null at the cheapest tier', () => {
    expect(tierHintOf(options, { quantity: 1000, unitPrice: '14.96' })).toBeNull();
  });
});
