import { randomBytes } from 'node:crypto';

import { type EmailMessage } from './email-sender.port';

/** RFC 2047 encoded-word for a header that is not plain ASCII. */
function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');

/**
 * A multipart/mixed MIME message (text + HTML alternative, then attachments) for providers' raw-send APIs; used
 * when a message carries attachments or copies (D-430). Attachment names are RFC 2231-encoded when not ASCII.
 */
export function buildMime(message: EmailMessage, from: string): Buffer {
  const mixed = `mixed_${randomBytes(12).toString('hex')}`;
  const alt = `alt_${randomBytes(12).toString('hex')}`;
  const lines: string[] = [
    `From: ${from}`,
    `To: ${message.to}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(', ')}`] : []),
    `Subject: ${header(message.subject)}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(message.text ?? '', 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(message.html, 'utf8').toString('base64')),
    `--${alt}--`,
  ];
  for (const a of message.attachments ?? []) {
    const ascii = /^[\x20-\x7e]*$/.test(a.fileName) && !a.fileName.includes('"');
    const name = ascii ? `filename="${a.fileName}"` : `filename*=UTF-8''${encodeURIComponent(a.fileName)}`;
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; ${ascii ? `name="${a.fileName}"` : `name*=UTF-8''${encodeURIComponent(a.fileName)}`}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${name}`,
      '',
      wrap(a.content.toString('base64')),
    );
  }
  lines.push(`--${mixed}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}
