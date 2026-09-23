import { type Audience } from '@modules/surfaces/surfaces';
import { Injectable } from '@nestjs/common';
import { decodeProtectedHeader, errors, importJWK, jwtVerify, SignJWT } from 'jose';

import { JWT_ALG, SigningKeys } from './signing-keys';

export const TOKEN_ISSUER = 'packio-api';

/** Principal kind inside the token: a person (`users`) or a machine client (`api_clients`). */
export type PrincipalType = 'user' | 'client';

export interface AccessTokenClaims {
  sub: string;
  aud: Audience;
  /** Session family id; absent for client-credentials tokens. */
  sid?: string;
  scp: string[];
  pty: PrincipalType;
  iat: number;
  exp: number;
}

export class AccessTokenInvalidError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`access token ${reason}`);
    this.name = 'AccessTokenInvalidError';
  }
}

/** Signs and verifies access tokens (ADR-0004: EdDSA, 10–15 min, claims sub aud sid scp). */
@Injectable()
export class TokenService {
  constructor(private readonly keys: SigningKeys) {}

  async issue(
    claims: { sub: string; aud: Audience; sid?: string; scp: string[]; pty: PrincipalType },
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const key = await this.keys.active();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      scp: claims.scp,
      pty: claims.pty,
      ...(claims.sid && { sid: claims.sid }),
    })
      .setProtectedHeader({ alg: JWT_ALG, kid: key.kid, typ: 'at+jwt' })
      .setIssuer(TOKEN_ISSUER)
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(key.privateKey);
    return { token, expiresAt: new Date((now + ttlSeconds) * 1000) };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    let kid: string | undefined;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      throw new AccessTokenInvalidError('invalid');
    }
    const key = kid ? await this.keys.publicKey(kid) : undefined;
    if (!key) throw new AccessTokenInvalidError('invalid');
    try {
      const { payload } = await jwtVerify(token, await importJWK(key.publicJwk, JWT_ALG), {
        algorithms: [JWT_ALG],
        issuer: TOKEN_ISSUER,
        typ: 'at+jwt',
      });
      const aud = payload.aud;
      if (
        typeof payload.sub !== 'string' ||
        (aud !== 'customer' && aud !== 'staff' && aud !== 'partner') ||
        (payload['pty'] !== 'user' && payload['pty'] !== 'client') ||
        !Array.isArray(payload['scp'])
      ) {
        throw new AccessTokenInvalidError('invalid');
      }
      return {
        sub: payload.sub,
        aud,
        scp: payload['scp'] as string[],
        pty: payload['pty'],
        iat: payload.iat ?? 0,
        exp: payload.exp ?? 0,
        ...(typeof payload['sid'] === 'string' && { sid: payload['sid'] }),
      };
    } catch (error) {
      if (error instanceof AccessTokenInvalidError) throw error;
      throw new AccessTokenInvalidError(error instanceof errors.JWTExpired ? 'expired' : 'invalid');
    }
  }
}
