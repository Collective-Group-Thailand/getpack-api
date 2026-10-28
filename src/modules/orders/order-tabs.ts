import { type OrderDto, type OrderGroupDto } from './orders.dto';

/**
 * D-453 (account Phase 2): the tabs of the customer's orders list, each a rule over the ONE customer status (D-437)
 * and who acts next (D-438) — never a status of its own. `active` = not finished (a delivered order and an open claim
 * are still active); `todo` = the customer acts next; the rest follow the customer status.
 */
export const ORDER_TABS = ['active', 'todo', 'in_production', 'shipping', 'completed', 'cancelled'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

type TabFacts = Pick<OrderDto, 'customerStatus' | 'actionOwner'>;

export function inTab(order: TabFacts, tab: OrderTab): boolean {
  const status = order.customerStatus;
  switch (tab) {
    case 'active':
      return status !== 'completed' && status !== 'cancelled';
    case 'todo':
      return order.actionOwner === 'customer' && status !== 'completed' && status !== 'cancelled';
    case 'in_production':
      return status === 'in_production';
    case 'shipping':
      return status === 'shipping';
    case 'completed':
      return status === 'completed';
    case 'cancelled':
      return status === 'cancelled';
  }
}

/** Longest search text the list accepts (a code, a PO number or part of a product name). */
export const ORDER_SEARCH_MAX = 100;

/**
 * D-453: the orders list search — part of the order code, the payment group's code, the group's PO number or the
 * product's name (Thai or English), case-insensitive. Blank matches everything.
 */
export function matchesSearch(
  group: Pick<OrderGroupDto, 'groupCode' | 'poNumber'>,
  order: OrderDto,
  q?: string,
) {
  const needle = q?.trim().toLocaleLowerCase('th');
  if (!needle) return true;
  const product = order.summary.product;
  const haystack = [
    order.orderCode,
    group.groupCode,
    group.poNumber,
    product?.nameTh,
    product?.nameEn,
    order.summary.productTypeNameTh,
    order.summary.productTypeNameEn,
  ];
  return haystack.some((text) => typeof text === 'string' && text.toLocaleLowerCase('th').includes(needle));
}

/**
 * The groups that hold at least one order in `tab` matching `q`, each listing only those orders (newest group
 * first, as given). The group's own figures (totals, deadline, `paymentOverdue`) stay the whole group's.
 */
export function filterGroups(groups: OrderGroupDto[], tab: OrderTab | undefined, q: string | undefined) {
  return groups.flatMap((group) => {
    const orders = group.orders.filter(
      (order) => (!tab || inTab(order, tab)) && matchesSearch(group, order, q),
    );
    return orders.length > 0 ? [{ ...group, orders }] : [];
  });
}

export type OrderTabCounts = Record<OrderTab, number> & { claimInReview: number };

/** Orders per tab (an order counts once per tab it is in) and open-claim orders, over every group given. */
export function tabCounts(groups: OrderGroupDto[]): OrderTabCounts {
  const counts = Object.fromEntries(ORDER_TABS.map((tab) => [tab, 0])) as OrderTabCounts;
  counts.claimInReview = 0;
  for (const order of groups.flatMap((group) => group.orders)) {
    for (const tab of ORDER_TABS) if (inTab(order, tab)) counts[tab] += 1;
    if (order.customerStatus === 'claim_in_review') counts.claimInReview += 1;
  }
  return counts;
}
