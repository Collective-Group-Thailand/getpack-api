import { suggestReorder } from './reorder-suggestion';

const RULES = { minOrders: 3, averageOrders: 3, safetyStockDays: 7 };

describe('reorder suggestion (D-288)', () => {
  it('needs the minimum number of orders and a delivered one', () => {
    const two = [
      { orderedOn: '2026-01-01', quantity: 1000, deliveredOn: '2026-01-15' },
      { orderedOn: '2026-02-01', quantity: 1000, deliveredOn: null },
    ];
    expect(suggestReorder(two, RULES)).toBeNull();
    const undelivered = [0, 1, 2].map((i) => ({
      orderedOn: `2026-0${i + 1}-01`,
      quantity: 1000,
      deliveredOn: null,
    }));
    expect(suggestReorder(undelivered, RULES)).toBeNull();
  });

  it('averages the available intervals with three orders: need, lead time, safety stock and quantity', () => {
    const result = suggestReorder(
      [
        { orderedOn: '2026-01-01', quantity: 1000, deliveredOn: '2026-01-12' },
        { orderedOn: '2026-01-31', quantity: 2000, deliveredOn: '2026-02-10' },
        { orderedOn: '2026-03-02', quantity: 1500, deliveredOn: null },
      ],
      RULES,
    );
    // Intervals 30 and 30 → next need 30 days after the last order; lead 10 days (the last delivered order).
    expect(result).toEqual({
      orderCount: 3,
      averageIntervalDays: '30.00',
      lastLeadTimeDays: 10,
      nextNeedOn: '2026-04-01',
      suggestedOn: '2026-03-15',
      suggestedQuantity: 1500,
    });
  });

  it('uses only the most recent intervals and their orders’ quantities', () => {
    const result = suggestReorder(
      [
        { orderedOn: '2025-01-01', quantity: 9000, deliveredOn: '2025-01-11' },
        { orderedOn: '2025-06-01', quantity: 1000, deliveredOn: '2025-06-11' },
        { orderedOn: '2025-07-01', quantity: 1000, deliveredOn: '2025-07-11' },
        { orderedOn: '2025-08-01', quantity: 1000, deliveredOn: '2025-08-11' },
        { orderedOn: '2025-08-21', quantity: 2000, deliveredOn: '2025-08-29' },
      ],
      RULES,
    );
    // Intervals 30, 31, 20 → 27.00; quantities of the last four orders → 1250; lead 8.
    expect(result).toMatchObject({
      orderCount: 5,
      averageIntervalDays: '27.00',
      lastLeadTimeDays: 8,
      nextNeedOn: '2025-09-17',
      suggestedOn: '2025-09-02',
      suggestedQuantity: 1250,
    });
  });
});
