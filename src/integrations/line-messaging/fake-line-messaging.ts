import { type LineMessaging, type LinePush } from './line-messaging.port';

export class FakeLineMessaging implements LineMessaging {
  readonly sent: LinePush[] = [];

  push(message: LinePush): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `fake-line-${message.retryKey}` });
  }
}
