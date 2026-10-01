/**
 * Where an in-app notification takes its reader (U-B0.3): a path relative to the zone of `packio-web`
 * (`/orders/{id}` in the admin zone is `/admin/orders/{id}`), derived from the event's aggregate. Null when the
 * zone has no page for it; the item then only marks itself read.
 */
export type InboxSurface = 'store' | 'admin' | 'partner';

type Link = (id: string, payload: Record<string, unknown>) => string | null;

const LINKS: Record<InboxSurface, Record<string, Link>> = {
  store: {
    order: (id) => `/account/orders/${id}`,
    rfq: (id) => `/account/rfqs/${id}`,
    claim: (id, p) =>
      typeof p['orderId'] === 'string' ? `/account/orders/${p['orderId']}/claims/${id}` : null,
  },
  admin: {
    order: (id) => `/orders/${id}`,
    order_group: (id) => `/orders/groups/${id}`,
    quote: (id) => `/quotations/${id}`,
    rfq: (id) => `/rfq/${id}`,
    claim: (id) => `/claims/${id}`,
    shipment: (id) => `/shipments/${id}`,
    company: (id) => `/companies/${id}`,
    approval_request: (id) => `/approvals/${id}`,
    price_proposal: (id) => `/partners/proposals/${id}`,
    billing_statement: (id) => `/finance/payables/statements/${id}`,
    purchase_order: (id) => `/finance/payables/purchase-orders/${id}`,
  },
  partner: {
    production_job: (id) => `/jobs/${id}`,
    shipment: (id) => `/ship/${id}`,
    claim: (id) => `/claims/${id}`,
    billing_statement: (id) => `/billing/${id}`,
    price_proposal: (id) => `/prices/proposals/${id}`,
    factory_change_request: () => '/requests',
  },
};

export function inboxLink(
  surface: InboxSurface,
  aggregateType: string,
  aggregateId: string,
  payload: unknown,
): string | null {
  const link = LINKS[surface][aggregateType];
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return link ? link(aggregateId, record) : null;
}
