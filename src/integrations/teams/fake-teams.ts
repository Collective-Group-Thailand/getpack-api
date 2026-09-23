import { type TeamsWebhook } from './teams.port';

export class FakeTeamsWebhook implements TeamsWebhook {
  readonly posted: { secretRef: string; text: string }[] = [];

  post(secretRef: string, text: string): Promise<void> {
    this.posted.push({ secretRef, text });
    return Promise.resolve();
  }
}
