import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import { type SecretsProvider } from '../secrets/secrets.port';
import { type TeamsWebhook } from './teams.port';

export class TeamsWebhookClient implements TeamsWebhook {
  private readonly http = new ResilientHttp('teams');

  constructor(private readonly secrets: SecretsProvider) {}

  async post(secretRef: string, text: string): Promise<void> {
    const url = (await this.secrets.getJsonSecret(secretRef))['url'];
    if (!url) throw new ProviderUnavailableError('teams', 'webhook secret has no url');
    const { status } = await this.http.call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (status >= 300) throw new ProviderUnavailableError('teams', `HTTP ${status}`, status);
  }
}
