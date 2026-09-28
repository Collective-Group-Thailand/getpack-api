/** LINE Messaging API push (customers who linked LINE, staff team groups — D-143) and rich menus (D-151). */
export const LINE_MESSAGING = Symbol('LINE_MESSAGING');

export interface LinePush {
  /** LINE userId or group id. */
  to: string;
  text: string;
  /** Idempotency key for provider-side retries (`X-Line-Retry-Key`, a uuid). */
  retryKey: string;
}

export interface LineMessaging {
  push(message: LinePush): Promise<{ providerMessageId: string }>;
  /** Shows a rich menu to one user (guest vs member menu, B4.6). */
  linkRichMenu(lineUserId: string, richMenuId: string): Promise<void>;
}
