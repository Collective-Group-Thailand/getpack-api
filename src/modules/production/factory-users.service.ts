import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
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

  async list(actor: UserActor, factoryPublicId: string): Promise<FactoryUserDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const grants = await this.prisma.userRole.findMany({
      where: { scopeType: 'factory', scopeId: factory.id, revokedAt: null },
      include: { user: true, role: true },
      orderBy: { id: 'asc' },
    });
    const byUser = new Map<bigint, FactoryUserDto>();
    for (const g of grants) {
      const dto = byUser.get(g.userId) ?? {
        id: g.user.publicId,
        email: g.user.email,
        displayName: g.user.displayName,
        roles: [],
      };
      dto.roles.push(g.role.key);
      byUser.set(g.userId, dto);
    }
    return [...byUser.values()];
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
      return { id: user.publicId, email: user.email, displayName: user.displayName, roles: input.roles };
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
