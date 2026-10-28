import { InvalidationBus } from '@common/cache/invalidation-bus';
import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { settingValueError } from './setting-value';
import { SettingsService } from './settings.service';

export const SETTINGS_CACHE_TOPIC = 'settings';
/** Subject type of approval policies that govern setting changes (ADR-0005 / ADR-0006). */
export const SETTING_VERSION_SUBJECT = 'setting_version';
/** Clock-skew allowance: a version may not take effect in the past (history is never rewritten). */
const BACKDATE_TOLERANCE_MS = 60_000;

export const SETTING_INCLUDE = {
  versions: { orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }] },
} satisfies Prisma.SettingInclude;
export type SettingWithVersions = Prisma.SettingGetPayload<{ include: typeof SETTING_INCLUDE }>;

/**
 * The owner check of a setting change: the owner role named by its decision — or Superadmin, who may do what any role
 * can do, acting on its behalf (owner decision 2026-10-28, DECISIONS-STAGE-A §11.6). The change is audited as the
 * Superadmin actor. Not extended to customer files (D-444) or to approving one's own maker-checker request. Pure.
 */
export function mayActAsOwner(roles: readonly string[], ownerRoleKey: string): boolean {
  return roles.includes(ownerRoleKey) || roles.includes('superadmin');
}

/**
 * Governance of effective-dated settings (ADR-0005, D-063): only the owner role (Superadmin for
 * platform thresholds) proposes; the value is validated against the setting's type; versions never
 * take effect in the past and are never edited. When the setting names an approval policy the
 * version is `proposed` until the approval outcome arrives; otherwise it is approved at once.
 * Every change: audit (`config`) + `setting.changed` / `setting.change_proposed` event + cache
 * invalidation on every process.
 */
@Injectable()
export class SettingsAdminService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionResolver,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    this.bus.on(SETTINGS_CACHE_TOPIC, (key) => this.settings.invalidate(key));
  }

  list(): Promise<SettingWithVersions[]> {
    return this.prisma.setting.findMany({
      include: SETTING_INCLUDE,
      orderBy: [{ key: 'asc' }, { scopeId: 'asc' }],
    });
  }

  async get(publicId: string): Promise<SettingWithVersions> {
    const setting = await this.prisma.setting.findUnique({ where: { publicId }, include: SETTING_INCLUDE });
    if (!setting) throw new DomainException('http.not_found');
    return setting;
  }

  /**
   * A platform setting changed from a dedicated back-office editor whose endpoint already checked the permission its
   * decision names (e.g. `styles.curate` for `storefront.style_library`, D-246, D-448) — validated, versioned, audited,
   * evented and invalidated exactly like {@link proposeChange}; only the owner-role check is the endpoint's.
   */
  async changeFromEditor(
    actor: UserActor,
    key: string,
    input: { value: unknown; effectiveFrom: Date; reason: string },
  ): Promise<SettingWithVersions> {
    const setting = await this.prisma.setting.findFirst({
      where: { key, scopeType: 'platform', scopeId: null },
      select: { publicId: true },
    });
    if (!setting) throw new DomainException('http.not_found');
    return this.proposeChange(actor, setting.publicId, input, { ownerChecked: true });
  }

  async proposeChange(
    actor: UserActor,
    publicId: string,
    input: { value: unknown; effectiveFrom: Date; reason: string },
    options: { ownerChecked?: boolean } = {},
  ): Promise<SettingWithVersions> {
    const setting = await this.get(publicId);
    const roles = options.ownerChecked
      ? []
      : (await this.permissions.forUser(actor.userId)).roles.map((r) => r.key);
    if (!options.ownerChecked && !mayActAsOwner(roles, setting.ownerRoleKey)) {
      throw new DomainException('settings.not_owner', { params: { role: setting.ownerRoleKey } });
    }
    const invalid = settingValueError(
      setting.valueType,
      input.value,
      setting.valueSchema as Record<string, unknown> | null,
    );
    if (invalid) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'value', code: 'settingValue', message: invalid }],
      });
    }
    if (input.effectiveFrom.getTime() < Date.now() - BACKDATE_TOLERANCE_MS) {
      throw new DomainException('settings.backdated');
    }

    const needsApproval = setting.approvalPolicyKey !== null;
    await this.prisma.withTx(async (tx) => {
      if (
        needsApproval &&
        (await tx.settingVersion.count({ where: { settingId: setting.id, status: 'proposed' } })) > 0
      ) {
        throw new DomainException('settings.pending_exists');
      }
      const last = await tx.settingVersion.findFirst({
        where: { settingId: setting.id },
        orderBy: { versionNo: 'desc' },
      });
      const current = await this.settings.at(setting.key, { tx, ...this.scopeOf(setting) }).catch(() => null);
      const version = await tx.settingVersion.create({
        data: {
          settingId: setting.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          status: needsApproval ? 'proposed' : 'approved',
          value: input.value as Prisma.InputJsonValue,
          reason: input.reason,
          createdById: actor.userId,
          ...(!needsApproval && { decidedAt: new Date(), decidedById: actor.userId }),
        },
      });
      const change = {
        key: setting.key,
        versionNo: version.versionNo,
        effectiveFrom: input.effectiveFrom.toISOString(),
        before: setting.isSensitive ? '[sensitive]' : (current?.value ?? null),
        after: setting.isSensitive ? '[sensitive]' : input.value,
        reason: input.reason,
      };

      if (needsApproval) {
        const request = await this.approvals.create(tx, {
          policyKey: setting.approvalPolicyKey!,
          subject: { type: SETTING_VERSION_SUBJECT, id: version.id, publicId: setting.publicId },
          requester: actor,
          payload: change,
        });
        await tx.settingVersion.update({
          where: { id: version.id },
          data: { approvalRequestId: request.id },
        });
      }
      await this.audit.record(tx, {
        category: 'config',
        action: needsApproval ? 'setting.change_proposed' : 'setting.changed',
        resourceType: 'setting',
        resourcePublicId: setting.publicId,
        data: change,
      });
      await this.events.record(tx, {
        type: needsApproval ? 'setting.change_proposed' : 'setting.changed',
        aggregateType: 'setting',
        aggregateId: setting.publicId,
        payload: { key: setting.key, versionNo: version.versionNo, effectiveFrom: change.effectiveFrom },
      });
    });
    await this.bus.publish(SETTINGS_CACHE_TOPIC, setting.key);
    return this.get(publicId);
  }

  /** Applies the outcome of a setting-change approval to the proposed version. */
  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'settings.apply-approval',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['subjectType'] !== SETTING_VERSION_SUBJECT) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const version = await tx.settingVersion.findUnique({
      where: { id: request.subjectId },
      include: { setting: true },
    });
    if (!version || version.status !== 'proposed') return;
    const status =
      event.type === 'approval.approved'
        ? 'approved'
        : event.type === 'approval.rejected'
          ? 'rejected'
          : 'withdrawn';
    await tx.settingVersion.update({ where: { id: version.id }, data: { status, decidedAt: new Date() } });
    await this.audit.record(tx, {
      category: 'config',
      action: status === 'approved' ? 'setting.changed' : 'setting.change_dropped',
      resourceType: 'setting',
      resourcePublicId: version.setting.publicId,
      data: { key: version.setting.key, versionNo: version.versionNo, outcome: event.type },
    });
    if (status === 'approved') {
      await this.events.record(tx, {
        type: 'setting.changed',
        aggregateType: 'setting',
        aggregateId: version.setting.publicId,
        payload: {
          key: version.setting.key,
          versionNo: version.versionNo,
          effectiveFrom: version.effectiveFrom.toISOString(),
        },
      });
    }
    await this.bus.publish(SETTINGS_CACHE_TOPIC, version.setting.key);
  }

  private scopeOf(setting: { scopeType: string; scopeId: bigint | null }) {
    return setting.scopeType === 'platform' || setting.scopeId === null
      ? {}
      : { scope: { type: setting.scopeType as 'entity' | 'product_type', id: setting.scopeId } };
  }
}
