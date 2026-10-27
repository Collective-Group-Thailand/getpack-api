import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toSkipTake } from '@common/pagination/pagination';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type UserKind, type UserStatus } from '@generated/prisma/client';
import { PasswordService } from '@modules/auth/password.service';
import { SessionService } from '@modules/auth/sessions/session.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { PermissionResolver } from '../permission-resolver.service';
import { CUSTOMER_FILE_READ } from '../roles.catalog';
import { ScopeDirectory, type ScopedType } from '../scope-directory';
import { SodService } from '../sod.service';

const USER_INCLUDE = {
  roles: { where: { revokedAt: null }, include: { role: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.UserInclude;
export type UserWithRoles = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/**
 * Staff and partner account administration and role grants (D-140). Rules:
 * - nobody grants or revokes their own roles (maker-checker);
 * - a granter only grants staff roles whose permissions they hold themselves (no privilege
 *   escalation); partner and company roles carry audience-specific permissions staff never hold;
 * - role pairs from `sod_rules` are enforced (e.g. Auditor never with Finance, D-168);
 * - deactivation ends every session at once.
 * Every change: one transaction, audit row (`iam`), domain event; permission caches invalidated.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly resolver: PermissionResolver,
    private readonly scopes: ScopeDirectory,
    private readonly sod: SodService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(filter: { kind?: UserKind; status?: UserStatus; q?: string; page: number; perPage: number }) {
    const where: Prisma.UserWhereInput = {
      anonymisedAt: null,
      ...(filter.kind && { kind: filter.kind }),
      ...(filter.status && { status: filter.status }),
      ...(filter.q && {
        OR: [
          { email: { contains: filter.q, mode: 'insensitive' } },
          { displayName: { contains: filter.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(filter),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total };
  }

  async get(publicId: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findFirst({
      where: { publicId, anonymisedAt: null },
      include: USER_INCLUDE,
    });
    if (!user) throw new DomainException('http.not_found');
    return user;
  }

  async create(
    actor: UserActor,
    input: { kind: 'staff' | 'partner'; email: string; displayName: string; initialPassword: string },
  ): Promise<UserWithRoles> {
    const email = input.email.trim();
    const passwordHash = await this.passwords.hash(input.initialPassword);
    return this.prisma.withTx(async (tx) => {
      if (await tx.user.count({ where: { kind: input.kind, email, anonymisedAt: null } })) {
        throw new DomainException('iam.user_exists');
      }
      const user = await tx.user.create({
        data: {
          kind: input.kind,
          status: 'active',
          email,
          displayName: input.displayName,
          passwordHash,
          passwordChangedAt: new Date(),
          createdById: actor.userId,
          updatedById: actor.userId,
          ...(input.kind === 'staff' && { staffProfile: { create: {} } }),
        },
        include: USER_INCLUDE,
      });
      await this.audit.record(tx, {
        category: 'iam',
        action: 'iam.user_created',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { kind: input.kind },
      });
      await this.events.record(tx, {
        type: 'user.created',
        aggregateType: 'user',
        aggregateId: user.publicId,
        payload: { userId: user.publicId, kind: input.kind },
      });
      return user;
    });
  }

  async setStatus(
    actor: UserActor,
    publicId: string,
    status: 'active' | 'inactive',
    reason: string,
  ): Promise<UserWithRoles> {
    const target = await this.get(publicId);
    if (target.id === actor.userId) throw new DomainException('iam.self_grant');
    let revokedFamilies: string[] = [];
    const updated = await this.prisma.withTx(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: { status, updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: USER_INCLUDE,
      });
      if (status === 'inactive')
        revokedFamilies = await this.sessions.revokeAllForUser(tx, target.id, 'user_suspended');
      await this.audit.record(tx, {
        category: 'iam',
        action: status === 'inactive' ? 'iam.user_deactivated' : 'iam.user_reactivated',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { before: target.status, after: status, reason },
      });
      await this.events.record(tx, {
        type: status === 'inactive' ? 'user.deactivated' : 'user.reactivated',
        aggregateType: 'user',
        aggregateId: user.publicId,
        payload: { userId: user.publicId, reason },
      });
      return user;
    });
    await this.sessions.markRevoked(revokedFamilies);
    await this.resolver.invalidate(target.id);
    return updated;
  }

  async revokeSessions(actor: UserActor, publicId: string): Promise<void> {
    const target = await this.get(publicId);
    const families = await this.prisma.withTx(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(tx, target.id, 'admin');
      await this.audit.record(tx, {
        category: 'security',
        action: 'iam.sessions_revoked',
        resourceType: 'user',
        resourcePublicId: target.publicId,
        data: { sessions: revoked.length, by: actor.publicId },
      });
      return revoked;
    });
    await this.sessions.markRevoked(families);
  }

  async grantRole(
    actor: UserActor,
    publicId: string,
    input: { roleKey: string; scope?: { type: ScopedType; id: string }; validTo?: Date; reason: string },
  ): Promise<UserWithRoles> {
    const target = await this.get(publicId);
    if (target.id === actor.userId) throw new DomainException('iam.self_grant');
    const role = await this.prisma.role.findUnique({
      where: { key: input.roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new DomainException('http.not_found');
    const scopeType = input.scope?.type ?? 'platform';
    if (role.scopeType !== scopeType || role.audience !== target.kind) {
      throw new DomainException('iam.role_scope_mismatch', { params: { scopeType: role.scopeType } });
    }
    let scopeId: bigint | null = null;
    if (input.scope) {
      scopeId =
        (await this.scopes.internalIds(input.scope.type, [input.scope.id])).get(input.scope.id) ?? null;
      if (scopeId === null) throw new DomainException('http.not_found');
    }
    if (role.audience === 'staff')
      await this.assertNoEscalation(
        actor,
        role.permissions.map((rp) => rp.permission.key),
      );

    await this.prisma.withTx(async (tx) => {
      const sod = await this.sod.checkRoleGrant(tx, target.id, role.id);
      let grant;
      try {
        grant = await tx.userRole.create({
          data: {
            userId: target.id,
            roleId: role.id,
            scopeType,
            scopeId,
            validTo: input.validTo ?? null,
            grantedById: actor.userId,
            reason: input.reason,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('http.conflict');
        }
        throw error;
      }
      await this.audit.record(tx, {
        category: 'iam',
        action: 'iam.role_granted',
        resourceType: 'user',
        resourcePublicId: target.publicId,
        data: {
          role: role.key,
          scope: input.scope ?? null,
          validTo: input.validTo ?? null,
          reason: input.reason,
          sodWarnings: sod.warnings,
        },
      });
      await this.events.record(tx, {
        type: 'iam.role_granted',
        aggregateType: 'user',
        aggregateId: target.publicId,
        payload: {
          userId: target.publicId,
          grantId: grant.publicId,
          role: role.key,
          scope: input.scope ?? null,
        },
      });
    });
    await this.resolver.invalidate(target.id);
    return this.get(publicId);
  }

  async revokeRole(
    actor: UserActor,
    publicId: string,
    grantPublicId: string,
    reason: string,
  ): Promise<UserWithRoles> {
    const target = await this.get(publicId);
    if (target.id === actor.userId) throw new DomainException('iam.self_grant');
    const grant = await this.prisma.userRole.findFirst({
      where: { publicId: grantPublicId, userId: target.id, revokedAt: null },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!grant) throw new DomainException('http.not_found');
    if (grant.role.audience === 'staff') {
      await this.assertNoEscalation(
        actor,
        grant.role.permissions.map((rp) => rp.permission.key),
      );
    }
    await this.prisma.withTx(async (tx: Tx) => {
      await tx.userRole.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revokedById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'iam',
        action: 'iam.role_revoked',
        resourceType: 'user',
        resourcePublicId: target.publicId,
        data: { role: grant.role.key, grantId: grant.publicId, reason },
      });
      await this.events.record(tx, {
        type: 'iam.role_revoked',
        aggregateType: 'user',
        aggregateId: target.publicId,
        payload: { userId: target.publicId, grantId: grant.publicId, role: grant.role.key },
      });
    });
    await this.resolver.invalidate(target.id);
    return this.get(publicId);
  }

  async roles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ audience: 'asc' }, { key: 'asc' }],
    });
  }

  /**
   * The actor must hold every permission of the role. D-444 withholds customer-file reads from Superadmin (and
   * Admin) on purpose, not as a privilege ceiling, so they do not count here: otherwise no one could grant CS,
   * CS Lead or Prepress. The grant itself is audited and SoD-checked; it gives the actor no file access.
   */
  private async assertNoEscalation(actor: UserActor, rolePermissions: string[]): Promise<void> {
    const held = (await this.resolver.forUser(actor.userId)).permissions;
    const counted = rolePermissions.filter((p) => !(CUSTOMER_FILE_READ as readonly string[]).includes(p));
    if (counted.some((p) => !held.has(p))) throw new DomainException('iam.role_escalation');
  }
}
