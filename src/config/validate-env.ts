import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnvironmentVariables, IntegrationsMode, NodeEnv } from './env.schema';

export class InvalidEnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Validates and types the environment. Fails fast listing every problem.
 * Messages name the variable and the rule only — never the value (it may be a secret).
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  // An empty string in .env means "not set", so defaults and @IsOptional apply.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const env = plainToInstance(EnvironmentVariables, cleaned, { enableImplicitConversion: false });
  const errors = validateSync(env, { whitelist: true, skipMissingProperties: false });

  const problems = errors.flatMap((error) =>
    Object.keys(error.constraints ?? {}).map((rule) => `${error.property}: failed "${rule}"`),
  );

  if (env.NODE_ENV === NodeEnv.Production && env.INTEGRATIONS_MODE === IntegrationsMode.Fake) {
    problems.push('INTEGRATIONS_MODE: must be "real" when NODE_ENV=production');
  }

  if (problems.length > 0) throw new InvalidEnvironmentError(problems);
  return env;
}
