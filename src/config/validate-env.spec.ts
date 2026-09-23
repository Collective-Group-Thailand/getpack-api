import { IntegrationsMode, NodeEnv } from './env.schema';
import { InvalidEnvironmentError, validateEnv } from './validate-env';

const valid = {
  DATABASE_URL: 'postgresql://packio:packio@localhost:5432/packio',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'packio-dev',
};

describe('validateEnv', () => {
  it('applies defaults and converts types', () => {
    const env = validateEnv({
      ...valid,
      PORT: '4000',
      DOCS_ENABLED: 'true',
      SENTRY_TRACES_SAMPLE_RATE: '0.2',
    });
    expect(env.PORT).toBe(4000);
    expect(env.DOCS_ENABLED).toBe(true);
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.2);
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.INTEGRATIONS_MODE).toBe(IntegrationsMode.Fake);
    expect(env.LOG_PRETTY).toBe(false);
  });

  it('treats "false" as false (no implicit Boolean("false") === true)', () => {
    expect(validateEnv({ ...valid, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('treats empty strings as unset', () => {
    expect(validateEnv({ ...valid, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
  });

  it('drops variables it does not know', () => {
    expect(validateEnv({ ...valid, HOME: '/Users/x' })).not.toHaveProperty('HOME');
  });

  it('fails fast listing every problem without echoing values', () => {
    const secretish = 'mysql://root:hunter2@db/x';
    try {
      validateEnv({ DATABASE_URL: secretish, PORT: 'abc' });
      fail('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnvironmentError);
      const { problems, message } = error as InvalidEnvironmentError;
      expect(problems).toEqual(
        expect.arrayContaining([
          'DATABASE_URL: failed "matches"',
          'REDIS_URL: failed "isString"',
          'S3_BUCKET: failed "isString"',
          'PORT: failed "isInt"',
        ]),
      );
      expect(message).not.toContain('hunter2');
    }
  });

  it('validates DOCS_ALLOWED_CIDRS and TRUST_PROXY', () => {
    const env = validateEnv({ ...valid, DOCS_ALLOWED_CIDRS: '10.0.0.0/8, 203.0.113.7', TRUST_PROXY: '1' });
    expect(env.DOCS_ALLOWED_CIDRS).toBe('10.0.0.0/8, 203.0.113.7');
    expect(env.TRUST_PROXY).toBe(1);
    expect(() => validateEnv({ ...valid, DOCS_ALLOWED_CIDRS: '10.0.0.0/99' })).toThrow(/DOCS_ALLOWED_CIDRS/);
  });

  it('refuses fake integrations in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', INTEGRATIONS_MODE: 'fake' })).toThrow(
      /INTEGRATIONS_MODE: must be "real"/,
    );
    expect(
      validateEnv({ ...valid, ...productionSecrets, NODE_ENV: 'production', INTEGRATIONS_MODE: 'real' })
        .INTEGRATIONS_MODE,
    ).toBe(IntegrationsMode.Real);
  });

  it('requires the signing keys and the OTP secret in production (ADR-0004)', () => {
    const production = { ...valid, NODE_ENV: 'production', INTEGRATIONS_MODE: 'real' };
    expect(() => validateEnv(production)).toThrow(
      /JWT_SIGNING_KEYS: required[\s\S]*OTP_HMAC_SECRET: required/,
    );
    expect(() => validateEnv({ ...production, ...productionSecrets, OTP_HMAC_SECRET: 'short' })).toThrow(
      /OTP_HMAC_SECRET: failed "minLength"/,
    );
  });
});

const productionSecrets = { JWT_SIGNING_KEYS: '[]', OTP_HMAC_SECRET: 'x'.repeat(32) };
