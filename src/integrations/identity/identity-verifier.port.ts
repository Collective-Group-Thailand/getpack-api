/** Verified external identity (customer login with Google/Apple through Firebase, or LINE). */
export interface VerifiedIdentity {
  provider: 'firebase_google' | 'firebase_apple' | 'line';
  /** Firebase uid or LINE userId. */
  subject: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  pictureUrl?: string;
}

/** The token is not valid (bad signature, wrong audience, expired, unsupported provider). */
export class IdentityTokenInvalidError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IdentityTokenInvalidError';
  }
}

export const FIREBASE_VERIFIER = Symbol('FIREBASE_VERIFIER');
export const LINE_VERIFIER = Symbol('LINE_VERIFIER');

export interface FirebaseVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}

export interface LineVerifier {
  /** LINE Login ID token (web login). */
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
  /** LIFF access token (inside the LINE app, D-151). */
  verifyLiffAccessToken(accessToken: string): Promise<VerifiedIdentity>;
}
