import {
  type FirebaseVerifier,
  IdentityTokenInvalidError,
  type LineVerifier,
  type VerifiedIdentity,
} from './identity-verifier.port';

/**
 * Fakes for tests and `pnpm dev`. Tokens are readable strings:
 * `fake-firebase.<google|apple>.<uid>[.<email>]`, `fake-line.<userId>[.<displayName>]`.
 */
export class FakeFirebaseVerifier implements FirebaseVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    const [marker, provider, uid, ...rest] = idToken.split('.');
    const email = rest.join('.');
    if (marker !== 'fake-firebase' || !uid || (provider !== 'google' && provider !== 'apple')) {
      return Promise.reject(new IdentityTokenInvalidError('not a fake Firebase token'));
    }
    return Promise.resolve({
      provider: provider === 'google' ? 'firebase_google' : 'firebase_apple',
      subject: uid,
      ...(email && { email: decodeURIComponent(email), emailVerified: true }),
    });
  }
}

export class FakeLineVerifier implements LineVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    return this.parse(idToken);
  }

  verifyLiffAccessToken(accessToken: string): Promise<VerifiedIdentity> {
    return this.parse(accessToken);
  }

  private parse(token: string): Promise<VerifiedIdentity> {
    const [marker, userId, ...rest] = token.split('.');
    const name = rest.join('.');
    if (marker !== 'fake-line' || !userId)
      return Promise.reject(new IdentityTokenInvalidError('not a fake LINE token'));
    return Promise.resolve({
      provider: 'line',
      subject: userId,
      ...(name && { displayName: decodeURIComponent(name) }),
    });
  }
}
