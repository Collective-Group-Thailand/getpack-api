import { type Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { PERMISSIONS } from '../../src/modules/iam/permissions.catalog';
import { ROLES } from '../../src/modules/iam/roles.catalog';
import { settingValueError } from '../../src/platform/settings/setting-value';
import { APPROVAL_POLICIES } from './data/approval-policies';
import { PRODUCT_TYPES } from './data/catalog';
import {
  ORDER_CANCEL_REASONS,
  PAYMENT_FEATURE_FLAGS,
  PAYMENT_SCHEDULE_TEMPLATES,
  REFERRAL_PROMOTION,
} from './data/commerce';
import { ALL_DIMENSIONS, CHART_OF_ACCOUNTS, VENDOR_WHT_RATES } from './data/finance-accounts';
import {
  FULFILMENT_FEATURE_FLAGS,
  MILESTONE_ROUTE_FAMILIES,
  MILESTONE_ROUTE_FAMILY_BY_TYPE,
} from './data/fulfilment';
import { NOTIFICATION_ROUTES, NOTIFICATION_TEMPLATES } from './data/notifications';
import { AGREEMENT_TEMPLATES } from './data/partners';
import { CUSTOMER_POSTING_RULES } from './data/posting-rules-customer';
import { VENDOR_POSTING_RULES } from './data/posting-rules-vendor';
import { UNMET_DEMAND_REASONS } from './data/quotes';
import { CREDIT_NOTE_REASONS, FINANCE_FEATURE_FLAGS } from './data/receivables';
import { CONSENT_PURPOSES, NATIONAL_CALENDAR, SOD_RULES, TAX_RATES, TEAMS } from './data/reference';
import { ENTITY_SETTING_KEYS, SETTINGS, type SettingSeed } from './data/settings';
import { CARRIERS, CUSTOMER_SHIPPING_RATE_CARDS, ZONE_SCHEMES } from './data/shipping';

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
  addressTh?: string;
  phone?: string;
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
      await ensureNotifications(tx, count);
      await ensureProductTypes(tx, count);
      await ensureAgreementTemplates(tx, count);
      await ensureTaxRates(tx, count);
      await ensureShipping(tx, count);
      await ensureUnmetDemandReasons(tx, count);
      await ensureOrderCancelReasons(tx, count);
      await ensurePaymentScheduleTemplates(tx, count);
      await ensurePaymentFeatureFlags(tx, count);
      await ensureMilestoneRoutes(tx, count);
      await ensureReferralPromotion(tx, count);
      await ensureLedger(tx, entityId, count);

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
    ['addressTh', input.addressTh],
    ['phone', input.phone],
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
  if (!seed.unset) assertSettingValue(seed);
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
      versions: seed.unset
        ? undefined
        : {
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

/** Platform notification templates (published) and routes; existing ones are never changed. */
async function ensureNotifications(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const seed of NOTIFICATION_TEMPLATES) {
    const existing = await tx.notificationTemplate.findUnique({
      where: { key_channel: { key: seed.key, channel: seed.channel } },
    });
    if (existing) continue;
    await tx.notificationTemplate.create({
      data: {
        key: seed.key,
        channel: seed.channel,
        category: seed.category,
        description: seed.description,
        versions: {
          create: (['th', 'en'] as const).map((locale) => ({
            versionNo: 1,
            locale,
            subject: seed.versions[locale].subject ?? null,
            body: seed.versions[locale].body,
            status: 'published' as const,
            publishedAt: new Date(),
          })),
        },
      },
    });
    count('notification_templates');
  }
  for (const seed of NOTIFICATION_ROUTES) {
    const template = await tx.notificationTemplate.findUniqueOrThrow({
      where: { key_channel: { key: seed.templateKey, channel: seed.channel } },
    });
    const team = seed.staffTeamCode
      ? await tx.team.findUniqueOrThrow({ where: { code: seed.staffTeamCode } })
      : null;
    const exists = await tx.notificationRoute.count({
      where: {
        eventType: seed.eventType,
        audience: seed.audience,
        staffTeamId: team?.id ?? null,
        channel: seed.channel,
      },
    });
    if (exists) continue;
    await tx.notificationRoute.create({
      data: {
        eventType: seed.eventType,
        audience: seed.audience,
        staffTeamId: team?.id ?? null,
        channel: seed.channel,
        templateId: template.id,
        isCritical: seed.isCritical ?? false,
      },
    });
    count('notification_routes');
  }
}

/** D-100 product types, one reporting category each; existing rows are left to the admins. */
async function ensureProductTypes(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const [index, type] of PRODUCT_TYPES.entries()) {
    if (await tx.productType.findUnique({ where: { code: type.code } })) continue;
    const category =
      (await tx.productCategory.findUnique({ where: { code: type.code } })) ??
      (await tx.productCategory.create({
        data: {
          code: type.code,
          nameTh: type.nameTh,
          nameEn: type.nameEn,
          sort: (index + 1) * 10,
          status: 'active',
        },
      }));
    await tx.productType.create({
      data: {
        code: type.code,
        categoryId: category.id,
        nameTh: type.nameTh,
        nameEn: type.nameEn,
        quoteMode: 'rfq',
        calculatorKey: type.calculatorKey,
        isFoodContactDefault: type.isFoodContactDefault ?? false,
        sort: (index + 1) * 10,
        status: 'active',
      },
    });
    count('product_types');
  }
}

async function ensureAgreementTemplates(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const template of AGREEMENT_TEMPLATES) {
    if (await tx.agreementTemplate.findUnique({ where: { key: template.key } })) continue;
    await tx.agreementTemplate.create({ data: { ...template } });
    count('agreement_templates');
  }
}

async function ensureTaxRates(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const rate of [...TAX_RATES, ...VENDOR_WHT_RATES]) {
    if (await tx.taxRate.findUnique({ where: { code: rate.code } })) continue;
    await tx.taxRate.create({
      data: {
        code: rate.code,
        nameTh: rate.nameTh,
        nameEn: rate.nameEn,
        description: rate.description,
        decisionRefs: [...rate.decisions],
        versions: {
          create: {
            versionNo: 1,
            effectiveFrom: SEED_EFFECTIVE_FROM,
            status: 'approved',
            ratePct: rate.ratePct,
            reason: `Seed default from ${rate.decisions.join(', ')} (accounting-design.md §2)`,
            decidedAt: new Date(),
          },
        },
      },
    });
    count('tax_rates');
  }
}

/** Shipping structure (B2.4): zone scheme, customer rate-card identity, carriers (D-013, D-114). */
async function ensureShipping(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const scheme of ZONE_SCHEMES) {
    if (await tx.zoneScheme.findUnique({ where: { code: scheme.code } })) continue;
    await tx.zoneScheme.create({ data: { ...scheme } });
    count('zone_schemes');
  }
  for (const card of CUSTOMER_SHIPPING_RATE_CARDS) {
    if (await tx.customerShippingRateCard.findUnique({ where: { key: card.key } })) continue;
    await tx.customerShippingRateCard.create({
      data: { key: card.key, description: card.description, decisionRefs: [...card.decisions] },
    });
    count('customer_shipping_rate_cards');
  }
  for (const carrier of CARRIERS) {
    if (await tx.carrier.findUnique({ where: { code: carrier.code } })) continue;
    await tx.carrier.create({ data: { ...carrier, supports: [...carrier.supports] } });
    count('carriers');
  }
}

/** Reason codes for declined / expired RFQs and unmet demand (D-102). */
async function ensureUnmetDemandReasons(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const reason of UNMET_DEMAND_REASONS) {
    if (await tx.unmetDemandReason.findUnique({ where: { code: reason.code } })) continue;
    await tx.unmetDemandReason.create({ data: { ...reason } });
    count('unmet_demand_reasons');
  }
}

/** Order cancel reasons (B3.1). */
async function ensureOrderCancelReasons(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const [index, reason] of ORDER_CANCEL_REASONS.entries()) {
    if (await tx.orderCancelReason.findUnique({ where: { code: reason.code } })) continue;
    await tx.orderCancelReason.create({ data: { ...reason, sort: (index + 1) * 10 } });
    count('order_cancel_reasons');
  }
}

/**
 * Payment schedule templates of D-020 (B3.2), one approved v1 each: the version is written as a draft
 * with its instalments (frozen once decided) and then approved; the 100 % total is checked at commit.
 */
async function ensurePaymentScheduleTemplates(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const t of PAYMENT_SCHEDULE_TEMPLATES) {
    if (await tx.paymentScheduleTemplate.findUnique({ where: { key: t.key } })) continue;
    const template = await tx.paymentScheduleTemplate.create({
      data: {
        key: t.key,
        nameTh: t.nameTh,
        nameEn: t.nameEn,
        description: t.description,
        decisionRefs: t.decisions,
      },
    });
    const version = await tx.paymentScheduleTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNo: 1,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        selectionRule: t.selectionRule as Prisma.InputJsonValue,
        priority: t.priority,
        requiresPermissionToSelect: t.requiresPermissionToSelect,
        reason: `Seed default from ${t.decisions.join(', ')}`,
        instalments: {
          create: t.instalments.map((i, index) => ({
            seq: index + 1,
            labelTh: i.labelTh,
            labelEn: i.labelEn,
            pct: i.pct,
            dueTrigger: i.dueTrigger,
            dueOffsetDays: i.dueOffsetDays ?? null,
            requiredBefore: i.requiredBefore,
          })),
        },
      },
    });
    await tx.paymentScheduleTemplateVersion.update({
      where: { id: version.id },
      data: { status: 'approved', decidedAt: new Date() },
    });
    count('payment_schedule_templates');
  }
}

/**
 * Default milestone routes (D-075, B4.2): a `standard` and a `mockup` route per produced product type, one
 * approved v1 each (steps are written while the version is a draft, then it is approved). Never changed later.
 */
async function ensureMilestoneRoutes(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const [typeCode, family] of Object.entries(MILESTONE_ROUTE_FAMILY_BY_TYPE)) {
    const type = await tx.productType.findUnique({ where: { code: typeCode } });
    if (!type) continue;
    for (const variant of ['standard', 'mockup'] as const) {
      const existing = await tx.milestoneRoute.findFirst({
        where: { productTypeId: type.id, printTypeId: null, variant },
      });
      if (existing) continue;
      const steps = MILESTONE_ROUTE_FAMILIES[variant === 'mockup' ? 'mockup' : family]!;
      const route = await tx.milestoneRoute.create({
        data: { productTypeId: type.id, variant, name: `${type.nameTh} (${variant})` },
      });
      const version = await tx.milestoneRouteVersion.create({
        data: {
          routeId: route.id,
          versionNo: 1,
          effectiveFrom: SEED_EFFECTIVE_FROM,
          reason: 'B4.2 default route from the prompt example (D-075); edit as new versions',
          steps: {
            create: steps.map((s, i) => ({
              seq: i + 1,
              key: s.key,
              nameTh: s.nameTh,
              nameEn: s.nameEn,
              customerVisible: s.customerLabelTh !== undefined,
              customerLabelTh: s.customerLabelTh ?? null,
              customerLabelEn: s.customerLabelEn ?? null,
              evidence: s.evidence ?? 'none',
              tracksQuantity: s.tracksQuantity ?? false,
            })),
          },
        },
      });
      await tx.milestoneRouteVersion.update({
        where: { id: version.id },
        data: { status: 'approved', decidedAt: new Date() },
      });
      count('milestone_routes');
    }
  }
}

/** Payment provider (D-005, D-176) and fulfilment integration (B4) feature flags, off. */
async function ensurePaymentFeatureFlags(tx: Tx, count: (what: string) => void): Promise<void> {
  for (const flag of [...PAYMENT_FEATURE_FLAGS, ...FULFILMENT_FEATURE_FLAGS, ...FINANCE_FEATURE_FLAGS]) {
    if (await tx.featureFlag.findUnique({ where: { key: flag.key } })) continue;
    await tx.featureFlag.create({
      data: { key: flag.key, description: flag.description, enabled: false, ownerRoleKey: 'superadmin' },
    });
    count('feature_flags');
  }
}

/** The system promotion of the referee discount (D-136), active from the seed date. */
async function ensureReferralPromotion(tx: Tx, count: (what: string) => void): Promise<void> {
  if (await tx.promotion.findFirst({ where: { kind: 'referral' } })) return;
  const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
  await tx.promotion.create({
    data: {
      entityId: entity.id,
      name: REFERRAL_PROMOTION.name,
      description: REFERRAL_PROMOTION.description,
      kind: 'referral',
      priority: REFERRAL_PROMOTION.priority,
      stacking: REFERRAL_PROMOTION.stacking,
      startsAt: SEED_EFFECTIVE_FROM,
      conditions: REFERRAL_PROMOTION.conditions,
      benefit: REFERRAL_PROMOTION.benefit,
      usageLimitPerCustomer: REFERRAL_PROMOTION.usageLimitPerCustomer,
      status: 'active',
    },
  });
  count('promotions');
}

/**
 * Ledger reference data (B5.1): the chart of accounts of the entity (accounting-design §3) and the default
 * posting rules P01–P30 with the supplementary rules of ADR-0007, each as an approved version 1.
 */
async function ensureLedger(tx: Tx, entityId: bigint, count: (what: string) => void): Promise<void> {
  const ids = new Map<string, bigint>();
  for (const account of CHART_OF_ACCOUNTS) {
    const existing = await tx.account.findUnique({ where: { entityId_code: { entityId, code: account.code } } });
    if (existing) {
      ids.set(account.code, existing.id);
      continue;
    }
    const created = await tx.account.create({
      data: {
        entityId,
        code: account.code,
        nameTh: account.nameTh,
        nameEn: account.nameEn,
        accountType: account.type,
        normalSide: account.side,
        parentId: account.parent ? (ids.get(account.parent) ?? null) : null,
        isControl: account.control ?? false,
        isPostable: account.postable ?? true,
        allowedDimensions: [...ALL_DIMENSIONS],
        requiredDimensions: account.required ?? [],
        cashFlowClass: account.cashFlow,
      },
    });
    ids.set(account.code, created.id);
    count('accounts');
  }
  for (const rule of [...CUSTOMER_POSTING_RULES, ...VENDOR_POSTING_RULES]) {
    if (await tx.postingRule.findUnique({ where: { key: rule.key } })) continue;
    await tx.postingRule.create({
      data: {
        key: rule.key,
        eventType: rule.eventType,
        name: rule.name,
        description: rule.description,
        decisionRefs: rule.decisions,
        versions: {
          create: {
            versionNo: 1,
            effectiveFrom: SEED_EFFECTIVE_FROM,
            status: 'approved',
            conditions: (rule.conditions ?? undefined),
            template: rule.template as unknown as Prisma.InputJsonValue,
            reason: `Seed default from accounting-design.md §5 (${rule.decisions.join(', ')})`,
            decidedAt: new Date(),
          },
        },
      },
    });
    count('posting_rules');
  }
  for (const reason of CREDIT_NOTE_REASONS) {
    if (await tx.creditNoteReason.findUnique({ where: { code: reason.code } })) continue;
    await tx.creditNoteReason.create({ data: { ...reason } });
    count('credit_note_reasons');
  }
}
