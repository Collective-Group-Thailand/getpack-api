import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { discountLine } from '@modules/checkout/order-pricing';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { IdentityFingerprints } from './identity-fingerprints.service';
import {
  type CartLine,
  type CartOrder,
  evaluatePromotions,
  type PromotionBenefit,
  type PromotionCandidate,
  type PromotionConditions,
  type PromotionContext,
} from './promotion-engine';
import { type AppliedPromotion, PromotionRedemptions } from './promotion-redemptions.service';
import { ReferralsService } from './referrals.service';

const D = (v: { toString(): string } | string) => new MoneyDecimal(v.toString());
/** Scheme of the customer rate cards; its zones are the ones promotions name (D-053 "shipping zone"). */
const CUSTOMER_ZONE_SCHEME = 'customer_default';

const PROMOTION_WITH = { campaign: true } as const satisfies Prisma.PromotionInclude;
type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof PROMOTION_WITH }>;

interface Candidate {
  row: PromotionRow;
  couponCodeId: bigint | null;
  code: string | null;
}

interface PromotionState {
  applied: AppliedPromotion[];
}

/** Promotions live at `at`: active, inside their window, and inside an active campaign's window. */
export function livePromotionWhere(at: Date): Prisma.PromotionWhereInput {
  return {
    status: 'active',
    startsAt: { lte: at },
    AND: [
      { OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      {
        OR: [
          { campaignId: null },
          {
            campaign: {
              status: 'active',
              startsAt: { lte: at },
              OR: [{ endsAt: null }, { endsAt: { gt: at } }],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Checkout extension `promotions` (order 100, D-053): evaluates the cart's coupon codes and the live
 * automatic promotions with the pure engine, writes the discount per line (VAT and withholding follow),
 * and at placement reserves each redemption under row-locked counters and budgets.
 */
@Injectable()
export class PromotionCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'promotions';
  readonly order = 100;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
    private readonly identity: IdentityFingerprints,
    private readonly redemptions: PromotionRedemptions,
    private readonly referrals: ReferralsService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const at = draft.at;
    const candidates = await this.candidates(draft, db);
    if (candidates.length === 0) return;

    const usable: Candidate[] = [];
    for (const c of candidates) {
      const reason = await this.limitReason(db, c, draft.customerUserId);
      if (reason)
        draft.notices.push({
          code: 'promotion.rejected',
          params: { promotionId: c.row.publicId, code: c.code, reason },
        });
      else usable.push(c);
    }
    if (usable.length === 0) return;

    const floor = await this.settings.at('pricing.margin_floor_pct', { at });
    const lines = await this.cartLines(draft, db);
    const orders: CartOrder[] = draft.orders.map((o, i) => ({
      order: i,
      buyCostNet: o.buyCostNet ? formatMoney(o.buyCostNet) : null,
    }));
    const ctx = await this.context(draft, db, String(floor.value));
    const byId = new Map(usable.map((c) => [c.row.publicId, c]));
    const result = evaluatePromotions(
      usable.map((c) => this.candidateOf(c)),
      lines,
      orders,
      ctx,
    );

    for (const r of result.rejected) {
      const c = byId.get(r.promotionId)!;
      if (c.code)
        draft.notices.push({
          code: 'promotion.rejected',
          params: { promotionId: r.promotionId, code: c.code, reason: r.reason },
        });
    }
    const applied: AppliedPromotion[] = [];
    for (const promotionId of result.applied) {
      const c = byId.get(promotionId)!;
      const mine = result.discounts.filter((d) => d.promotionId === promotionId);
      let amount = D(0);
      let capped = D(0);
      for (const d of mine) {
        capped = capped.add(d.cappedAmount);
        if (D(d.amount).lte(0)) continue;
        amount = amount.add(d.amount);
        const order = draft.orders[d.order]!;
        order.lines[d.line] = discountLine(order.lines[d.line]!, d.amount);
        order.discounts.push({
          lineIndex: d.line,
          source:
            c.row.kind === 'coupon'
              ? 'coupon'
              : c.row.kind === 'referral'
                ? 'referral'
                : 'automatic_promotion',
          amount: d.amount,
          pct:
            c.row.benefit && (c.row.benefit as { type?: string }).type === 'percent'
              ? D((c.row.benefit as { pct: string }).pct).toFixed(4)
              : null,
          cappedAmount: d.cappedAmount,
          capReason: d.capReason,
          promotionId: c.row.id,
          couponCodeId: c.couponCodeId,
          campaignId: c.row.campaignId,
          meta: { promotionId: c.row.publicId, code: c.code },
        });
      }
      const perks = result.perks.filter((p) => p.promotionId === promotionId);
      if (amount.lte(0) && perks.length === 0) {
        if (capped.gt(0))
          draft.notices.push({
            code: 'promotion.capped',
            params: {
              promotionId,
              code: c.code,
              cappedAmount: formatMoney(capped),
              reason: mine[0]?.capReason ?? null,
            },
          });
        continue;
      }
      draft.notices.push({
        code: 'promotion.applied',
        params: { promotionId, name: c.row.name, code: c.code, amount: formatMoney(amount) },
      });
      if (capped.gt(0))
        draft.notices.push({
          code: 'promotion.capped',
          params: {
            promotionId,
            code: c.code,
            cappedAmount: formatMoney(capped),
            reason: mine.find((d) => d.capReason)?.capReason ?? null,
          },
        });
      applied.push({
        promotionId: c.row.id,
        promotionPublicId: c.row.publicId,
        couponCodeId: c.couponCodeId,
        campaignId: c.row.campaignId,
        usageLimitTotal: c.row.usageLimitTotal,
        usageLimitPerCustomer: c.row.usageLimitPerCustomer,
        amount: formatMoney(amount),
        cappedAmount: formatMoney(capped),
        snapshot: {
          name: c.row.name,
          kind: c.row.kind,
          code: c.code,
          conditions: c.row.conditions,
          conditionsSchemaVersion: c.row.conditionsSchemaVersion,
          benefit: c.row.benefit,
          benefitSchemaVersion: c.row.benefitSchemaVersion,
          campaignId: c.row.campaign?.publicId ?? null,
          perks,
          marginFloorPct: String(floor.value),
          marginFloorVersionId: String(floor.versionId),
        },
      });
    }
    if (result.requiredPaymentMethods.length > 0 && applied.length > 0)
      draft.notices.push({
        code: 'promotion.payment_method_required',
        params: { methods: result.requiredPaymentMethods },
      });
    draft.state[this.key] = { applied } satisfies PromotionState;
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    await this.recordFingerprints(tx, draft);
    await this.referrals.markFirstOrder(tx, draft.customerUserId, placed.groupId);
    const state = draft.state[this.key] as PromotionState | undefined;
    if (!state?.applied.length) return;
    await this.redemptions.reserve(tx, draft, placed, state.applied);
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async candidates(draft: CheckoutDraft, db: Tx): Promise<Candidate[]> {
    const live = livePromotionWhere(draft.at);
    const automatic = await db.promotion.findMany({
      where: { ...live, kind: 'automatic' },
      include: PROMOTION_WITH,
    });
    const out: Candidate[] = automatic.map((row) => ({ row, couponCodeId: null, code: null }));
    const codes = await db.cartCode.findMany({
      where: { cartId: draft.cartId, status: 'validated', couponCodeId: { not: null } },
      include: { couponCode: { include: { promotion: { include: PROMOTION_WITH } } } },
      orderBy: { id: 'asc' },
    });
    // D-136: a referred new customer gets the referee discount on the first order (system promotion,
    // values from `referral.rules`).
    const attribution = await db.referralAttribution.findUnique({
      where: { refereeUserId: draft.customerUserId },
    });
    if (attribution?.status === 'pending' && attribution.firstOrderGroupId === null) {
      const referral = await db.promotion.findFirst({
        where: { kind: 'referral', status: 'active' },
        include: PROMOTION_WITH,
      });
      if (referral) {
        const rules = (await this.settings.at('referral.rules', { at: draft.at })).value;
        out.push({
          row: {
            ...referral,
            conditions: { firstOrderOnly: true },
            benefit: {
              type: 'percent',
              pct: rules.refereeDiscountPct,
              maxAmount: rules.refereeDiscountMaxBaht,
            },
          },
          couponCodeId: null,
          code: null,
        });
      }
    }
    const seen = new Set<bigint>();
    for (const cc of codes) {
      const coupon = cc.couponCode!;
      const reason = couponReason(coupon, draft.customerUserId, draft.at);
      if (reason) {
        draft.notices.push({
          code: 'promotion.rejected',
          params: { promotionId: coupon.promotion.publicId, code: cc.code, reason },
        });
        continue;
      }
      // One code per promotion counts.
      if (seen.has(coupon.promotionId)) continue;
      seen.add(coupon.promotionId);
      out.push({ row: coupon.promotion, couponCodeId: coupon.id, code: coupon.code });
    }
    return out;
  }

  /** Why the customer cannot use this promotion any more (usage limits), or null. */
  private async limitReason(db: Tx, c: Candidate, customer: bigint): Promise<string | null> {
    const counters = await db.promotionUsageCounter.findMany({
      where: { promotionId: c.row.id, customerKey: { in: [0n, customer] } },
    });
    const total = counters.find((x) => x.customerKey === 0n)?.usedCount ?? 0;
    if (c.row.usageLimitTotal !== null && total >= c.row.usageLimitTotal) return 'usage_limit';
    if (c.row.usageLimitPerCustomer !== null) {
      const own = counters.find((x) => x.customerKey === customer)?.usedCount ?? 0;
      const related = await this.identity.relatedUserIds(db, customer);
      const relatedUsed = related.length
        ? await db.promotionRedemption.count({
            where: {
              promotionId: c.row.id,
              customerUserId: { in: related },
              status: { in: ['reserved', 'applied'] },
            },
          })
        : 0;
      if (own + relatedUsed >= c.row.usageLimitPerCustomer) return 'customer_limit';
    }
    return null;
  }

  private candidateOf(c: Candidate): PromotionCandidate {
    const left = (budget: Prisma.Decimal | null | undefined, spent: Prisma.Decimal | undefined) =>
      budget === null || budget === undefined
        ? null
        : MoneyDecimal.max(D(budget).sub(spent?.toString() ?? '0'), D(0));
    const lefts = [
      left(c.row.budgetAmount, c.row.spentAmount),
      left(c.row.campaign?.budgetAmount, c.row.campaign?.spentAmount),
    ].filter((x): x is MoneyValue => x !== null);
    return {
      id: c.row.publicId,
      kind: c.row.kind,
      priority: c.row.priority,
      stacking: c.row.stacking,
      stackGroup: c.row.stackGroup,
      conditions: c.row.conditions as PromotionConditions,
      benefit: c.row.benefit as PromotionBenefit,
      budgetLeft: lefts.length ? formatMoney(MoneyDecimal.min(...lefts)) : null,
    };
  }

  private async cartLines(draft: CheckoutDraft, db: Tx): Promise<CartLine[]> {
    const typeIds = [...new Set(draft.orders.map((o) => o.productTypeId))];
    const types = await db.productType.findMany({
      where: { id: { in: typeIds } },
      include: { category: true },
    });
    const category = new Map(types.map((t) => [t.id, t.category.code]));
    const productIds = draft.orders.map((o) => o.catalogProductId).filter((x): x is bigint => x !== null);
    const products = productIds.length
      ? await db.catalogProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, publicId: true },
        })
      : [];
    const productPublic = new Map(products.map((p) => [p.id, p.publicId]));
    return draft.orders.flatMap((o, order) =>
      o.lines.map((l, line) => ({
        order,
        line,
        lineType: l.lineType,
        productTypeCode: o.productTypeCode,
        categoryCode: category.get(o.productTypeId) ?? null,
        catalogProductId: o.catalogProductId ? (productPublic.get(o.catalogProductId) ?? null) : null,
        quantity: l.quantity,
        net: formatMoney(D(l.netAmount).sub(l.discountAmount)),
        vatPct: l.vatRatePct,
      })),
    );
  }

  private async context(draft: CheckoutDraft, db: Tx, marginFloorPct: string): Promise<PromotionContext> {
    const groups = await db.orderGroup.findMany({
      where: { customerUserId: draft.customerUserId, status: { not: 'cancelled' } },
      select: { status: true },
    });
    const returning = groups.some((g) => !['waiting_payment', 'pending_company_approval'].includes(g.status));
    const postcodes = [...new Set(draft.orders.flatMap((o) => o.legs.map((l) => l.postcode)))];
    const zones = postcodes.length
      ? await db.zonePostcode.findMany({
          where: { postcode: { in: postcodes }, scheme: { code: CUSTOMER_ZONE_SCHEME } },
          include: { zone: true },
        })
      : [];
    const zoneOf = new Map(zones.map((z) => [z.postcode, z.zone.code]));
    return {
      channel: draft.channel,
      segment: returning ? 'returning' : 'new',
      b2b: false,
      firstOrder: groups.length === 0,
      paymentMethod: null,
      // A destination outside every zone fails a zone condition (the engine needs every destination in).
      zoneCodes: postcodes.map((p) => zoneOf.get(p) ?? `unzoned:${p}`),
      marginFloorPct,
    };
  }

  /** Phone and delivery addresses of every placed order feed identity matching (D-053, D-136). */
  private async recordFingerprints(tx: Tx, draft: CheckoutDraft): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: draft.customerUserId }, select: { phone: true } });
    await this.identity.record(tx, draft.customerUserId, 'phone', user?.phone);
    const seen = new Set<string>();
    for (const leg of draft.orders.flatMap((o) => o.legs)) {
      const s = leg.snapshot as { line1?: string; line2?: string | null };
      const key = `${s.line1 ?? ''} ${s.line2 ?? ''} ${leg.subdistrictId ?? ''} ${leg.postcode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.identity.record(tx, draft.customerUserId, 'address', key);
    }
  }
}

/** Why a coupon code on the cart no longer works, or null (window, status, assignment, uses). */
export function couponReason(
  coupon: {
    status: string;
    assignedUserId: bigint | null;
    usageLimit: number | null;
    usedCount: number;
    promotion: {
      kind: string;
      status: string;
      startsAt: Date;
      endsAt: Date | null;
      campaign: { status: string; startsAt: Date; endsAt: Date | null } | null;
    };
  },
  customer: bigint,
  at: Date,
): string | null {
  const p = coupon.promotion;
  if (coupon.status === 'disabled') return 'disabled';
  if (coupon.status === 'used_up' || (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit))
    return 'used_up';
  if (coupon.assignedUserId !== null && coupon.assignedUserId !== customer) return 'not_yours';
  if (p.kind !== 'coupon' || p.status !== 'active') return 'inactive';
  if (p.startsAt > at || (p.campaign && p.campaign.startsAt > at)) return 'not_started';
  if ((p.endsAt && p.endsAt <= at) || (p.campaign?.endsAt && p.campaign.endsAt <= at)) return 'expired';
  if (p.campaign && p.campaign.status !== 'active')
    return p.campaign.status === 'exhausted' ? 'budget_exhausted' : 'inactive';
  return null;
}
