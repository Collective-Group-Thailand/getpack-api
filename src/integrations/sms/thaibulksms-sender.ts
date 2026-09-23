import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import { type SmsMessage, type SmsSender } from './sms-sender.port';

export interface ThaiBulkSmsConfig {
  apiKey?: string;
  apiSecret?: string;
  sender?: string;
}

/**
 * ThaiBulkSMS v2 (`POST /sms`, HTTP Basic with API key/secret, form body). The provider expects
 * local Thai numbers (`0812345678`). Not retried: a retry could send the message twice.
 */
export class ThaiBulkSmsSender implements SmsSender {
  private readonly http = new ResilientHttp('thaibulksms');

  constructor(private readonly config: ThaiBulkSmsConfig) {}

  async send(message: SmsMessage): Promise<{ providerMessageId: string }> {
    const { apiKey, apiSecret, sender } = this.config;
    if (!apiKey || !apiSecret || !sender) throw new ProviderUnavailableError('thaibulksms', 'not configured');
    const body = new URLSearchParams({ msisdn: toLocalThai(message.to), message: message.text, sender });
    const { status, body: result } = await this.http.call('https://api-v2.thaibulksms.com/sms', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      timeoutMs: 10_000,
    });
    if (status >= 300) throw new ProviderUnavailableError('thaibulksms', `HTTP ${status}`, status);
    const id = (result as { phone_number_list?: { message_id?: string }[] } | null)?.phone_number_list?.[0]
      ?.message_id;
    return { providerMessageId: id ?? 'unknown' };
  }
}

export function toLocalThai(e164: string): string {
  return e164.startsWith('+66') ? `0${e164.slice(3)}` : e164;
}
