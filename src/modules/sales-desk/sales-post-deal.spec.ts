import { actualFigures } from './sales-post-deal';

/** D-470 item 10: actual figures after delivery (tolerance, D-165 factory pay, refunds, commission). */
describe('post-deal review actuals', () => {
  const base = {
    quantityOrdered: 1000,
    quantityDelivered: 1000,
    productNet: '100000.00',
    shippingCharged: '2000.00',
    buyCost: '80000.00',
    refundsGross: '0',
    vatPct: '7.00',
    commission: '3000.00',
  };

  it('computes gross margin and contribution as approved when delivered exactly', () => {
    const f = actualFigures({
      orders: [base],
      approvedShippingPaid: '1500.00',
      creditCost: '500.00',
      badDebt: '0.00',
    });
    expect(f).toEqual({
      netRevenue: '100000.00',
      grossMargin: '20500.00',
      grossMarginPct: '20.50',
      contribution: '17000.00',
      contributionPct: '17.00',
    });
  });

  it('invoices the over-delivery but pays the factory for the ordered quantity only (D-165)', () => {
    const f = actualFigures({
      orders: [{ ...base, quantityDelivered: 1050 }],
      approvedShippingPaid: '0',
      creditCost: '0',
      badDebt: '0',
    });
    expect([f.netRevenue, f.grossMargin]).toEqual(['105000.00', '27000.00']);
  });

  it('takes refunds net of VAT off revenue and margin', () => {
    const f = actualFigures({
      orders: [{ ...base, refundsGross: '10700.00' }],
      approvedShippingPaid: '0',
      creditCost: '0',
      badDebt: '0',
    });
    expect([f.netRevenue, f.grossMargin]).toEqual(['90000.00', '12000.00']);
  });
});
