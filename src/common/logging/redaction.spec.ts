import { Writable } from 'node:stream';

import pino from 'pino';

import { REDACT_CENSOR, REDACT_PATHS, redactDeep, REDACTED_FIELDS } from './redaction';

function capture(): { logger: pino.Logger; lines: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, stream);
  return { logger, lines: () => output };
}

describe('log redaction (PDPA)', () => {
  it.each(REDACTED_FIELDS)('redacts %s at any depth up to 5', (field) => {
    const { logger, lines } = capture();
    const secret = `S3CRET-${field}`;
    logger.info({
      [field]: secret,
      a: { [field]: secret, b: { [field]: secret, c: { [field]: secret, d: { [field]: secret } } } },
    });
    expect(lines()).not.toContain(secret);
    expect(lines()).toContain(REDACT_CENSOR);
  });

  it('redacts request headers such as authorization and cookie', () => {
    const { logger, lines } = capture();
    logger.info({ req: { headers: { authorization: 'Bearer abc.def', cookie: 'sid=xyz', accept: 'json' } } });
    expect(lines()).not.toContain('abc.def');
    expect(lines()).not.toContain('sid=xyz');
    expect(lines()).toContain('"accept":"json"');
  });
});

describe('redactDeep', () => {
  it('censors redacted fields at any depth, case-insensitively, without mutating the input', () => {
    const input = {
      user: { Password: 'x', profile: { otp: '123456', name: 'ok' } },
      list: [{ refreshToken: 't' }],
    };
    const out = redactDeep(input);
    expect(out).toEqual({
      user: { Password: REDACT_CENSOR, profile: { otp: REDACT_CENSOR, name: 'ok' } },
      list: [{ refreshToken: REDACT_CENSOR }],
    });
    expect(input.user.Password).toBe('x');
  });

  it('leaves primitives untouched', () => {
    expect(redactDeep('secret')).toBe('secret');
    expect(redactDeep(null)).toBeNull();
  });
});
