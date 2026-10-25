import { statusLabel } from '@common/labels/status-labels';
import { nextActions, NO_PERMISSIONS } from '@common/next-actions/next-actions';

import {
  actionOwnerOf,
  artworkOwner,
  CUSTOMER_ORDER_STATUSES,
  type CustomerStatusFacts,
  customerStatusOf,
  initialArtworkStatus,
} from './customer-status';
import { type OrderFacts, STORE_ORDER_ACTIONS } from './order-actions';
import { sameConfiguration } from './order-requote.service';
import { paymentOverdue } from './order-views';

const at = (d: string) => new Date(`${d}T10:00:00+07:00`);
const placed: CustomerStatusFacts = {
  artworkStatus: 'awaiting_template',
  paidForProductionAt: null,
  productionStartedAt: null,
  shippedAt: null,
  deliveredAt: null,
  completedAt: null,
  cancelledAt: null,
  openClaimCount: 0,
};
const paid = { ...placed, paidForProductionAt: at('2026-10-12') };
const approved = { ...paid, artworkStatus: 'approved' };
const started = { ...approved, productionStartedAt: at('2026-10-13') };
const shipped = { ...started, shippedAt: at('2026-10-15') };
const delivered = { ...shipped, deliveredAt: at('2026-10-16') };

describe('customer status (D-437)', () => {
  it('walks every step of an order, one status at a time', () => {
    const steps: [CustomerStatusFacts, string][] = [
      [placed, 'awaiting_payment'],
      [{ ...placed, artworkStatus: 'proof_sent' }, 'awaiting_payment'],
      [paid, 'awaiting_artwork'],
      [{ ...paid, artworkStatus: 'awaiting_upload' }, 'awaiting_artwork'],
      [{ ...paid, artworkStatus: 'changes_requested' }, 'awaiting_artwork'],
      [{ ...paid, artworkStatus: 'uploaded' }, 'awaiting_approval'],
      [{ ...paid, artworkStatus: 'in_review' }, 'awaiting_approval'],
      [{ ...paid, artworkStatus: 'proof_sent' }, 'awaiting_approval'],
      [approved, 'in_production'],
      [started, 'in_production'],
      [shipped, 'shipping'],
      [delivered, 'received'],
      [{ ...delivered, openClaimCount: 1 }, 'claim_in_review'],
      [{ ...delivered, completedAt: at('2026-10-23') }, 'completed'],
      [{ ...delivered, completedAt: at('2026-10-23'), openClaimCount: 1 }, 'claim_in_review'],
      [{ ...placed, cancelledAt: at('2026-10-20') }, 'cancelled'],
      [{ ...paid, cancelledAt: at('2026-10-20') }, 'cancelled'],
    ];
    for (const [facts, status] of steps) expect([facts, customerStatusOf(facts)]).toEqual([facts, status]);
  });

  it('labels every customer status for the storefront', () => {
    for (const s of CUSTOMER_ORDER_STATUSES) expect(statusLabel('CustomerOrderStatus', s).th).not.toBe(s);
    expect(statusLabel('CustomerOrderStatus', 'claim_in_review').th).toBe('ได้รับแล้ว · เคลมกำลังตรวจ');
    expect(statusLabel('CustomerOrderStatus', 'awaiting_approval').th).toBe('รออนุมัติแบบ');
  });

  it('says who acts next', () => {
    expect(actionOwnerOf('awaiting_payment', placed)).toBe('customer');
    expect(actionOwnerOf('awaiting_artwork', paid)).toBe('team');
    expect(actionOwnerOf('awaiting_artwork', { ...paid, artworkStatus: 'awaiting_upload' })).toBe('customer');
    expect(actionOwnerOf('awaiting_approval', { ...paid, artworkStatus: 'in_review' })).toBe('team');
    expect(actionOwnerOf('awaiting_approval', { ...paid, artworkStatus: 'proof_sent' })).toBe('customer');
    expect(actionOwnerOf('in_production', started)).toBe('team');
    expect(actionOwnerOf('received', delivered)).toBe('customer');
    expect(actionOwnerOf('claim_in_review', delivered)).toBe('team');
    expect(actionOwnerOf('completed', delivered)).toBeNull();
    expect(actionOwnerOf('cancelled', placed)).toBeNull();
  });
});

describe('artwork owner (D-438)', () => {
  it('splits "รอแบบไดคัท" between the team and the customer', () => {
    expect(statusLabel('ArtworkStatus', 'awaiting_template').th).toBe('รอทีมส่งแบบไดคัทให้');
    expect(statusLabel('ArtworkStatus', 'awaiting_upload').th).toBe('รอไฟล์จากคุณ');
    expect(artworkOwner('awaiting_template')).toBe('team');
    expect(artworkOwner('uploaded')).toBe('team');
    expect(artworkOwner('in_review')).toBe('team');
    expect(artworkOwner('awaiting_upload')).toBe('customer');
    expect(artworkOwner('changes_requested')).toBe('customer');
    expect(artworkOwner('proof_sent')).toBe('customer');
    expect(artworkOwner('approved')).toBeNull();
  });

  it('starts an online design with the customer, everything else with the team', () => {
    expect(initialArtworkStatus('online_designer')).toBe('awaiting_upload');
    expect(initialArtworkStatus('own_file')).toBe('awaiting_template');
    expect(initialArtworkStatus('hired_design')).toBe('awaiting_template');
  });
});

describe('store order actions (D-437, D-438)', () => {
  const order: OrderFacts = {
    status: 'waiting_payment',
    artworkStatus: 'awaiting_template',
    designOption: 'own_file',
    mockupOption: 'none',
    productionStartedAt: null,
    paidForProductionAt: null,
    deliveredAt: null,
    completedAt: null,
    cancelledAt: null,
    claimWindowEndsAt: null,
    discountAmount: '0.00',
    lines: [{ lineType: 'product' }],
  };
  const keys = (o: OrderFacts) =>
    nextActions(o, STORE_ORDER_ACTIONS, NO_PERMISSIONS).map((a) =>
      a.disabledReason ? `${a.key}!${a.disabledReason}` : a.key,
    );

  it('offers "ส่งไฟล์งาน" only while the customer owns the artwork step', () => {
    expect(keys(order)).toEqual([]);
    expect(keys({ ...order, artworkStatus: 'in_review' })).toEqual([]);
    expect(keys({ ...order, artworkStatus: 'awaiting_upload' })).toEqual(['order.upload_artwork']);
    expect(keys({ ...order, artworkStatus: 'changes_requested' })).toEqual(['order.upload_artwork']);
  });

  // UATOR-2610-00008: delivered, window passed, a claim under review.
  const received = {
    ...order,
    status: 'shipping',
    artworkStatus: 'approved',
    productionStartedAt: at('2026-10-05'),
    paidForProductionAt: at('2026-10-02'),
    deliveredAt: at('2026-10-12'),
    claimWindowEndsAt: at('2026-10-19'),
  };

  it('asks for receipt and announces the closed window only without an open claim', () => {
    expect(keys(received)).toEqual([
      'order.confirm_receipt',
      'order.open_claim!claims.window_closed',
      'order.reorder',
    ]);
    expect(keys({ ...received, openClaimCount: 1 })).toEqual(['order.reorder']);
    const open = { ...received, claimWindowEndsAt: new Date(Date.now() + 86_400_000), openClaimCount: 1 };
    expect(keys(open)).toEqual(['order.open_claim', 'order.reorder']);
  });
});

describe('payment deadline (D-436)', () => {
  it('is overdue only while unpaid and past the deadline', () => {
    const now = at('2026-10-25');
    expect(paymentOverdue({ status: 'waiting_payment', expiresAt: at('2026-10-22') }, now)).toBe(true);
    expect(paymentOverdue({ status: 'waiting_payment', expiresAt: at('2026-10-26') }, now)).toBe(false);
    expect(paymentOverdue({ status: 'in_progress', expiresAt: null }, now)).toBe(false);
    expect(paymentOverdue({ status: 'cancelled', expiresAt: at('2026-10-22') }, now)).toBe(false);
  });

  it('re-quotes only the same configuration and delivery postcode', () => {
    const input = {
      productTypeCode: 'folding',
      configuration: { a: 1, b: [1, 2] },
      deliveryPostcode: '10110',
    };
    expect(sameConfiguration(input, { ...input, configuration: { b: [1, 2], a: 1 } })).toBe(true);
    expect(sameConfiguration(input, { ...input, configuration: { a: 2, b: [1, 2] } })).toBe(false);
    expect(sameConfiguration(input, { ...input, deliveryPostcode: '10120' })).toBe(false);
  });
});
