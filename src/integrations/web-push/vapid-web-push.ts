import webpush from 'web-push';

import { ProviderUnavailableError } from '../http/resilient-http';
import { type WebPushSender, type WebPushTarget } from './web-push.port';

export class VapidWebPush implements WebPushSender {
  readonly publicKey: string | null;

  constructor(private readonly config: { publicKey?: string; privateKey?: string; subject?: string }) {
    this.publicKey = config.publicKey ?? null;
  }

  async send(target: WebPushTarget, payload: string): Promise<'sent' | 'gone'> {
    const { publicKey, privateKey, subject } = this.config;
    if (!publicKey || !privateKey || !subject)
      throw new ProviderUnavailableError('web-push', 'VAPID not configured');
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { vapidDetails: { subject, publicKey, privateKey }, TTL: 86_400, timeout: 5_000 },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw new ProviderUnavailableError('web-push', `HTTP ${status ?? 'error'}`, status);
    }
  }
}
