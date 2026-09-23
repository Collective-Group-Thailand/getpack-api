import { REQUIRED_PERMISSIONS } from '@common/auth/can.decorator';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '@platform/audit/audit.service';
import { type Request } from 'express';

import { PermissionResolver } from './permission-resolver.service';

/**
 * `@Can()` enforcement (runs after `AuthGuard`). Users need the permission through an active role;
 * machine clients through their configured scopes. Denials are audited (B1.3 "Audit").
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolver,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const actor = RequestContext.actor();
    if (!actor) throw new DomainException('auth.unauthenticated');

    let held: ReadonlySet<string>;
    if (actor.type === 'user') held = (await this.resolver.forUser(actor.userId)).permissions;
    else if (actor.type === 'api_client') held = new Set(actor.scopes);
    else held = new Set();

    const missing = required.filter((p) => !held.has(p));
    if (missing.length === 0) return true;
    const req = context.switchToHttp().getRequest<Request>();
    await this.audit.recordStandalone({
      category: 'security',
      action: 'auth.permission_denied',
      outcome: 'denied',
      data: {
        missing,
        method: req.method,
        route: (req.route as { path?: string } | undefined)?.path ?? null,
      },
    });
    throw new DomainException('auth.forbidden');
  }
}
