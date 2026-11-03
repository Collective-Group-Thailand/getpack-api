import { createHash } from 'node:crypto';

import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { canonical } from '@modules/catalog/imports/import-engine';

/**
 * D-470 (PLAN A-12, §7): the pure rules of the discount approval desk — the approval level, the per-deal waterfall,
 * the credit cost estimate, the snapshot hash and the field-level serializers. Decimal strings in and out; no I/O.
 * Wording: the bottom line is "กำไรหลังหักค่าคอม" (contribution after commission), never "กำไรสุทธิ".
 */

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());
const money = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
const pct2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);

// --- approval level ---------------------------------------------------------------------------------------------

export const APPROVAL_LEVELS = ['rep', 'sales_manager', 'c_level'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];
export const AUTHORITY_COLOURS = ['green', 'amber', 'red'] as const;
export type AuthorityColour = (typeof AUTHORITY_COLOURS)[number];

export interface DiscountAuthority {
  repMaxPct: string;
  managerMaxPct: string;
  repMaxAmount: string | null;
  managerMaxAmount: string | null;
}

/**
 * The matrix: `rep` when the discount % ≤ repMaxPct (and the amount ≤ repMaxAmount when set) and the gross margin
 * after it ≥ floor; `sales_manager` the same up to managerMaxPct; else `c_level` (always below the floor). A
 * negotiation-heavy customer moves one level up (C-Level stays C-Level).
 */
export function approvalLevel(input: {
  discountPct: string;
  discountAmount: string;
  grossMarginPct: string;
  floorPct: string;
  authority: DiscountAuthority;
  negotiationHeavy: boolean;
}): { baseLevel: ApprovalLevel; level: ApprovalLevel } {
  const pct = D(input.discountPct);
  const amount = D(input.discountAmount);
  const aboveFloor = D(input.grossMarginPct).gte(input.floorPct);
  const within = (maxPct: string, maxAmount: string | null) =>
    aboveFloor && pct.lte(maxPct) && (maxAmount === null || amount.lte(maxAmount));
  const baseLevel: ApprovalLevel = within(input.authority.repMaxPct, input.authority.repMaxAmount)
    ? 'rep'
    : within(input.authority.managerMaxPct, input.authority.managerMaxAmount)
      ? 'sales_manager'
      : 'c_level';
  return { baseLevel, level: input.negotiationHeavy ? levelAbove(baseLevel) : baseLevel };
}

export function levelAbove(level: ApprovalLevel): ApprovalLevel {
  return level === 'rep' ? 'sales_manager' : 'c_level';
}

export function levelRank(level: ApprovalLevel): number {
  return APPROVAL_LEVELS.indexOf(level);
}

/** What a rep is shown instead of figures: green = within a rep's authority, amber = manager, red = C-Level. */
export function authorityColour(level: ApprovalLevel): AuthorityColour {
  return level === 'rep' ? 'green' : level === 'sales_manager' ? 'amber' : 'red';
}

/** The highest level a person may decide, from their roles (Superadmin decides any). */
export function deciderLevel(roles: readonly string[]): ApprovalLevel | null {
  if (roles.includes('superadmin') || roles.includes('c_level')) return 'c_level';
  if (roles.includes('sales_manager')) return 'sales_manager';
  if (roles.includes('sales_rep')) return 'rep';
  return null;
}

// --- negotiation history ------------------------------------------------------------------------------------------

/** Rounds ≥ minRounds on ≥ minQuotes of the last `lastQuotes` quotes (newest first) — "เจรจาราคาสูง". */
export function negotiationHeavy(
  roundsPerQuoteNewestFirst: readonly number[],
  rule: { minRounds: number; minQuotes: number; lastQuotes: number },
): boolean {
  return (
    roundsPerQuoteNewestFirst.slice(0, rule.lastQuotes).filter((r) => r >= rule.minRounds).length >=
    rule.minQuotes
  );
}

// --- credit cost (item 9) -------------------------------------------------------------------------------------------

export interface CashLeg {
  /** THB, decimal string. */
  amount: string;
  /** Days from job acceptance (day 0). */
  day: number;
}

/**
 * Credit cost estimate (PLAN §7; management figure, never posted): each cash-out leg to the factory is funded by the
 * customer's receipts first-in first-out; a leg costs `amount-days uncovered × rate ÷ 365`, **rounded half-up to the
 * whole baht per leg**, then summed (the PLAN example rounds its legs: ฿6,642 + ฿4,757 = ฿11,399). Receipts before
 * a payment cover it at once; a leg never covered within the horizon counts to its last receipt.
 */
export function creditCost(input: {
  cashOut: readonly CashLeg[];
  receipts: readonly CashLeg[];
  annualPct: string;
}): { amount: string; legs: { day: number; amount: string; days: string; cost: string }[] } {
  const outs = [...input.cashOut].filter((l) => D(l.amount).gt(0)).sort((a, b) => a.day - b.day);
  const ins = [...input.receipts].filter((l) => D(l.amount).gt(0)).sort((a, b) => a.day - b.day);
  const rate = D(input.annualPct).div(100).div(365);
  // R(t): cumulative receipts at day t.
  const received = (t: number) => ins.filter((r) => r.day <= t).reduce((a, r) => a.add(r.amount), D(0));
  const days = [...new Set(ins.map((r) => r.day))].sort((a, b) => a - b);
  let cumulative = D(0);
  const legs = outs.map((leg) => {
    const lo = cumulative;
    const hi = cumulative.add(leg.amount);
    cumulative = hi;
    // Uncovered part of [lo, hi] at time t: clamp(hi − max(R(t), lo), 0, amount).
    const uncovered = (t: number) => {
      const r = received(t);
      const top = r.gt(lo) ? r : lo;
      const u = hi.sub(top);
      return u.gt(0) ? u : D(0);
    };
    let amountDays = D(0);
    let t = leg.day;
    for (const next of [...days.filter((d) => d > leg.day), Number.POSITIVE_INFINITY]) {
      const u = uncovered(t);
      if (u.lte(0) || next === Number.POSITIVE_INFINITY) break;
      amountDays = amountDays.add(u.mul(next - t));
      t = next;
    }
    const cost = amountDays.mul(rate).toDecimalPlaces(0, MoneyDecimal.ROUND_HALF_UP);
    return {
      day: leg.day,
      amount: money(D(leg.amount)),
      days: D(leg.amount).gt(0) ? amountDays.div(leg.amount).toDecimalPlaces(2).toFixed(2) : '0.00',
      cost: cost.toFixed(2),
    };
  });
  return { amount: money(legs.reduce((a, l) => a.add(l.cost), D(0))), legs };
}

// --- waterfall ------------------------------------------------------------------------------------------------------

export interface WaterfallInput {
  /** The quantity's price before VAT, excluding shipping (the commission base before discount). */
  listRevenue: string;
  discountPct: string;
  /** Factory buy price (net) of the quantity. */
  factoryCost: string;
  /** Shipping charged to the customer (net) and paid to the carrier / factory (net); null = not priced. */
  shippingCharged: string | null;
  shippingPaid: string | null;
  /** VAT rate % of the quotation (payment fees are on the gross the customer pays). */
  vatPct: string;
  paymentFee: {
    method: string | null;
    pct: string | null;
    fixedAmount: string | null;
    status: 'set' | 'not_set';
  };
  freeServices: string;
  commissionRatePct: string;
  minBase: string;
  creditCost: string;
  badDebt: { pct: string | null; status: 'set' | 'not_set' | 'not_applicable' };
  floorPct: string;
}

export interface Waterfall {
  listRevenue: string;
  discountPct: string;
  discountAmount: string;
  netRevenue: string;
  factoryCost: string;
  shippingDifference: string;
  paymentFee: { method: string | null; amount: string; status: string };
  freeServices: string;
  grossMargin: string;
  grossMarginPct: string;
  commissionRatePct: string;
  commissionAmount: string;
  creditCost: string;
  creditCostPct: string;
  badDebtProvision: { pct: string | null; amount: string; status: string };
  contributionAfterCommission: string;
  contributionPct: string;
  floorPct: string;
  floorCheck: 'pass' | 'fail';
}

/**
 * The per-deal waterfall (PLAN A-12): list revenue ex VAT − discount = net revenue − factory cost + shipping
 * difference − payment fee − samples / free services = gross margin; − agent commission − credit cost − bad-debt
 * provision = contribution after commission ("กำไรหลังหักค่าคอม"). Percentages of net revenue; floor check on the gross
 * margin %.
 */
export function waterfall(i: WaterfallInput): Waterfall {
  const list = D(i.listRevenue);
  const discount = list.mul(i.discountPct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
  const net = list.sub(discount);
  const shipDiff = D(i.shippingCharged ?? 0).sub(i.shippingPaid ?? 0);
  const gross = net
    .add(i.shippingCharged ?? 0)
    .mul(D(100).add(i.vatPct))
    .div(100);
  const fee =
    i.paymentFee.status === 'set'
      ? gross
          .mul(i.paymentFee.pct ?? 0)
          .div(100)
          .add(i.paymentFee.fixedAmount ?? 0)
      : D(0);
  const feeAmount = D(money(fee));
  const grossMargin = net.sub(i.factoryCost).add(shipDiff).sub(feeAmount).sub(i.freeServices);
  const ofNet = (v: MoneyValue) => (net.gt(0) ? pct2(v.mul(100).div(net)) : '0.00');
  const commission = net.lte(0) || net.lt(i.minBase) ? D(0) : D(money(net.mul(i.commissionRatePct).div(100)));
  const badDebt = i.badDebt.status === 'set' ? D(money(net.mul(i.badDebt.pct ?? 0).div(100))) : D(0);
  const contribution = grossMargin.sub(commission).sub(i.creditCost).sub(badDebt);
  const grossMarginPct = ofNet(grossMargin);
  return {
    listRevenue: money(list),
    discountPct: D(i.discountPct).toFixed(2),
    discountAmount: money(discount),
    netRevenue: money(net),
    factoryCost: money(D(i.factoryCost)),
    shippingDifference: money(shipDiff),
    paymentFee: { method: i.paymentFee.method, amount: money(feeAmount), status: i.paymentFee.status },
    freeServices: money(D(i.freeServices)),
    grossMargin: money(grossMargin),
    grossMarginPct,
    commissionRatePct: D(i.commissionRatePct).toFixed(4),
    commissionAmount: money(commission),
    creditCost: money(D(i.creditCost)),
    creditCostPct: ofNet(D(i.creditCost)),
    badDebtProvision: { pct: i.badDebt.pct, amount: money(badDebt), status: i.badDebt.status },
    contributionAfterCommission: money(contribution),
    contributionPct: ofNet(contribution),
    floorPct: D(i.floorPct).toFixed(2),
    floorCheck: D(grossMarginPct).gte(i.floorPct) ? 'pass' : 'fail',
  };
}

// --- field-level visibility -----------------------------------------------------------------------------------------

export const WATERFALL_TIERS = ['authority', 'margin_pct', 'full'] as const;
export type WaterfallTier = (typeof WATERFALL_TIERS)[number];

/** The tier a viewer gets — chosen server-side from permissions (D-141, PLAN A-12). */
export function tierOf(permissions: ReadonlySet<string>): WaterfallTier {
  if (permissions.has('discount_approvals.waterfall_full')) return 'full';
  if (permissions.has('discount_approvals.margin_pct')) return 'margin_pct';
  return 'authority';
}

export interface AuthorityView {
  visibility: 'authority';
  authorityLevel: AuthorityColour;
}
export interface MarginPctView {
  visibility: 'margin_pct';
  authorityLevel: AuthorityColour;
  discountPct: string;
  grossMarginPct: string;
  contributionPct: string;
  floorPct: string;
  floorCheck: 'pass' | 'fail';
}
export type FullView = { visibility: 'full'; authorityLevel: AuthorityColour } & Waterfall;
export type TieredWaterfall = AuthorityView | MarginPctView | FullView;

/**
 * Three serializers, built field by field (never by deleting keys from the full one): a rep (and nobody below) gets
 * the authority colour only; a sales manager percentages and the floor check; C-Level, VP, Director, Finance Manager
 * and Superadmin the full waterfall.
 */
export function serializeWaterfall(w: Waterfall, level: ApprovalLevel, tier: WaterfallTier): TieredWaterfall {
  const authorityLevel = authorityColour(level);
  if (tier === 'authority') return { visibility: 'authority', authorityLevel };
  if (tier === 'margin_pct')
    return {
      visibility: 'margin_pct',
      authorityLevel,
      discountPct: w.discountPct,
      grossMarginPct: w.grossMarginPct,
      contributionPct: w.contributionPct,
      floorPct: w.floorPct,
      floorCheck: w.floorCheck,
    };
  return { visibility: 'full', authorityLevel, ...w };
}

// --- snapshot -------------------------------------------------------------------------------------------------------

export interface ApprovalSnapshot {
  quoteId: string;
  lines: {
    optionId: string;
    quantity: number;
    buyCost: string | null;
    shippingPaid: string | null;
    net: string;
  }[];
  terms: {
    requestedPct: string;
    giveGetSha256: string;
    paymentTemplate: string | null;
    creditDays: number | null;
  };
}

export function snapshotSha256(s: ApprovalSnapshot): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(canonical(s)))
    .digest();
}

/**
 * Whether a later snapshot keeps an approval: equal → yes; lines, quantities or terms changed → no; only costs changed
 * after the quotation expired (a re-quote, D-436) → yes only while the margin at today's cost is still ≥ floor.
 */
export function snapshotKeeps(
  approved: ApprovalSnapshot,
  now: ApprovalSnapshot,
  context: { requoteAfterExpiry: boolean; marginAtTodayPct: string; floorPct: string },
): boolean {
  if (snapshotSha256(approved).equals(snapshotSha256(now))) return true;
  const shape = (s: ApprovalSnapshot) =>
    JSON.stringify(
      canonical({ lines: s.lines.map((l) => ({ quantity: l.quantity, net: l.net })), terms: s.terms }),
    );
  if (shape(approved) !== shape(now)) return false;
  return context.requoteAfterExpiry && D(context.marginAtTodayPct).gte(context.floorPct);
}
