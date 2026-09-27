import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Promotion engine (D-053), pure: evaluates candidate promotions over a cart snapshot and returns the
 * discount per line with the margin guard applied. No I/O; the caller loads the promotions, counters and
 * the customer's context and stores the result per line for accounting (P09) and analytics.
 *
 * Stacking: promotions are evaluated alone first. When any **exclusive** promotion applies, the one
 * giving the most wins alone. Otherwise the best **best_of** promotion and every **stackable** one apply
 * together (within one `stackGroup` only the best). Discounts are then applied in priority order on what
 * is left of each line, so no line ever goes below zero. The **margin guard** caps the discounts of an
 * order so its margin stays at the floor (D-012 / D-053) — the capped amount is reported, never hidden.
 */

export type Channel = 'web' | 'cs' | 'line' | 'b2b';
export type StackingMode = 'exclusive' | 'stackable' | 'best_of';

export interface PromotionConditions {
  channels?: Channel[];
  /** `new` = no paid order yet, `returning` = at least one, `b2b` = ordering for a company. */
  segments?: ('new' | 'returning' | 'b2b')[];
  productTypeCodes?: string[];
  categoryCodes?: string[];
  catalogProductIds?: string[];
  /** Minimum pieces on a matching line. */
  minQuantity?: number;
  /** Minimum gross of the matching lines (incl. VAT). */
  minOrderValue?: string;
  firstOrderOnly?: boolean;
  /** The customer pays with one of these (declared at checkout, enforced when paying). */
  paymentMethods?: string[];
  /** Shipping zone codes of every destination. */
  zoneCodes?: string[];
}

export type PromotionBenefit =
  | { type: 'percent'; pct: string; maxAmount?: string }
  | { type: 'fixed'; amount: string }
  | {
      type: 'tiered';
      basis: 'quantity' | 'value';
      tiers: { min: string; pct?: string; amount?: string }[];
      maxAmount?: string;
    }
  | { type: 'free_shipping' }
  | { type: 'unit_price_override'; unitPrice: string }
  | { type: 'free_design' }
  | { type: 'free_revision_rounds'; rounds: number }
  | { type: 'free_mockup' }
  | { type: 'points_multiplier'; multiplier: string }
  | { type: 'bonus_points'; points: number };

export interface PromotionCandidate {
  id: string;
  kind: 'coupon' | 'automatic' | 'referral';
  priority: number;
  stacking: StackingMode;
  stackGroup: string | null;
  conditions: PromotionConditions;
  benefit: PromotionBenefit;
  /** Campaign budget left (THB); null = no budget. */
  budgetLeft: string | null;
}

export interface CartLine {
  /** Order index and line index in the checkout draft. */
  order: number;
  line: number;
  lineType: 'product' | 'design_fee' | 'structure_design_fee' | 'shipping';
  productTypeCode: string;
  categoryCode: string | null;
  catalogProductId: string | null;
  quantity: number;
  /** VAT-exclusive net and the VAT rate of the line. */
  net: string;
  vatPct: string;
}

export interface CartOrder {
  order: number;
  /** Buy price + delivery cost (staff-only); null when unknown — then no discount can be given. */
  buyCostNet: string | null;
}

export interface PromotionContext {
  channel: Channel;
  segment: 'new' | 'returning';
  b2b: boolean;
  firstOrder: boolean;
  paymentMethod: string | null;
  zoneCodes: string[];
  marginFloorPct: string;
}

export interface LineDiscount {
  promotionId: string;
  order: number;
  line: number;
  /** Discount on the line's net (VAT-exclusive). */
  amount: string;
  /** Removed by the margin guard or the campaign budget. */
  cappedAmount: string;
  capReason: 'margin_floor' | 'budget' | null;
}

export interface Perk {
  promotionId: string;
  type: 'free_design' | 'free_revision_rounds' | 'free_mockup' | 'points_multiplier' | 'bonus_points';
  value: string | number | null;
}

export interface EvaluationResult {
  applied: string[];
  /** Candidates whose conditions failed, with the first failing condition (shown to the customer for codes). */
  rejected: { promotionId: string; reason: string }[];
  discounts: LineDiscount[];
  perks: Perk[];
  requiredPaymentMethods: string[];
}

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const ZERO = D(0);

/** The first condition a promotion fails, or null when every condition holds. */
export function failedCondition(
  c: PromotionConditions,
  lines: readonly CartLine[],
  ctx: PromotionContext,
): string | null {
  if (c.channels && !c.channels.includes(ctx.channel)) return 'channel';
  if (c.segments) {
    const ok = c.segments.some((s) => (s === 'b2b' ? ctx.b2b : s === ctx.segment));
    if (!ok) return 'segment';
  }
  if (c.firstOrderOnly && !ctx.firstOrder) return 'first_order';
  if (c.paymentMethods && ctx.paymentMethod && !c.paymentMethods.includes(ctx.paymentMethod))
    return 'payment_method';
  if (c.zoneCodes && (ctx.zoneCodes.length === 0 || !ctx.zoneCodes.every((z) => c.zoneCodes!.includes(z))))
    return 'zone';
  const matching = matchingLines(c, lines);
  if (matching.length === 0) return 'product';
  if (c.minQuantity && !matching.some((l) => l.quantity >= c.minQuantity!)) return 'quantity';
  if (c.minOrderValue) {
    const gross = matching.reduce((a, l) => a.add(D(l.net).mul(D(100).add(l.vatPct)).div(100)), ZERO);
    if (gross.lt(c.minOrderValue)) return 'order_value';
  }
  return null;
}

/** Product lines a promotion's product conditions select. */
export function matchingLines(c: PromotionConditions, lines: readonly CartLine[]): CartLine[] {
  return lines.filter(
    (l) =>
      l.lineType === 'product' &&
      (!c.productTypeCodes || c.productTypeCodes.includes(l.productTypeCode)) &&
      (!c.categoryCodes || (l.categoryCode !== null && c.categoryCodes.includes(l.categoryCode))) &&
      (!c.catalogProductIds ||
        (l.catalogProductId !== null && c.catalogProductIds.includes(l.catalogProductId))),
  );
}

/** Standalone discount of one promotion per line (before stacking, the guard and the budget). */
export function standalone(p: PromotionCandidate, lines: readonly CartLine[]): Map<string, MoneyValue> {
  const out = new Map<string, MoneyValue>();
  const key = (l: CartLine) => `${l.order}:${l.line}`;
  const targets = matchingLines(p.conditions, lines);
  const spread = (total: MoneyValue, on: CartLine[]) => {
    const base = on.reduce((a, l) => a.add(l.net), ZERO);
    if (base.lte(0) || total.lte(0)) return;
    const capped = MoneyDecimal.min(total, base);
    let left = capped;
    on.forEach((l, i) => {
      const share = i === on.length - 1 ? left : round2(capped.mul(l.net).div(base));
      const amount = MoneyDecimal.min(share, D(l.net));
      out.set(key(l), (out.get(key(l)) ?? ZERO).add(amount));
      left = left.sub(amount);
    });
  };
  const b = p.benefit;
  switch (b.type) {
    case 'percent': {
      const total = targets.reduce((a, l) => a.add(round2(D(l.net).mul(b.pct).div(100))), ZERO);
      spread(b.maxAmount ? MoneyDecimal.min(total, D(b.maxAmount)) : total, targets);
      break;
    }
    case 'fixed':
      spread(D(b.amount), targets);
      break;
    case 'tiered': {
      const measure =
        b.basis === 'quantity'
          ? D(targets.reduce((a, l) => a + l.quantity, 0))
          : targets.reduce((a, l) => a.add(D(l.net).mul(D(100).add(l.vatPct)).div(100)), ZERO);
      const tier = [...b.tiers].sort((x, y) => D(y.min).cmp(D(x.min))).find((t) => measure.gte(t.min));
      if (!tier) break;
      const net = targets.reduce((a, l) => a.add(l.net), ZERO);
      let total = tier.pct ? round2(net.mul(tier.pct).div(100)) : D(tier.amount ?? '0');
      if (b.maxAmount) total = MoneyDecimal.min(total, D(b.maxAmount));
      spread(total, targets);
      break;
    }
    case 'free_shipping': {
      const orders = new Set(targets.map((l) => l.order));
      for (const l of lines.filter((x) => x.lineType === 'shipping' && orders.has(x.order)))
        out.set(key(l), D(l.net));
      break;
    }
    case 'unit_price_override':
      for (const l of targets) {
        // The override price is VAT-inclusive per piece; the discount is the difference on the net.
        const newNet = round2(D(b.unitPrice).mul(l.quantity).mul(100).div(D(100).add(l.vatPct)));
        const diff = D(l.net).sub(newNet);
        if (diff.gt(0)) out.set(key(l), diff);
      }
      break;
    default:
      break; // perks carry no money
  }
  return out;
}

const total = (m: Map<string, MoneyValue>) => [...m.values()].reduce((a, v) => a.add(v), ZERO);

/** Evaluates the candidates over the cart (see file comment for the rules). Pure and order-independent. */
export function evaluatePromotions(
  candidates: readonly PromotionCandidate[],
  lines: readonly CartLine[],
  orders: readonly CartOrder[],
  ctx: PromotionContext,
): EvaluationResult {
  const rejected: EvaluationResult['rejected'] = [];
  const eligible: { p: PromotionCandidate; money: Map<string, MoneyValue> }[] = [];
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const p of sorted) {
    const failed = failedCondition(p.conditions, lines, ctx);
    if (failed) rejected.push({ promotionId: p.id, reason: failed });
    else eligible.push({ p, money: standalone(p, lines) });
  }
  const best = (list: typeof eligible) =>
    list.reduce<(typeof eligible)[number] | null>((winner, e) => {
      if (!winner) return e;
      const c = total(e.money).cmp(total(winner.money));
      return c > 0 || (c === 0 && e.p.priority < winner.p.priority) ? e : winner;
    }, null);

  let chosen: typeof eligible;
  const exclusive = best(eligible.filter((e) => e.p.stacking === 'exclusive'));
  if (exclusive) {
    chosen = [exclusive];
  } else {
    const bestOf = best(eligible.filter((e) => e.p.stacking === 'best_of'));
    const stackable = eligible.filter((e) => e.p.stacking === 'stackable');
    const byGroup = new Map<string, typeof eligible>();
    for (const e of stackable) {
      const g = e.p.stackGroup ?? `solo:${e.p.id}`;
      byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
    }
    chosen = [...(bestOf ? [bestOf] : []), ...[...byGroup.values()].map((g) => best(g)!)];
    chosen.sort((a, b) => a.p.priority - b.p.priority || a.p.id.localeCompare(b.p.id));
  }
  for (const e of eligible)
    if (!chosen.includes(e)) rejected.push({ promotionId: e.p.id, reason: 'not_combinable' });

  // Apply in priority order on what is left of each line; the campaign budget caps each promotion.
  const left = new Map(lines.map((l) => [`${l.order}:${l.line}`, D(l.net)]));
  const discounts: LineDiscount[] = [];
  for (const e of chosen) {
    let budget = e.p.budgetLeft === null ? null : D(e.p.budgetLeft);
    for (const [k, wanted] of e.money) {
      const room = left.get(k) ?? ZERO;
      let amount = MoneyDecimal.min(wanted, room);
      let capped = ZERO;
      let capReason: LineDiscount['capReason'] = null;
      if (budget !== null && amount.gt(budget)) {
        capped = amount.sub(budget);
        amount = budget;
        capReason = 'budget';
      }
      if (budget !== null) budget = budget.sub(amount);
      if (amount.lte(0) && capped.lte(0)) continue;
      left.set(k, room.sub(amount));
      const [order, line] = k.split(':').map(Number) as [number, number];
      discounts.push({
        promotionId: e.p.id,
        order,
        line,
        amount: formatMoney(amount),
        cappedAmount: formatMoney(capped),
        capReason,
      });
    }
  }
  guardMargins(discounts, lines, orders, ctx.marginFloorPct);

  const perks: Perk[] = chosen.flatMap((e): Perk[] => {
    const b = e.p.benefit;
    switch (b.type) {
      case 'free_design':
      case 'free_mockup':
        return [{ promotionId: e.p.id, type: b.type, value: null }];
      case 'free_revision_rounds':
        return [{ promotionId: e.p.id, type: b.type, value: b.rounds }];
      case 'points_multiplier':
        return [{ promotionId: e.p.id, type: b.type, value: b.multiplier }];
      case 'bonus_points':
        return [{ promotionId: e.p.id, type: b.type, value: b.points }];
      default:
        return [];
    }
  });
  const requiredPaymentMethods = [...new Set(chosen.flatMap((e) => e.p.conditions.paymentMethods ?? []))];
  const withMoney = new Set(discounts.filter((d) => D(d.amount).gt(0)).map((d) => d.promotionId));
  const applied = chosen
    .filter((e) => withMoney.has(e.p.id) || perks.some((x) => x.promotionId === e.p.id))
    .map((e) => e.p.id);
  return {
    applied,
    rejected,
    discounts: discounts.filter((d) => D(d.amount).gt(0) || D(d.cappedAmount).gt(0)),
    perks,
    requiredPaymentMethods,
  };
}

/**
 * Margin guard: per order, the discounts may not take (net − discount − buy cost) / (net − discount)
 * below the floor. The allowed total is net − buy cost / (1 − floor); discounts over it are cut from the
 * last applied promotion backwards and reported as `margin_floor`. Unknown buy cost → no discount.
 */
export function guardMargins(
  discounts: LineDiscount[],
  lines: readonly CartLine[],
  orders: readonly CartOrder[],
  marginFloorPct: string,
): void {
  const keep = D(1).sub(D(marginFloorPct).div(100));
  for (const o of orders) {
    const own = discounts.filter((d) => d.order === o.order);
    if (own.length === 0) continue;
    const net = lines.filter((l) => l.order === o.order).reduce((a, l) => a.add(l.net), ZERO);
    const allowed =
      o.buyCostNet === null || keep.lte(0)
        ? ZERO
        : MoneyDecimal.max(ZERO, round2(net.sub(D(o.buyCostNet).div(keep))));
    let excess = own.reduce((a, d) => a.add(d.amount), ZERO).sub(allowed);
    for (const d of [...own].reverse()) {
      if (excess.lte(0)) break;
      const cut = MoneyDecimal.min(excess, D(d.amount));
      d.amount = formatMoney(D(d.amount).sub(cut));
      d.cappedAmount = formatMoney(D(d.cappedAmount).add(cut));
      d.capReason = 'margin_floor';
      excess = excess.sub(cut);
    }
  }
}
