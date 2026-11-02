import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Commission rules after D-464 (owner 2026-11-01, supersedes the per-order cap of P-02 and the margin cap of D-418):
 * the full rate at every deal size, the rate LOCKED for the order (the plan version in force when the group was
 * placed, or a rate locked on the quote by a deal registration / an agent-accepted option — Phase 3), and no silent
 * cut: when commission ÷ the order's gross margin exceeds `agent.margin_alert_pct` C-Level is alerted, the amount is
 * unchanged. Only the agent can accept a lower rate (co-fund). Pure: decimal strings in and out.
 */

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());

export interface RateLock {
  firstOrderPct: string;
  repeatOrderPct: string;
  /** Where the lock comes from (`deal_registration`, `accepted_option`), for the entry's note. */
  source: string;
}

export interface CommissionInput {
  base: string;
  isFirstOrder: boolean;
  /** The plan version in force when the order group was placed. */
  plan: { firstOrderPct: string; repeatOrderPct: string };
  lock?: RateLock | null;
  /** The order's gross margin (internal); null when unknown. */
  grossMargin: string | null;
  /** `agent.margin_alert_pct`. */
  alertPct: string;
}

export interface CommissionResult {
  ratePct: string;
  /** `plan`, or the lock's source. */
  rateSource: string;
  amount: string;
  /** commission ÷ gross margin × 100, 4 dp; null without a positive margin. */
  marginRatioPct: string | null;
  marginAlert: boolean;
}

export function commissionFor(input: CommissionInput): CommissionResult {
  const source = input.lock ?? null;
  const rate = D(
    input.isFirstOrder
      ? (source?.firstOrderPct ?? input.plan.firstOrderPct)
      : (source?.repeatOrderPct ?? input.plan.repeatOrderPct),
  );
  const amount = D(input.base).mul(rate).div(100).toDecimalPlaces(2);
  const margin = input.grossMargin === null ? null : D(input.grossMargin);
  // No margin (or a loss) with commission to pay is always worth a look; an unknown margin is not alerted.
  const ratio = margin !== null && margin.gt(0) ? amount.div(margin).mul(100).toDecimalPlaces(4) : null;
  const alert = ratio !== null ? ratio.gt(input.alertPct) : margin !== null && amount.gt(0);
  return {
    ratePct: rate.toFixed(4),
    rateSource: source ? source.source : 'plan',
    amount: amount.toFixed(2),
    marginRatioPct: ratio === null ? null : ratio.toFixed(4),
    marginAlert: alert,
  };
}

/**
 * What an order's commission is worth after refunds (D-418 unchanged): proportional to the refunded share of the
 * order's gross, never below zero.
 */
export function remainingAfterRefund(entryAmount: string, refundedGross: string, orderGross: string): string {
  const gross = D(orderGross);
  const share = gross.gt(0) ? MoneyDecimal.min(D(refundedGross).div(gross), D(1)) : D(0);
  const target = D(entryAmount).mul(D(1).sub(share)).toDecimalPlaces(2);
  return (target.gt(0) ? target : D(0)).toFixed(2);
}
