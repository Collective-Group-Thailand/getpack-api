import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import {
  IdentityTokenInvalidError,
  type LineVerifier,
  type VerifiedIdentity,
} from './identity-verifier.port';

/**
 * LINE Login v2.1: ID tokens are verified by LINE's verify endpoint with our channel id; LIFF access
 * tokens are verified (channel must be ours, not expired) and then exchanged for the profile.
 */
export class LineLoginVerifier implements LineVerifier {
  private readonly http = new ResilientHttp('line-login');

  constructor(private readonly channelId: string | undefined) {}

  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    const channelId = this.requireChannel();
    const { status, body } = await this.http.call('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      retries: 1,
    });
    const claims = body as { sub?: string; name?: string; picture?: string; email?: string } | null;
    if (status !== 200 || !claims?.sub) throw new IdentityTokenInvalidError(`LINE verify HTTP ${status}`);
    return {
      provider: 'line',
      subject: claims.sub,
      ...(claims.name && { displayName: claims.name }),
      ...(claims.picture && { pictureUrl: claims.picture }),
      ...(claims.email && { email: claims.email }),
    };
  }

  async verifyLiffAccessToken(accessToken: string): Promise<VerifiedIdentity> {
    const channelId = this.requireChannel();
    const verify = await this.http.call(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
      { retries: 1 },
    );
    const token = verify.body as { client_id?: string; expires_in?: number } | null;
    if (verify.status !== 200 || token?.client_id !== channelId || !(Number(token.expires_in) > 0)) {
      throw new IdentityTokenInvalidError('LIFF access token not valid for this channel');
    }
    const profile = await this.http.call('https://api.line.me/v2/profile', {
      headers: { authorization: `Bearer ${accessToken}` },
      retries: 1,
    });
    const p = profile.body as { userId?: string; displayName?: string; pictureUrl?: string } | null;
    if (profile.status !== 200 || !p?.userId) throw new IdentityTokenInvalidError('LINE profile unavailable');
    return {
      provider: 'line',
      subject: p.userId,
      ...(p.displayName && { displayName: p.displayName }),
      ...(p.pictureUrl && { pictureUrl: p.pictureUrl }),
    };
  }

  private requireChannel(): string {
    if (!this.channelId) throw new ProviderUnavailableError('line-login', 'not configured');
    return this.channelId;
  }
}
