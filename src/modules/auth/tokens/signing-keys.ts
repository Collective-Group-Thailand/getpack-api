import { AppConfig } from '@config/app-config';
import { Injectable } from '@nestjs/common';
import { exportJWK, generateKeyPair, importJWK, type JWK } from 'jose';

export const JWT_ALG = 'EdDSA';

interface LoadedKey {
  kid: string;
  privateKey: Awaited<ReturnType<typeof importJWK>>;
  publicJwk: JWK;
}

/**
 * Ed25519 signing keys (ADR-0004). `JWT_SIGNING_KEYS` holds private JWKs; the first signs, the rest
 * only verify, so rotation = prepend a new key, deploy, drop the old one after the access-token TTL.
 * Without the variable (development, tests, contract build) an ephemeral key is generated.
 */
@Injectable()
export class SigningKeys {
  private loading?: Promise<LoadedKey[]>;

  constructor(private readonly config: AppConfig) {}

  async active(): Promise<LoadedKey> {
    const [first] = await this.keys();
    if (!first) throw new Error('JWT_SIGNING_KEYS contains no key');
    return first;
  }

  async publicKey(kid: string): Promise<LoadedKey | undefined> {
    return (await this.keys()).find((k) => k.kid === kid);
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: (await this.keys()).map((k) => k.publicJwk) };
  }

  private keys(): Promise<LoadedKey[]> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<LoadedKey[]> {
    const raw = this.config.get('JWT_SIGNING_KEYS');
    if (!raw) {
      if (this.config.isProduction) throw new Error('JWT_SIGNING_KEYS is required in production');
      const { privateKey, publicKey } = await generateKeyPair(JWT_ALG, { crv: 'Ed25519', extractable: true });
      const kid = `ephemeral-${Date.now().toString(36)}`;
      return [
        { kid, privateKey, publicJwk: { ...(await exportJWK(publicKey)), kid, alg: JWT_ALG, use: 'sig' } },
      ];
    }
    const parsed = JSON.parse(raw) as JWK[];
    return Promise.all(
      parsed.map(async (jwk) => {
        if (!jwk.kid || jwk.crv !== 'Ed25519' || !jwk.d)
          throw new Error('JWT_SIGNING_KEYS: each key needs kid, crv Ed25519, d');
        const { d: _private, ...publicPart } = jwk;
        return {
          kid: jwk.kid,
          privateKey: await importJWK({ ...jwk, alg: JWT_ALG }, JWT_ALG),
          publicJwk: { ...publicPart, alg: JWT_ALG, use: 'sig' },
        };
      }),
    );
  }
}
