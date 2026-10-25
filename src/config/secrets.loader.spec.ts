import { FakeSecretsProvider } from '@collective/integrations/secrets';

import { loadSecretsIntoEnv } from './secrets.loader';

describe('loadSecretsIntoEnv', () => {
  const provider = new FakeSecretsProvider({
    'getpack/api': { DATABASE_URL: 'postgresql://from-secret/db', SENTRY_DSN: 'https://k@sentry.example/1' },
  });

  it('does nothing without AWS_SECRETS_ID', async () => {
    const env: NodeJS.ProcessEnv = {};
    await expect(loadSecretsIntoEnv(env, provider)).resolves.toEqual({ loadedKeys: [] });
    expect(env).toEqual({});
  });

  it('fills unset variables and keeps explicit ones', async () => {
    const env: NodeJS.ProcessEnv = {
      AWS_SECRETS_ID: 'getpack/api',
      DATABASE_URL: 'postgresql://explicit/db',
    };
    const result = await loadSecretsIntoEnv(env, provider);
    expect(env.DATABASE_URL).toBe('postgresql://explicit/db');
    expect(env.SENTRY_DSN).toBe('https://k@sentry.example/1');
    expect(result.loadedKeys).toEqual(['SENTRY_DSN']);
  });

  it('fails when the secret does not exist', async () => {
    await expect(loadSecretsIntoEnv({ AWS_SECRETS_ID: 'missing' }, provider)).rejects.toThrow(/not found/);
  });
});
