import { type Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { PERMISSIONS } from '../../src/modules/iam/permissions.catalog';
import { ROLES } from '../../src/modules/iam/roles.catalog';
import { settingValueError } from '../../src/platform/settings/setting-value';
import { APPROVAL_POLICIES } from './data/approval-policies';
import { CONSENT_PURPOSES, NATIONAL_CALENDAR, SOD_RULES, TEAMS } from './data/reference';
import { ENTITY_SETTING_KEYS, SETTINGS, type SettingSeed } from './data/settings';

type Tx = Prisma.TransactionClient;

/** Seeded versions apply from this instant, before any business activity (ADR-0005). */
export const SEED_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface EntitySeedInput {
  code: string;
  displayName: string;
  legalNameTh?: string;
  legalNameEn?: string;
  taxId?: string;
  branchCode?: string;
}

export type SeedReport = Record<string, number>;

/** Rejects a seed whose value does not match its declared type (fails the whole transaction). */
export function assertSettingValue(
  seed: Pick<SettingSeed, 'key' | 'valueType' | 'value' | 'valueSchema'>,
): void {
  const error = settingValueError(seed.valueType, seed.value, seed.valueSchema);
  if (error)
    throw new Error(
      `setting ${seed.key}: value ${JSON.stringify(seed.value)} is not a valid ${seed.valueType} (${error})`,
    );
}

/**
 * `pnpm db:seed` — reference and configuration data for every environment (B1.2 step 3).
 * Idempotent: it creates what is missing and never changes what exists (admins own the data after
 * the first run), except the permission catalogue, which the code owns.
 */
export async function seedReference(prisma: PrismaClient, entity: EntitySeedInput): Promise<SeedReport> {
  return prisma.$transaction(
    async (tx) => {
      const report: SeedReport = {};
      const count = (what: string, n = 1) => (report[what] = (report[what] ?? 0) + n);

      const entityId = await ensureEntity(tx, entity, count);
      await ensureEntitySettings(tx, entityId, entity, count);
      await ensurePermissionsAndRoles(tx, count);
      await ensureSodRules(tx, count);
      for (const seed of SETTINGS) await ensureSetting(tx, seed, 'platform', null, count);
      await ensureApprovalPolicies(tx, count);
      await ensureTeamsConsentCalendar(tx, count);

      if (Object.keys(report).length > 0) {
        await tx.auditLog.create({
          data: {
            entityId,
            actorType: 'system',
            category: 'config',
            action: 'seed.reference_applied',
            outcome: 'success',
            data: { created: report },
          },
        });
      }
      return report;
    },
    { timeout: 60_000 },
  );
}

async function ensureEntity(tx: Tx, input: EntitySeedInput, count: (what: string) => void): Promise<bigint> {
  const existing = await tx.entity.findUnique({ where: { code: input.code } });
  if (existing) return existing.id;
  const hasDefault = (await tx.entity.count({ where: { isDefault: true } })) > 0;
  const created = await tx.entity.create({
    data: { code: input.code, displayName: input.displayName, isDefault: !hasDefault },
  });
  count('entities');
  return created.id;
}

async function ensureEntitySettings(
  tx: Tx,
  entityId: bigint,
  input: EntitySeedInput,
  count: (what: string) => void,
): Promise<void> {
  const values: [keyof typeof ENTITY_SETTING_KEYS, string | undefined][] = [
    ['legalNameTh', input.legalNameTh],
    ['legalNameEn', input.legalNameEn],
    ['taxId', input.taxId],
    ['branchCode', input.branchCode],
  ];
  for (const [field, value] of values) {
    if (value === undefined || value === '') continue;
    const { key, description } = ENTITY_SETTING_KEYS[field];
    await ensureSetting(
      tx,
      { key, valueType: 'string', value, description, decisions: ['D-092'] },
      'entity',
      entityId,
      count,
    );
  }
}

async function ensureSetting(
  tx: Tx,
  seed: SettingSeed,
  scopeType: 'platform' | 'entity',
  scopeId: bigint | null,
  count: (what: string) => void,
): Promise<void> {
  assertSettingValue(seed);
  const existing = await tx.setting.findFirst({ where: { key: seed.key, scopeType, scopeId } });
  if (existing) return;
  await tx.setting.create({
    data: {
      key: seed.key,
      scopeType,
      scopeId,
      valueType: seed.valueType,
      valueSchema: (seed.valueSchema ?? undefined) as Prisma.InputJsonValue | undefined,
      description: seed.description,
      decisionRefs: seed.decisions,
      ownerRoleKey: seed.ownerRole ?? 'superadmin',
      confirmationStatus: seed.confirmation ?? 'confirmed',
      versions: {
        create: {
          versionNo: 1,
          effectiveFrom: SEED_EFFECTIVE_FROM,
          status: 'approved',
          value: seed.value as Prisma.InputJsonValue,
          reason: `Seed default from ${seed.decisions.join(', ')}`,
          decidedAt: new Date(),
        },
      },
    },
  });
  count('settings');
}

async function ensurePermissionsAndRoles(tx: Tx, count: (what: string, n?: number) => void): Promise<void> {
  for (const permission of PERMISSIONS) {
    const data = {
      audience: permission.audience,
      description: permission.description,
      isSensitive: 'sensitive' in permission ? permission.sensitive : false,
      decisionRefs: 'decisionRefs' in permission ? [...permission.decisionRefs] : [],
    };
    const existing = await tx.permission.findUnique({ where: { key: permission.key } });
    if (existing) {
      const changed =
        existing.audience !== data.audience ||
        existing.description !== data.description ||
        existing.isSensitive !== data.isSensitive ||
        existing.decisionRefs.join(',') !== data.decisionRefs.join(',');
      if (changed) {
        await tx.permission.update({ where: { key: permission.key }, data });
        count('permissions_updated');
      }
    } else {
      await tx.permission.create({ data: { key: permission.key, ...data } });
      count('permissions');
    }
  }

  const permissionIds = new Map(
    (await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );
  for (const role of ROLES) {
    let roleRow = await tx.role.findUnique({ where: { key: role.key } });
    if (!roleRow) {
      roleRow = await tx.role.create({
        data: {
          key: role.key,
          audience: role.audience,
          scopeType: role.scopeType,
          nameTh: role.nameTh,
          nameEn: role.nameEn,
          isSystem: true,
        },
      });
      count('roles');
    }
    const grants = await tx.rolePermission.createMany({
      data: role.permissions.map((key) => {
        const permissionId = permissionIds.get(key);
        if (permissionId === undefined) throw new Error(`role ${role.key}: unknown permission ${key}`);
        return { roleId: roleRow.id, permissionId };
      }),
      skipDuplicates: true,
    });
    if (grants.count > 0) count('role_permissions', grants.count);
  }
}

async function ensureSodRules(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const rule of SOD_RULES) {
    if (await tx.sodRule.findUnique({ where: { key: rule.key } })) continue;
    const roleId = async (key: string) => (await tx.role.findUniqueOrThrow({ where: { key } })).id;
    await tx.sodRule.create({
      data: {
        key: rule.key,
        kind: rule.kind,
        description: rule.description,
        decisionRefs: rule.decisions,
        roleAId: rule.roles ? await roleId(rule.roles[0]) : null,
        roleBId: rule.roles ? await roleId(rule.roles[1]) : null,
        actionA: rule.actions?.[0] ?? null,
        actionB: rule.actions?.[1] ?? null,
        subjectMatch: rule.subjectMatch ?? null,
      },
    });
    count('sod_rules');
  }
}

async function ensureApprovalPolicies(tx: Tx, count: (what: string) => void): Promise<void> {
  const roleIds = new Map(
    (await tx.role.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id]),
  );
  for (const policy of APPROVAL_POLICIES) {
    if (await tx.approvalPolicy.findUnique({ where: { key: policy.key } })) continue;
    const created = await tx.approvalPolicy.create({
      data: {
        key: policy.key,
        subjectType: policy.subjectType,
        description: policy.description,
        decisionRefs: policy.decisions,
      },
    });
    // Steps are added while the version is a draft; approving it freezes them (trigger).
    const version = await tx.approvalPolicyVersion.create({
      data: {
        policyId: created.id,
        versionNo: 1,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        reason: policy.reason,
        expiryRule: policy.expiryRule ?? undefined,
      },
    });
    await tx.approvalStep.createMany({
      data: policy.steps.map((step, index) => {
        const approverRoleId = roleIds.get(step.role);
        if (approverRoleId === undefined) throw new Error(`policy ${policy.key}: unknown role ${step.role}`);
        return {
          policyVersionId: version.id,
          stepNo: index + 1,
          name: step.name,
          approverRoleId,
          approverScope: step.scope ?? 'platform',
          condition: step.condition ?? undefined,
        };
      }),
    });
    await tx.approvalPolicyVersion.update({
      where: { id: version.id },
      data: { status: 'approved', decidedAt: new Date() },
    });
    count('approval_policies');
  }
}

async function ensureTeamsConsentCalendar(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const team of TEAMS) {
    if (await tx.team.findUnique({ where: { code: team.code } })) continue;
    await tx.team.create({ data: { ...team } });
    count('teams');
  }
  for (const purpose of CONSENT_PURPOSES) {
    if (await tx.consentPurpose.findUnique({ where: { key: purpose.key } })) continue;
    await tx.consentPurpose.create({ data: { ...purpose } });
    count('consent_purposes');
  }
  if (!(await tx.businessCalendar.findUnique({ where: { code: NATIONAL_CALENDAR.code } }))) {
    await tx.businessCalendar.create({
      data: {
        code: NATIONAL_CALENDAR.code,
        name: NATIONAL_CALENDAR.name,
        kind: 'national',
        weekendDays: [...NATIONAL_CALENDAR.weekendDays],
      },
    });
    count('business_calendars');
  }
}
