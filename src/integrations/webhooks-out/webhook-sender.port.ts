/** Outbound B2B webhook deliveries (D-291): one signed POST, its HTTP status — never its body (it may hold PII). */
export const WEBHOOK_SENDER = Symbol('WEBHOOK_SENDER');

export interface WebhookSender {
  /** Resolves with the response status; rejects on a network error or timeout. */
  post(url: string, headers: Record<string, string>, body: string): Promise<number>;
}
