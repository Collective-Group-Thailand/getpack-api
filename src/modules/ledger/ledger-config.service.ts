import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type AccountChangeKind,
  type AccountType,
  type ApprovalRequest,
  type CashFlowClass,
  type LedgerDimension,
  type LedgerSide,
  Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';

import { PostingEngine } from './posting/posting-engine.service';
import { accountCodesOf, type PostingTemplate, ruleApplies, validateTemplate } from './posting/template';

export interface AccountFields {
  code?: string;
  nameTh?: string;
  nameEn?: string;
  accountType?: AccountType;
  normalSide?: LedgerSide;
  parentCode?: string | null;
  isControl?: boolean;
  isPostable?: boolean;
  allowedDimensions?: LedgerDimension[];
  requiredDimensions?: LedgerDimension[];
  cashFlowClass?: CashFlowClass;
}

export interface AccountChangeInput {
  kind: AccountChangeKind;
  accountCode?: string;
  fields?: AccountFields;
  reason: string;
}

export interface RuleVersionInput {
  effectiveFrom: Date;
  conditions: unknown;
  template: unknown;
  reason: string;
}

/**
 * Configuration of the ledger under maker-checker (accounting-design §8, D-169): chart-of-accounts changes
 * (`coa_change`), posting-rule versions (`posting_rule_change`) and tax-rate versions (`tax_setting_change`).
 * Each proposal waits for its approval; the approval subscriber applies it in one transaction with the
 * audit row and a domain event. Nothing here edits a posted journal.
 */
@Injectable()
export class LedgerConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly engine: PostingEngine,
  ) {}

  // --- chart of accounts ---------------------------------------------------------------------------------

  async accounts() {
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.account.findMany({
      where: { entityId },
      include: { parent: { select: { code: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async accountChanges(status?: 'proposed' | 'approved' | 'rejected' | 'withdrawn') {
    return this.prisma.accountChange.findMany({
      where: status ? { status } : {},
      include: { account: { select: { code: true } }, approvalRequest: { select: { publicId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async proposeAccountChange(actor: UserActor, input: AccountChangeInput) {
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      const account =
        input.kind === 'create'
          ? null
          : await tx.account.findUnique({
              where: { entityId_code: { entityId, code: input.accountCode ?? '' } },
            });
      if (input.kind !== 'create' && !account) throw new DomainException('http.not_found');
      const fields = input.fields ?? {};
      if (input.kind === 'create') {
        const missing = (
          ['code', 'nameTh', 'nameEn', 'accountType', 'normalSide', 'cashFlowClass'] as const
        ).filter((k) => fields[k] === undefined);
        if (missing.length > 0)
          throw new DomainException('validation.failed', {
            errors: missing.map((k) => ({
              path: `fields.${k}`,
              code: 'required',
              message: `${k} is required`,
            })),
          });
        if (await tx.account.findUnique({ where: { entityId_code: { entityId, code: fields.code! } } }))
          throw new DomainException('ledger.account_exists', { params: { code: fields.code! } });
      }
      if (
        fields.parentCode &&
        !(await tx.account.findUnique({ where: { entityId_code: { entityId, code: fields.parentCode } } }))
      )
        throw new DomainException('ledger.account_invalid', {
          params: { code: fields.parentCode, reason: 'unknown parent' },
        });
      if (
        fields.requiredDimensions &&
        fields.allowedDimensions &&
        !fields.requiredDimensions.every((d) => fields.allowedDimensions!.includes(d))
      )
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'fields.requiredDimensions',
              code: 'subset',
              message: 'required dimensions must be allowed',
            },
          ],
        });
      if (input.kind === 'deactivate' && account) {
        const balance = await this.accountBalance(tx, account.id);
        if (!balance.isZero())
          throw new DomainException('ledger.account_invalid', {
            params: {
              code: account.code,
              reason: `balance ${formatMoney(balance)} must be zero to deactivate`,
            },
          });
      }
      if (
        account &&
        (await tx.accountChange.count({ where: { accountId: account.id, status: 'proposed' } })) > 0
      )
        throw new DomainException('ledger.change_pending', { params: { subject: 'account' } });
      const change = await tx.accountChange.create({
        data: {
          entityId,
          accountId: account?.id ?? null,
          kind: input.kind,
          proposed: fields as Prisma.InputJsonValue,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: 'coa_change',
        subject: { type: 'account_change', id: change.id, publicId: change.publicId },
        requester: actor,
        entityId,
        payload: { kind: input.kind, account: account?.code ?? fields.code, fields, reason: input.reason },
      });
      await tx.accountChange.update({ where: { id: change.id }, data: { approvalRequestId: request.id } });
      await this.audit.record(tx, {
        category: 'config',
        action: 'account_change.proposed',
        actor,
        resourceType: 'account_change',
        resourcePublicId: change.publicId,
        entityId,
        data: { kind: input.kind, account: account?.code ?? fields.code, fields },
      });
      return tx.accountChange.findUniqueOrThrow({
        where: { id: change.id },
        include: { account: { select: { code: true } }, approvalRequest: { select: { publicId: true } } },
      });
    });
  }

  async onAccountChangeDecided(tx: Tx, request: ApprovalRequest, approved: boolean): Promise<void> {
    const change = await tx.accountChange.findUnique({ where: { id: request.subjectId } });
    if (!change || change.status !== 'proposed') return;
    const status = approved ? 'approved' : request.status === 'withdrawn' ? 'withdrawn' : 'rejected';
    if (approved) {
      const f = change.proposed as AccountFields;
      const parentId =
        f.parentCode === undefined
          ? undefined
          : f.parentCode === null
            ? null
            : (
                await tx.account.findUniqueOrThrow({
                  where: { entityId_code: { entityId: change.entityId, code: f.parentCode } },
                })
              ).id;
      const data = {
        ...(f.nameTh !== undefined && { nameTh: f.nameTh }),
        ...(f.nameEn !== undefined && { nameEn: f.nameEn }),
        ...(f.accountType !== undefined && { accountType: f.accountType }),
        ...(f.normalSide !== undefined && { normalSide: f.normalSide }),
        ...(parentId !== undefined && { parentId }),
        ...(f.isControl !== undefined && { isControl: f.isControl }),
        ...(f.isPostable !== undefined && { isPostable: f.isPostable }),
        ...(f.allowedDimensions !== undefined && { allowedDimensions: f.allowedDimensions }),
        ...(f.requiredDimensions !== undefined && { requiredDimensions: f.requiredDimensions }),
        ...(f.cashFlowClass !== undefined && { cashFlowClass: f.cashFlowClass }),
      };
      if (change.kind === 'create') {
        await tx.account.create({
          data: {
            entityId: change.entityId,
            code: f.code!,
            nameTh: f.nameTh!,
            nameEn: f.nameEn!,
            accountType: f.accountType!,
            normalSide: f.normalSide!,
            cashFlowClass: f.cashFlowClass!,
            parentId: parentId ?? null,
            isControl: f.isControl ?? false,
            isPostable: f.isPostable ?? true,
            allowedDimensions: f.allowedDimensions ?? [],
            requiredDimensions: f.requiredDimensions ?? [],
            createdById: change.createdById,
          },
        });
      } else {
        await tx.account.update({
          where: { id: change.accountId! },
          data: {
            ...data,
            ...(change.kind === 'deactivate' && { status: 'inactive' as const }),
            ...(change.kind === 'reactivate' && { status: 'active' as const }),
            updatedById: change.createdById,
            rowVersion: { increment: 1 },
          },
        });
      }
    }
    await tx.accountChange.update({ where: { id: change.id }, data: { status, decidedAt: new Date() } });
    await this.events.record(
      tx,
      {
        type: approved ? 'account.changed' : 'account_change.declined',
        aggregateType: 'account_change',
        aggregateId: change.publicId,
        entityId: change.entityId,
        payload: { accountChangeId: change.publicId, kind: change.kind, status },
      },
      systemActor('ledger.approvals'),
    );
  }

  async costCentres() {
    return this.prisma.costCentre.findMany({ orderBy: { code: 'asc' } });
  }

  async createCostCentre(actor: UserActor, input: { code: string; name: string }) {
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      try {
        const row = await tx.costCentre.create({ data: { entityId, ...input, createdById: actor.userId } });
        await this.audit.record(tx, {
          category: 'config',
          action: 'cost_centre.created',
          actor,
          resourceType: 'cost_centre',
          resourcePublicId: row.publicId,
          entityId,
          data: input,
        });
        return row;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new DomainException('ledger.account_exists', { params: { code: input.code } });
        throw error;
      }
    });
  }

  private async accountBalance(tx: Tx, accountId: bigint) {
    const sum = await tx.journalLine.aggregate({
      where: { accountId, journalEntry: { status: 'posted' } },
      _sum: { debit: true, credit: true },
    });
    return new MoneyDecimal(sum._sum.debit?.toString() ?? '0').sub(sum._sum.credit?.toString() ?? '0');
  }

  // --- posting rules ---------------------------------------------------------------------------------------

  async rules() {
    return this.prisma.postingRule.findMany({
      include: { versions: { orderBy: { versionNo: 'desc' } } },
      orderBy: { key: 'asc' },
    });
  }

  async rule(key: string) {
    const rule = await this.prisma.postingRule.findUnique({
      where: { key },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          include: { approvalRequest: { select: { publicId: true } } },
        },
      },
    });
    if (!rule) throw new DomainException('http.not_found');
    return rule;
  }

  async proposeRuleVersion(actor: UserActor, key: string, input: RuleVersionInput) {
    const problems = validateTemplate(input.template);
    if (problems.length > 0)
      throw new DomainException('ledger.rule_invalid', { params: { reason: problems.join('; ') } });
    if (input.effectiveFrom.getTime() < Date.now() - 60_000)
      throw new DomainException('ledger.rule_invalid', {
        params: { reason: 'a new version cannot be back-dated' },
      });
    const entityId = await this.entities.defaultEntityId();
    await this.prisma.withTx(async (tx) => {
      const rule = await tx.postingRule.findUnique({ where: { key } });
      if (!rule) throw new DomainException('http.not_found');
      if ((await tx.postingRuleVersion.count({ where: { postingRuleId: rule.id, status: 'proposed' } })) > 0)
        throw new DomainException('ledger.change_pending', { params: { subject: 'posting rule' } });
      const codes = accountCodesOf(input.template as PostingTemplate);
      const known = await tx.account.findMany({
        where: { entityId, code: { in: codes }, status: 'active', isPostable: true },
      });
      const unknown = codes.filter((c) => !known.some((a) => a.code === c));
      if (unknown.length > 0)
        throw new DomainException('ledger.rule_invalid', {
          params: { reason: `unknown or unpostable accounts ${unknown.join(', ')}` },
        });
      const last = await tx.postingRuleVersion.aggregate({
        where: { postingRuleId: rule.id },
        _max: { versionNo: true },
      });
      const version = await tx.postingRuleVersion.create({
        data: {
          postingRuleId: rule.id,
          versionNo: (last._max.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          status: 'proposed',
          conditions: input.conditions ?? Prisma.DbNull,
          template: input.template as Prisma.InputJsonValue,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: 'posting_rule_change',
        subject: { type: 'posting_rule_version', id: version.id, publicId: version.publicId },
        requester: actor,
        entityId,
        payload: {
          rule: key,
          versionNo: version.versionNo,
          effectiveFrom: input.effectiveFrom.toISOString(),
          reason: input.reason,
        },
      });
      await tx.postingRuleVersion.update({
        where: { id: version.id },
        data: { approvalRequestId: request.id },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'posting_rule.version_proposed',
        actor,
        resourceType: 'posting_rule',
        resourcePublicId: rule.publicId,
        entityId,
        data: { key, versionNo: version.versionNo },
      });
    });
    return this.rule(key);
  }

  async onRuleVersionDecided(tx: Tx, request: ApprovalRequest, approved: boolean): Promise<void> {
    const version = await tx.postingRuleVersion.findUnique({
      where: { id: request.subjectId },
      include: { postingRule: true },
    });
    if (!version || version.status !== 'proposed') return;
    const approver = await tx.approvalAction.findFirst({
      where: { requestId: request.id, action: 'approve' },
      orderBy: { createdAt: 'desc' },
    });
    const status = approved ? 'approved' : request.status === 'withdrawn' ? 'withdrawn' : 'rejected';
    await tx.postingRuleVersion.update({
      where: { id: version.id },
      data: { status, decidedAt: new Date(), decidedById: approver?.actorUserId ?? null },
    });
    this.engine.invalidate();
    await this.events.record(
      tx,
      {
        type: approved ? 'posting_rule.version_approved' : 'posting_rule.version_declined',
        aggregateType: 'posting_rule',
        aggregateId: version.postingRule.publicId,
        payload: { key: version.postingRule.key, versionNo: version.versionNo, status },
      },
      systemActor('ledger.approvals'),
    );
  }

  /** Dry run: renders a rule version (the one in force, or a given one) on a sample payload. */
  async previewRule(key: string, payload: Record<string, unknown>, versionNo?: number) {
    const rule = await this.rule(key);
    const version = versionNo
      ? rule.versions.find((v) => v.versionNo === versionNo)
      : rule.versions.find((v) => v.status === 'approved' && v.effectiveFrom <= new Date());
    if (!version) throw new DomainException('http.not_found');
    const applies = ruleApplies(version.conditions, payload);
    const journal = this.engine.render(rule, version, payload);
    return { rule, version, applies, journal };
  }

  // --- tax rates ---------------------------------------------------------------------------------------------

  async taxRates() {
    return this.prisma.taxRate.findMany({
      include: { versions: { orderBy: { versionNo: 'desc' } } },
      orderBy: { code: 'asc' },
    });
  }

  async proposeTaxRate(
    actor: UserActor,
    code: string,
    input: { ratePct: string; effectiveFrom: Date; reason: string },
  ) {
    const rate = new MoneyDecimal(input.ratePct);
    if (rate.lt(0) || rate.gt(100))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'ratePct', code: 'range', message: '0–100' }],
      });
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) throw new DomainException('settings.backdated');
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      const taxRate = await tx.taxRate.findUnique({ where: { code } });
      if (!taxRate) throw new DomainException('http.not_found');
      if ((await tx.taxRateVersion.count({ where: { taxRateId: taxRate.id, status: 'proposed' } })) > 0)
        throw new DomainException('ledger.change_pending', { params: { subject: 'tax rate' } });
      const last = await tx.taxRateVersion.aggregate({
        where: { taxRateId: taxRate.id },
        _max: { versionNo: true },
      });
      const version = await tx.taxRateVersion.create({
        data: {
          taxRateId: taxRate.id,
          versionNo: (last._max.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          status: 'proposed',
          ratePct: input.ratePct,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: 'tax_setting_change',
        subject: { type: 'tax_rate_version', id: version.id, publicId: version.publicId },
        requester: actor,
        pct: input.ratePct,
        entityId,
        payload: {
          code,
          ratePct: input.ratePct,
          effectiveFrom: input.effectiveFrom.toISOString(),
          reason: input.reason,
        },
      });
      await tx.taxRateVersion.update({ where: { id: version.id }, data: { approvalRequestId: request.id } });
      await this.audit.record(tx, {
        category: 'config',
        action: 'tax_rate.version_proposed',
        actor,
        resourceType: 'tax_rate',
        resourcePublicId: taxRate.publicId,
        entityId,
        data: { code, ratePct: input.ratePct, effectiveFrom: input.effectiveFrom.toISOString() },
      });
      return tx.taxRate.findUniqueOrThrow({
        where: { id: taxRate.id },
        include: { versions: { orderBy: { versionNo: 'desc' } } },
      });
    });
  }

  async onTaxRateDecided(tx: Tx, request: ApprovalRequest, approved: boolean): Promise<void> {
    const version = await tx.taxRateVersion.findUnique({
      where: { id: request.subjectId },
      include: { taxRate: true },
    });
    if (!version || version.status !== 'proposed') return;
    const approver = await tx.approvalAction.findFirst({
      where: { requestId: request.id, action: 'approve' },
      orderBy: { createdAt: 'desc' },
    });
    const status = approved ? 'approved' : request.status === 'withdrawn' ? 'withdrawn' : 'rejected';
    await tx.taxRateVersion.update({
      where: { id: version.id },
      data: { status, decidedAt: new Date(), decidedById: approver?.actorUserId ?? null },
    });
    await this.events.record(
      tx,
      {
        type: approved ? 'tax_rate.version_approved' : 'tax_rate.version_declined',
        aggregateType: 'tax_rate',
        aggregateId: version.taxRate.publicId,
        payload: {
          code: version.taxRate.code,
          versionNo: version.versionNo,
          ratePct: version.ratePct.toString(),
          status,
        },
      },
      systemActor('ledger.approvals'),
    );
  }
}
