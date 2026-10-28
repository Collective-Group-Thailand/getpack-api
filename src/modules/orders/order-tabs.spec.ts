import { filterGroups, inTab, matchesSearch, ORDER_TABS, tabCounts } from './order-tabs';
import { type OrderDto, type OrderGroupDto } from './orders.dto';
import { PAYMENT_OVERDUE_EVENT, PaymentOverdueReminder } from './payment-overdue-reminder';

const order = (code: string, customerStatus: string, actionOwner: string | null, nameTh = 'กล่องไปรษณีย์') =>
  ({
    orderCode: code,
    customerStatus,
    actionOwner,
    summary: {
      product: { slug: 'mailer', nameTh, nameEn: 'Mailer box', imageUrl: null },
      productTypeCode: 'MB',
      productTypeNameTh: 'กล่องลูกฟูก',
      productTypeNameEn: 'Corrugated box',
      unit: 'piece',
      specs: [],
    },
  }) as unknown as OrderDto;

const group = (code: string, orders: OrderDto[], poNumber: string | null = null) =>
  ({ groupCode: code, poNumber, orders }) as unknown as OrderGroupDto;

describe('account order tabs (D-453)', () => {
  it('puts each customer status in its tabs', () => {
    const tabs = (status: string, owner: string | null) =>
      ORDER_TABS.filter((tab) => inTab({ customerStatus: status, actionOwner: owner }, tab));
    expect(tabs('awaiting_payment', 'customer')).toEqual(['active', 'todo']);
    expect(tabs('awaiting_artwork', 'team')).toEqual(['active']);
    expect(tabs('awaiting_artwork', 'customer')).toEqual(['active', 'todo']);
    expect(tabs('in_production', 'team')).toEqual(['active', 'in_production']);
    expect(tabs('shipping', 'team')).toEqual(['active', 'shipping']);
    expect(tabs('received', 'customer')).toEqual(['active', 'todo']);
    expect(tabs('claim_in_review', 'team')).toEqual(['active']);
    expect(tabs('completed', null)).toEqual(['completed']);
    expect(tabs('cancelled', null)).toEqual(['cancelled']);
  });

  it('searches the order code, group code, PO number and product name', () => {
    const g = group('OG-2610-00016', [], 'PO-7781');
    const o = order('OR-2610-00017', 'awaiting_payment', 'customer');
    for (const q of ['or-2610-00017', '00016', 'po-77', 'ไปรษณีย์', 'MAILER', 'ลูกฟูก', '  ']) {
      expect(matchesSearch(g, o, q)).toBe(true);
    }
    expect(matchesSearch(g, o, 'OR-9999')).toBe(false);
  });

  it('keeps only matching orders of a group and counts every tab', () => {
    const groups = [
      group('OG-1', [
        order('OR-1', 'awaiting_payment', 'customer'),
        order('OR-2', 'awaiting_artwork', 'team'),
      ]),
      group('OG-2', [order('OR-3', 'claim_in_review', 'team'), order('OR-4', 'completed', null)]),
    ];
    const todo = filterGroups(groups, 'todo', undefined);
    expect(todo.map((g) => [g.groupCode, g.orders.map((o) => o.orderCode)])).toEqual([['OG-1', ['OR-1']]]);
    expect(filterGroups(groups, undefined, 'OR-4')[0]?.orders.map((o) => o.orderCode)).toEqual(['OR-4']);
    expect(tabCounts(groups)).toEqual({
      active: 3,
      todo: 1,
      in_production: 0,
      shipping: 0,
      completed: 1,
      cancelled: 0,
      claimInReview: 1,
    });
  });
});

describe('overdue payment reminder (D-453)', () => {
  const now = new Date('2026-10-25T03:00:00Z');
  const setup = (enabled: boolean, status = 'waiting_payment') => {
    const record = jest.fn(() => Promise.resolve());
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      orderGroup: {
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            publicId: 'g-1',
            groupCode: 'OG-2610-00016',
            status,
            expiresAt: new Date('2026-10-22T04:47:00Z'),
            grossAmount: { toFixed: () => '9284.96' },
            cashAmount: { toFixed: () => '9284.96' },
            orders: [{ publicId: 'o-16', orderCode: 'OR-2610-00016' }],
          }),
        ),
      },
    };
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: 7n }])),
      withTx: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const flags = { isEnabled: jest.fn(() => Promise.resolve(enabled)) };
    const job = new PaymentOverdueReminder(prisma as never, { record } as never, flags as never);
    return { job, record, prisma };
  };

  it('does nothing while the flag is off', async () => {
    const { job, prisma } = setup(false);
    await expect(job.run(now)).resolves.toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('records one event with the order to open, in the transaction', async () => {
    const { job, record } = setup(true);
    await expect(job.run(now)).resolves.toBe(1);
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      'order_group',
      'g-1',
      PAYMENT_OVERDUE_EVENT,
      expect.objectContaining({
        groupCode: 'OG-2610-00016',
        dueAt: '2026-10-22T04:47:00.000Z',
        orderId: 'o-16',
        cashAmount: '9284.96',
      }),
      expect.objectContaining({ type: 'system' }),
    );
  });

  it('skips a group paid meanwhile', async () => {
    const { job, record } = setup(true, 'paid');
    await expect(job.run(now)).resolves.toBe(0);
    expect(record).not.toHaveBeenCalled();
  });
});
