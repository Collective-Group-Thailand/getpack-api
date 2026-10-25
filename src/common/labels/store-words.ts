/**
 * The storefront's words (D-440, GLOBAL-RULES §1, D-435): nothing a `/v1/store/*` response carries names a factory
 * or production capacity — not a status word for staff, not an enum value. Staff, partner and admin responses keep
 * their own words and values; only the store surface is mapped, here, in one place:
 *
 * - every `<field>LabelAdminTh` (and a dictionary's `labelAdminTh`) carries the customer's words of its sibling
 *   `<field>LabelTh` / `labelTh`;
 * - the enum values below are replaced by their store alias (`STORE_VALUE_ALIASES`), and a claim's
 *   `currentOwner` `factory` reads `getpack` (our team acts).
 *
 * Applied at runtime by `StoreWordsInterceptor` and to the contract's store examples by the contract build, so the
 * published examples are what a client receives. The store DTOs declare the store enums (`STORE_*` below).
 */

/** Factory- or capacity-named values and their store alias (one value each, unique across the contract). */
export const STORE_VALUE_ALIASES: Readonly<Record<string, string>> = {
  // ClaimStatus: the factory's review is part of getpack's review for the customer.
  factory_review: 'under_review',
  // CallOffStatus: waiting for production to confirm the agreement.
  pending_factory: 'pending_confirmation',
  // QuotePathReason / QuoteNoPriceReason: no instant price — the configurator offers a quotation request.
  no_active_factory: 'not_instant',
  capacity_unavailable: 'not_instant',
};

/** Keys whose value `factory` is a party to a claim (ClaimOwner): for the customer, our team acts. */
const OWNER_KEYS = new Set(['currentOwner']);

const ADMIN_LABEL = /^(.*)LabelAdminTh$/;

/** A deep copy of `value` in the storefront's words (idempotent; non-JSON values are returned as they are). */
export function storeWords<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (typeof value === 'string') return STORE_VALUE_ALIASES[value] ?? value;
  if (Array.isArray(value)) return value.map(convert);
  if (!isConvertible(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (OWNER_KEYS.has(key) && child === 'factory') {
      out[key] = 'getpack';
      continue;
    }
    out[key] = convert(child);
  }
  for (const key of Object.keys(out)) {
    const sibling = key === 'labelAdminTh' ? 'labelTh' : key.replace(ADMIN_LABEL, '$1LabelTh');
    if (sibling !== key && (ADMIN_LABEL.test(key) || key === 'labelAdminTh') && sibling in out)
      out[key] = out[sibling];
  }
  return out;
}

/** Objects serialised by their own keys (DTOs); a value with `toJSON` (Date, Decimal) or a Buffer stays as is. */
function isConvertible(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return false;
  return typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

/** The store's list of an enum's values (aliases applied, each once) — for the store DTOs' `enum`. */
export function storeEnum<T extends string>(values: readonly T[]): string[] {
  return [...new Set(values.map((v) => STORE_VALUE_ALIASES[v] ?? v))];
}

/** ClaimOwner on the store: `factory` reads `getpack`. */
export const STORE_CLAIM_OWNERS = ['getpack', 'customer', 'none'] as const;
