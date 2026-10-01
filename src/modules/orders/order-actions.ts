import { type ActionRule } from '@common/next-actions/next-actions';

/** What an order's action guards read (`order-state.ts` facts, `artwork.service.ts`, `delivery.service.ts`, …). */
export interface OrderFacts {
  status: string;
  artworkStatus: string;
  designOption: string;
  mockupOption: string;
  productionStartedAt: Date | null;
  paidForProductionAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  claimWindowEndsAt: Date | null;
  discountAmount: { toString(): string };
  lines: { lineType: string }[];
}

/** `assertTakesArtwork`: before production, until the artwork is approved. */
const PRE_PRODUCTION = ['waiting_payment', 'paid_for_production', 'artwork_approved'];
const takesArtwork = (o: OrderFacts) => PRE_PRODUCTION.includes(o.status) && o.artworkStatus !== 'approved';
const OWN_ARTWORK = ['own_file', 'online_designer'];
const received = (o: OrderFacts) => o.deliveredAt !== null && o.cancelledAt === null;

/** The customer's actions on an order (D-070, D-073, D-081, D-082, D-153). */
export const STORE_ORDER_ACTIONS: ActionRule<OrderFacts>[] = [
  {
    key: 'order.upload_artwork',
    when: (o) => takesArtwork(o) && OWN_ARTWORK.includes(o.designOption),
  },
  {
    key: 'order.approve_proof',
    irreversible: true,
    when: (o) => takesArtwork(o) && o.artworkStatus === 'proof_sent',
  },
  { key: 'order.confirm_receipt', irreversible: true, when: (o) => received(o) && o.completedAt === null },
  {
    key: 'order.open_claim',
    when: (o) =>
      received(o) &&
      o.claimWindowEndsAt !== null &&
      (o.claimWindowEndsAt.getTime() >= Date.now() || 'claims.window_closed'),
  },
  { key: 'order.reorder', when: received },
];

/** Staff actions on an order (D-051, D-060, D-073, D-074). */
export const ADMIN_ORDER_ACTIONS: ActionRule<OrderFacts>[] = [
  {
    key: 'order.start_production',
    permissions: ['production.start_manual'],
    irreversible: true,
    when: (o) => o.productionStartedAt === null && o.cancelledAt === null && o.paidForProductionAt !== null,
  },
  {
    key: 'order.submit_artwork',
    permissions: ['artwork.submit_on_behalf'],
    when: (o) => takesArtwork(o),
  },
  {
    key: 'order.add_mockup',
    permissions: ['mockups.manage'],
    when: (o) => o.mockupOption === 'none' && !o.lines.some((l) => l.lineType === 'mockup'),
  },
  {
    key: 'order.reprice',
    permissions: ['orders.reprice'],
    when: (o) =>
      PRE_PRODUCTION.includes(o.status) &&
      o.productionStartedAt === null &&
      (o.lines.some((l) => l.lineType === 'extra_revision' || l.lineType === 'mockup')
        ? 'order.reprice_has_add_ons'
        : Number(o.discountAmount.toString()) > 0
          ? 'order.reprice_has_discounts'
          : true),
  },
  {
    key: 'order.cancel',
    permissions: ['orders.cancel'],
    irreversible: true,
    when: (o) => o.cancelledAt === null && o.completedAt === null && o.productionStartedAt === null,
  },
];
