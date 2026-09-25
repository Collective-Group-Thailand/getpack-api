/**
 * Thai 13-digit tax identification number (juristic persons and individuals): the last digit is a
 * check digit — `(11 − Σ dᵢ·(13 − i) mod 11) mod 10` over the first 12 digits (schema-design §1.3:
 * check digits are validated in code, the database only checks the length).
 */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^[0-9]{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((acc, digit, i) => acc + digit * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === digits[12];
}
