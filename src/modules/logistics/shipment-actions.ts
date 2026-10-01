import { type ActionRule } from '@common/next-actions/next-actions';

/** What a shipment's action guards read (`shipments.service.ts`, `delivery.service.ts`). */
export interface ShipmentFacts {
  status: string;
  carrier: string;
  carrierRequested: boolean;
  /** The shipping gate's payment part (`assertShippable`): an instalment due before shipping is unpaid. */
  blockedByPayment: boolean;
  podReview: 'pending' | 'accepted' | 'rejected' | null;
  exceptionResolved: boolean;
}

/** Statuses with a next carrier status (`TRANSITIONS`). */
const MOVING = ['picked_up', 'in_transit', 'out_for_delivery', 'failed'];
const fleet = (s: ShipmentFacts) => s.carrier === 'factory_fleet';
const paid = (s: ShipmentFacts) => !s.blockedByPayment || 'shipments.payment_pending';
const MANAGE = ['factory_shipments.manage'];
const STAFF = ['shipments.manage'];

/** The factory's actions on its own trips (D-013, D-076, D-114). */
export const PARTNER_SHIPMENT_ACTIONS: ActionRule<ShipmentFacts>[] = [
  { key: 'shipment.mark_ready', permissions: MANAGE, when: (s) => s.status === 'draft' },
  { key: 'shipment.dispatch', permissions: MANAGE, when: (s) => s.status === 'ready' && fleet(s) && paid(s) },
  {
    key: 'shipment.request_carrier',
    permissions: MANAGE,
    when: (s) => s.status === 'ready' && fleet(s) && !s.carrierRequested,
  },
  { key: 'shipment.update_status', permissions: MANAGE, when: (s) => fleet(s) && MOVING.includes(s.status) },
  {
    key: 'shipment.record_pod',
    permissions: MANAGE,
    irreversible: true,
    when: (s) => fleet(s) && (MOVING.includes(s.status) || (s.status === 'ready' && paid(s))),
  },
  {
    key: 'shipment.cancel',
    permissions: MANAGE,
    irreversible: true,
    when: (s) => s.status === 'draft' || s.status === 'ready',
  },
];

/** Logistics staff actions (D-013, D-076, D-229, D-230). */
export const ADMIN_SHIPMENT_ACTIONS: ActionRule<ShipmentFacts>[] = [
  {
    key: 'shipment.book_carrier',
    permissions: STAFF,
    when: (s) => s.status === 'ready' && fleet(s) && paid(s),
  },
  { key: 'shipment.split', permissions: STAFF, when: (s) => s.status === 'draft' },
  {
    key: 'shipment.resolve_exception',
    permissions: STAFF,
    when: (s) => s.status === 'failed' || (s.status === 'returned' && !s.exceptionResolved),
  },
  { key: 'shipment.review_pod', permissions: STAFF, when: (s) => s.podReview === 'pending' },
  { key: 'shipment.update_status', permissions: STAFF, when: (s) => MOVING.includes(s.status) },
  {
    key: 'shipment.record_pod',
    permissions: STAFF,
    irreversible: true,
    when: (s) => MOVING.includes(s.status) || (s.status === 'ready' && paid(s)),
  },
  {
    key: 'shipment.cancel',
    permissions: STAFF,
    irreversible: true,
    when: (s) => s.status === 'draft' || s.status === 'ready',
  },
];
