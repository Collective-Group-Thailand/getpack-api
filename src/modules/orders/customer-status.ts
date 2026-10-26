import { type ClaimStatus, type Prisma } from '@generated/prisma/client';
import { FINAL_CLAIM_STATUSES } from '@modules/claims/liability';

/**
 * The customer's status of an order (D-437): ONE value derived server-side from the facts on the order — payment,
 * artwork, production, shipment, receipt, claims, completion and cancellation — so the overview, the orders list,
 * the order page, e-mails and LINE all say the same thing. Pure; the facts come from the order row and its open
 * claims. The stored `orders.status` (the legacy fact status, `order-state.ts`) is unchanged and stays for staff.
 */

export const CUSTOMER_ORDER_STATUSES = [
  'awaiting_payment',
  'awaiting_artwork',
  'awaiting_approval',
  'in_production',
  'shipping',
  'received',
  'claim_in_review',
  'completed',
  'cancelled',
] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];

/** The claims that are not final yet, as an order relation include (`orders.claims`). */
export const OPEN_CLAIMS = {
  where: { status: { notIn: [...FINAL_CLAIM_STATUSES] as ClaimStatus[] } },
  select: { publicId: true, claimNo: true, status: true },
  orderBy: { id: 'asc' as const },
} satisfies Prisma.Order$claimsArgs;

/** Who acts next (D-438): our team, the customer, or nobody (the order is over). */
export const ACTION_OWNERS = ['team', 'customer'] as const;
export type ActionOwner = (typeof ACTION_OWNERS)[number];

export interface CustomerStatusFacts {
  artworkStatus: string;
  paidForProductionAt: Date | null;
  productionStartedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** Claims on the order that are not final (`FINAL_CLAIM_STATUSES`). */
  openClaimCount: number;
}

/**
 * D-438: who owns the artwork step. "รอทีมส่งแบบไดคัทให้" (`awaiting_template`) and a file being checked
 * (`uploaded`, `in_review`) wait for the team — no upload button; "รอไฟล์จากคุณ" (`awaiting_upload`), a file sent
 * back (`changes_requested`) and a proof to answer (`proof_sent`) wait for the customer. Approved: nobody.
 */
export function artworkOwner(artworkStatus: string): ActionOwner | null {
  switch (artworkStatus) {
    case 'awaiting_template':
    case 'uploaded':
    case 'in_review':
      return 'team';
    case 'awaiting_upload':
    case 'changes_requested':
    case 'proof_sent':
      return 'customer';
    default:
      return null;
  }
}

/**
 * D-438 (B-API-4): the artwork status an order starts with. An own-file order ("มีไฟล์งานแล้ว") and an online design
 * wait for the customer's file ("รอไฟล์จากคุณ", upload offered) — the dieline the team may send after payment is a
 * help, not a step the customer waits for; a hired design waits for the team's designer (`awaiting_template`).
 */
export function initialArtworkStatus(designOption: string): 'awaiting_template' | 'awaiting_upload' {
  return designOption === 'online_designer' || designOption === 'own_file'
    ? 'awaiting_upload'
    : 'awaiting_template';
}

/**
 * D-438 (B-API-4): the artwork status the customer reads. An own-file order never waits for the team before its
 * first file: `awaiting_template` on such an order (rows placed before B-API-4) reads as `awaiting_upload`, whether
 * or not a dieline was sent. Every other status and design option is read as stored.
 */
export function customerArtworkStatus(designOption: string, artworkStatus: string): string {
  return designOption === 'own_file' && artworkStatus === 'awaiting_template'
    ? 'awaiting_upload'
    : artworkStatus;
}

/** B-API-4b: what the customer reads while a file sent before payment waits for it. */
export const ARTWORK_RECEIVED_BEFORE_PAYMENT_TH = 'ไฟล์ได้รับแล้ว ทีมงานจะตรวจหลังชำระเงิน';

/**
 * B-API-4b (DECISIONS-STAGE-A §7): the artwork next step to show the customer, or null for none. A file uploaded
 * before payment is preflighted at once, but Prepress reviews it only after payment — the order says so.
 */
export function customerArtworkNoteTh(f: {
  artworkStatus: string;
  paidForProductionAt: Date | null;
  cancelledAt: Date | null;
}): string | null {
  return !f.paidForProductionAt &&
    !f.cancelledAt &&
    (f.artworkStatus === 'uploaded' || f.artworkStatus === 'in_review')
    ? ARTWORK_RECEIVED_BEFORE_PAYMENT_TH
    : null;
}

/**
 * The customer status, first match wins: cancelled · a delivered order with an open claim ("ได้รับแล้ว ·
 * เคลมกำลังตรวจ", also after completion) · completed · received · shipping · in production · unpaid · the artwork
 * step (approved and paid = in production, waiting for the start).
 */
export function customerStatusOf(f: CustomerStatusFacts): CustomerOrderStatus {
  if (f.cancelledAt) return 'cancelled';
  if (f.deliveredAt && f.openClaimCount > 0) return 'claim_in_review';
  if (f.completedAt) return 'completed';
  if (f.deliveredAt) return 'received';
  if (f.shippedAt) return 'shipping';
  if (f.productionStartedAt) return 'in_production';
  if (!f.paidForProductionAt) return 'awaiting_payment';
  switch (f.artworkStatus) {
    case 'approved':
      return 'in_production';
    case 'proof_sent':
    case 'uploaded':
    case 'in_review':
      return 'awaiting_approval';
    default:
      return 'awaiting_artwork';
  }
}

/** Who acts next on an order in `status` (D-438). */
export function actionOwnerOf(status: CustomerOrderStatus, f: CustomerStatusFacts): ActionOwner | null {
  switch (status) {
    case 'awaiting_payment':
      return 'customer';
    case 'awaiting_artwork':
    case 'awaiting_approval':
      return artworkOwner(f.artworkStatus);
    case 'in_production':
    case 'shipping':
    case 'claim_in_review':
      return 'team';
    case 'received':
      // Receipt to confirm (or it completes by itself, D-081).
      return 'customer';
    default:
      return null;
  }
}
