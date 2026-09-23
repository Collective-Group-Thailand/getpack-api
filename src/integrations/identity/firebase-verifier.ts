import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

import { ProviderUnavailableError } from '../http/resilient-http';
import {
  type FirebaseVerifier,
  IdentityTokenInvalidError,
  type VerifiedIdentity,
} from './identity-verifier.port';

const FIREBASE_JWKS = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

/**
 * Verifies Firebase Auth ID tokens locally against Google's published keys (no firebase-admin):
 * RS256, `iss = https://securetoken.google.com/<project>`, `aud = <project>`, not expired.
 */
export class JoseFirebaseVerifier implements FirebaseVerifier {
  private readonly jwks = createRemoteJWKSet(FIREBASE_JWKS, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });

  constructor(private readonly projectId: string | undefined) {}

  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    if (!this.projectId) throw new ProviderUnavailableError('firebase', 'not configured');
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        algorithms: ['RS256'],
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
      });
      const signIn = (payload['firebase'] as { sign_in_provider?: string } | undefined)?.sign_in_provider;
      const provider =
        signIn === 'google.com' ? 'firebase_google' : signIn === 'apple.com' ? 'firebase_apple' : null;
      if (!provider || !payload.sub)
        throw new IdentityTokenInvalidError(`unsupported sign-in provider ${signIn}`);
      return {
        provider,
        subject: payload.sub,
        ...(typeof payload['email'] === 'string' && { email: payload['email'] }),
        ...(typeof payload['email_verified'] === 'boolean' && { emailVerified: payload['email_verified'] }),
        ...(typeof payload['name'] === 'string' && { displayName: payload['name'] }),
        ...(typeof payload['picture'] === 'string' && { pictureUrl: payload['picture'] }),
      };
    } catch (error) {
      if (error instanceof IdentityTokenInvalidError) throw error;
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw new IdentityTokenInvalidError(error.code);
      }
      throw new ProviderUnavailableError('firebase', 'key set unavailable');
    }
  }
}
