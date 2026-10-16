import { type AppConfig } from '@config/app-config';
import { SignJWT } from 'jose';

import { SigningKeys } from './signing-keys';
import { AccessTokenInvalidError, TokenService } from './token.service';

const config = (env: Record<string, unknown> = {}) =>
  ({ get: (key: string) => env[key], isProduction: env['production'] === true }) as unknown as AppConfig;

describe('TokenService (ADR-0004)', () => {
  const keys = new SigningKeys(config());
  const tokens = new TokenService(keys);

  it('issues EdDSA tokens with sub, aud, sid, scp and a kid, and verifies them', async () => {
    const { token, expiresAt } = await tokens.issue(
      { sub: 'u-1', aud: 'partner', sid: 'family-1', scp: ['factory:f-1'], pty: 'user' },
      600,
    );
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
    await expect(tokens.verify(token)).resolves.toMatchObject({
      sub: 'u-1',
      aud: 'partner',
      sid: 'family-1',
      scp: ['factory:f-1'],
      pty: 'user',
    });
  });

  it('reports expired tokens distinctly', async () => {
    const { token } = await tokens.issue({ sub: 'u-1', aud: 'staff', scp: [], pty: 'user' }, -5);
    await expect(tokens.verify(token)).rejects.toEqual(new AccessTokenInvalidError('expired'));
  });

  it('rejects tampered tokens, unknown keys and garbage', async () => {
    const { token } = await tokens.issue({ sub: 'u-1', aud: 'staff', scp: [], pty: 'user' }, 600);
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', aud: 'staff', scp: [], pty: 'user' })).toString(
      'base64url',
    );
    await expect(tokens.verify(`${header}.${forged}.${signature}`)).rejects.toEqual(
      new AccessTokenInvalidError('invalid'),
    );
    await expect(tokens.verify(`${header}.${payload}`)).rejects.toBeInstanceOf(AccessTokenInvalidError);
    await expect(tokens.verify('garbage')).rejects.toBeInstanceOf(AccessTokenInvalidError);

    const other = new TokenService(new SigningKeys(config()));
    const { token: foreign } = await other.issue({ sub: 'u-1', aud: 'staff', scp: [], pty: 'user' }, 600);
    await expect(tokens.verify(foreign)).rejects.toEqual(new AccessTokenInvalidError('invalid'));
  });

  it('rejects tokens without the getpack shape (wrong audience value, no scp)', async () => {
    const active = await keys.active();
    const token = await new SignJWT({ pty: 'user' })
      .setProtectedHeader({ alg: 'EdDSA', kid: active.kid, typ: 'at+jwt' })
      .setIssuer('getpack-api')
      .setSubject('u-1')
      .setAudience('somebody-else')
      .setExpirationTime('5m')
      .sign(active.privateKey);
    await expect(tokens.verify(token)).rejects.toEqual(new AccessTokenInvalidError('invalid'));
  });

  it('loads configured keys, signs with the first and publishes only public parts', async () => {
    const jwk = (await new SigningKeys(config()).jwks()).keys[0]!;
    expect(jwk.d).toBeUndefined();
    await expect(new SigningKeys(config({ production: true })).active()).rejects.toThrow(
      'required in production',
    );
    await expect(
      new SigningKeys(config({ JWT_SIGNING_KEYS: JSON.stringify([{ kty: 'OKP' }]) })).active(),
    ).rejects.toThrow('each key needs kid');
  });
});
