import { InvalidationBus } from '@common/cache/invalidation-bus';
import { PrismaService } from '@database/prisma.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

export interface HeldRole {
  key: string;
  scopeType: 'platform' | 'factory' | 'company';
  scopeId: bigint | null;
  validTo: Date | null;
}

export interface EffectiveAccess {
  roles: HeldRole[];
  /** Union of the permissions of every active role (scope is enforced at repository level). */
  permissions: ReadonlySet<string>;
}

export const IAM_CACHE_TOPIC = 'iam.user';
const CACHE_TTL_MS = 30_000;

/**
 * Effective roles and permissions of a user (D-140): active grants only — not revoked, inside
 * `valid_from … valid_to` (time-boxed Auditor access, `accounting-design.md` §8).
 */
@Injectable()
export class PermissionResolver implements OnModuleInit {
  private readonly cache = new Map<string, { access: EffectiveAccess; loadedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    this.bus.on(IAM_CACHE_TOPIC, (userId) => this.cache.delete(userId));
  }

  async forUser(userId: bigint, at: Date = new Date()): Promise<EffectiveAccess> {
    const key = userId.toString();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS && !expiredSince(cached.access, at)) {
      return cached.access;
    }
    const grants = await this.prisma.userRole.findMany({
      where: {
        userId,
        revokedAt: null,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const access: EffectiveAccess = {
      roles: grants.map((g) => ({
        key: g.role.key,
        scopeType: g.scopeType,
        scopeId: g.scopeId,
        validTo: g.validTo,
      })),
      permissions: new Set(grants.flatMap((g) => g.role.permissions.map((rp) => rp.permission.key))),
    };
    this.cache.set(key, { access, loadedAt: Date.now() });
    return access;
  }

  /** After a grant, revocation or deactivation (all processes). */
  async invalidate(userId: bigint): Promise<void> {
    await this.bus.publish(IAM_CACHE_TOPIC, userId.toString());
  }
}

function expiredSince(access: EffectiveAccess, at: Date): boolean {
  return access.roles.some((r) => r.validTo !== null && r.validTo.getTime() <= at.getTime());
}
