import Decimal from 'decimal.js';

/**
 * Step conditions of approval policies (ADR-0006), the shape used by the seeds:
 * `{ all: [...] } | { any: [...] } | { field, op, value } | { field, op, ref }`.
 * Fields: `amount`, `pct` (decimal strings), `flags` (string list), `entity` (entity code), or a
 * `payload.<path>` into the request snapshot. `ref` names a value the requesting module supplies
 * (e.g. `company.order_approval_threshold`, D-123). Anything unknown or missing evaluates to false,
 * so a policy never auto-approves by accident (fail closed).
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { field: string; op: ConditionOp; value: string | number | boolean }
  | { field: string; op: ConditionOp; ref: string };

export type ConditionOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'includes' | 'excludes';

export interface ConditionContext {
  amount?: string | null;
  pct?: string | null;
  flags?: readonly string[];
  entity?: string;
  payload?: Record<string, unknown>;
  refs?: Record<string, string | number>;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function evaluateCondition(condition: unknown, context: ConditionContext): boolean {
  if (condition === null || condition === undefined) return true;
  if (typeof condition !== 'object') return false;
  const c = condition as Record<string, unknown>;
  if (Array.isArray(c['all']))
    return c['all'].length > 0 && c['all'].every((inner) => evaluateCondition(inner, context));
  if (Array.isArray(c['any'])) return c['any'].some((inner) => evaluateCondition(inner, context));
  if (typeof c['field'] !== 'string' || typeof c['op'] !== 'string') return false;

  const left = fieldValue(c['field'], context);
  const right =
    'ref' in c ? (typeof c['ref'] === 'string' ? context.refs?.[c['ref']] : undefined) : c['value'];
  if (left === undefined || left === null || right === undefined) return false;
  return compare(left, c['op'] as ConditionOp, right);
}

function fieldValue(field: string, context: ConditionContext): unknown {
  switch (field) {
    case 'amount':
      return context.amount;
    case 'pct':
      return context.pct;
    case 'flags':
      return context.flags ?? [];
    case 'entity':
      return context.entity;
    default:
      if (!field.startsWith('payload.')) return undefined;
      return field
        .slice('payload.'.length)
        .split('.')
        .reduce<unknown>(
          (value, key) =>
            value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
          context.payload,
        );
  }
}

function compare(left: unknown, op: ConditionOp, right: unknown): boolean {
  if (op === 'includes' || op === 'excludes') {
    if (!Array.isArray(left)) return false;
    const has = left.includes(right);
    return op === 'includes' ? has : !has;
  }
  const l = asDecimal(left);
  const r = asDecimal(right);
  if (l && r) {
    const cmp = l.comparedTo(r);
    return (
      { gt: cmp > 0, gte: cmp >= 0, lt: cmp < 0, lte: cmp <= 0, eq: cmp === 0, ne: cmp !== 0 }[op] ?? false
    );
  }
  if (op === 'eq') return left === right;
  if (op === 'ne') return left !== right;
  return false;
}

function asDecimal(value: unknown): Decimal | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  if (typeof value === 'string' && DECIMAL.test(value)) return new Decimal(value);
  return null;
}
