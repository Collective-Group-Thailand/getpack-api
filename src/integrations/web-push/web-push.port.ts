/** Web push (VAPID) to a browser subscription. */
export const WEB_PUSH = Symbol('WEB_PUSH');

export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushSender {
  readonly publicKey: string | null;
  /** `gone` = the subscription no longer exists (HTTP 404/410): revoke it. */
  send(target: WebPushTarget, payload: string): Promise<'sent' | 'gone'>;
}
