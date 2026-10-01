import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { PasswordService } from '@modules/auth/password.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { FACTORY_STAFF_ROLES, type FactoryUserDto } from './production.dto';

/**
 * The factory owner manages the factory's own users (B4.2 partner surface, D-140 factory roles): accounts
 * with staff roles scoped to the factory (never the owner role — the Partner team creates owners, D-171),
 * and deactivation by revoking the factory's roles. Audited (`iam`).
 */
@Injectable()
export class FactoryUsersService {
  private readonly passwords = new PasswordService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly audit: AuditService,
  ) {}

  /**
   * The factory's users (U-B0.3): active ones hold a factory role; a deactivated one had every role revoked and
   * shows the roles it held then.
   */
  async list(
    actor: UserActor,
    factoryPublicId: string,
    status: 'active' | 'deactivated' = 'active',
  ): Promise<FactoryUserDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const grants = await this.prisma.userRole.findMany({
      where: { scopeType: 'factory', scopeId: factory.id },
      include: { user: true, role: true },
      orderBy: { id: 'asc' },
    });
    const byUser = new Map<bigint, typeof grants>();
    for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), g]);
    const out: FactoryUserDto[] = [];
    for (const mine of byUser.values()) {
      const user = mine[0]!.user;
      const active = mine.filter((g) => g.revokedAt === null);
      if (active.length > 0 !== (status === 'active')) continue;
      const lastRevoked = Math.max(...mine.map((g) => g.revokedAt?.getTime() ?? 0));
      const held = active.length ? active : mine.filter((g) => g.revokedAt?.getTime() === lastRevoked);
      out.push(this.view(user, [...new Set(held.map((g) => g.role.key))], active.length > 0, actor));
    }
    return out;
  }

  /**
   * Sets a staff user's factory roles (U-B0.3, D-140, D-171): grants the new ones, revokes the others; a deactivated
   * user of the factory is reactivated this way. Never the owner role, never the owner, never oneself. Audited.
   */
  async setRoles(
    actor: UserActor,
    factoryPublicId: string,
    userPublicId: string,
    roles: string[],
  ): Promise<FactoryUserDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    if (roles.some((r) => !(FACTORY_STAFF_ROLES as readonly string[]).includes(r)))
      throw new DomainException('factory_users.role_not_allowed');
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new DomainException('http.not_found');
    if (user.id === actor.userId) throw new DomainException('iam.self_grant');
    const wanted = [...new Set(roles)];
    return this.prisma.withTx(async (tx) => {
      const grants = await tx.userRole.findMany({
        where: { userId: user.id, scopeType: 'factory', scopeId: factory.id },
        include: { role: true },
      });
      if (grants.length === 0) throw new DomainException('http.not_found');
      const active = grants.filter((g) => g.revokedAt === null);
      if (active.some((g) => g.role.key === 'factory_owner'))
        throw new DomainException('factory_users.role_not_allowed');
      const before = [...new Set(active.map((g) => g.role.key))].sort();
      const revoke = active.filter((g) => !wanted.includes(g.role.key));
      if (revoke.length)
        await tx.userRole.updateMany({
          where: { id: { in: revoke.map((g) => g.id) } },
          data: { revokedAt: new Date(), revokedById: actor.userId },
        });
      const add = await tx.role.findMany({
        where: { key: { in: wanted.filter((k) => !before.includes(k)) } },
      });
      for (const r of add)
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: r.id,
            scopeType: 'factory',
            scopeId: factory.id,
            grantedById: actor.userId,
            reason: `Roles set by the factory owner of ${factory.code}`,
          },
        });
      await this.audit.record(tx, {
        category: 'iam',
        action: before.length ? 'factory_user.roles_changed' : 'factory_user.reactivated',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { factoryId: factory.publicId, before, after: [...wanted].sort() },
      });
      return this.view(user, wanted, true, actor);
    });
  }

  private view(
    user: {
      publicId: string;
      email: string | null;
      displayName: string;
      lastLoginAt: Date | null;
      id: bigint;
    },
    roles: string[],
    active: boolean,
    actor: UserActor,
  ): FactoryUserDto {
    return {
      id: user.publicId,
      email: user.email,
      displayName: user.displayName,
      roles,
      status: active ? 'active' : 'deactivated',
      lastSignInAt: user.lastLoginAt ? toBangkokIso(user.lastLoginAt) : null,
      isSelf: user.id === actor.userId,
    };
  }

  async create(
    actor: UserActor,
    factoryPublicId: string,
    input: { email: string; displayName: string; initialPassword: string; roles: string[] },
  ): Promise<FactoryUserDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    if (input.roles.some((r) => !(FACTORY_STAFF_ROLES as readonly string[]).includes(r)))
      throw new DomainException('factory_users.role_not_allowed');
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findFirst({ where: { kind: 'partner', email, anonymisedAt: null } }))
      throw new DomainException('iam.user_exists');
    const roles = await this.prisma.role.findMany({ where: { key: { in: input.roles } } });
    const hash = await this.passwords.hash(input.initialPassword);
    return this.prisma.withTx(async (tx) => {
      const user = await tx.user.create({
        data: {
          kind: 'partner',
          status: 'active',
          email,
          displayName: input.displayName,
          passwordHash: hash,
          roles: {
            create: roles.map((r) => ({
              roleId: r.id,
              scopeType: 'factory' as const,
              scopeId: factory.id,
              grantedById: actor.userId,
              reason: `Added by the factory owner of ${factory.code}`,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        category: 'iam',
        action: 'factory_user.created',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { factoryId: factory.publicId, roles: input.roles },
      });
      return this.view(user, input.roles, true, actor);
    });
  }

  async deactivate(actor: UserActor, factoryPublicId: string, userPublicId: string): Promise<void> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw new DomainException('http.not_found');
    if (user.id === actor.userId) throw new DomainException('iam.self_grant');
    await this.prisma.withTx(async (tx) => {
      const grants = await tx.userRole.findMany({
        where: { userId: user.id, scopeType: 'factory', scopeId: factory.id, revokedAt: null },
        include: { role: true },
      });
      if (grants.length === 0) throw new DomainException('http.not_found');
      if (grants.some((g) => g.role.key === 'factory_owner'))
        throw new DomainException('factory_users.role_not_allowed');
      await tx.userRole.updateMany({
        where: { id: { in: grants.map((g) => g.id) } },
        data: { revokedAt: new Date(), revokedById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'iam',
        action: 'factory_user.deactivated',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { factoryId: factory.publicId },
      });
    });
  }
}
