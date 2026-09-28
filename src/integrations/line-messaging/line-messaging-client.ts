import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import { type LineMessaging, type LinePush } from './line-messaging.port';

/** `POST /v2/bot/message/push`; retried safely because LINE deduplicates by `X-Line-Retry-Key`. */
export class LineMessagingClient implements LineMessaging {
  private readonly http = new ResilientHttp('line-messaging');

  constructor(private readonly accessToken: string | undefined) {}

  async push(message: LinePush): Promise<{ providerMessageId: string }> {
    if (!this.accessToken) throw new ProviderUnavailableError('line-messaging', 'not configured');
    const { status, body } = await this.http.call('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        'x-line-retry-key': message.retryKey,
      },
      body: JSON.stringify({
        to: message.to,
        messages: [{ type: 'text', text: message.text.slice(0, 5000) }],
      }),
      retries: 2,
    });
    // 409 = this retry key was already accepted: the message was delivered before.
    if (status !== 200 && status !== 409)
      throw new ProviderUnavailableError('line-messaging', `HTTP ${status}`, status);
    const sent = (body as { sentMessages?: { id?: string }[] } | null)?.sentMessages?.[0]?.id;
    return { providerMessageId: sent ?? message.retryKey };
  }

  /** `POST /v2/bot/user/{userId}/richmenu/{richMenuId}`. */
  async linkRichMenu(lineUserId: string, richMenuId: string): Promise<void> {
    if (!this.accessToken) throw new ProviderUnavailableError('line-messaging', 'not configured');
    const url = `https://api.line.me/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`;
    const { status } = await this.http.call(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.accessToken}` },
      retries: 2,
    });
    if (status !== 200) throw new ProviderUnavailableError('line-messaging', `HTTP ${status}`, status);
  }
}
