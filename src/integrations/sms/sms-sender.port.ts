/** SMS provider port (ThaiBulkSMS). SMS is for OTP and critical events only (D-143). */
export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsMessage {
  /** E.164, e.g. `+66812345678`. */
  to: string;
  text: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<{ providerMessageId: string }>;
}
