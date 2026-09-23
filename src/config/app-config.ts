import { type EnvironmentVariables, IntegrationsMode, NodeEnv } from './env.schema';

/**
 * Typed, read-only view of the validated environment. Built by `AppConfigModule` when Nest
 * instantiates providers — i.e. after `loadSecretsIntoEnv()` has run in the entry point.
 */
export class AppConfig {
  constructor(private readonly env: EnvironmentVariables) {}

  get<K extends keyof EnvironmentVariables>(key: K): EnvironmentVariables[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === NodeEnv.Production;
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === NodeEnv.Test;
  }

  get useFakes(): boolean {
    return this.env.INTEGRATIONS_MODE === IntegrationsMode.Fake;
  }

  /**
   * Who may open `/docs*` (contract §5): everyone in development/test; in production nobody unless
   * `DOCS_ENABLED=true`, and then only callers inside `DOCS_ALLOWED_CIDRS` (staff tokens: B1.3).
   */
  get docsAccess(): 'open' | 'allow-list' | 'off' {
    if (!this.isProduction) return 'open';
    return this.env.DOCS_ENABLED ? 'allow-list' : 'off';
  }
}
