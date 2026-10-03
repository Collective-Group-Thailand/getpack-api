import { InvalidationBus } from '@common/cache/invalidation-bus';
import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { nameUuid } from '@common/ids/uuidv7';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type FeatureFlagRules, FeatureFlagsService } from './feature-flags.service';

export const FLAGS_CACHE_TOPIC = 'feature_flags';

/** Operational toggles: audited, no versions (schema-design §3.1); business values are settings. */
@Injectable()
export class FeatureFlagsAdminService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly bus: InvalidationBus,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.bus.on(FLAGS_CACHE_TOPIC, () => this.flags.invalidate());
  }

  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async upsert(
    actor: UserActor,
    key: string,
    input: { enabled: boolean; description?: string; rules?: FeatureFlagRules },
  ) {
    const flag = await this.prisma.withTx(async (tx) => {
      const before = await tx.featureFlag.findUnique({ where: { key } });
      // D-296: a development aid is never switched on in production.
      if (before?.devOnly && input.enabled && this.config.isProduction)
        throw new DomainException('feature_flags.dev_only', { params: { key } });
      const rules = (input.rules ?? before?.rules ?? {}) as Prisma.InputJsonValue;
      const saved = before
        ? await tx.featureFlag.update({
            where: { key },
            data: {
              enabled: input.enabled,
              rules,
              ...(input.description && { description: input.description }),
              updatedById: actor.userId,
              rowVersion: { increment: 1 },
            },
          })
        : await tx.featureFlag.create({
            data: {
              key,
              enabled: input.enabled,
              rules,
              description: input.description ?? key,
              ownerRoleKey: 'superadmin',
              createdById: actor.userId,
              updatedById: actor.userId,
            },
          });
      await this.audit.record(tx, {
        category: 'config',
        action: 'feature_flag.changed',
        resourceType: 'feature_flag',
        resourcePublicId: nameUuid(`feature_flag:${key}`),
        data: {
          key,
          before: before ? { enabled: before.enabled, rules: before.rules } : null,
          after: { enabled: saved.enabled, rules: saved.rules },
        },
      });
      await this.events.record(tx, {
        type: 'feature_flag.changed',
        aggregateType: 'feature_flag',
        aggregateId: nameUuid(`feature_flag:${key}`),
        payload: { key, enabled: saved.enabled },
      });
      return saved;
    });
    await this.bus.publish(FLAGS_CACHE_TOPIC, key);
    return flag;
  }
}
