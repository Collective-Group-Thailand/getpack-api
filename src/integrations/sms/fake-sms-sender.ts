import { randomUUID } from 'node:crypto';

import { type SmsMessage, type SmsSender } from './sms-sender.port';

/** Keeps messages in memory; tests read OTP codes from `sent`. Never used in production. */
export class FakeSmsSender implements SmsSender {
  readonly sent: (SmsMessage & { providerMessageId: string })[] = [];

  send(message: SmsMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-sms-${randomUUID()}`;
    this.sent.push({ ...message, providerMessageId });
    return Promise.resolve({ providerMessageId });
  }

  lastTo(phone: string): SmsMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === phone);
  }
}
