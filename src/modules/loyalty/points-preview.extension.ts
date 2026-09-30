import { MoneyDecimal } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type CheckoutDraft, type CheckoutExtension, CheckoutExtensions } from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { LoyaltyService } from './loyalty.service';
import { earnPoints } from './points-math';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

/**
 * Checkout extension `points_preview` (order 990, after every price adjustment; U-B0.1): what the checkout
 * preview shows about points — the balance, the smallest and largest redemption (D-133) and the points the order
 * earns (D-130: per THB paid before VAT, excluding shipping, after discounts, times the tier multiplier). Reads
 * only. The margin-floor cap is left to the redemption itself (`points.capped`), so no margin is disclosed.
 */
@Injectable()
export class PointsPreviewCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'points_preview';
  readonly order = 990;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    // No membership row yet (tiers are recomputed later) → the base tier, as when points are earned.
    const membership = await db.loyaltyMembership.findUnique({ where: { userId: draft.customerUserId } });
    const multiplier = membership?.multiplier.toString() ?? '1';
    const [value, limits, rate, balance] = await Promise.all([
      this.settings.at('loyalty.point_value', { at: draft.at }),
      this.settings.at('loyalty.redemption_limits', { at: draft.at }),
      this.settings.at('loyalty.earn_rate', { at: draft.at }),
      this.loyalty.availableBalance(db, draft.customerUserId, draft.at),
    ]);
    const pointValue = D(String(value.value));
    const redeemedPoints = (draft.state['points'] as { points?: number } | undefined)?.points ?? 0;
    const gross = draft.orders
      .flatMap((o) => o.lines)
      .reduce((a, l) => a.add(l.grossAmount), D(0))
      .add(pointValue.mul(redeemedPoints));
    const byPct = gross.mul(limits.value.maxPctOfOrder).div(100).div(pointValue).floor().toNumber();
    const toEarn = draft.orders.reduce((sum, o) => {
      const base = o.lines
        .filter((l) => l.lineType !== 'shipping')
        .reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount)), D(0));
      return sum + earnPoints(base, rate.value.bahtPerPoint, multiplier);
    }, 0);
    draft.preview.points = {
      balance,
      pointValue: pointValue.toFixed(2),
      minimumPoints: D(limits.value.minimumBaht).div(pointValue).ceil().toNumber(),
      maximumPoints: Math.max(Math.min(balance, byPct), 0),
      redeemedPoints,
      toEarn,
    };
  }
}
