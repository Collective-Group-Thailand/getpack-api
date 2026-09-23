import { IS_PUBLIC, OPTIONAL_AUTH } from '@common/auth/auth.decorators';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { type Audience } from '@modules/surfaces/surfaces';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '@platform/audit/audit.service';
import { type Request } from 'express';

import { PrincipalService } from '../principal.service';
import { SessionService } from '../sessions/session.service';
import { type AccessTokenClaims, AccessTokenInvalidError, TokenService } from '../tokens/token.service';

const SURFACE_AUDIENCE: Record<string, Audience> = { store: 'customer', admin: 'staff', partner: 'partner' };
const SURFACE_OF_PATH = /^\/v\d+\/(store|admin|partner)(?:\/|$)/;

/** The audience a path requires (contract §2), or `undefined` for auth, webhooks, health and docs. */
export function audienceForPath(path: string): Audience | undefined {
  const surface = SURFACE_OF_PATH.exec(path)?.[1];
  return surface ? SURFACE_AUDIENCE[surface] : undefined;
}

export function bearerOf(req: Pick<Request, 'headers'>): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Global guard (ADR-0004). `/v1/store`, `/v1/admin`, `/v1/partner` require a bearer token whose
 * `aud` matches the prefix — a token of one audience is rejected on every other prefix — unless the
 * route is `@Public()`. Revoked session families are refused at once (Redis marker); when Redis is
 * unreachable the guard fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly principals: PrincipalService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const bearer = bearerOf(req);
    const required = audienceForPath(req.path);

    if (!required) {
      const optional = this.reflector.getAllAndOverride<Audience | undefined>(OPTIONAL_AUTH, targets);
      if (optional && bearer) await this.authenticate(bearer, optional);
      return true;
    }
    if (!bearer) {
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
      throw new DomainException('auth.unauthenticated');
    }
    await this.authenticate(bearer, required);
    return true;
  }

  /**
   * True when `bearer` is a live staff token whose user holds `permission`. For gates outside the
   * Nest pipeline (the `/docs` middleware); never throws.
   */
  async staffHasPermission(bearer: string | undefined, permission: string): Promise<boolean> {
    if (!bearer) return false;
    try {
      const claims = await this.tokens.verify(bearer);
      if (claims.aud !== 'staff' || !claims.sid || (await this.sessions.isRevoked(claims.sid))) return false;
      const actor = await this.principals.actorFor(claims);
      return (
        actor.type === 'user' && (await this.permissions.forUser(actor.userId)).permissions.has(permission)
      );
    } catch {
      return false;
    }
  }

  /** Verifies a bearer token for `required` and sets the request actor. */
  async authenticate(bearer: string, required: Audience): Promise<void> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verify(bearer);
    } catch (error) {
      if (error instanceof AccessTokenInvalidError && error.reason === 'expired') {
        throw new DomainException('auth.token_expired');
      }
      throw new DomainException('auth.unauthenticated');
    }
    if (claims.aud !== required) {
      await this.audit.recordStandalone({
        category: 'security',
        action: 'auth.audience_rejected',
        outcome: 'denied',
        actor: { type: 'system', name: 'auth-guard' },
        data: { tokenAudience: claims.aud, requiredAudience: required },
      });
      throw new DomainException('auth.wrong_audience');
    }
    if (claims.sid) {
      let revoked: boolean;
      try {
        revoked = await this.sessions.isRevoked(claims.sid);
      } catch (error) {
        throw new DomainException('service.unavailable', { cause: error });
      }
      if (revoked) throw new DomainException('auth.session_revoked');
    }
    RequestContext.setActor(await this.principals.actorFor(claims));
  }
}
