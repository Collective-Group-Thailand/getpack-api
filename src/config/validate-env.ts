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

  if (env.NODE_ENV === NodeEnv.Production) {
    if (!env.JWT_SIGNING_KEYS) problems.push('JWT_SIGNING_KEYS: required when NODE_ENV=production');
    if (!env.OTP_HMAC_SECRET) problems.push('OTP_HMAC_SECRET: required when NODE_ENV=production');
    if (!env.FIELD_ENCRYPTION_KEY || Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64').length !== 32) {
      problems.push('FIELD_ENCRYPTION_KEY: 32 bytes base64 required when NODE_ENV=production');
    }
    for (const key of ['PUBLIC_API_BASE_URL', 'MERCHANT_FEED_LINK_TEMPLATE'] as const) {
      if (env[key].includes('.invalid')) problems.push(`${key}: set the real URL when NODE_ENV=production`);
    }
  }

  if (problems.length > 0) throw new InvalidEnvironmentError(problems);
  return env;
}
