import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type LoginMethod, type TokenAudience } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { scopeClaim, ScopeDirectory } from '@modules/iam/scope-directory';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { type IssuedSession, SessionService } from './sessions/session.service';
import { TokenService } from './tokens/token.service';

/** Contract §4 login response. */
export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  subject: {
    id: string;
    type: TokenAudience;
    roles: string[];
    permissions: string[];
    scopes: string[];
  };
}

/**
 * Issues the contract §4 token set for a user: resolves roles, permissions and scopes, creates the
 * refresh session in the caller's transaction and signs the access token.
 */
@Injectable()
export class AuthTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionResolver,
    private readonly scopes: ScopeDirectory,
    private readonly settings: SettingsService,
  ) {}

  /** Scopes carried by the token (`factory:<uuid>`, `company:<uuid>`). */
  async scopesFor(
    userId: bigint,
    audience: TokenAudience,
  ): Promise<{ roles: string[]; permissions: string[]; scopes: string[] }> {
    const access = await this.permissions.forUser(userId);
    const scoped = access.roles.filter((r) => r.scopeType !== 'platform' && r.scopeId !== null);
    const scopes: string[] = [];
    for (const type of ['factory', 'company'] as const) {
      const ids = [...new Set(scoped.filter((r) => r.scopeType === type).map((r) => r.scopeId!))];
      if (ids.length === 0) continue;
      const publicIds = await this.scopes.publicIds(type, ids);
      // A partner acts only inside factory scopes; refuse rather than issue a token without them.
      if (audience === 'partner' && type === 'factory' && publicIds.size !== ids.length) {
        throw new DomainException('auth.scope_unavailable');
      }
      for (const id of ids) {
        const publicId = publicIds.get(id);
        if (publicId) scopes.push(scopeClaim(type, publicId));
      }
    }
    if (audience === 'partner' && !scopes.some((s) => s.startsWith('factory:'))) {
      throw new DomainException('auth.scope_unavailable');
    }
    return {
      roles: [...new Set(access.roles.map((r) => r.key))].sort(),
      permissions: [...access.permissions].sort(),
      scopes: scopes.sort(),
    };
  }

  /** New session (login). Runs in the caller's transaction together with the login's own writes. */
  async issue(
    tx: Tx,
    user: { id: bigint; publicId: string },
    audience: TokenAudience,
    loginMethod: LoginMethod,
    deviceId?: string,
  ): Promise<TokenPair> {
    const subject = await this.scopesFor(user.id, audience);
    const session = await this.sessions.create(tx, { userId: user.id, audience, loginMethod, deviceId });
    return this.sign(user.publicId, audience, subject, session);
  }

  /** Access token for a rotated session (refresh). */
  async forRotated(userId: bigint, audience: TokenAudience, session: IssuedSession): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { publicId: true },
    });
    const subject = await this.scopesFor(userId, audience);
    return this.sign(user.publicId, audience, subject, session);
  }

  private async sign(
    publicId: string,
    audience: TokenAudience,
    subject: { roles: string[]; permissions: string[]; scopes: string[] },
    session: IssuedSession,
  ): Promise<TokenPair> {
    const ttl = await this.settings.value('auth.access_token_ttl_seconds');
    const access = await this.tokens.issue(
      { sub: publicId, aud: audience, sid: session.familyId, scp: subject.scopes, pty: 'user' },
      ttl,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
      subject: { id: publicId, type: audience, ...subject },
    };
  }
}
