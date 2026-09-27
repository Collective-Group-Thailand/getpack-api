import { MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import { priceOrderLines, type PricingContext, type QuoteOptionInput, totalsOf, vatOf } from './order-pricing';

const ctx: PricingContext = { vatPct: '7', nature: 'hire_of_work', productRevenue: 'made_to_order', wht: null };

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

describe('priceOrderLines', () => {
  it('keeps the locked quotation total when the destinations cost what the quotation priced', () => {
    const lines = priceOrderLines(instant, new MoneyDecimal('120.00'), ctx);
    expect(lines.map((l) => l.lineType)).toEqual(['product', 'design_fee', 'shipping']);
    const totals = totalsOf(lines);
    expect(totals.grossAmount).toBe('14054.40');
    expect(totals.vatAmount).toBe('919.45');
    expect(totals.shippingNetAmount).toBe('120.00');
    for (const l of lines) {
      expect(new MoneyDecimal(l.netAmount).add(l.vatAmount).toFixed(2)).toBe(l.grossAmount);
    }
    const [product, fee] = lines;
    expect(product!.grossAmount).toBe('13380.00');
    expect(fee!.grossAmount).toBe('546.00');
    expect(product!.unitPrice).toMatch(/^\d+\.\d{6}$/);
  });

  it('replaces the quotation shipping by the destinations’ shipping with VAT on the line', () => {
    const lines = priceOrderLines(instant, new MoneyDecimal('240.00'), ctx);
    const shipping = lines.find((l) => l.lineType === 'shipping')!;
    expect(shipping).toMatchObject({ netAmount: '240.00', vatAmount: '16.80', grossAmount: '256.80' });
    expect(totalsOf(lines).grossAmount).toBe('14182.80');
  });

  it('keeps RFQ nets and their quoted shipping', () => {
    const lines = priceOrderLines(
      {
        source: 'rfq',
        quantity: 500,
        netAmount: '10100.00',
        vatAmount: '707.00',
        grossAmount: '10807.00',
        shippingAmount: '107.00',
        result: { productAmount: '10000.00', shippingNetAmount: '100.00' },
      },
      null,
      ctx,
    );
    expect(lines.map((l) => [l.lineType, l.netAmount, l.vatAmount])).toEqual([
      ['product', '10000.00', '700.00'],
      ['shipping', '100.00', '7.00'],
    ]);
  });

  it('withholds per category when the customer withholds (D-174) and never on goods', () => {
    const wht = { hire_of_work: '3', transport: '1', service: '3' };
    const lines = priceOrderLines(instant, new MoneyDecimal('120.00'), { ...ctx, wht });
    expect(lines.map((l) => [l.whtCategory, l.whtRatePct])).toEqual([
      ['hire_of_work', '3.0000'],
      ['service', '3.0000'],
      ['transport', '1.0000'],
    ]);
    const product = lines[0]!;
    expect(product.whtAmount).toBe(new MoneyDecimal(product.netAmount).mul(0.03).toFixed(2));
    const totals = totalsOf(lines);
    expect(new MoneyDecimal(totals.grossAmount).sub(totals.whtAmount).toFixed(2)).toBe(totals.cashAmount);

    const goods = priceOrderLines(instant, null, { ...ctx, nature: 'sale_of_goods', wht });
    expect(goods[0]).toMatchObject({ whtCategory: 'none', whtAmount: '0.00' });
  });

  it('property: lines always add up and the product side keeps the quotation’s gross and VAT', () => {
    const cents = (min: number, max: number) => fc.integer({ min, max }).map((n) => new MoneyDecimal(n).div(100));
    fc.assert(
      fc.property(cents(10_000, 50_000_000), cents(0, 1_000_000), cents(0, 500_000), cents(0, 100_000), (pieces, fee, ship, newShip) => {
        const productSideGross = pieces.add(fee);
        const productSideVat = productSideGross.sub(productSideGross.div(1.07)).toDecimalPlaces(2);
        const shipVat = vatOf(ship, '7');
        const option: QuoteOptionInput = {
          source: 'instant',
          quantity: 1000,
          netAmount: productSideGross.sub(productSideVat).add(ship).toFixed(2),
          vatAmount: productSideVat.add(shipVat).toFixed(2),
          grossAmount: productSideGross.add(ship).add(shipVat).toFixed(2),
          shippingAmount: ship.gt(0) ? ship.add(shipVat).toFixed(2) : null,
          result: {
            productAmount: pieces.toFixed(2),
            designFeeAmount: fee.toFixed(2),
            shippingNetAmount: ship.gt(0) ? ship.toFixed(2) : null,
            shippingVatAmount: ship.gt(0) ? shipVat.toFixed(2) : null,
          },
        };
        const lines = priceOrderLines(option, newShip, ctx);
        const productSide = lines.filter((l) => l.lineType !== 'shipping');
        const gross = productSide.reduce((a, l) => a.add(l.grossAmount), new MoneyDecimal(0));
        const vat = productSide.reduce((a, l) => a.add(l.vatAmount), new MoneyDecimal(0));
        expect(gross.toFixed(2)).toBe(productSideGross.toFixed(2));
        expect(vat.toFixed(2)).toBe(productSideVat.toFixed(2));
        for (const l of lines) {
          expect(new MoneyDecimal(l.netAmount).gte(0)).toBe(true);
          expect(new MoneyDecimal(l.netAmount).add(l.vatAmount).toFixed(2)).toBe(l.grossAmount);
        }
      }),
    );
  });
});
