import { randomUUID } from 'node:crypto';

import { type EmailMessage, type EmailSender } from './email-sender.port';

export class FakeEmailSender implements EmailSender {
  readonly sent: (EmailMessage & { providerMessageId: string })[] = [];

  send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-email-${randomUUID()}`;
    this.sent.push({ ...message, providerMessageId });
    return Promise.resolve({ providerMessageId });
  }
}
