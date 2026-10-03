import { ResilientHttp } from '../http/resilient-http';
import { type WebhookSender } from './webhook-sender.port';

/** One attempt per call (the back-off is the delivery job's, D-291); 10 s timeout, no body read or logged. */
export class HttpWebhookSender implements WebhookSender {
  private readonly http = new ResilientHttp('b2b-webhooks');

  async post(url: string, headers: Record<string, string>, body: string): Promise<number> {
    const { status } = await this.http.call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      timeoutMs: 10_000,
      retries: 0,
    });
    return status;
  }
}
