import { type Actor, actorColumns, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { addMonths, dateOnly, dayOf, monthEnd } from '@common/ledger-core/dates';
import { accountCodesOf, type PostingTemplate, validateTemplate } from '@common/ledger-core/template';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type AccountChangeKind,
  type AccountType,
  type CashFlowClass,
  type ErpGlAccount,
  type ErpGlJournalEntry,
  type ErpGlPeriod,
  type ErpGlSettings,
  type JournalKind,
  type LedgerSide,
  type PeriodStatus,
  Prisma,
  type TaxCode,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { dec } from './erp.math';
import {
  type ErpGlAccountChangeDto,
  type ErpGlAccountDto,
  type ErpGlAccountListQuery,
  type ErpGlAccountProposalDto,
  type ErpGlAccountRefDto,
  type ErpGlChangeListQuery,
  type ErpGlCloseCheckDto,
  type ErpGlCloseChecklistDto,
  type ErpGlPeriodDto,
  type ErpGlPeriodListQuery,
  type ErpGlPeriodTransitionDto,
  type ErpGlProposeAccountChangeDto,
  type ErpGlRuleDto,
  type ErpGlSettingsDto,
  type ErpUpdateGlSettingsDto,
} from './erp-e6.dto';
import {
  CHART_TEMPLATE,
  CHART_TEMPLATE_VERSION,
  CLOSE_CHECKS,
  type CloseCheckKey,
  ERP_GL_DIMENSIONS,
  ITEM_KIND_ACCOUNTS,
  METHOD_ACCOUNTS,
  RULES_TEMPLATE,
  RULES_TEMPLATE_VERSION,
  type StatementLine,
} from './erp-ledger.template';
import { isoTs, userRef } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP E6 core (D-385 – D-390): the factory's book — settings, the chart of accounts created from
 * the template with maker-checker changes, fiscal years and periods with the close checklist, and the posting
 * core every journal (automatic, manual, recurring, reversal, closing) goes through. Factory-private (D-317).
 */

export interface GlDraftLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: MoneyValue | string;
  description?: string | null;
  /** Dimension key → public id (resolved to internal ids here). */
  dimensions?: Partial<Record<string, string>>;
  taxCode?: string | null;
  taxBase?: MoneyValue | string | null;
}

export interface GlDraft {
  kind: JournalKind;
  documentDate: string;
  description: string;
  source?: { type: string; publicId: string; number: string | null } | null;
  domainEventId?: string | null;
  postingRuleId?: bigint | null;
  postingRuleVersionId?: bigint | null;
  reversesEntryId?: bigint | null;
  recurringJournalId?: bigint | null;
  autoReverseOn?: string | null;
  createdById?: bigint | null;
  approvedById?: bigint | null;
  allowSoftClosed?: boolean;
  lines: GlDraftLine[];
}

export interface ValidatedGlLine {
  account: ErpGlAccount;
  debit: string;
  credit: string;
  description: string | null;
  dims: {
    itemId?: bigint;
    partnerId?: bigint;
    warehouseId?: bigint;
    productionOrderId?: bigint;
    machineId?: bigint;
    bankAccountId?: bigint;
  };
  taxCode: TaxCode | null;
  taxBase: string | null;
}

export interface AccountBalance {
  debit: MoneyValue;
  credit: MoneyValue;
}

/** Thai names of the close checks, for the problem detail (D-390). */
const CHECK_TH: Record<CloseCheckKey, string> = {
  stock_valuation: 'มูลค่าสต็อก',
  payables: 'เจ้าหนี้',
  receivables: 'ลูกหนี้',
  vat: 'ภาษีมูลค่าเพิ่ม',
  wht: 'ภาษีหัก ณ ที่จ่าย',
  bank: 'กระทบยอดธนาคาร',
  depreciation: 'ค่าเสื่อมราคา',
  open_wip: 'งานระหว่างทำ',
};

const TRANSITIONS: Record<string, { from: PeriodStatus[]; to: PeriodStatus }> = {
  soft_close: { from: ['open'], to: 'soft_closed' },
  close: { from: ['open', 'soft_closed'], to: 'closed' },
  lock: { from: ['closed'], to: 'locked' },
  reopen: { from: ['soft_closed', 'closed'], to: 'open' },
};

const DIMENSION_LOOKUP: Record<string, { column: keyof ValidatedGlLine['dims']; table: string }> = {
  item: { column: 'itemId', table: 'erp_items' },
  partner: { column: 'partnerId', table: 'erp_trading_partners' },
  warehouse: { column: 'warehouseId', table: 'erp_warehouses' },
  productionOrder: { column: 'productionOrderId', table: 'erp_production_orders' },
  machine: { column: 'machineId', table: 'factory_machines' },
  bankAccount: { column: 'bankAccountId', table: 'erp_gl_bank_accounts' },
};

export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);
export const money = (v: MoneyValue): string => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
export const accountRef = (a: Pick<ErpGlAccount, 'publicId' | 'code' | 'nameTh'>): ErpGlAccountRefDto => ({
  id: a.publicId,
  code: a.code,
  name: a.nameTh,
});

const SETTINGS_ACTIONS: ActionRule<{ started: boolean }>[] = [
  { key: 'erp_ledger.configure', permissions: ['factory_ledger.configure'], when: () => true },
  { key: 'erp_ledger.catch_up', permissions: ['factory_ledger.configure'], when: (s) => s.started },
];
const ACCOUNT_ACTIONS: ActionRule<{ status: string; pending: boolean }>[] = [
  { key: 'erp_account.propose', permissions: ['factory_ledger.configure'], when: (a) => (a.pending ? 'มีคำขอแก้ไขรออนุมัติอยู่' : true) },
];
const CHANGE_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_account_change.approve', permissions: ['factory_ledger.approve'], when: (c) => c.status === 'proposed' },
  { key: 'erp_account_change.reject', permissions: ['factory_ledger.approve'], when: (c) => c.status === 'proposed' },
];
const PERIOD_ACTIONS: ActionRule<{ status: PeriodStatus; previousClosed: boolean; lastOfYear: boolean }>[] = [
  { key: 'erp_period.soft_close', permissions: ['factory_ledger.close'], when: (p) => p.status === 'open' },
  { key: 'erp_period.close', permissions: ['factory_ledger.close'], when: (p) => (p.status === 'open' || p.status === 'soft_closed' ? (p.previousClosed ? true : 'ปิดงวดก่อนหน้าก่อน') : false) },
  { key: 'erp_period.lock', permissions: ['factory_ledger.close'], when: (p) => p.status === 'closed' },
  { key: 'erp_period.reopen', permissions: ['factory_ledger.close'], when: (p) => p.status === 'soft_closed' || p.status === 'closed' },
  { key: 'erp_period.close_year', permissions: ['factory_ledger.close'], irreversible: true, when: (p) => p.lastOfYear && p.status === 'soft_closed' && (p.previousClosed ? true : 'ปิดงวดเดือนที่ 1 – 11 ก่อน') },
];

@Injectable()
export class ErpLedgerService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly audit: AuditService,
  ) {}

  // ============================================================================================ book

  /** The factory's book: settings, chart and rules exist after this (created from the templates on first use). */
  async book(tx: Tx, factoryId: bigint, userId: bigint | null): Promise<ErpGlSettings> {
    let settings = await tx.erpGlSettings.findUnique({ where: { factoryId } });
    if (!settings) {
      const start = `${bangkokDate(new Date()).slice(0, 7)}-01`;
      settings = await tx.erpGlSettings.create({
        data: {
          factoryId,
          ledgerStartOn: dateOnly(start),
          itemKindAccounts: { ...ITEM_KIND_ACCOUNTS },
          methodAccounts: { ...METHOD_ACCOUNTS },
          chartTemplateVersion: CHART_TEMPLATE_VERSION,
          rulesTemplateVersion: RULES_TEMPLATE_VERSION,
          createdById: userId ?? (await this.anyOwner(tx, factoryId)),
        },
      });
    }
    if ((await tx.erpGlAccount.count({ where: { factoryId } })) === 0) await this.createChart(tx, factoryId, userId);
    if (settings.rulesTemplateVersion < RULES_TEMPLATE_VERSION || (await tx.erpGlPostingRule.count({ where: { factoryId } })) === 0) {
      await this.createRules(tx, factoryId, userId);
      settings = await tx.erpGlSettings.update({ where: { id: settings.id }, data: { rulesTemplateVersion: RULES_TEMPLATE_VERSION } });
    }
    return settings;
  }

  private async anyOwner(tx: Tx, factoryId: bigint): Promise<bigint> {
    const owner = await tx.userRole.findFirst({
      where: { scopeType: 'factory', scopeId: factoryId, revokedAt: null, role: { key: 'factory_owner' } },
      select: { userId: true },
    });
    if (!owner) throw new DomainException('http.not_found');
    return owner.userId;
  }

  private async createChart(tx: Tx, factoryId: bigint, userId: bigint | null): Promise<void> {
    const ids = new Map<string, bigint>();
    for (const a of CHART_TEMPLATE) {
      const row = await tx.erpGlAccount.create({
        data: {
          factoryId,
          code: a.code,
          nameTh: a.nameTh,
          nameEn: a.nameEn,
          accountType: a.type,
          normalSide: a.side,
          parentId: a.parent ? (ids.get(a.parent) ?? null) : null,
          isControl: a.control ?? false,
          isPostable: a.postable ?? true,
          cashFlowClass: a.cashFlow,
          statementLine: a.line,
          createdById: userId,
        },
      });
      ids.set(a.code, row.id);
    }
  }

  /** Creates the template's rules the factory does not have yet (a newer template adds rules; existing ones are kept). */
  private async createRules(tx: Tx, factoryId: bigint, userId: bigint | null): Promise<void> {
    const have = new Set((await tx.erpGlPostingRule.findMany({ where: { factoryId }, select: { key: true } })).map((r) => r.key));
    for (const r of RULES_TEMPLATE.filter((x) => !have.has(x.key))) {
      const rule = await tx.erpGlPostingRule.create({
        data: { factoryId, key: r.key, eventType: r.eventType, name: r.name, description: r.description },
      });
      await tx.erpGlPostingRuleVersion.create({
        data: {
          ruleId: rule.id,
          versionNo: 1,
          effectiveFrom: new Date(0),
          status: 'approved',
          template: r.template as unknown as Prisma.InputJsonValue,
          reason: `Template v${RULES_TEMPLATE_VERSION}`,
          createdById: userId,
          decidedAt: new Date(),
          decidedById: userId,
        },
      });
    }
  }

  async settingsDto(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpGlSettingsDto> {
    const s = await this.workspace.tx((tx) => this.book(tx, scope.factory.id, scope.actor.userId));
    return this.settingsView(s, perms);
  }

  private async settingsView(s: ErpGlSettings, perms: ReadonlySet<string>): Promise<ErpGlSettingsDto> {
    const [accounts, rules, factory] = await Promise.all([
      this.workspace.db.erpGlAccount.count({ where: { factoryId: s.factoryId } }),
      this.workspace.db.erpGlPostingRule.count({ where: { factoryId: s.factoryId, versions: { some: { status: 'approved' } } } }),
      this.workspace.db.factory.findUniqueOrThrow({ where: { id: s.factoryId }, select: { publicId: true } }),
    ]);
    return {
      id: factory.publicId,
      fiscalYearStartMonth: s.fiscalYearStartMonth,
      ledgerStartOn: dayOf(s.ledgerStartOn),
      itemKindAccounts: { ...ITEM_KIND_ACCOUNTS, ...(s.itemKindAccounts as Record<string, string>) },
      methodAccounts: { ...METHOD_ACCOUNTS, ...(s.methodAccounts as Record<string, string>) },
      cpaName: s.cpaName,
      cpaContact: s.cpaContact,
      chartTemplateVersion: s.chartTemplateVersion,
      rulesTemplateVersion: s.rulesTemplateVersion,
      accounts,
      rules,
      nextActions: nextActions({ started: true }, SETTINGS_ACTIONS, perms),
      version: s.rowVersion,
    };
  }

  async updateSettings(scope: ErpScope, ifMatch: string | undefined, body: ErpUpdateGlSettingsDto, perms: ReadonlySet<string>) {
    const s = await this.workspace.tx(async (tx) => {
      const current = await this.book(tx, scope.factory.id, scope.actor.userId);
      assertIfMatch(ifMatch, etagOf(scope.factory.publicId, current.rowVersion));
      const accounts = await this.accountsByCode(tx, scope.factory.id);
      const checkCodes = (map: Record<string, string> | undefined, at: string) => {
        for (const [k, code] of Object.entries(map ?? {})) {
          const a = accounts.get(code);
          if (!a || !a.isPostable || a.status !== 'active')
            throw new DomainException('validation.failed', { errors: [{ path: `${at}.${k}`, code: 'invalid', message: `${code} is not a postable active account` }] });
        }
      };
      checkCodes(body.itemKindAccounts, 'itemKindAccounts');
      checkCodes(body.methodAccounts, 'methodAccounts');
      if (body.fiscalYearStartMonth !== undefined && body.fiscalYearStartMonth !== current.fiscalYearStartMonth) {
        const posted = await tx.erpGlJournalEntry.count({ where: { factoryId: scope.factory.id, status: 'posted' } });
        if (posted > 0)
          throw new DomainException('validation.failed', { errors: [{ path: 'fiscalYearStartMonth', code: 'invalid', message: 'The fiscal year cannot change once entries are posted' }] });
        const touched = await tx.erpGlPeriod.count({ where: { factoryId: scope.factory.id, status: { not: 'open' } } });
        if (touched > 0)
          throw new DomainException('validation.failed', { errors: [{ path: 'fiscalYearStartMonth', code: 'invalid', message: 'The fiscal year cannot change once a period is closed' }] });
        await tx.erpGlPeriod.deleteMany({ where: { factoryId: scope.factory.id } });
        await tx.erpGlFiscalYear.deleteMany({ where: { factoryId: scope.factory.id } });
      }
      const updated = await tx.erpGlSettings.update({
        where: { id: current.id },
        data: {
          fiscalYearStartMonth: body.fiscalYearStartMonth ?? current.fiscalYearStartMonth,
          ledgerStartOn: body.ledgerStartOn ? dateOnly(body.ledgerStartOn) : current.ledgerStartOn,
          itemKindAccounts: body.itemKindAccounts
            ? { ...(current.itemKindAccounts as Record<string, string>), ...body.itemKindAccounts }
            : (current.itemKindAccounts as Prisma.InputJsonValue),
          methodAccounts: body.methodAccounts
            ? { ...(current.methodAccounts as Record<string, string>), ...body.methodAccounts }
            : (current.methodAccounts as Prisma.InputJsonValue),
          cpaName: body.cpaName === undefined ? current.cpaName : body.cpaName,
          cpaContact: body.cpaContact === undefined ? current.cpaContact : body.cpaContact,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'erp_ledger.settings_changed',
        resourceType: 'factory',
        resourcePublicId: scope.factory.publicId,
        data: { changed: Object.keys(body) },
      });
      await this.workspace.record(tx, scope, 'erp_ledger.settings_updated', 'factory', scope.factory.publicId, {});
      return updated;
    });
    return this.settingsView(s, perms);
  }

  /** The account code for a purpose, honouring the factory's overrides. */
  methodAccount(settings: ErpGlSettings, key: keyof typeof METHOD_ACCOUNTS): string {
    return (settings.methodAccounts as Record<string, string>)[key] ?? METHOD_ACCOUNTS[key];
  }

  methodAccounts(settings: ErpGlSettings): Record<string, string> {
    return { ...METHOD_ACCOUNTS, ...(settings.methodAccounts as Record<string, string>) };
  }

  itemKindAccount(settings: ErpGlSettings, kind: string): string {
    return (settings.itemKindAccounts as Record<string, string>)[kind] ?? ITEM_KIND_ACCOUNTS[kind as keyof typeof ITEM_KIND_ACCOUNTS] ?? '1144';
  }

  async rulesDto(scope: ErpScope): Promise<ErpGlRuleDto[]> {
    await this.workspace.tx((tx) => this.book(tx, scope.factory.id, scope.actor.userId));
    const rules = await this.workspace.db.erpGlPostingRule.findMany({
      where: { factoryId: scope.factory.id },
      include: {
        versions: { where: { status: 'approved', effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }], take: 1 },
        _count: { select: { entries: true, versions: { where: { status: 'proposed' } } } },
      },
      orderBy: { key: 'asc' },
    });
    return rules.map((r) => {
      const v = r.versions[0] ?? null;
      const template = (v?.template ?? { lines: [] }) as unknown as PostingTemplate;
      return {
        id: r.publicId,
        key: r.key,
        eventType: r.eventType,
        name: r.name,
        description: r.description,
        versionNo: v?.versionNo ?? null,
        template: template as unknown as Record<string, unknown>,
        accountCodes: accountCodesOf(template),
        entries: r._count.entries,
        pending: r._count.versions > 0,
      };
    });
  }

  /** Structural check of a template against the factory ledger's dimensions (used by tests; the rule editor, D-398). */
  templateProblems(template: unknown): string[] {
    return validateTemplate(template, ERP_GL_DIMENSIONS);
  }

  // ======================================================================================== accounts

  async accountsByCode(tx: Tx, factoryId: bigint): Promise<Map<string, ErpGlAccount>> {
    const rows = await tx.erpGlAccount.findMany({ where: { factoryId } });
    return new Map(rows.map((a) => [a.code, a]));
  }

  /**
   * Balances of every account as debit / credit sums of posted lines in `[from, to]` (both optional); the caller
   * turns them into signed balances by the account's normal side.
   */
  async balances(tx: Tx, factoryId: bigint, range: { from?: string; to?: string } = {}): Promise<Map<bigint, AccountBalance>> {
    const rows = await tx.$queryRaw<{ account_id: bigint; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>(Prisma.sql`
      SELECT l.account_id, coalesce(sum(l.debit), 0) AS debit, coalesce(sum(l.credit), 0) AS credit
        FROM erp_gl_journal_lines l
        JOIN erp_gl_journal_entries e ON e.id = l.entry_id
       WHERE l.factory_id = ${factoryId} AND e.status = 'posted'
         ${range.from ? Prisma.sql`AND l.entry_date >= ${dateOnly(range.from)}::date` : Prisma.empty}
         ${range.to ? Prisma.sql`AND l.entry_date <= ${dateOnly(range.to)}::date` : Prisma.empty}
       GROUP BY l.account_id`);
    return new Map(rows.map((r) => [r.account_id, { debit: dec(r.debit), credit: dec(r.credit) }]));
  }

  /** Debit-positive signed balance. */
  signed(b: AccountBalance | undefined): MoneyValue {
    return b ? b.debit.minus(b.credit) : new MoneyDecimal(0);
  }

  /** Balance on the account's normal side (what the chart screen shows). */
  natural(a: Pick<ErpGlAccount, 'normalSide'>, b: AccountBalance | undefined): MoneyValue {
    const s = this.signed(b);
    return a.normalSide === 'debit' ? s : s.negated();
  }

  async listAccounts(scope: ErpScope, q: ErpGlAccountListQuery, perms: ReadonlySet<string>) {
    await this.workspace.tx((tx) => this.book(tx, scope.factory.id, scope.actor.userId));
    const where: Prisma.ErpGlAccountWhereInput = {
      factoryId: scope.factory.id,
      ...(q.accountType && { accountType: q.accountType as AccountType }),
      ...(q.status && { status: q.status as 'active' | 'inactive' }),
      ...(q.postable && { isPostable: true }),
      ...(q.q && { OR: [{ code: { startsWith: q.q } }, { nameTh: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }] }),
    };
    const [rows, total, balances, pending] = await Promise.all([
      this.workspace.db.erpGlAccount.findMany({ where, include: { parent: true }, orderBy: { code: 'asc' }, ...toSkipTake(q) }),
      this.workspace.db.erpGlAccount.count({ where }),
      this.balances(this.workspace.db, scope.factory.id),
      this.workspace.db.erpGlAccountChange.findMany({ where: { factoryId: scope.factory.id, status: 'proposed' }, select: { accountId: true } }),
    ]);
    const pendingIds = new Set(pending.map((p) => p.accountId));
    return paginated(
      rows.map((a) => this.accountDto(a, balances.get(a.id), pendingIds.has(a.id), perms)),
      total,
      q,
    );
  }

  accountDto(a: ErpGlAccount & { parent: ErpGlAccount | null }, balance: AccountBalance | undefined, pending: boolean, perms: ReadonlySet<string>): ErpGlAccountDto {
    return {
      id: a.publicId,
      code: a.code,
      nameTh: a.nameTh,
      nameEn: a.nameEn,
      accountType: a.accountType,
      normalSide: a.normalSide,
      parent: a.parent ? accountRef(a.parent) : null,
      isControl: a.isControl,
      isPostable: a.isPostable,
      cashFlowClass: a.cashFlowClass,
      statementLine: a.statementLine,
      status: a.status,
      balance: money(this.natural(a, balance)),
      changePending: pending,
      nextActions: nextActions({ status: a.status, pending }, ACCOUNT_ACTIONS, perms),
      version: a.rowVersion,
    };
  }

  async proposeChange(scope: ErpScope, body: ErpGlProposeAccountChangeDto, perms: ReadonlySet<string>): Promise<ErpGlAccountChangeDto> {
    const id = await this.workspace.tx(async (tx) => {
      await this.book(tx, scope.factory.id, scope.actor.userId);
      const kind = body.kind as AccountChangeKind;
      const fail = (path: string, message: string) =>
        new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
      let account: ErpGlAccount | null = null;
      if (kind === 'create') {
        if (body.accountId) throw fail('accountId', 'Not for a new account');
        const p = body.proposed;
        if (!p?.code || !p.nameTh || !p.nameEn || !p.accountType || !p.cashFlowClass || !p.statementLine)
          throw fail('proposed', 'code, nameTh, nameEn, accountType, cashFlowClass and statementLine are required');
        if (await tx.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, code: p.code } }))
          throw fail('proposed.code', `${p.code} already exists`);
      } else {
        if (!body.accountId) throw fail('accountId', 'The account to change is required');
        account = await tx.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, publicId: body.accountId } });
        if (!account) throw new DomainException('http.not_found');
        if (kind === 'update' && !body.proposed) throw fail('proposed', 'The new values are required');
        if (kind === 'deactivate' && account.status !== 'active') throw fail('kind', 'The account is already inactive');
        if (kind === 'reactivate' && account.status !== 'inactive') throw fail('kind', 'The account is active');
        const pending = await tx.erpGlAccountChange.findFirst({ where: { accountId: account.id, status: 'proposed' } });
        if (pending) throw new DomainException('erp.ledger_change_pending', { params: { code: account.code } });
      }
      if (body.proposed?.parentCode) {
        const parent = await tx.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, code: body.proposed.parentCode } });
        if (!parent) throw fail('proposed.parentCode', `${body.proposed.parentCode} is not in the chart`);
      }
      const change = await tx.erpGlAccountChange.create({
        data: {
          factoryId: scope.factory.id,
          accountId: account?.id ?? null,
          kind,
          proposed: (body.proposed ?? {}) as unknown as Prisma.InputJsonValue,
          reason: body.reason,
          createdById: scope.actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'erp_ledger.account_change_proposed',
        resourceType: 'erp_gl_account_change',
        resourcePublicId: change.publicId,
        data: { kind, code: account?.code ?? body.proposed?.code },
      });
      await this.workspace.record(tx, scope, 'erp_ledger.account_change_proposed', 'erp_gl_account_change', change.publicId, { kind });
      return change.id;
    });
    return this.getChange(scope, id, perms);
  }

  private async getChange(scope: ErpScope, id: bigint, perms: ReadonlySet<string>): Promise<ErpGlAccountChangeDto> {
    const c = await this.workspace.db.erpGlAccountChange.findUniqueOrThrow({
      where: { id },
      include: { account: true, createdBy: true, decidedBy: true },
    });
    return this.changeDto(c, perms);
  }

  private changeDto(
    c: Prisma.ErpGlAccountChangeGetPayload<{ include: { account: true; createdBy: true; decidedBy: true } }>,
    perms: ReadonlySet<string>,
  ): ErpGlAccountChangeDto {
    return {
      id: c.publicId,
      kind: c.kind,
      account: c.account ? accountRef(c.account) : null,
      proposed: c.proposed as unknown as ErpGlAccountProposalDto,
      reason: c.reason,
      status: c.status,
      decisionNote: c.decisionNote,
      createdBy: c.createdBy.displayName,
      createdAt: isoTs(c.createdAt)!,
      decidedBy: c.decidedBy?.displayName ?? null,
      decidedAt: isoTs(c.decidedAt),
      nextActions: nextActions({ status: c.status }, CHANGE_ACTIONS, perms),
    };
  }

  async listChanges(scope: ErpScope, q: ErpGlChangeListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpGlAccountChangeWhereInput = {
      factoryId: scope.factory.id,
      ...(q.status && { status: q.status as 'proposed' }),
    };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpGlAccountChange.findMany({
        where,
        include: { account: true, createdBy: true, decidedBy: true },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q),
      }),
      this.workspace.db.erpGlAccountChange.count({ where }),
    ]);
    return paginated(rows.map((c) => this.changeDto(c, perms)), total, q);
  }

  async decideChange(scope: ErpScope, publicId: string, approve: boolean, note: string | null, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const c = await tx.erpGlAccountChange.findFirst({ where: { factoryId: scope.factory.id, publicId }, include: { account: true } });
      if (!c) throw new DomainException('http.not_found');
      if (c.status !== 'proposed') throw new DomainException('erp.invalid_status', { params: { status: c.status } });
      if (c.createdById === scope.actor.userId) throw new DomainException('erp.ledger_self_approval');
      if (approve) {
        const p = c.proposed as unknown as ErpGlAccountProposalDto;
        const parentId = p.parentCode
          ? ((await tx.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, code: p.parentCode } }))?.id ?? null)
          : p.parentCode === null
            ? null
            : undefined;
        if (c.kind === 'create') {
          await tx.erpGlAccount.create({
            data: {
              factoryId: scope.factory.id,
              code: p.code!,
              nameTh: p.nameTh!,
              nameEn: p.nameEn!,
              accountType: p.accountType as AccountType,
              normalSide: (p.normalSide as LedgerSide | undefined) ?? (['asset', 'cost_of_sales', 'expense'].includes(p.accountType!) ? 'debit' : 'credit'),
              parentId: parentId ?? null,
              isControl: p.isControl ?? false,
              isPostable: p.isPostable ?? true,
              cashFlowClass: p.cashFlowClass as CashFlowClass,
              statementLine: p.statementLine!,
              createdById: scope.actor.userId,
            },
          });
        } else if (c.kind === 'update') {
          await tx.erpGlAccount.update({
            where: { id: c.accountId! },
            data: {
              nameTh: p.nameTh ?? undefined,
              nameEn: p.nameEn ?? undefined,
              accountType: (p.accountType as AccountType | undefined) ?? undefined,
              normalSide: (p.normalSide as LedgerSide | undefined) ?? undefined,
              parentId: parentId === undefined ? undefined : parentId,
              isControl: p.isControl ?? undefined,
              isPostable: p.isPostable ?? undefined,
              cashFlowClass: (p.cashFlowClass as CashFlowClass | undefined) ?? undefined,
              statementLine: p.statementLine ?? undefined,
              updatedById: scope.actor.userId,
              rowVersion: { increment: 1 },
            },
          });
        } else {
          await tx.erpGlAccount.update({
            where: { id: c.accountId! },
            data: { status: c.kind === 'deactivate' ? 'inactive' : 'active', updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
          });
        }
      }
      await tx.erpGlAccountChange.update({
        where: { id: c.id },
        data: { status: approve ? 'approved' : 'rejected', decisionNote: note, decidedAt: new Date(), decidedById: scope.actor.userId },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: approve ? 'erp_ledger.account_change_approved' : 'erp_ledger.account_change_rejected',
        resourceType: 'erp_gl_account_change',
        resourcePublicId: c.publicId,
        data: { kind: c.kind, code: c.account?.code ?? (c.proposed as { code?: string }).code },
      });
      await this.workspace.record(tx, scope, approve ? 'erp_ledger.account_change_approved' : 'erp_ledger.account_change_rejected', 'erp_gl_account_change', c.publicId, {});
      return c.id;
    });
    return this.getChange(scope, id, perms);
  }

  // ========================================================================================= periods

  /** The fiscal year holding `day` exists after this (12 monthly periods from the settings' start month). */
  async ensureYear(tx: Tx, factoryId: bigint, startMonth: number, day: string): Promise<void> {
    const existing = await tx.erpGlPeriod.findFirst({
      where: { factoryId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } },
      select: { id: true },
    });
    if (existing) return;
    const [y, m] = day.split('-').map(Number) as [number, number];
    const startYear = m >= startMonth ? y : y - 1;
    const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
    const end = monthEnd(addMonths(start, 11));
    const label = startMonth === 1 ? `FY${startYear}` : `FY${startYear}/${String(startYear + 1).slice(2)}`;
    await tx.$executeRaw`SAVEPOINT erp_gl_ensure_year`;
    try {
      const year = await tx.erpGlFiscalYear.create({ data: { factoryId, label, startDate: dateOnly(start), endDate: dateOnly(end) } });
      for (let i = 0; i < 12; i++) {
        const from = addMonths(start, i);
        await tx.erpGlPeriod.create({
          data: { factoryId, fiscalYearId: year.id, periodNo: i + 1, startDate: dateOnly(from), endDate: dateOnly(monthEnd(from)) },
        });
      }
      await tx.$executeRaw`RELEASE SAVEPOINT erp_gl_ensure_year`;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT erp_gl_ensure_year`;
      const again = await tx.erpGlPeriod.findFirst({ where: { factoryId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } } });
      if (!again) throw error;
    }
  }

  /** The period a document dated `day` posts into: its own if open (or soft-closed when allowed), else the next open one. */
  async postingPeriod(tx: Tx, factoryId: bigint, startMonth: number, day: string, allowSoftClosed = false): Promise<{ period: ErpGlPeriod; entryDate: string }> {
    await this.ensureYear(tx, factoryId, startMonth, day);
    const own = await tx.erpGlPeriod.findFirstOrThrow({ where: { factoryId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } } });
    if (own.status === 'open' || (own.status === 'soft_closed' && allowSoftClosed)) return { period: own, entryDate: day };
    for (let probe = addMonths(day, 1), i = 0; i < 36; probe = addMonths(probe, 1), i++) {
      await this.ensureYear(tx, factoryId, startMonth, probe);
      const next = await tx.erpGlPeriod.findFirstOrThrow({ where: { factoryId, startDate: { lte: dateOnly(probe) }, endDate: { gte: dateOnly(probe) } } });
      if (next.status === 'open') return { period: next, entryDate: dayOf(next.startDate) };
    }
    throw new DomainException('erp.ledger_period_closed', { params: { date: day, status: own.status } });
  }

  async listPeriods(scope: ErpScope, q: ErpGlPeriodListQuery, perms: ReadonlySet<string>): Promise<ErpGlPeriodDto[]> {
    const settings = await this.workspace.tx(async (tx) => {
      const s = await this.book(tx, scope.factory.id, scope.actor.userId);
      const today = bangkokDate(new Date());
      await this.ensureYear(tx, scope.factory.id, s.fiscalYearStartMonth, dayOf(s.ledgerStartOn) < today ? dayOf(s.ledgerStartOn) : today);
      await this.ensureYear(tx, scope.factory.id, s.fiscalYearStartMonth, today);
      return s;
    });
    const years = await this.workspace.db.erpGlFiscalYear.findMany({
      where: { factoryId: scope.factory.id, ...(q.fiscalYear && { label: q.fiscalYear }) },
      orderBy: { startDate: 'desc' },
      take: q.fiscalYear ? 1 : 2,
    });
    const periods = await this.workspace.db.erpGlPeriod.findMany({
      where: { fiscalYearId: { in: years.map((y) => y.id) } },
      include: { fiscalYear: true, statusChangedBy: true, _count: { select: { entries: { where: { status: 'posted' } } } } },
      orderBy: { startDate: 'asc' },
    });
    const ledgerStart = dayOf(settings.ledgerStartOn);
    return periods
      .filter((p) => dayOf(p.endDate) >= ledgerStart)
      .map((p, i, all) => this.periodDto(p, i === 0 || all[i - 1]!.status === 'closed' || all[i - 1]!.status === 'locked', perms));
  }

  periodDto(
    p: Prisma.ErpGlPeriodGetPayload<{ include: { fiscalYear: true; statusChangedBy: true; _count: { select: { entries: true } } } }>,
    previousClosed: boolean,
    perms: ReadonlySet<string>,
  ): ErpGlPeriodDto {
    return {
      id: p.publicId,
      fiscalYear: p.fiscalYear.label,
      fiscalYearId: p.fiscalYear.publicId,
      periodNo: p.periodNo,
      month: monthOf(p.startDate),
      startDate: dayOf(p.startDate),
      endDate: dayOf(p.endDate),
      status: p.status,
      entries: p._count.entries,
      statusChangedBy: p.statusChangedBy?.displayName ?? null,
      statusChangedAt: isoTs(p.statusChangedAt),
      closeNote: p.closeNote,
      closeChecklist: ((p.closeChecklist as unknown as ErpGlCloseCheckDto[] | null) ?? []),
      nextActions: nextActions({ status: p.status, previousClosed, lastOfYear: p.periodNo === 12 }, PERIOD_ACTIONS, perms),
    };
  }

  private async period(tx: Tx, scope: ErpScope, publicId: string) {
    const p = await tx.erpGlPeriod.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: { fiscalYear: true, statusChangedBy: true, _count: { select: { entries: { where: { status: 'posted' } } } } },
    });
    if (!p) throw new DomainException('http.not_found');
    return p;
  }

  async transition(scope: ErpScope, periodId: string, body: ErpGlPeriodTransitionDto, perms: ReadonlySet<string>): Promise<ErpGlPeriodDto> {
    const dto = await this.workspace.tx(async (tx) => {
      const p = await this.period(tx, scope, periodId);
      const t = TRANSITIONS[body.action]!;
      if (!t.from.includes(p.status)) throw new DomainException('erp.ledger_period_transition', { params: { status: p.status } });
      if (body.action === 'reopen' && !body.note)
        throw new DomainException('validation.failed', { errors: [{ path: 'note', code: 'required', message: 'A reason is required to reopen a period' }] });
      let checklist: ErpGlCloseCheckDto[] | undefined;
      if (body.action === 'close' || body.action === 'lock') {
        const previous = await tx.erpGlPeriod.findFirst({
          where: { factoryId: scope.factory.id, endDate: { lt: p.startDate }, status: { in: ['open', 'soft_closed'] } },
          orderBy: { startDate: 'desc' },
        });
        const settings = await this.book(tx, scope.factory.id, scope.actor.userId);
        if (previous && dayOf(previous.endDate) >= dayOf(settings.ledgerStartOn))
          throw new DomainException('erp.ledger_close_blocked', { params: { count: 1, items: `งวด ${monthOf(previous.startDate)}` } });
        if (body.action === 'close') {
          const list = await this.checklist(tx, scope, p, settings);
          const failing = list.checks.filter((c) => c.blocking && !c.ok);
          if (failing.length > 0)
            throw new DomainException('erp.ledger_close_blocked', { params: { count: failing.length, items: failing.map((c) => CHECK_TH[c.key as CloseCheckKey]).join(', ') } });
          checklist = list.checks;
        }
      }
      if (body.action === 'reopen') {
        const later = await tx.erpGlPeriod.findFirst({
          where: { factoryId: scope.factory.id, startDate: { gt: p.endDate }, status: { in: ['closed', 'locked'] } },
        });
        if (later) throw new DomainException('erp.ledger_period_transition', { params: { status: `${p.status} (a later period is closed)` } });
      }
      await tx.erpGlPeriod.update({
        where: { id: p.id },
        data: {
          status: t.to,
          statusChangedAt: new Date(),
          statusChangedById: scope.actor.userId,
          closeNote: body.note ?? (body.action === 'reopen' ? null : p.closeNote),
          ...(checklist && { closeChecklist: checklist as unknown as Prisma.InputJsonValue }),
          ...(body.action === 'reopen' && { closeChecklist: Prisma.DbNull }),
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: `erp_ledger.period_${body.action}`,
        resourceType: 'erp_gl_period',
        resourcePublicId: p.publicId,
        data: { month: monthOf(p.startDate), from: p.status, to: t.to, note: body.note ?? null },
      });
      await this.workspace.record(tx, scope, `erp_ledger.period_${t.to}`, 'erp_gl_period', p.publicId, { month: monthOf(p.startDate) });
      const fresh = await this.period(tx, scope, periodId);
      return this.periodDto(fresh, true, perms);
    });
    return dto;
  }

  async closeChecklistDto(scope: ErpScope, periodId: string): Promise<ErpGlCloseChecklistDto> {
    return this.workspace.tx(async (tx) => {
      const settings = await this.book(tx, scope.factory.id, scope.actor.userId);
      const p = await this.period(tx, scope, periodId);
      return this.checklist(tx, scope, p, settings);
    });
  }

  /** §6 — the eight close checks of a period, each sub-ledger against its general-ledger account(s). */
  async checklist(tx: Tx, scope: ErpScope, p: ErpGlPeriod, settings: ErpGlSettings): Promise<ErpGlCloseChecklistDto> {
    const factoryId = scope.factory.id;
    const end = dayOf(p.endDate);
    const endDate = dateOnly(end);
    const nextDay = dateOnly(addMonths(dayOf(p.startDate), 1));
    const accounts = await this.accountsByCode(tx, factoryId);
    const asOf = await this.balances(tx, factoryId, { to: end });
    const inPeriod = await this.balances(tx, factoryId, { from: dayOf(p.startDate), to: end });
    const bal = (code: string, map = asOf) => {
      const a = accounts.get(code);
      return a ? this.natural(a, map.get(a.id)) : new MoneyDecimal(0);
    };
    const m = (k: string) => this.methodAccount(settings, k as keyof typeof METHOD_ACCOUNTS);
    const checks: ErpGlCloseCheckDto[] = [];
    const push = (key: CloseCheckKey, expected: MoneyValue | null, actual: MoneyValue | null, detail: string | null, ok?: boolean) => {
      const diff = expected !== null && actual !== null ? expected.minus(actual) : null;
      checks.push({
        key,
        blocking: CLOSE_CHECKS.find((c) => c.key === key)!.blocking,
        ok: ok ?? (diff ? diff.abs().lte('0.005') : true),
        expected: expected === null ? null : money(expected),
        actual: actual === null ? null : money(actual),
        difference: diff === null ? null : money(diff),
        detail,
      });
    };

    // 1. stock valuation = inventory accounts
    const [stock] = await tx.$queryRaw<{ value: Prisma.Decimal; items: bigint }[]>(Prisma.sql`
      SELECT coalesce(sum(value), 0) AS value, count(DISTINCT item_id) AS items
        FROM erp_stock_movements WHERE factory_id = ${factoryId} AND occurred_at < ${nextDay}`);
    const inventoryCodes = new Set(Object.values({ ...ITEM_KIND_ACCOUNTS, ...(settings.itemKindAccounts as Record<string, string>) }));
    inventoryCodes.add(m('wip'));
    const inventoryLedger = [...inventoryCodes].reduce((a, code) => a.plus(bal(code)), new MoneyDecimal(0));
    push('stock_valuation', dec(stock!.value), inventoryLedger, `สินค้า ${Number(stock!.items)} รายการ · บัญชี ${[...inventoryCodes].sort().join(', ')}`);

    // 2. AP sub-ledger = trade payables
    const [ap] = await tx.$queryRaw<{ open: Prisma.Decimal }[]>(Prisma.sql`
      SELECT coalesce(sum(i.total), 0) - coalesce((
        SELECT sum(a.amount) FROM erp_payment_allocations a JOIN erp_supplier_payments p ON p.id = a.payment_id
          JOIN erp_supplier_invoices i2 ON i2.id = a.supplier_invoice_id
         WHERE i2.factory_id = ${factoryId} AND p.paid_on <= ${endDate}::date AND i2.invoice_date >= ${settings.ledgerStartOn}::date
           AND i2.invoice_date <= ${endDate}::date AND i2.status <> 'cancelled'), 0) AS open
        FROM erp_supplier_invoices i
       WHERE i.factory_id = ${factoryId} AND i.status <> 'cancelled' AND i.invoice_date >= ${settings.ledgerStartOn}::date
         AND i.invoice_date <= ${endDate}::date`);
    const [wht] = await tx.$queryRaw<{ wht: Prisma.Decimal }[]>(Prisma.sql`
      SELECT coalesce(sum(c.wht_amount), 0) AS wht FROM erp_wht_certificates c
       WHERE c.factory_id = ${factoryId} AND c.status = 'issued' AND c.paid_on >= ${settings.ledgerStartOn}::date AND c.paid_on <= ${endDate}::date`);
    const grir = bal(m('grir'));
    push('payables', dec(ap!.open).minus(dec(wht!.wht)), bal(m('payables')), `สินค้ารับแล้วยังไม่ได้รับใบแจ้งหนี้ ${money(grir)} · ใบแจ้งหนี้ตั้งแต่ ${dayOf(settings.ledgerStartOn)}`);

    // 3. AR sub-ledger = trade receivables
    const [ar] = await tx.$queryRaw<{ open: Prisma.Decimal }[]>(Prisma.sql`
      SELECT coalesce(sum(i.total), 0)
           - coalesce((SELECT sum(n.total) FROM erp_sales_notes n WHERE n.factory_id = ${factoryId} AND n.kind = 'credit' AND n.status = 'issued'
                        AND n.issue_date >= ${settings.ledgerStartOn}::date AND n.issue_date <= ${endDate}::date), 0)
           + coalesce((SELECT sum(n.total) FROM erp_sales_notes n WHERE n.factory_id = ${factoryId} AND n.kind = 'debit' AND n.status = 'issued'
                        AND n.issue_date >= ${settings.ledgerStartOn}::date AND n.issue_date <= ${endDate}::date), 0)
           - coalesce((SELECT sum(CASE WHEN r.kind = 'refund' THEN -(r.amount + r.wht_amount) ELSE r.amount + r.wht_amount END)
                         FROM erp_customer_receipts r WHERE r.factory_id = ${factoryId} AND r.status = 'issued'
                        AND r.received_on >= ${settings.ledgerStartOn}::date AND r.received_on <= ${endDate}::date), 0) AS open
        FROM erp_sales_invoices i
       WHERE i.factory_id = ${factoryId} AND i.status IN ('issued', 'partially_paid', 'paid')
         AND i.issue_date >= ${settings.ledgerStartOn}::date AND i.issue_date <= ${endDate}::date`);
    push('receivables', dec(ar!.open), bal(m('receivables')), `ใบแจ้งหนี้ ใบลด/เพิ่มหนี้ และใบเสร็จตั้งแต่ ${dayOf(settings.ledgerStartOn)}`);

    // 4. VAT registers = VAT accounts movement in the month
    const [vat] = await tx.$queryRaw<{ output: Prisma.Decimal; input: Prisma.Decimal }[]>(Prisma.sql`
      SELECT coalesce((SELECT sum(CASE WHEN i.status = 'voided' THEN 0 ELSE i.vat_amount END) FROM erp_sales_invoices i
                        WHERE i.factory_id = ${factoryId} AND i.is_tax_invoice AND i.invoice_no IS NOT NULL
                          AND i.issue_date >= ${p.startDate}::date AND i.issue_date <= ${endDate}::date), 0)
           + coalesce((SELECT sum(CASE WHEN n.status = 'voided' THEN 0 WHEN n.kind = 'credit' THEN -n.vat_amount ELSE n.vat_amount END) FROM erp_sales_notes n
                        WHERE n.factory_id = ${factoryId} AND n.is_tax_document AND n.note_no IS NOT NULL
                          AND n.issue_date >= ${p.startDate}::date AND n.issue_date <= ${endDate}::date), 0)
           + coalesce((SELECT sum(b.vat_amount) FROM billing_statements b
                        WHERE b.factory_id = ${factoryId} AND b.confirmed_at IS NOT NULL
                          AND (b.confirmed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN ${p.startDate}::date AND ${endDate}::date), 0) AS output,
             coalesce((SELECT sum(i.vat_amount) FROM erp_supplier_invoices i
                        WHERE i.factory_id = ${factoryId} AND i.tax_invoice_no IS NOT NULL AND i.status <> 'cancelled'
                          AND i.invoice_date >= ${p.startDate}::date AND i.invoice_date <= ${endDate}::date), 0) AS input`);
    const outputMove = bal(m('outputVat'), inPeriod);
    const inputMove = bal(m('inputVat'), inPeriod);
    push('vat', dec(vat!.output).minus(dec(vat!.input)), outputMove.minus(inputMove), `ตามเอกสาร: ภาษีขาย ${money(dec(vat!.output))} / ภาษีซื้อ ${money(dec(vat!.input))} · ตามบัญชี: ${money(outputMove)} / ${money(inputMove)}`);

    // 5. WHT registers = WHT payable movement in the month
    const [whtMonth] = await tx.$queryRaw<{ pnd3: Prisma.Decimal; pnd53: Prisma.Decimal }[]>(Prisma.sql`
      SELECT coalesce(sum(CASE WHEN form = 'pnd3' THEN wht_amount END), 0) AS pnd3,
             coalesce(sum(CASE WHEN form = 'pnd53' THEN wht_amount END), 0) AS pnd53
        FROM erp_wht_certificates WHERE factory_id = ${factoryId} AND status = 'issued'
         AND paid_on >= ${p.startDate}::date AND paid_on <= ${endDate}::date`);
    push('wht', dec(whtMonth!.pnd3).plus(dec(whtMonth!.pnd53)), bal(m('whtPnd3'), inPeriod).plus(bal(m('whtPnd53'), inPeriod)), `ภ.ง.ด.3 ${money(dec(whtMonth!.pnd3))} · ภ.ง.ด.53 ${money(dec(whtMonth!.pnd53))} ตามหนังสือรับรอง`);

    // 6. bank reconciled: no open statement line up to the period end
    const banks = await tx.erpGlBankAccount.findMany({ where: { factoryId, status: 'active' }, include: { _count: { select: { statement: { where: { status: 'open', txnDate: { lte: endDate } } } } } } });
    const openLines = banks.reduce((n, b) => n + b._count.statement, 0);
    push('bank', null, null, banks.length === 0 ? 'ยังไม่มีบัญชีธนาคาร' : `รอกระทบ ${openLines} รายการ ใน ${banks.length} บัญชี`, openLines === 0);

    // 7. depreciation run posted (when there are active assets)
    const activeAssets = await tx.erpGlFixedAsset.count({ where: { factoryId, status: 'active', depreciationStart: { lte: endDate } } });
    const run = await tx.erpGlDepreciationRun.findUnique({ where: { periodId: p.id } });
    push('depreciation', null, null, activeAssets === 0 ? 'ไม่มีสินทรัพย์ที่ต้องคิดค่าเสื่อม' : run ? `บันทึกแล้ว ${money(dec(run.total))}` : `สินทรัพย์ ${activeAssets} รายการ ยังไม่คิดค่าเสื่อม`, activeAssets === 0 || !!run);

    // 8. open production orders at month end (information)
    const openMos = await tx.erpProductionOrder.count({
      where: { factoryId, status: { in: ['released', 'in_progress'] }, createdAt: { lt: nextDay } },
    });
    push('open_wip', null, bal(m('wip')), `ใบสั่งผลิตเปิดอยู่ ${openMos} ใบ · งานระหว่างทำ ${money(bal(m('wip')))}`, true);

    return {
      periodId: p.publicId,
      month: monthOf(p.startDate),
      status: p.status,
      checks,
      canClose: checks.every((c) => !c.blocking || c.ok),
      openProductionOrders: openMos,
    };
  }

  // ==================================================================================== posting core

  /** Validates draft lines against the chart and resolves dimensions to ids. */
  async validateLines(tx: Tx, factoryId: bigint, kind: JournalKind, lines: GlDraftLine[], reversesEntryId?: bigint | null): Promise<ValidatedGlLine[]> {
    if (lines.length < 2) throw new DomainException('erp.ledger_unbalanced', { params: { debit: '0.00', credit: '0.00' } });
    const accounts = await this.accountsByCode(tx, factoryId);
    let fromSubLedger = kind === 'auto' || kind === 'closing';
    if (kind === 'reversal' && reversesEntryId) {
      const original = await tx.erpGlJournalEntry.findUnique({ where: { id: reversesEntryId }, select: { kind: true } });
      fromSubLedger = original?.kind === 'auto';
    }
    const out: ValidatedGlLine[] = [];
    let debit = new MoneyDecimal(0);
    let credit = new MoneyDecimal(0);
    for (const line of lines) {
      const account = accounts.get(line.accountCode);
      const invalid = (reason: string) => new DomainException('erp.ledger_account_invalid', { params: { code: line.accountCode, reason } });
      if (!account) throw invalid('not in the chart of accounts');
      if (account.status !== 'active') throw invalid('inactive');
      if (!account.isPostable) throw invalid('a heading account');
      if (account.isControl && !fromSubLedger) throw invalid('a control account takes postings from documents only');
      const amount = dec(line.amount).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
      if (!amount.gt(0)) throw invalid('amounts must be positive');
      const dims: ValidatedGlLine['dims'] = {};
      for (const [key, raw] of Object.entries(line.dimensions ?? {})) {
        const spec = DIMENSION_LOOKUP[key];
        if (!spec || !raw) continue;
        const rows = await tx.$queryRaw<{ id: bigint }[]>(
          Prisma.sql`SELECT id FROM ${Prisma.raw(spec.table)} WHERE public_id = ${raw}::uuid AND factory_id = ${factoryId} LIMIT 1`,
        );
        if (rows[0]) dims[spec.column] = rows[0].id;
        else if (kind === 'manual') throw invalid(`unknown ${key} ${raw}`);
      }
      if (line.side === 'debit') debit = debit.plus(amount);
      else credit = credit.plus(amount);
      out.push({
        account,
        debit: line.side === 'debit' ? money(amount) : '0.00',
        credit: line.side === 'credit' ? money(amount) : '0.00',
        description: line.description?.slice(0, 300) ?? null,
        dims,
        taxCode: (line.taxCode as TaxCode | null | undefined) ?? null,
        taxBase: line.taxBase === null || line.taxBase === undefined ? null : money(dec(line.taxBase)),
      });
    }
    if (!debit.eq(credit)) throw new DomainException('erp.ledger_unbalanced', { params: { debit: money(debit), credit: money(credit) } });
    return out;
  }

  /** Writes a draft entry with its lines (status draft); `post` finalises it. */
  async createEntry(tx: Tx, factoryId: bigint, settings: ErpGlSettings, draft: GlDraft, status: 'draft' | 'pending_approval' = 'draft'): Promise<ErpGlJournalEntry> {
    const lines = await this.validateLines(tx, factoryId, draft.kind, draft.lines, draft.reversesEntryId);
    const { period, entryDate } = await this.postingPeriod(tx, factoryId, settings.fiscalYearStartMonth, draft.documentDate, draft.allowSoftClosed ?? false);
    const total = lines.reduce((a, l) => a.plus(l.debit), new MoneyDecimal(0));
    return tx.erpGlJournalEntry.create({
      data: {
        factoryId,
        periodId: period.id,
        entryDate: dateOnly(entryDate),
        documentDate: dateOnly(draft.documentDate),
        kind: draft.kind,
        status,
        sourceDocumentType: draft.source?.type ?? null,
        sourceDocumentPublicId: draft.source?.publicId ?? null,
        sourceDocumentNo: draft.source?.number ?? null,
        domainEventId: draft.domainEventId ?? null,
        postingRuleId: draft.postingRuleId ?? null,
        postingRuleVersionId: draft.postingRuleVersionId ?? null,
        reversesEntryId: draft.reversesEntryId ?? null,
        recurringJournalId: draft.recurringJournalId ?? null,
        autoReverseOn: draft.autoReverseOn ? dateOnly(draft.autoReverseOn) : null,
        description: draft.description.slice(0, 500) || '-',
        totalDebit: money(total),
        totalCredit: money(total),
        createdById: draft.createdById ?? null,
        approvedById: draft.approvedById ?? null,
        approvedAt: draft.approvedById ? new Date() : null,
        lines: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            accountId: l.account.id,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            ...l.dims,
            taxCode: l.taxCode,
            taxBaseAmount: l.taxBase,
            factoryId,
            periodId: period.id,
            entryDate: dateOnly(entryDate),
          })),
        },
      },
    });
  }

  /** Creates and posts in one go (automatic, recurring, reversal and closing entries). */
  async post(tx: Tx, factoryId: bigint, settings: ErpGlSettings, draft: GlDraft, actor: Actor): Promise<ErpGlJournalEntry> {
    const entry = await this.createEntry(tx, factoryId, settings, draft);
    return this.finalise(tx, entry, draft.allowSoftClosed ?? false, actor);
  }

  /** Posts an existing draft / pending entry (manual journals after approval); the period is chosen again now. */
  async postExisting(tx: Tx, settings: ErpGlSettings, entryId: bigint, actor: Actor, extra: { approvedById?: bigint | null; allowSoftClosed?: boolean } = {}) {
    const entry = await tx.erpGlJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
    if (entry.status === 'posted' || entry.status === 'rejected') throw new DomainException('erp.ledger_journal_not_editable', { params: { status: entry.status } });
    const { period, entryDate } = await this.postingPeriod(tx, entry.factoryId, settings.fiscalYearStartMonth, dayOf(entry.documentDate), extra.allowSoftClosed ?? false);
    const moved = await tx.erpGlJournalEntry.update({
      where: { id: entry.id },
      data: {
        periodId: period.id,
        entryDate: dateOnly(entryDate),
        approvedById: extra.approvedById ?? entry.approvedById,
        approvedAt: extra.approvedById ? new Date() : entry.approvedAt,
      },
    });
    return this.finalise(tx, moved, extra.allowSoftClosed ?? false, actor);
  }

  private async finalise(tx: Tx, entry: ErpGlJournalEntry, allowSoftClosed: boolean, actor: Actor): Promise<ErpGlJournalEntry> {
    const entryNo = await this.workspace.nextNumber(tx, entry.factoryId, 'jv', new Date(`${dayOf(entry.entryDate)}T12:00:00+07:00`));
    if (allowSoftClosed) await tx.$executeRaw`SELECT set_config('packio.erp_post_soft_closed', 'on', true)`;
    try {
      return await tx.erpGlJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: 'posted',
          entryNo,
          postedAt: new Date(),
          postedById: actorColumns(actor).actorUserId,
          rowVersion: { increment: 1 },
        },
      });
    } catch (error) {
      if (String(error).includes('erp.ledger_period_closed'))
        throw new DomainException('erp.ledger_period_closed', { params: { date: dayOf(entry.entryDate), status: 'closed' } });
      throw error;
    } finally {
      if (allowSoftClosed) await tx.$executeRaw`SELECT set_config('packio.erp_post_soft_closed', 'off', true)`;
    }
  }

  /** The reversal of a posted entry: mirrored lines, dated `documentDate`. */
  async reverse(tx: Tx, settings: ErpGlSettings, original: ErpGlJournalEntry, documentDate: string, reason: string, actor: Actor, createdById: bigint | null): Promise<ErpGlJournalEntry> {
    if (original.status !== 'posted') throw new DomainException('erp.ledger_journal_not_editable', { params: { status: original.status } });
    const existing = await tx.erpGlJournalEntry.findUnique({ where: { reversesEntryId: original.id } });
    if (existing) throw new DomainException('erp.ledger_already_posted', { params: { entryNo: existing.entryNo ?? existing.publicId } });
    const lines = await tx.erpGlJournalLine.findMany({ where: { entryId: original.id }, include: { account: true, item: true, partner: true, warehouse: true, productionOrder: true, machine: true, bankAccount: true }, orderBy: { lineNo: 'asc' } });
    return this.post(
      tx,
      original.factoryId,
      settings,
      {
        kind: 'reversal',
        documentDate,
        description: `กลับรายการ ${original.entryNo ?? ''} — ${reason}`.trim(),
        source: original.sourceDocumentType ? { type: original.sourceDocumentType, publicId: original.sourceDocumentPublicId!, number: original.sourceDocumentNo } : null,
        reversesEntryId: original.id,
        createdById,
        approvedById: createdById,
        lines: lines.map((l) => ({
          accountCode: l.account.code,
          side: dec(l.debit).gt(0) ? 'credit' : 'debit',
          amount: dec(l.debit).gt(0) ? dec(l.debit) : dec(l.credit),
          description: l.description,
          dimensions: {
            ...(l.item && { item: l.item.publicId }),
            ...(l.partner && { partner: l.partner.publicId }),
            ...(l.warehouse && { warehouse: l.warehouse.publicId }),
            ...(l.productionOrder && { productionOrder: l.productionOrder.publicId }),
            ...(l.machine && { machine: l.machine.publicId }),
            ...(l.bankAccount && { bankAccount: l.bankAccount.publicId }),
          },
          taxCode: l.taxCode,
          taxBase: l.taxBaseAmount ? dec(l.taxBaseAmount) : null,
        })),
      },
      actor,
    );
  }

  /** The lines of a section of the statements, by statement line (D-391). */
  statementLineOf(a: Pick<ErpGlAccount, 'statementLine'>): StatementLine {
    return a.statementLine as StatementLine;
  }

  /** Looks the user up for an actor (audit / "by" columns). */
  userActor(scope: ErpScope): UserActor {
    return scope.actor;
  }

  userName = userRef;
}
