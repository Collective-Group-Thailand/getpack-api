import { formatMoney, MoneyDecimal } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { discountLine } from '@modules/checkout/order-pricing';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { LoyaltyService } from './loyalty.service';
import { redeemablePoints } from './points-math';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

interface PointsState {
  points: number;
  pointValue: string;
  versionId: bigint;
}

/**
 * Checkout extension `points` (order 200, after promotions; D-133, P11): the customer asks for a number of
 * points; the redemption is capped at 20 % of the order value, the margin room promotions left and the
 * balance, refused below the THB 10 minimum, and spread over the non-shipping lines as a price reduction
 * (VAT on the net price). At placement the points are taken from the lots under row locks.
 */
@Injectable()
export class PointsCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'points';
  readonly order = 200;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const requested = Number((draft.input.extensions?.['points'] as number | undefined) ?? 0);
    if (!Number.isInteger(requested) || requested <= 0) return;
    const [value, limits, floor] = await Promise.all([
      this.settings.at('loyalty.point_value', { at: draft.at }),
      this.settings.at('loyalty.redemption_limits', { at: draft.at }),
      this.settings.at('pricing.margin_floor_pct', { at: draft.at }),
    ]);
    const pointValue = String(value.value);
    const keep = D(1).sub(D(String(floor.value)).div(100));
    // Discount room per order: down to the margin floor, after the discounts already on it; unknown cost → none.
    const rooms = draft.orders.map((o) => {
      if (!o.buyCostNet || keep.lte(0)) return D(0);
      const payable = o.lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount)), D(0));
      return MoneyDecimal.max(
        payable.sub(D(o.buyCostNet).div(keep)).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN),
        D(0),
      );
    });
    const result = redeemablePoints({
      requested,
      balance: await this.loyalty.availableBalance(db, draft.customerUserId, draft.at),
      pointValue,
      orderValue: draft.totals.grossAmount,
      maxPctOfOrder: limits.value.maxPctOfOrder,
      minimumBaht: limits.value.minimumBaht,
      marginRoom: rooms.reduce((a, r) => a.add(r), D(0)),
    });
    if (result.points === 0) {
      draft.notices.push({
        code: 'points.rejected',
        params: { requested, reason: result.reason, minimumBaht: limits.value.minimumBaht },
      });
      return;
    }
    if (result.reason !== 'ok')
      draft.notices.push({
        code: 'points.capped',
        params: { requested, points: result.points, reason: result.reason },
      });

    // Spread the discount: orders with the most room first, then each order's non-shipping lines by net left.
    let left = D(result.points).mul(pointValue);
    const byRoom = draft.orders.map((o, i) => ({ o, room: rooms[i]! })).sort((a, b) => b.room.cmp(a.room));
    for (const { o, room } of byRoom) {
      let take = MoneyDecimal.min(room, left);
      const lines = o.lines
        .map((l, index) => ({ l, index, net: D(l.netAmount).sub(l.discountAmount) }))
        .filter((x) => x.l.lineType !== 'shipping' && x.net.gt(0))
        .sort((a, b) => b.net.cmp(a.net));
      for (const x of lines) {
        if (take.lte(0)) break;
        const amount = MoneyDecimal.min(x.net, take);
        o.lines[x.index] = discountLine(o.lines[x.index]!, amount);
        o.discounts.push({
          lineIndex: x.index,
          source: 'points_redemption',
          amount: formatMoney(amount),
          meta: { points: result.points },
        });
        take = take.sub(amount);
        left = left.sub(amount);
      }
      if (left.lte(0)) break;
    }
    draft.notices.push({
      code: 'points.applied',
      params: { points: result.points, amount: formatMoney(D(result.points).mul(pointValue)) },
    });
    draft.state[this.key] = {
      points: result.points,
      pointValue,
      versionId: value.versionId,
    } satisfies PointsState;
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const state = draft.state[this.key] as PointsState | undefined;
    if (!state) return;
    await this.loyalty.redeem(
      tx,
      draft.customerUserId,
      placed.groupId,
      state.points,
      state.pointValue,
      state.versionId,
      draft.actor,
    );
  }
}
