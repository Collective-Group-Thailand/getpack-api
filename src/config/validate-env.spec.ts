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

  it('refuses fake integrations in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', INTEGRATIONS_MODE: 'fake' })).toThrow(
      /INTEGRATIONS_MODE: must be "real"/,
    );
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production', INTEGRATIONS_MODE: 'real' }).INTEGRATIONS_MODE,
    ).toBe(IntegrationsMode.Real);
  });
});
