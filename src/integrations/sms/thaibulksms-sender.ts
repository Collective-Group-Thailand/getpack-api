import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import { type SmsMessage, type SmsSender } from './sms-sender.port';

export const THAIBULKSMS_CREDIT_TYPES = ['standard', 'corporate'] as const;
export type ThaiBulkSmsCreditType = (typeof THAIBULKSMS_CREDIT_TYPES)[number];

export interface ThaiBulkSmsConfig {
  apiKey?: string;
  apiSecret?: string;
  sender?: string;
  /** Credit type (`force`). An approved sender belongs to one type; omitted, the provider chooses. */
  creditType?: ThaiBulkSmsCreditType;
}

/**
 * ThaiBulkSMS v2 (`POST /sms`, HTTP Basic with API key/secret, form body). The provider expects
 * local Thai numbers (`0812345678`). Not retried: a retry could send the message twice.
 */
export class ThaiBulkSmsSender implements SmsSender {
  private readonly http: ResilientHttp;

  constructor(
    private readonly config: ThaiBulkSmsConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.http = new ResilientHttp('thaibulksms', fetchImpl);
  }

  async send(message: SmsMessage): Promise<{ providerMessageId: string }> {
    const { apiKey, apiSecret, sender, creditType } = this.config;
    if (!apiKey || !apiSecret || !sender) throw new ProviderUnavailableError('thaibulksms', 'not configured');
    const body = new URLSearchParams({ msisdn: toLocalThai(message.to), message: message.text, sender });
    if (creditType) body.set('force', creditType);
    const { status, body: result } = await this.http.call('https://api-v2.thaibulksms.com/sms', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      timeoutMs: 10_000,
    });
    if (status >= 300) {
      const reason = providerReason(result);
      throw new ProviderUnavailableError(
        'thaibulksms',
        `HTTP ${status}${reason ? ` ${reason}` : ''}`,
        status,
      );
    }
    const id = (result as { phone_number_list?: { message_id?: string }[] } | null)?.phone_number_list?.[0]
      ?.message_id;
    return { providerMessageId: id ?? 'unknown' };
  }
}

/**
 * The provider's error code and description (`{ error: { code, name, description } }`), so a 4xx
 * says why (unapproved sender, bad number, no credit). Digit runs are masked: no phone numbers in logs.
 */
export function providerReason(body: unknown): string | undefined {
  const error = (body as { error?: { code?: unknown; name?: unknown; description?: unknown } } | null)?.error;
  if (!error || typeof error !== 'object') return undefined;
  const reason = [error.code, error.name, error.description]
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .join(' ')
    .replace(/\d{6,}/g, '***')
    .slice(0, 200);
  return reason ? `(${reason})` : undefined;
}

export function toLocalThai(e164: string): string {
  return e164.startsWith('+66') ? `0${e164.slice(3)}` : e164;
}
