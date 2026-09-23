import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { JWT_ALG, SigningKeys } from '@modules/auth/tokens/signing-keys';
import { TOKEN_ISSUER } from '@modules/auth/tokens/token.service';
import { Injectable } from '@nestjs/common';
import { decodeProtectedHeader, importJWK, jwtVerify, SignJWT } from 'jose';

const TTL_SECONDS = 60;
const AUDIENCE = 'realtime';

/**
 * Short-lived channel authorisation for `GET …/realtime/stream` (contract §6). The stream itself is
 * called with the principal's bearer token (forwarded by the BFF); the channel token lists the
 * channels its holder may read — `user:<uuid>` plus the token scopes (`factory:<uuid>`,
 * `company:<uuid>`) — and must belong to the same principal and surface.
 */
@Injectable()
export class RealtimeTokens {
  constructor(private readonly keys: SigningKeys) {}

  channelsFor(actor: Actor): string[] {
    if (actor.type !== 'user' && actor.type !== 'api_client') return [];
    return [
      `user:${actor.publicId}`,
      ...actor.scopes.filter((s) => s.startsWith('factory:') || s.startsWith('company:')),
    ];
  }

  async issue(
    actor: Actor,
    surface: string,
  ): Promise<{ token: string; expiresAt: Date; channels: string[] }> {
    const channels = this.channelsFor(actor);
    const key = await this.keys.active();
    const now = Math.floor(Date.now() / 1000);
    const subject = actor.type === 'user' || actor.type === 'api_client' ? actor.publicId : 'none';
    const token = await new SignJWT({ ch: channels, srf: surface })
      .setSubject(subject)
      .setProtectedHeader({ alg: JWT_ALG, kid: key.kid, typ: 'rt+jwt' })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + TTL_SECONDS)
      .sign(key.privateKey);
    return { token, expiresAt: new Date((now + TTL_SECONDS) * 1000), channels };
  }

  async verify(token: string, surface: string, actor: Actor): Promise<string[]> {
    try {
      const kid = decodeProtectedHeader(token).kid;
      const key = kid ? await this.keys.publicKey(kid) : undefined;
      if (!key) throw new Error('unknown key');
      const { payload } = await jwtVerify(token, await importJWK(key.publicJwk, JWT_ALG), {
        algorithms: [JWT_ALG],
        issuer: TOKEN_ISSUER,
        audience: AUDIENCE,
        typ: 'rt+jwt',
      });
      const holder = actor.type === 'user' || actor.type === 'api_client' ? actor.publicId : undefined;
      if (payload['srf'] !== surface || payload.sub !== holder || !Array.isArray(payload['ch']))
        throw new Error('not for this principal');
      return payload['ch'] as string[];
    } catch {
      throw new DomainException('auth.unauthenticated');
    }
  }
}
