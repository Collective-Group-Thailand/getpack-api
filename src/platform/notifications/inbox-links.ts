/**
 * Where an in-app notification takes its reader (U-B0.3): a path relative to the zone of `getpack-web`
 * (`/orders/{id}` in the admin zone is `/admin/orders/{id}`), derived from the event's aggregate. Null when the
 * zone has no page for it; the item then only marks itself read.
 */
export type InboxSurface = 'store' | 'admin' | 'partner';

type Link = (id: string, payload: Record<string, unknown>) => string | null;

const LINKS: Record<InboxSurface, Record<string, Link>> = {
  store: {
    order: (id) => `/account/orders/${id}`,
    // D-453: the overdue reminder opens the group's first order on its "ตรวจราคาใหม่และชำระ" step (D-436).
    order_group: (_id, p) =>
      typeof p['orderId'] === 'string'
        ? `/account/orders/${p['orderId']}${p['dueAt'] ? '?requote=1' : ''}`
        : '/account/orders',
    rfq: (id) => `/account/rfqs/${id}`,
    // D-459: a finished file check opens its workspace on the upload page.
    file_check: (id) => `/studio/upload?check=${id}`,
    conversation: (id) => `/account/messages/${id}`,
    claim: (id, p) =>
      typeof p['orderId'] === 'string' ? `/account/orders/${p['orderId']}/claims/${id}` : null,
    // A company approver decides in the business pages (round 2, B2); other policies are staff's.
    approval_request: (id, p) =>
      p['policyKey'] === 'company_order_approval' ? `/business/approvals?request=${id}` : null,
  },
  admin: {
    order: (id) => `/orders/${id}`,
    order_group: (id) => `/orders/groups/${id}`,
    quote: (id) => `/quotations/${id}`,
    rfq: (id) => `/rfq/${id}`,
    conversation: (id) => `/inbox/${id}`,
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
    // getpack Factory ERP alerts open what they are about (D-358).
    erp_alert: (_id, p) => {
      const id = typeof p['subjectId'] === 'string' ? p['subjectId'] : null;
      switch (p['subjectType']) {
        case 'item':
          return id ? `/stock/items/${id}` : '/alerts';
        case 'maintenance_order':
          return id ? `/maintenance/${id}` : '/alerts';
        case 'maintenance_plan':
          return id ? `/maintenance/plans/${id}` : '/maintenance';
        case 'document':
          return id ? `/documents/${id}` : '/alerts';
        case 'erp_ncr':
          return id ? `/quality/ncrs/${id}` : '/quality/ncrs';
        case 'machine':
          return '/insight/oee';
        default:
          return '/alerts';
      }
    },
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
