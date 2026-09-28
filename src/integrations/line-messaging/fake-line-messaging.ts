import { type LineMessaging, type LinePush } from './line-messaging.port';

export class FakeLineMessaging implements LineMessaging {
  readonly sent: LinePush[] = [];
  readonly richMenus = new Map<string, string>();

  push(message: LinePush): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `fake-line-${message.retryKey}` });
  }

  linkRichMenu(lineUserId: string, richMenuId: string): Promise<void> {
    this.richMenus.set(lineUserId, richMenuId);
    return Promise.resolve();
  }
}
