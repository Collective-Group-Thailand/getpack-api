import { toBangkokIso } from '@common/time/bangkok';

import { type TokenPairDto } from '../auth.dto';
import { type TokenPair } from '../auth-tokens.service';

export const toTokenPairDto = (pair: TokenPair): TokenPairDto => ({
  accessToken: pair.accessToken,
  accessTokenExpiresAt: toBangkokIso(pair.accessTokenExpiresAt),
  refreshToken: pair.refreshToken,
  refreshTokenExpiresAt: toBangkokIso(pair.refreshTokenExpiresAt),
  subject: pair.subject,
});

/**
 * Stricter limit for credential-guessing targets (per IP, on top of the global throttle).
 * `AUTH_LOGIN_THROTTLE_LIMIT` is validated at start-up (env.schema.ts); read lazily per request.
 */
export const LOGIN_THROTTLE = {
  default: { limit: () => Number(process.env.AUTH_LOGIN_THROTTLE_LIMIT ?? 10), ttl: 60_000 },
};
