import { type Actor } from '@common/context/actor';
import { type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type DiscountSource, type SalesChannel } from '@generated/prisma/client';
import { type TaxProfileSnapshot } from '@modules/customers/customers.service';
import { Injectable } from '@nestjs/common';

import { type LineDraft, type Totals } from './order-pricing';

/**
 * Extension points of checkout (B3.1). Later deliverables plug in without touching checkout itself:
 * promotions (B3.3), points redemption (B3.4), CS / memo / company discounts (B3.5) adjust the draft;
 * the payment schedule (B3.2) and the company approval (B3.5) write their rows once the group exists.
 */

export interface DiscountDraft {
  /** Index into the order's `lines`, or null for an order-level discount spread by the extension. */
  lineIndex: number | null;
  source: DiscountSource;
  amount: string;
  pct?: string | null;
  cappedAmount?: string;
  capReason?: string | null;
  grantedByUserId?: bigint | null;
  /** Promotion references kept on the order discount (D-053, P09 dimension). */
  promotionId?: bigint | null;
  couponCodeId?: bigint | null;
  campaignId?: bigint | null;
  /** The discount memo behind a memo or company discount (D-052, D-124). */
  discountMemoId?: bigint | null;
  /** Extension data kept on the order discount row or in the pricing snapshot. */
  meta?: Record<string, unknown>;
}

export interface ShippingLeg {
  cartDestinationId: bigint | null;
  customerAddressId: bigint | null;
  snapshot: Record<string, unknown>;
  postcode: string;
  provinceId: bigint;
  subdistrictId: bigint | null;
  quantity: number;
  /** Customer shipping (VAT-exclusive) and Packio's cost of this leg; zero for RFQ quotations. */
  net: MoneyValue;
  cost: MoneyValue | null;
  method: string | null;
  customerRateVersionId: string | null;
  factoryPayoutVersionId: string | null;
}

export interface DraftOrder {
  cartItemId: bigint | null;
  cartItemPublicId: string | null;
  quoteId: bigint;
  quotePublicId: string;
  quoteCode: string | null;
  quoteSource: 'instant' | 'rfq';
  quoteOptionId: bigint;
  productTypeId: bigint;
  productTypeCode: string;
  catalogProductId: bigint | null;
  stockProductId: bigint | null;
  quantity: number;
  unit: string;
  designOption: string;
  designNote: string | null;
  mockupOption: string;
  reorderOfOrderId: bigint | null;
  designDocumentId: bigint | null;
  reuseArtworkProofId: bigint | null;
  leadTimeDays: number | null;
  earliestShipDate: Date | null;
  toleranceShortagePct: string | null;
  toleranceOveragePct: string | null;
  selectedFactoryId: bigint | null;
  lines: LineDraft[];
  discounts: DiscountDraft[];
  legs: ShippingLeg[];
  /** Staff-only: buy price + delivery cost (D-141). */
  buyCostNet: MoneyValue | null;
  totals: Totals;
  snapshot: Record<string, unknown>;
  configRefs: Record<string, unknown>;
}

export interface CheckoutInput {
  taxProfileId?: string | null;
  poNumber?: string | null;
  ccEmails?: string[];
  csRemarks?: string | null;
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>> | null;
  expectedGrossAmount?: string | null;
  /** Extension inputs (promotion codes, points, memo…), validated by their extension. */
  extensions?: Record<string, unknown>;
}

export interface CheckoutDraft {
  actor: Actor;
  customerUserId: bigint;
  channel: SalesChannel;
  csUserId: bigint | null;
  at: Date;
  cartId: bigint;
  cartRowVersion: number;
  input: CheckoutInput;
  taxProfile: TaxProfileSnapshot | null;
  vatPct: string;
  orders: DraftOrder[];
  totals: Totals;
  /** Messages extensions return to the client (applied promotions, capped amounts…). */
  notices: { code: string; params?: Record<string, unknown> }[];
  /** Extension state carried from `adjust` to `placed`. */
  state: Record<string, unknown>;
  /** Initial group status; an extension may hold the group for approval (D-123). */
  initialStatus: 'waiting_payment' | 'pending_company_approval';
  settingVersionIds: Record<string, string>;
}

export interface PlacedGroup {
  groupId: bigint;
  groupPublicId: string;
  orders: { id: bigint; publicId: string; draft: DraftOrder }[];
}

export interface CheckoutExtension {
  readonly key: string;
  /** Lower runs first (promotions 100, points 200, discounts 300; schedule 900, approval 950). */
  readonly order: number;
  /**
   * Supplies the buyer's tax profile instead of `taxProfileId` (a company branch, B3.5); `undefined` when
   * the extension does not apply. Runs before pricing so withholding follows the buyer.
   */
  taxProfile?(who: { actor: Actor; customerUserId: bigint }, input: CheckoutInput, db: Tx): Promise<TaxProfileSnapshot | undefined>;
  /** Adjusts prices on the draft (reads only); runs for preview and checkout. */
  adjust?(draft: CheckoutDraft, db: Tx): Promise<void>;
  /** Writes its rows in the checkout transaction once the group and its orders exist. */
  placed?(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void>;
}

@Injectable()
export class CheckoutExtensions {
  private readonly extensions = new Map<string, CheckoutExtension>();

  register(extension: CheckoutExtension): void {
    this.extensions.set(extension.key, extension);
  }

  list(): CheckoutExtension[] {
    return [...this.extensions.values()].sort((a, b) => a.order - b.order);
  }
}
