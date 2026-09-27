/**
 * Thai 13-digit tax / citizen id check digit (Revenue Department): the weighted sum of the first 12
 * digits (weights 13 … 2) gives the last digit as (11 − sum mod 11) mod 10.
 */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(value[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}
