/**
 * P4-01 / P4-D1: what a partner factory may know of a getpack delivery destination. Never the recipient's name,
 * phone or address lines, and never the full postcode — only the destination's code within the job (`D1`, `D2` …),
 * the province and the first three digits of the postcode (enough to price shipping).
 */

/** Customer-identity fields that must never appear on a partner-surface destination. */
export const PARTNER_HIDDEN_DESTINATION_FIELDS = [
  'recipientName',
  'phone',
  'line1',
  'line2',
  'postcode',
] as const;

/**
 * The destination's code by its stable order within the job's order (`sort`, then id): index 0 → `D1`.
 * A negative index (destination not found) yields `D?` rather than throwing.
 */
export function destinationCode(index: number): string {
  return index < 0 ? 'D?' : `D${index + 1}`;
}

/** The first three digits of a Thai postcode (e.g. `10110` → `101`). */
export function postcodePrefix(postcode: string): string {
  return postcode.trim().slice(0, 3);
}

/** The code of `destinationId` among `ordered` (already in stable order). */
export function codeAmong(ordered: readonly { id: bigint }[], destinationId: bigint): string {
  return destinationCode(ordered.findIndex((d) => d.id === destinationId));
}
