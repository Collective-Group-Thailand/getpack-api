import { type WebhookSender } from './webhook-sender.port';

/** Records every delivery; `respond` sets the status the next calls get (tests drive retries with it). */
export class FakeWebhookSender implements WebhookSender {
  readonly sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  status = 200;

  post(url: string, headers: Record<string, string>, body: string): Promise<number> {
    this.sent.push({ url, headers, body });
    return Promise.resolve(this.status);
  }
}
