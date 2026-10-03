import { addCalendarDays } from '@common/time/bangkok';

/** One earlier order of a SKU, on Bangkok calendar dates. */
export interface SkuOrder {
  orderedOn: string;
  quantity: number;
  deliveredOn: string | null;
}

export interface SuggestionRules {
  minOrders: number;
  averageOrders: number;
  safetyStockDays: number;
}

export interface SuggestionResult {
  orderCount: number;
  /** Mean of the intervals used, days (2 decimals). */
  averageIntervalDays: string;
  lastLeadTimeDays: number;
  nextNeedOn: string;
  suggestedOn: string;
  suggestedQuantity: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * D-288, pure. With ≥ `minOrders` orders (oldest first): the next need = the last order + the simple moving average of
 * the last `averageOrders` intervals (fewer when fewer exist), rounded to whole days; the suggested date = next need −
 * the last lead time (placement → delivery of the most recent delivered order) − `safetyStockDays`; the suggested
 * quantity = the mean quantity of the orders those intervals span, rounded. Null without enough orders or without a
 * delivered one (no lead time to go by).
 */
export function suggestReorder(orders: readonly SkuOrder[], rules: SuggestionRules): SuggestionResult | null {
  if (orders.length < Math.max(2, rules.minOrders)) return null;
  const k = Math.min(rules.averageOrders, orders.length - 1);
  const used = orders.slice(-(k + 1));
  let sum = 0;
  for (let i = 1; i < used.length; i++) sum += daysBetween(used[i - 1]!.orderedOn, used[i]!.orderedOn);
  const average = sum / k;
  const delivered = [...orders].reverse().find((o) => o.deliveredOn !== null);
  if (!delivered) return null;
  const lead = Math.max(0, daysBetween(delivered.orderedOn, delivered.deliveredOn!));
  const last = orders.at(-1)!;
  const nextNeedOn = addCalendarDays(last.orderedOn, Math.round(average));
  const quantity = Math.round(used.reduce((a, o) => a + o.quantity, 0) / used.length);
  return {
    orderCount: orders.length,
    averageIntervalDays: average.toFixed(2),
    lastLeadTimeDays: lead,
    nextNeedOn,
    suggestedOn: addCalendarDays(nextNeedOn, -(lead + rules.safetyStockDays)),
    suggestedQuantity: Math.max(1, quantity),
  };
}
