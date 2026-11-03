import { createHash } from 'node:crypto';

import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * D-468 (PLAN A-10, §7): the pure rules of agent discount requests — give-get change detection (one round per quote
 * version unless the terms change), the commission base of a quoted quantity, the commission at a discounted price
 * and the shape of the options Phase 4 offers (the first is always the full standard rate; co-fund lower, spiff
 * higher). Decimal strings in and out; no I/O.
 */

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());

export const DISCOUNT_REASONS = [
  'competitor_price',
  'budget',
  'volume',
  'strategic_account',
  'other',
] as const;
export const COMMITMENTS = ['one_off', 'call_off'] as const;
export const OPTION_KINDS = ['standard', 'co_fund', 'spiff'] as const;

export interface GiveGet {
  quantityChange: number | null;
  commitment: (typeof COMMITMENTS)[number];
  commitmentMonths: number | null;
  depositPct: string | null;
  cashWithinDays: number | null;
  leadTimeFlexDays: number | null;
  specChange: string | null;
}

/** Canonical give-get (decimals normalised, blank text = none) — the same terms always hash the same. */
export function canonicalGiveGet(g: GiveGet): GiveGet {
  return {
    quantityChange: g.quantityChange ?? null,
    commitment: g.commitment,
    commitmentMonths: g.commitment === 'call_off' ? (g.commitmentMonths ?? null) : null,
    depositPct: g.depositPct === null || g.depositPct === undefined ? null : D(g.depositPct).toFixed(4),
    cashWithinDays: g.cashWithinDays ?? null,
    leadTimeFlexDays: g.leadTimeFlexDays ?? null,
    specChange: g.specChange?.trim().replace(/\s+/g, ' ').toLowerCase() || null,
  };
}

export function giveGetSha256(g: GiveGet): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(canonicalGiveGet(g)))
    .digest();
}

/** True when the customer gives something: at least one give-get field beyond a plain one-off order. */
export function givesSomething(g: GiveGet): boolean {
  const c = canonicalGiveGet(g);
  return (
    c.quantityChange !== null ||
    c.commitment === 'call_off' ||
    c.depositPct !== null ||
    c.cashWithinDays !== null ||
    c.leadTimeFlexDays !== null ||
    c.specChange !== null
  );
}

export type RoundRefusal = 'quotes.discount_request_open' | 'quotes.discount_round_limit' | null;

/**
 * Whether a new round may be opened on a quote version: never while one is open; after an answered round only when
 * at least one give-get field changed from the LAST round (A-10 one-round rule).
 */
export function roundRefusal(
  previous: readonly { status: string; giveGetSha256: Uint8Array }[],
  next: Buffer,
): RoundRefusal {
  if (previous.some((r) => r.status === 'open')) return 'quotes.discount_request_open';
  const last = previous.at(-1);
  if (last && Buffer.from(last.giveGetSha256).equals(next)) return 'quotes.discount_round_limit';
  return null;
}

/**
 * The commission base of a quoted quantity (D-418): its price before VAT, excluding shipping — `net_amount` of the
 * quote option is gross − VAT incl. shipping, so the shipping net is taken off.
 */
export function quotedBase(option: { netAmount: string; shippingNetAmount: string | null }): string {
  const base = D(option.netAmount).sub(option.shippingNetAmount ?? 0);
  return (base.gt(0) ? base : D(0)).toFixed(2);
}

/** The base after a discount of `pct` %, rounded half-up to the satang. */
export function discountedBase(base: string, pct: string): string {
  return D(base).mul(D(100).sub(pct)).div(100).toDecimalPlaces(2).toFixed(2);
}

/** Commission at a base: base × rate %, rounded to the satang; nothing below the plan's minimum base. */
export function commissionAt(base: string, ratePct: string, minBase: string): string {
  const b = D(base);
  if (b.lte(0) || b.lt(minBase)) return '0.00';
  return b.mul(ratePct).div(100).toDecimalPlaces(2).toFixed(2);
}

export interface OfferInput {
  kind: (typeof OPTION_KINDS)[number];
  discountPct: string;
  /** The rate of a co-fund / spiff option; ignored (forced) for `standard`. */
  ratePct?: string | null;
}

export interface OfferedOption {
  position: number;
  kind: (typeof OPTION_KINDS)[number];
  discountPct: string;
  baseAmount: string;
  netAmount: string;
  ratePct: string;
  standardRatePct: string;
  commissionAmount: string;
}

export type OfferProblem =
  | 'count'
  | 'first_not_standard'
  | 'standard_twice'
  | 'co_fund_not_lower'
  | 'spiff_not_higher'
  | 'rate_missing'
  | 'discount_range';

/**
 * Builds the 1–3 options of an answer (Phase 4 desk calls it through `AgentDiscountsService.offerOptions`): the first
 * is `standard` and always carries the FULL standard rate (A-05: nobody but the agent lowers it); a `co_fund` option
 * has a lower rate and only applies once the agent accepts it; a `spiff` a higher one. Throws the first problem.
 */
export function buildOptions(
  offers: readonly OfferInput[],
  ctx: { base: string; standardRatePct: string; minBase: string },
): OfferedOption[] {
  const fail = (p: OfferProblem): never => {
    throw new OfferError(p);
  };
  if (offers.length < 1 || offers.length > 3) fail('count');
  if (offers[0]!.kind !== 'standard') fail('first_not_standard');
  const standard = D(ctx.standardRatePct);
  return offers.map((o, i) => {
    if (i > 0 && o.kind === 'standard') fail('standard_twice');
    const pct = D(o.discountPct);
    if (pct.lt(0) || pct.gte(100)) fail('discount_range');
    let rate = standard;
    if (o.kind !== 'standard') {
      if (o.ratePct === null || o.ratePct === undefined) fail('rate_missing');
      rate = D(o.ratePct!);
      if (o.kind === 'co_fund' && (rate.gte(standard) || rate.lt(0))) fail('co_fund_not_lower');
      if (o.kind === 'spiff' && (rate.lte(standard) || rate.gt(100))) fail('spiff_not_higher');
    }
    const net = discountedBase(ctx.base, pct.toFixed(4));
    return {
      position: i + 1,
      kind: o.kind,
      discountPct: pct.toFixed(4),
      baseAmount: D(ctx.base).toFixed(2),
      netAmount: net,
      ratePct: rate.toFixed(4),
      standardRatePct: standard.toFixed(4),
      commissionAmount: commissionAt(net, rate.toFixed(4), ctx.minBase),
    };
  });
}

export class OfferError extends Error {
  constructor(readonly problem: OfferProblem) {
    super(`discount options: ${problem}`);
  }
}

const thDate = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}/${Number(y) + 543}`;
};

/**
 * The conditions line printed with a discounted price (PLAN §7): "ราคานี้สำหรับ … ชำระภายใน … สั่งภายใน …".
 * `validUntil` is a Bangkok date (YYYY-MM-DD).
 */
export function conditionsLine(g: GiveGet, quantity: number, validUntil: string): { th: string; en: string } {
  const c = canonicalGiveGet(g);
  const qty = c.quantityChange ?? quantity;
  const th = [`ราคานี้สำหรับ ${qty.toLocaleString('en-US')} ชิ้น`];
  const en = [`This price is for ${qty.toLocaleString('en-US')} pieces`];
  if (c.commitment === 'call_off' && c.commitmentMonths) {
    th.push(`สัญญาเรียกของ ${c.commitmentMonths} เดือน`);
    en.push(`a ${c.commitmentMonths}-month call-off agreement`);
  }
  if (c.depositPct) {
    th.push(`มัดจำ ${D(c.depositPct).toString()}%`);
    en.push(`a ${D(c.depositPct).toString()}% deposit`);
  }
  if (c.cashWithinDays !== null) {
    th.push(`ชำระภายใน ${c.cashWithinDays} วัน`);
    en.push(`payment within ${c.cashWithinDays} days`);
  }
  if (c.leadTimeFlexDays !== null) {
    th.push(`รับงานได้ช้ากว่าปกติ ${c.leadTimeFlexDays} วัน`);
    en.push(`lead time ${c.leadTimeFlexDays} days longer`);
  }
  if (g.specChange?.trim()) {
    th.push(`ปรับสเปก: ${g.specChange.trim()}`);
    en.push(`spec change: ${g.specChange.trim()}`);
  }
  th.push(`สั่งภายใน ${thDate(validUntil)}`);
  en.push(`order by ${validUntil}`);
  return { th: th.join(' · '), en: en.join(' · ') };
}
