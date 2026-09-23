import { type WebPushSender, type WebPushTarget } from './web-push.port';

export class FakeWebPush implements WebPushSender {
  readonly publicKey = 'BFakeVapidPublicKeyForDevelopmentOnly000000000000000000000000000000000000000000000';
  readonly sent: { target: WebPushTarget; payload: string }[] = [];

  send(target: WebPushTarget, payload: string): Promise<'sent' | 'gone'> {
    if (target.endpoint.includes('gone')) return Promise.resolve('gone');
    this.sent.push({ target, payload });
    return Promise.resolve('sent');
  }
}
