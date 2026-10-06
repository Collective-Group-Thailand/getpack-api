/**
 * Normalises a Thai or international phone number to E.164 (`ck_users__phone_e164`).
 * `081-234-5678` → `+66812345678`; `66812345678` → `+66812345678`; a Thai mobile typed without its
 * leading zero after a `+66` prefix (`812345678`) → `+66812345678`. Returns `null` when invalid.
 */
export function toE164(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  let e164: string;
  if (/^0\d{8,9}$/.test(compact)) e164 = `+66${compact.slice(1)}`;
  else if (/^66\d{8,9}$/.test(compact)) e164 = `+${compact}`;
  else if (/^[689]\d{8}$/.test(compact)) e164 = `+66${compact}`;
  else e164 = compact;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** `+66812345678` → `+66•••••5678` for display names, logs and masked recipients. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)}${'•'.repeat(Math.max(e164.length - 7, 0))}${e164.slice(-4)}`;
}
