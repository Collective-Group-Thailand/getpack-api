import { type ScrubFormat } from '@common/files/metadata-scrub';

/**
 * D-442 (DECISIONS-STAGE-A §1): files production receives are named by the order code — never by the uploaded
 * name, which can carry the customer's name, brand or company. Only the extension of the uploaded name survives
 * (lower-case letters and digits, at most 8), else the scrubbed format's.
 */
const FORMAT_EXTENSION: Record<ScrubFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf' };

export function safeExtension(originalName: string, format?: ScrubFormat): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalName.trim());
  if (match) return match[1]!.toLowerCase();
  return format ? FORMAT_EXTENSION[format] : 'bin';
}

/** `<orderCode>-original-v<submission version>[-<n>].<ext>` (`-<n>` only when the submission has several files). */
export function originalCopyName(input: {
  orderCode: string;
  submissionVersion: number;
  index: number;
  total: number;
  originalName: string;
  format?: ScrubFormat;
}): string {
  const counter = input.total > 1 ? `-${Math.max(1, input.index)}` : '';
  return `${input.orderCode}-original-v${input.submissionVersion}${counter}.${safeExtension(input.originalName, input.format)}`;
}

/** `<orderCode>-proof-v<proof version>.<ext>`: the locked copy of an approved proof (production downloads it). */
export function approvedProofName(orderCode: string, proofVersion: number, originalName: string): string {
  return `${orderCode}-proof-v${proofVersion}.${safeExtension(originalName)}`;
}
