import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type DiscountSource } from '@generated/prisma/client';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type DraftOrder,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { discountLine } from '@modules/checkout/order-pricing';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { DiscountMemosService } from './discount-memos.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

interface DiscountState {
  memoId: bigint | null;
}

interface Grant {
  source: DiscountSource;
  pct: MoneyValue;
  memoId: bigint | null;
  memoPublicId: string | null;
  grantedByUserId: bigint | null;
  /** A C-Level memo flagged below the floor may go under it (D-052); nothing else may. */
  mayBreachFloor: boolean;
}

/**
 * Checkout extension `discounts` (order 300, after promotions and points): the company discount of a
 * company order (D-124), an approved discount memo (CS, D-052) or a CS discount within
 * `discounts.cs_limit_pct` — each a % of what is left of the non-shipping lines, written per line with its
 * source (and memo id), and capped at the margin floor unless a C-Level memo allowed going below it.
 */
@Injectable()
export class DiscountCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'discounts';
  readonly order = 300;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
    private readonly memos: DiscountMemosService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const grants: Grant[] = [];
    const ext = draft.input.extensions ?? {};

    const companyPublicId = (ext['company'] as { companyId?: string } | undefined)?.companyId;
    if (companyPublicId) {
      const version = await db.companyDiscountVersion.findFirst({
        where: {
          status: 'approved',
          effectiveFrom: { lte: draft.at },
          OR: [{ validTo: null }, { validTo: { gt: draft.at } }],
          discount: { company: { publicId: companyPublicId } },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        include: { discountMemo: true },
      });
      if (version)
        grants.push({ source: 'company_discount', pct: D(version.discountPct), memoId: version.discountMemoId, memoPublicId: version.discountMemo.publicId, grantedByUserId: null, mayBreachFloor: false });
    }

    const memoPublicId = ext['discountMemoId'] as string | undefined;
    const csPct = ext['csDiscountPct'] as string | undefined;
    if (memoPublicId && csPct) throw new DomainException('validation.failed', { errors: [{ path: 'csDiscountPct', code: 'conflict', message: 'a discount memo replaces the CS discount' }] });
    if (memoPublicId) {
      const memo = await db.discountMemo.findUnique({ where: { publicId: memoPublicId } });
      if (!memo || memo.scope !== 'order' || memo.status !== 'approved' || memo.validUntil <= draft.at || memo.customerUserId !== draft.customerUserId)
        throw new DomainException('discount_memos.not_usable', { params: { status: memo?.status ?? 'unknown' } });
      grants.push({ source: 'discount_memo', pct: D(memo.approvedPct!), memoId: memo.id, memoPublicId: memo.publicId, grantedByUserId: null, mayBreachFloor: memo.belowMarginFloor });
    }
    if (csPct) {
      const limit = String((await this.settings.at('discounts.cs_limit_pct', { at: draft.at })).value);
      if (D(csPct).gt(limit)) throw new DomainException('discounts.cs_limit_exceeded', { params: { limit } });
      grants.push({ source: 'cs_discount', pct: D(csPct), memoId: null, memoPublicId: null, grantedByUserId: draft.csUserId, mayBreachFloor: false });
    }
    if (grants.length === 0) return;

    const floor = D(String((await this.settings.at('pricing.margin_floor_pct', { at: draft.at })).value));
    const keep = D(1).sub(floor.div(100));
    for (const grant of grants) {
      let given = D(0);
      let capped = D(0);
      for (const order of draft.orders) {
        const [g, c] = this.applyToOrder(order, grant, keep);
        given = given.add(g);
        capped = capped.add(c);
      }
      draft.notices.push({ code: 'discount.applied', params: { source: grant.source, pct: grant.pct.toFixed(4), amount: formatMoney(given), memoId: grant.memoPublicId } });
      if (capped.gt(0)) draft.notices.push({ code: 'discount.capped', params: { source: grant.source, cappedAmount: formatMoney(capped), reason: 'margin_floor' } });
    }
    const memo = grants.find((g) => g.source === 'discount_memo');
    draft.state[this.key] = { memoId: memo?.memoId ?? null } satisfies DiscountState;
  }

  /** Spreads the % over the order's non-shipping lines, capped at the order's margin room. */
  private applyToOrder(order: DraftOrder, grant: Grant, keep: MoneyValue): [MoneyValue, MoneyValue] {
    const lines = order.lines
      .map((l, index) => ({ l, index, net: D(l.netAmount).sub(l.discountAmount) }))
      .filter((x) => x.l.lineType !== 'shipping' && x.net.gt(0));
    const wanted = lines.map((x) => x.net.mul(grant.pct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP));
    const total = wanted.reduce((a, w) => a.add(w), D(0));
    let allowed = total;
    if (!grant.mayBreachFloor) {
      const payable = order.lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount)), D(0));
      const room = order.buyCostNet && keep.gt(0)
        ? MoneyDecimal.max(payable.sub(D(order.buyCostNet).div(keep)).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN), D(0))
        : D(0);
      allowed = MoneyDecimal.min(total, room);
    }
    let left = allowed;
    for (const [i, x] of lines.entries()) {
      const share = i === lines.length - 1 ? left : MoneyDecimal.min(left, total.gt(0) ? wanted[i]!.mul(allowed).div(total).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN) : D(0));
      const amount = MoneyDecimal.min(share, x.net);
      const cappedHere = MoneyDecimal.max(wanted[i]!.sub(amount), D(0));
      if (amount.lte(0) && cappedHere.lte(0)) continue;
      if (amount.gt(0)) order.lines[x.index] = discountLine(order.lines[x.index]!, amount);
      order.discounts.push({
        lineIndex: x.index,
        source: grant.source,
        pct: grant.pct.toFixed(4),
        amount: formatMoney(amount),
        cappedAmount: formatMoney(cappedHere),
        capReason: cappedHere.gt(0) ? 'margin_floor' : null,
        grantedByUserId: grant.grantedByUserId,
        discountMemoId: grant.memoId,
        meta: { memoId: grant.memoPublicId },
      });
      left = left.sub(amount);
    }
    return [allowed.sub(MoneyDecimal.max(left, D(0))), total.sub(allowed)];
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const state = draft.state[this.key] as DiscountState | undefined;
    if (!state?.memoId) return;
    // One use per memo (D-052): a concurrent checkout with the same memo loses.
    const { count } = await tx.discountMemo.updateMany({
      where: { id: state.memoId, status: 'approved' },
      data: { status: 'applied', appliedOrderGroupId: placed.groupId, appliedAt: new Date(), rowVersion: { increment: 1 } },
    });
    if (count !== 1) throw new DomainException('discount_memos.not_usable', { params: { status: 'applied' } });
    await tx.orderGroup.update({ where: { id: placed.groupId }, data: { discountMemoId: state.memoId } });
    const memo = await tx.discountMemo.findUniqueOrThrow({ where: { id: state.memoId } });
    await this.memos.record(tx, memo, 'discount_memo.applied', { groupId: placed.groupPublicId }, draft.actor);
  }
}
