import { type AppConfig } from '@config/app-config';

import { FieldEncryption } from './field-encryption';

const withKey = (key?: string) => new FieldEncryption({ get: () => key } as unknown as AppConfig);

describe('FieldEncryption', () => {
  it('round-trips and never produces the same ciphertext twice', () => {
    const enc = withKey(Buffer.alloc(32, 1).toString('base64'));
    const a = enc.encrypt('auth-secret');
    const b = enc.encrypt('auth-secret');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(enc.decrypt(a)).toBe('auth-secret');
  });

  it('detects tampering and wrong keys', () => {
    const enc = withKey(Buffer.alloc(32, 1).toString('base64'));
    const sealed = Buffer.from(enc.encrypt('x'));
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 0xff;
    expect(() => enc.decrypt(sealed)).toThrow();
    expect(() => withKey(Buffer.alloc(32, 2).toString('base64')).decrypt(enc.encrypt('x'))).toThrow();
    expect(() => withKey(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
