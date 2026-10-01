/**
 * PHP 7 numeric semantics used by the legacy calculators (B2.3). The ported engines work in IEEE
 * doubles, exactly like the PHP they come from, so golden vectors match to 0.005; results become
 * `MoneyDecimal` strings only at the engine boundary. Everything here mirrors PHP 7.1–7.4
 * (`composer.json` `php ^7.1.3`), not PHP 8.4, whose `round()` dropped the pre-rounding step.
 */

const POWERS_OF_TEN = Array.from({ length: 23 }, (_, i) => Number(`1e${i}`));

/** `php_intpow10` — exact table for 10⁰…10²², `pow` beyond (ext/standard/math.c). */
function intPow10(power: number): number {
  return power < 0 || power > 22 ? Math.pow(10, power) : POWERS_OF_TEN[power]!;
}

/** `php_round_helper` in `PHP_ROUND_HALF_UP` mode: half away from zero. */
function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

/** `php_round_get_basic`. */
function scale(value: number, places: number): number {
  const factor = intPow10(Math.abs(places));
  return places >= 0 ? value * factor : value / factor;
}

/**
 * PHP 7 `round($value, $places)` (`_php_math_round`): the value is first pre-rounded to the 15
 * significant digits a double guarantees, then rounded half away from zero. This is why PHP gives
 * `round(1.005, 2) = 1.01` and `round(5.015, 2) = 5.02` where a naive `Math.round(x * 100) / 100`
 * gives 1 and 5.01.
 */
export function phpRound(value: number, places = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const precisionPlaces = 14 - Math.floor(Math.log10(Math.abs(value)));
  const factor = intPow10(Math.abs(places));
  let scaled: number;
  if (precisionPlaces > places && precisionPlaces - 15 < places) {
    scaled = roundHalfAwayFromZero(scale(value, precisionPlaces));
    scaled = scaled / intPow10(Math.abs(places - precisionPlaces));
  } else {
    scaled = places >= 0 ? value * factor : value / factor;
    // Beyond double precision: rounding is pointless, PHP returns the value unchanged.
    if (Math.abs(scaled) >= 1e15) return value;
  }
  scaled = roundHalfAwayFromZero(scaled);
  return places > 0 ? scaled / factor : scaled * factor;
}

/**
 * PHP 7 `number_format($number, $decimals, $decPoint, $thousandsSep)`. Note the default thousands
 * separator `,`: legacy code that feeds the string back into arithmetic (`convertToMm('in', …)`)
 * silently truncates at the first comma, see {@link phpFloatval}.
 */
export function numberFormat(value: number, decimals = 0, decPoint = '.', thousandsSep = ','): string {
  const places = Math.max(0, decimals);
  const rounded = phpRound(value, places);
  if (!Number.isFinite(rounded)) return String(rounded);
  const [integerPart, fraction] = Math.abs(rounded).toFixed(places).split('.');
  const grouped = integerPart!.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
  const sign = rounded < 0 ? '-' : '';
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}${decPoint}${fraction}`;
}

const NUMERIC_PREFIX = /^[ \t\n\r\v\f]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

/**
 * PHP 7 `floatval()` / numeric-string coercion of a string: the longest leading decimal number, `0`
 * when there is none (`"1,234.50"` → 1, `" 12.5abc"` → 12.5, `"abc"` → 0).
 */
export function phpFloatval(value: string | number | boolean | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === undefined) return 0;
  const match = NUMERIC_PREFIX.exec(value);
  return match ? Number(match[1]) : 0;
}

/** PHP 7.1+ `intval()`: truncation toward zero (`"1e3"` → 1000, `"12abc"` → 12). */
export function phpIntval(value: string | number | boolean | null | undefined): number {
  const number = phpFloatval(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

/** `convertTo2Decimal` — ceiling to the satang (legacy `app/Helpers/helpers.php:1691-1696`). */
export function convertTo2Decimal(value: number): number {
  return phpRound(Math.ceil(value * 100) / 100, 2);
}

/**
 * `convertTo2Decimal3Digit` — ceiling to 3 decimals, then PHP round to 2
 * (legacy `app/Helpers/helpers.php:1698-1703`).
 */
export function convertTo2Decimal3Digit(value: number): number {
  return phpRound(Math.ceil(value * 1000) / 1000, 2);
}

/**
 * `convertNumberFloat` — PHP round, then a plain 2-decimal string (no thousands separator); legacy
 * returns a **string** that later arithmetic coerces back (`app/Helpers/helpers.php:2686-2706`).
 * A `digits` other than 0 still formats 2 decimals, as legacy does.
 */
export function convertNumberFloat(value: string | number | null | undefined = 0, digits = 2): string {
  const number = typeof value === 'string' ? phpFloatval(value.replaceAll(',', '')) : (value ?? 0);
  return numberFormat(phpRound(number, digits), digits === 0 ? 0 : 2, '.', '');
}

/**
 * `roundUp($value, $decimal, $digit = null)` — ceiling to `digit` decimals (default `decimal`), then PHP round to
 * `decimal` (legacy `app/Helpers/helpers.php:1706-1711`; the pouch factory price per piece, `roundUp(…, 1)`).
 */
export function roundUp(value: number, decimal: number, digit: number | null = null): number {
  const multiples = Math.pow(10, digit === null || digit === 0 ? decimal : digit);
  return phpRound(Math.ceil(value * multiples) / multiples, decimal);
}

/**
 * `calculateMargin($price, $margin_percent)` — the price with a gross margin, rounded up to the satang; null for a
 * price ≤ 0, where legacy returns `[]` and the caller fails (legacy `app/Helpers/helpers.php:1733-1748`).
 */
export function calculateMargin(
  price: number,
  marginPercent: number,
): { withMargin: number; marginPrice: number } | null {
  if (!(price > 0)) return null;
  const salePrice = price / (1 - marginPercent / 100);
  return { withMargin: convertTo2Decimal(salePrice), marginPrice: convertTo2Decimal(salePrice - price) };
}

/**
 * `calculateVat($price, $vat_percent)` — the price with VAT, rounded up to the satang; null for a price ≤ 0
 * (legacy `app/Helpers/helpers.php:1750-1765`).
 */
export function calculateVat(
  price: number,
  vatPercent: number,
): { vatPrice: number; withVat: number } | null {
  if (!(price > 0)) return null;
  const withVat = price * (1 + vatPercent / 100);
  return { vatPrice: convertTo2Decimal(withVat - price), withVat: convertTo2Decimal(withVat) };
}
