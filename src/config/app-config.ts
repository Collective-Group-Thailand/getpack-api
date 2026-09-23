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

  /** `/docs` is on everywhere except production, where it needs `DOCS_ENABLED=true` (contract §2). */
  get docsEnabled(): boolean {
    return !this.isProduction || this.env.DOCS_ENABLED;
  }
}
