/**
 * Order status driven by facts (B3.1). The legacy status names are kept (`waiting_payment →
 * paid_for_production → artwork_approved → in_production → shipping → completed`, `cancelled`), but the
 * status is never set directly: it is derived from the facts recorded on the order — the instalments
 * required before production are paid (B3.2), the artwork is approved (B4.1), production started (B4.2,
 * D-073), the order shipped / was delivered (B4.3), it completed (D-081) or was cancelled. A fact whose
 * prerequisite is missing is refused (`order.invalid_transition`); a fact already recorded is a no-op.
 */

export type OrderStatus =
  | 'waiting_payment'
  | 'paid_for_production'
  | 'artwork_approved'
  | 'in_production'
  | 'shipping'
  | 'completed'
  | 'cancelled';

export interface OrderFacts {
  paidForProductionAt: Date | null;
  artworkApprovedAt: Date | null;
  productionStartedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export type OrderFact =
  | { kind: 'paid_for_production' }
  | { kind: 'artwork_approved' }
  | { kind: 'production_started'; mode: 'auto' | 'manual_exception' }
  | { kind: 'shipped' }
  | { kind: 'delivered' }
  | { kind: 'completed'; mode: 'auto_after_days' | 'customer_confirmed' }
  | { kind: 'cancelled' };

export type FactResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; facts: OrderFacts; status: OrderStatus }
  | { ok: false; reason: string };

/** The status the facts imply. */
export function statusOf(f: OrderFacts): OrderStatus {
  if (f.cancelledAt) return 'cancelled';
  if (f.completedAt) return 'completed';
  if (f.shippedAt) return 'shipping';
  if (f.productionStartedAt) return 'in_production';
  if (f.paidForProductionAt && f.artworkApprovedAt) return 'artwork_approved';
  if (f.paidForProductionAt) return 'paid_for_production';
  return 'waiting_payment';
}

/** Records `fact` at `at`, checking its prerequisites. Pure. */
export function applyFact(current: OrderFacts, fact: OrderFact, at: Date): FactResult {
  const refuse = (reason: string): FactResult => ({ ok: false, reason });
  if (current.cancelledAt) return refuse('the order is cancelled');
  if (current.completedAt && fact.kind !== 'completed') return refuse('the order is completed');
  const next: OrderFacts = { ...current };
  switch (fact.kind) {
    case 'paid_for_production':
      if (current.paidForProductionAt) return { ok: true, changed: false };
      next.paidForProductionAt = at;
      break;
    case 'artwork_approved':
      if (current.artworkApprovedAt) return { ok: true, changed: false };
      if (current.productionStartedAt) return refuse('production already started');
      next.artworkApprovedAt = at;
      break;
    case 'production_started':
      if (current.productionStartedAt) return { ok: true, changed: false };
      // D-073: production needs the instalments required before production; a manual exception may
      // start before the artwork is approved only as CS's documented decision, never before payment.
      if (!current.paidForProductionAt) return refuse('instalments required before production are unpaid');
      if (!current.artworkApprovedAt && fact.mode === 'auto') return refuse('the artwork is not approved');
      next.productionStartedAt = at;
      break;
    case 'shipped':
      if (current.shippedAt) return { ok: true, changed: false };
      if (!current.productionStartedAt) return refuse('production has not started');
      next.shippedAt = at;
      break;
    case 'delivered':
      if (current.deliveredAt) return { ok: true, changed: false };
      if (!current.shippedAt) return refuse('the order has not shipped');
      next.deliveredAt = at;
      break;
    case 'completed':
      if (current.completedAt) return { ok: true, changed: false };
      if (!current.deliveredAt) return refuse('the order has not been delivered');
      next.completedAt = at;
      break;
    case 'cancelled':
      if (current.productionStartedAt) return refuse('production already started (claims, B4.5)');
      next.cancelledAt = at;
      break;
  }
  return { ok: true, changed: true, facts: next, status: statusOf(next) };
}

export type GroupStatus = 'pending_company_approval' | 'waiting_payment' | 'in_progress' | 'completed' | 'cancelled';

/** Group status from its orders (a group held for company approval stays held until decided). */
export function groupStatusOf(current: GroupStatus, orders: readonly OrderStatus[]): GroupStatus {
  if (current === 'pending_company_approval') return current;
  if (orders.every((s) => s === 'cancelled')) return 'cancelled';
  if (orders.every((s) => s === 'completed' || s === 'cancelled')) return 'completed';
  if (orders.some((s) => s !== 'waiting_payment' && s !== 'cancelled')) return 'in_progress';
  return 'waiting_payment';
}
