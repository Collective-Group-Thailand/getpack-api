import { createHash } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { addMonths, dateOnly, dayOf, monthEnd } from '@common/ledger-core/dates';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type ErpGlTaxReturn, Prisma } from '@generated/prisma/client';
import { bankFileAdapter, BankFileError, type StatementRow } from '@integrations/bank-files/bank-files';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { dec } from './erp.math';
import {
  type ErpGlAssetCategoryDto,
  type ErpGlAssetDto,
  type ErpGlAssetListQuery,
  type ErpGlBankAccountDto,
  type ErpGlBankLineDto,
  type ErpGlBankLineListQuery,
  type ErpGlBankMatchDto,
  type ErpGlCashPositionDto,
  type ErpGlCreateAssetDto,
  type ErpGlDepreciationRunDto,
  type ErpGlDisposeAssetDto,
  type ErpGlImportResultDto,
  type ErpGlImportStatementDto,
  type ErpGlMarkFiledDto,
  type ErpGlMatchBankLineDto,
  type ErpGlSaveAssetCategoryDto,
  type ErpGlSaveBankAccountDto,
  type ErpGlTaxFilingDto,
} from './erp-e6.dto';
import { accountRef, ErpLedgerService, money } from './erp-ledger.service';
import { ErpLedgerPostingService } from './erp-ledger-posting.service';
import { isoTs } from './erp-sales.shared';
import { ErpTaxService } from './erp-tax.service';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * E6 fixed assets, bank and tax filings (D-392 – D-394): asset categories and the register, the monthly
 * straight-line depreciation run that catches up missed months (posted with F16 in the same transaction),
 * disposals (F16D); bank accounts as sub-accounts of 1120, statement import (rows, or a CSV through getpack's
 * bank-file adapters) with auto-matching against supplier payments and customer receipts, manual matches, fees
 * and interest (F18), the cash position; the monthly VAT / WHT returns reconciled ledger ↔ documents and marked filed.
 */

const ASSET_INCLUDE = { category: true, machine: true } satisfies Prisma.ErpGlFixedAssetInclude;
type AssetRow = Prisma.ErpGlFixedAssetGetPayload<{ include: typeof ASSET_INCLUDE }>;
const ASSET_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_asset.dispose', permissions: ['factory_ledger.post'], irreversible: true, when: (a) => a.status === 'active' },
];
const BANK_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_bank.edit', permissions: ['factory_ledger.configure'], when: () => true },
  { key: 'erp_bank.import', permissions: ['factory_ledger.post'], when: (b) => b.status === 'active' },
];
const LINE_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_bank_line.match', permissions: ['factory_ledger.post'], when: (l) => l.status === 'open' },
  { key: 'erp_bank_line.ignore', permissions: ['factory_ledger.post'], when: (l) => l.status === 'open' },
  { key: 'erp_bank_line.unmatch', permissions: ['factory_ledger.post'], when: (l) => l.status !== 'open' },
];
const FILING_ACTIONS: ActionRule<{ filed: boolean; due: boolean }>[] = [
  { key: 'erp_tax.mark_filed', permissions: ['factory_tax.file'], when: (f) => !f.filed && f.due },
];
const MATCH_DAYS = 3;

/** Straight-line monthly depreciation (D-393): (cost − salvage) / life, the last month takes the remainder. */
export function monthlyDepreciation(cost: MoneyValue, salvage: MoneyValue, lifeMonths: number): MoneyValue {
  return cost.minus(salvage).div(lifeMonths).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
}

/** What one run charges an asset: every month from the last charged up to `month`, capped at the depreciable base. */
export function depreciationDue(a: {
  cost: MoneyValue;
  salvage: MoneyValue;
  lifeMonths: number;
  start: string;
  opening: MoneyValue;
  accumulated: MoneyValue;
  monthsDone: number;
  month: string;
}): { months: number; amount: MoneyValue } {
  const startMonth = a.start.slice(0, 7);
  if (a.month < startMonth) return { months: 0, amount: new MoneyDecimal(0) };
  const [sy, sm] = startMonth.split('-').map(Number) as [number, number];
  const [my, mm] = a.month.split('-').map(Number) as [number, number];
  const elapsed = (my - sy) * 12 + (mm - sm) + 1;
  const months = Math.max(0, Math.min(elapsed, a.lifeMonths) - a.monthsDone);
  const base = a.cost.minus(a.salvage);
  const left = base.minus(a.opening).minus(a.accumulated);
  if (months === 0 || !left.gt(0)) return { months: 0, amount: new MoneyDecimal(0) };
  const per = monthlyDepreciation(a.cost, a.salvage, a.lifeMonths);
  const amount = a.monthsDone + months >= a.lifeMonths ? left : MoneyDecimal.min(left, per.times(months));
  return { months, amount: amount.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP) };
}

/** A statement line's identity (D-394): the same line imported twice is skipped. */
export function lineHash(bankAccountId: string, r: { txnDate: string; amount: string; description: string; reference: string | null }, seq: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update([bankAccountId, r.txnDate, dec(r.amount).toFixed(2), r.description.trim(), r.reference ?? '', String(seq)].join('|')).digest());
}

@Injectable()
export class ErpLedgerAssetsService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
    private readonly posting: ErpLedgerPostingService,
    private readonly tax: ErpTaxService,
    private readonly audit: AuditService,
  ) {}

  // ====================================================================================== categories

  private async account(tx: Tx, factoryId: bigint, code: string, path: string) {
    const a = await tx.erpGlAccount.findFirst({ where: { factoryId, code } });
    if (!a || !a.isPostable || a.status !== 'active')
      throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message: `${code} is not a postable active account` }] });
    return a;
  }

  async listCategories(scope: ErpScope): Promise<ErpGlAssetCategoryDto[]> {
    await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rows = await this.workspace.db.erpGlAssetCategory.findMany({
      where: { factoryId: scope.factory.id },
      include: { assetAccount: true, accumulatedAccount: true, expenseAccount: true, gainLossAccount: true, _count: { select: { assets: { where: { status: 'active' } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.publicId,
      name: c.name,
      usefulLifeMonths: c.usefulLifeMonths,
      assetAccount: accountRef(c.assetAccount),
      accumulatedAccount: accountRef(c.accumulatedAccount),
      expenseAccount: accountRef(c.expenseAccount),
      gainLossAccount: accountRef(c.gainLossAccount),
      status: c.status,
      assets: c._count.assets,
    }));
  }

  async saveCategory(scope: ErpScope, publicId: string | null, body: ErpGlSaveAssetCategoryDto): Promise<ErpGlAssetCategoryDto[]> {
    await this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const f = scope.factory.id;
      const data = {
        name: body.name,
        usefulLifeMonths: body.usefulLifeMonths,
        assetAccountId: (await this.account(tx, f, body.assetAccountCode, 'assetAccountCode')).id,
        accumulatedAccountId: (await this.account(tx, f, body.accumulatedAccountCode, 'accumulatedAccountCode')).id,
        expenseAccountId: (await this.account(tx, f, body.expenseAccountCode, 'expenseAccountCode')).id,
        gainLossAccountId: (await this.account(tx, f, body.gainLossAccountCode, 'gainLossAccountCode')).id,
        status: (body.status as 'active' | 'inactive' | undefined) ?? 'active',
      };
      const clash = await tx.erpGlAssetCategory.findFirst({ where: { factoryId: f, name: body.name, ...(publicId && { NOT: { publicId } }) } });
      if (clash) throw new DomainException('validation.failed', { errors: [{ path: 'name', code: 'duplicate', message: `${body.name} already exists` }] });
      if (publicId) {
        const c = await tx.erpGlAssetCategory.findFirst({ where: { factoryId: f, publicId } });
        if (!c) throw new DomainException('http.not_found');
        await tx.erpGlAssetCategory.update({ where: { id: c.id }, data });
      } else {
        await tx.erpGlAssetCategory.create({ data: { ...data, factoryId: f, createdById: scope.actor.userId } });
      }
      await this.workspace.record(tx, scope, 'erp_asset_category.saved', 'factory', scope.factory.publicId, { name: body.name });
    });
    return this.listCategories(scope);
  }

  // ========================================================================================== assets

  assetDto(a: AssetRow, perms: ReadonlySet<string>): ErpGlAssetDto {
    const accumulated = dec(a.accumulated).plus(dec(a.openingAccumulated));
    return {
      id: a.publicId,
      assetNo: a.assetNo,
      name: a.name,
      category: { id: a.category.publicId, name: a.category.name },
      machine: a.machine ? { id: a.machine.publicId, name: a.machine.name } : null,
      acquiredOn: dayOf(a.acquiredOn),
      cost: money(dec(a.cost)),
      salvageValue: money(dec(a.salvageValue)),
      usefulLifeMonths: a.usefulLifeMonths,
      depreciationStart: dayOf(a.depreciationStart),
      monthlyDepreciation: money(monthlyDepreciation(dec(a.cost), dec(a.salvageValue), a.usefulLifeMonths)),
      accumulated: money(accumulated),
      netBookValue: money(a.status === 'active' ? dec(a.cost).minus(accumulated) : new MoneyDecimal(0)),
      monthsDepreciated: a.monthsDepreciated,
      status: a.status,
      disposedOn: a.disposedOn ? dayOf(a.disposedOn) : null,
      proceeds: a.proceeds === null ? null : money(dec(a.proceeds)),
      note: a.note,
      nextActions: nextActions({ status: a.status }, ASSET_ACTIONS, perms),
      version: a.rowVersion,
    };
  }

  async listAssets(scope: ErpScope, q: ErpGlAssetListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpGlFixedAssetWhereInput = {
      factoryId: scope.factory.id,
      ...(q.status && { status: q.status as 'active' }),
      ...(q.categoryId && { category: { publicId: q.categoryId } }),
    };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpGlFixedAsset.findMany({ where, include: ASSET_INCLUDE, orderBy: { assetNo: 'asc' }, ...toSkipTake(q) }),
      this.workspace.db.erpGlFixedAsset.count({ where }),
    ]);
    return paginated(rows.map((a) => this.assetDto(a, perms)), total, q);
  }

  async getAsset(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlAssetDto> {
    const a = await this.workspace.db.erpGlFixedAsset.findFirst({ where: { factoryId: scope.factory.id, publicId }, include: ASSET_INCLUDE });
    if (!a) throw new DomainException('http.not_found');
    return this.assetDto(a, perms);
  }

  /**
   * Registers an asset (D-393). Its acquisition is posted by the supplier invoice that bought it (or an opening
   * journal); the register carries depreciation and disposal only.
   */
  async createAsset(scope: ErpScope, body: ErpGlCreateAssetDto, perms: ReadonlySet<string>): Promise<ErpGlAssetDto> {
    const id = await this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const category = await tx.erpGlAssetCategory.findFirst({ where: { factoryId: scope.factory.id, publicId: body.categoryId } });
      if (!category) throw new DomainException('http.not_found');
      if (category.status !== 'active') throw new DomainException('erp.archived', { params: { name: category.name } });
      const machine = body.machineId ? await tx.factoryMachine.findFirst({ where: { factoryId: scope.factory.id, publicId: body.machineId } }) : null;
      if (body.machineId && !machine) throw new DomainException('http.not_found');
      const cost = dec(body.cost);
      const salvage = dec(body.salvageValue ?? '0');
      const opening = dec(body.openingAccumulated ?? '0');
      if (!cost.gt(0) || salvage.gt(cost) || opening.gt(cost.minus(salvage)))
        throw new DomainException('validation.failed', { errors: [{ path: 'cost', code: 'invalid', message: 'cost > 0, salvage ≤ cost, opening accumulated ≤ cost − salvage' }] });
      const start = body.depreciationStart ?? addMonths(`${body.acquiredOn.slice(0, 7)}-01`, 1);
      const assetNo = await this.workspace.nextNumber(tx, scope.factory.id, 'fa', new Date(`${body.acquiredOn}T12:00:00+07:00`));
      const a = await tx.erpGlFixedAsset.create({
        data: {
          factoryId: scope.factory.id,
          categoryId: category.id,
          machineId: machine?.id ?? null,
          assetNo,
          name: body.name,
          acquiredOn: dateOnly(body.acquiredOn),
          cost: money(cost),
          salvageValue: money(salvage),
          usefulLifeMonths: body.usefulLifeMonths ?? category.usefulLifeMonths,
          depreciationStart: dateOnly(`${start.slice(0, 7)}-01`),
          openingAccumulated: money(opening),
          note: body.note ?? null,
          createdById: scope.actor.userId,
        },
      });
      await this.workspace.record(tx, scope, 'erp_fixed_asset.registered', 'erp_gl_fixed_asset', a.publicId, { assetNo });
      return a.publicId;
    });
    return this.getAsset(scope, id, perms);
  }

  async disposeAsset(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: ErpGlDisposeAssetDto, perms: ReadonlySet<string>): Promise<ErpGlAssetDto> {
    await this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const a = await tx.erpGlFixedAsset.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!a) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(a.publicId, a.rowVersion));
      if (a.status !== 'active') throw new DomainException('erp.ledger_asset_not_active', { params: { status: a.status } });
      const proceeds = dec(body.proceeds ?? '0');
      await tx.erpGlFixedAsset.update({
        where: { id: a.id },
        data: {
          status: proceeds.gt(0) ? 'disposed' : 'written_off',
          disposedOn: dateOnly(body.disposedOn),
          proceeds: money(proceeds),
          note: body.note ? (a.note ? `${a.note}\n${body.note}` : body.note) : a.note,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      const [entry] = await this.posting.postSync(tx, scope.factory.publicId, 'erp_fixed_asset.disposed', a.publicId, { bankAccountId: body.bankAccountId ?? null });
      if (entry) await tx.erpGlFixedAsset.update({ where: { id: a.id }, data: { disposalEntryId: entry.id } });
      await this.audit.record(tx, { category: 'finance', action: 'erp_ledger.asset_disposed', resourceType: 'erp_gl_fixed_asset', resourcePublicId: a.publicId, data: { proceeds: money(proceeds), entryNo: entry?.entryNo ?? null } });
      await this.workspace.record(tx, scope, 'erp_fixed_asset.disposed_recorded', 'erp_gl_fixed_asset', a.publicId, { entryNo: entry?.entryNo ?? null });
    });
    return this.getAsset(scope, publicId, perms);
  }

  // ===================================================================================== depreciation

  private async runDto(id: bigint): Promise<ErpGlDepreciationRunDto> {
    const r = await this.workspace.db.erpGlDepreciationRun.findUniqueOrThrow({
      where: { id },
      include: { period: true, entry: true, createdBy: true, lines: { include: { asset: true }, orderBy: { id: 'asc' } } },
    });
    return {
      id: r.publicId,
      month: dayOf(r.period.startDate).slice(0, 7),
      periodId: r.period.publicId,
      entry: r.entry ? { type: 'erp_gl_journal_entry', id: r.entry.publicId, number: r.entry.entryNo } : null,
      total: money(dec(r.total)),
      lines: r.lines.map((l) => ({
        asset: { id: l.asset.publicId, name: `${l.asset.assetNo} · ${l.asset.name}` },
        months: 0,
        amount: money(dec(l.amount)),
        accumulatedAfter: money(dec(l.asset.accumulated).plus(dec(l.asset.openingAccumulated))),
      })),
      createdBy: r.createdBy.displayName,
      createdAt: isoTs(r.createdAt)!,
    };
  }

  async listRuns(scope: ErpScope): Promise<ErpGlDepreciationRunDto[]> {
    const runs = await this.workspace.db.erpGlDepreciationRun.findMany({ where: { factoryId: scope.factory.id }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true } });
    return Promise.all(runs.map((r) => this.runDto(r.id)));
  }

  /** The depreciation of `month` (D-393): once per period, catching up months not yet charged, posted with F16. */
  async runDepreciation(scope: ErpScope, month: string): Promise<ErpGlDepreciationRunDto> {
    const id = await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const day = `${month}-01`;
      await this.ledger.ensureYear(tx, scope.factory.id, settings.fiscalYearStartMonth, day);
      const period = await tx.erpGlPeriod.findFirstOrThrow({ where: { factoryId: scope.factory.id, startDate: dateOnly(day) } });
      if (await tx.erpGlDepreciationRun.findUnique({ where: { periodId: period.id } })) throw new DomainException('erp.ledger_depreciation_done', { params: { month } });
      const assets = await tx.erpGlFixedAsset.findMany({ where: { factoryId: scope.factory.id, status: 'active', depreciationStart: { lte: dateOnly(monthEnd(day)) } } });
      const lines: { assetId: bigint; amount: MoneyValue; months: number }[] = [];
      for (const a of assets) {
        const due = depreciationDue({
          cost: dec(a.cost),
          salvage: dec(a.salvageValue),
          lifeMonths: a.usefulLifeMonths,
          start: dayOf(a.depreciationStart),
          opening: dec(a.openingAccumulated),
          accumulated: dec(a.accumulated),
          monthsDone: a.monthsDepreciated,
          month,
        });
        if (due.amount.gt(0)) lines.push({ assetId: a.id, amount: due.amount, months: due.months });
      }
      const total = lines.reduce((t, l) => t.plus(l.amount), new MoneyDecimal(0));
      const run = await tx.erpGlDepreciationRun.create({
        data: { factoryId: scope.factory.id, periodId: period.id, total: money(total), createdById: scope.actor.userId, lines: { create: lines.map((l) => ({ assetId: l.assetId, amount: money(l.amount) })) } },
      });
      for (const l of lines) {
        await tx.erpGlFixedAsset.update({ where: { id: l.assetId }, data: { accumulated: { increment: money(l.amount) }, monthsDepreciated: { increment: l.months } } });
      }
      if (total.gt(0)) {
        const [entry] = await this.posting.postSync(tx, scope.factory.publicId, 'erp_fixed_asset.depreciated', run.publicId);
        if (entry) await tx.erpGlDepreciationRun.update({ where: { id: run.id }, data: { entryId: entry.id } });
      }
      await this.audit.record(tx, { category: 'finance', action: 'erp_ledger.depreciation_run', resourceType: 'erp_gl_depreciation_run', resourcePublicId: run.publicId, data: { month, total: money(total), assets: lines.length } });
      await this.workspace.record(tx, scope, 'erp_fixed_asset.depreciation_run', 'erp_gl_depreciation_run', run.publicId, { month });
      return run.id;
    });
    return this.runDto(id);
  }

  // ============================================================================================ bank

  private async bankDto(id: bigint, perms: ReadonlySet<string>): Promise<ErpGlBankAccountDto> {
    const b = await this.workspace.db.erpGlBankAccount.findUniqueOrThrow({ where: { id }, include: { glAccount: true } });
    const [balances, open, last] = await Promise.all([
      this.ledger.balances(this.workspace.db, b.factoryId),
      this.workspace.db.erpGlBankStatementLine.count({ where: { bankAccountId: b.id, status: 'open' } }),
      this.workspace.db.erpGlBankStatementLine.findFirst({ where: { bankAccountId: b.id }, orderBy: { txnDate: 'desc' } }),
    ]);
    return {
      id: b.publicId,
      name: b.name,
      bankName: b.bankName,
      accountNoLast4: b.accountNoLast4,
      glAccount: accountRef(b.glAccount),
      isDefault: b.isDefault,
      status: b.status,
      ledgerBalance: money(this.ledger.signed(balances.get(b.glAccountId))),
      openLines: open,
      lastStatementDate: last ? dayOf(last.txnDate) : null,
      nextActions: nextActions({ status: b.status }, BANK_ACTIONS, perms),
      version: b.rowVersion,
    };
  }

  async listBanks(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpGlBankAccountDto[]> {
    await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rows = await this.workspace.db.erpGlBankAccount.findMany({ where: { factoryId: scope.factory.id }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true } });
    return Promise.all(rows.map((r) => this.bankDto(r.id, perms)));
  }

  /** A bank account gets its own sub-account of 1120 bank deposits (1121, 1122, …). */
  async createBank(scope: ErpScope, body: ErpGlSaveBankAccountDto, perms: ReadonlySet<string>): Promise<ErpGlBankAccountDto> {
    const id = await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const parentCode = this.ledger.methodAccount(settings, 'bank');
      const parent = await tx.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, code: parentCode } });
      if (!parent) throw new DomainException('erp.ledger_account_invalid', { params: { code: parentCode, reason: 'not in the chart of accounts' } });
      const siblings = await tx.erpGlAccount.findMany({ where: { factoryId: scope.factory.id, parentId: parent.id }, select: { code: true } });
      const used = new Set(siblings.map((s) => s.code));
      let n = 1;
      while (used.has(`${parentCode.slice(0, 3)}${n}`) && n < 9) n++;
      const code = n < 10 && !used.has(`${parentCode.slice(0, 3)}${n}`) ? `${parentCode.slice(0, 3)}${n}` : `${parentCode}.${siblings.length + 1}`;
      const gl = await tx.erpGlAccount.create({
        data: {
          factoryId: scope.factory.id,
          code,
          nameTh: `${body.bankName} ${body.name} xx${body.accountNoLast4}`,
          nameEn: `${body.bankName} ${body.name} xx${body.accountNoLast4}`,
          accountType: 'asset',
          normalSide: 'debit',
          parentId: parent.id,
          cashFlowClass: 'cash',
          statementLine: 'cash',
          createdById: scope.actor.userId,
        },
      });
      const first = (await tx.erpGlBankAccount.count({ where: { factoryId: scope.factory.id } })) === 0;
      if (body.isDefault) await tx.erpGlBankAccount.updateMany({ where: { factoryId: scope.factory.id }, data: { isDefault: false } });
      const b = await tx.erpGlBankAccount.create({
        data: { factoryId: scope.factory.id, name: body.name, bankName: body.bankName, accountNoLast4: body.accountNoLast4, glAccountId: gl.id, isDefault: body.isDefault ?? first, createdById: scope.actor.userId },
      });
      await this.workspace.record(tx, scope, 'erp_bank_account.created', 'erp_gl_bank_account', b.publicId, {});
      return b.id;
    });
    return this.bankDto(id, perms);
  }

  async updateBank(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: ErpGlSaveBankAccountDto, perms: ReadonlySet<string>): Promise<ErpGlBankAccountDto> {
    const id = await this.workspace.tx(async (tx) => {
      const b = await tx.erpGlBankAccount.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!b) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(b.publicId, b.rowVersion));
      if (body.isDefault) await tx.erpGlBankAccount.updateMany({ where: { factoryId: scope.factory.id }, data: { isDefault: false } });
      await tx.erpGlBankAccount.update({
        where: { id: b.id },
        data: { name: body.name, bankName: body.bankName, accountNoLast4: body.accountNoLast4, isDefault: body.isDefault ?? b.isDefault, status: (body.status as 'active' | undefined) ?? b.status, updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
      });
      await this.workspace.record(tx, scope, 'erp_bank_account.updated', 'erp_gl_bank_account', b.publicId, {});
      return b.id;
    });
    return this.bankDto(id, perms);
  }

  private async bank(tx: Tx, scope: ErpScope, publicId: string) {
    const b = await tx.erpGlBankAccount.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!b) throw new DomainException('http.not_found');
    return b;
  }

  async importStatement(scope: ErpScope, bankPublicId: string, body: ErpGlImportStatementDto): Promise<ErpGlImportResultDto> {
    let rows: { txnDate: string; amount: string; description: string; reference: string | null }[];
    if (body.file) {
      try {
        rows = bankFileAdapter(body.format ?? 'generic_csv').parseStatement(Buffer.from(body.file, 'base64')).map((r: StatementRow) => ({ txnDate: r.txnDate, amount: r.amount, description: r.description, reference: r.reference }));
      } catch (error) {
        throw new DomainException('erp.ledger_bank_file_invalid', { params: { reason: error instanceof BankFileError ? error.message : 'unreadable file' } });
      }
    } else rows = (body.rows ?? []).map((r) => ({ txnDate: r.txnDate, amount: r.amount, description: r.description, reference: r.reference ?? null }));
    if (rows.length === 0) throw new DomainException('erp.ledger_bank_file_invalid', { params: { reason: 'no statement lines' } });
    const result = await this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const b = await this.bank(tx, scope, bankPublicId);
      if (b.status !== 'active') throw new DomainException('erp.archived', { params: { name: b.name } });
      let imported = 0;
      let duplicates = 0;
      const seen = new Map<string, number>();
      const created: bigint[] = [];
      for (const r of rows) {
        const key = `${r.txnDate}|${r.amount}|${r.description}|${r.reference ?? ''}`;
        const seq = seen.get(key) ?? 0;
        seen.set(key, seq + 1);
        const hash = lineHash(b.publicId, { txnDate: r.txnDate, amount: r.amount, description: r.description, reference: r.reference ?? null }, seq);
        const exists = await tx.erpGlBankStatementLine.findUnique({ where: { bankAccountId_lineHash: { bankAccountId: b.id, lineHash: hash } } });
        if (exists || dec(r.amount).isZero()) {
          duplicates++;
          continue;
        }
        const line = await tx.erpGlBankStatementLine.create({
          data: { factoryId: scope.factory.id, bankAccountId: b.id, txnDate: dateOnly(r.txnDate), amount: money(dec(r.amount)), description: r.description.slice(0, 300), reference: r.reference ?? null, lineHash: hash, importedById: scope.actor.userId },
        });
        created.push(line.id);
        imported++;
      }
      let autoMatched = 0;
      for (const id of created) {
        const line = await tx.erpGlBankStatementLine.findUniqueOrThrow({ where: { id } });
        const suggestions = await this.suggest(tx, scope, line);
        if (suggestions.length === 1) {
          await this.applyMatch(tx, scope, line, suggestions[0]!, true);
          autoMatched++;
        }
      }
      await this.workspace.record(tx, scope, 'erp_bank_statement.imported', 'erp_gl_bank_account', b.publicId, { imported, duplicates, autoMatched });
      return { imported, duplicates, autoMatched };
    });
    return result;
  }

  /** Same amount within ±3 days among the factory's supplier payments (out) and customer receipts (in), not yet matched. */
  private async suggest(tx: Tx, scope: ErpScope, line: { id: bigint; txnDate: Date; amount: Prisma.Decimal }): Promise<ErpGlBankMatchDto[]> {
    const amount = dec(line.amount);
    const from = new Date(line.txnDate.getTime() - MATCH_DAYS * 86_400_000);
    const to = new Date(line.txnDate.getTime() + MATCH_DAYS * 86_400_000);
    const matched = new Set((await tx.erpGlBankMatch.findMany({ where: { line: { factoryId: scope.factory.id }, targetPublicId: { not: null } }, select: { targetPublicId: true } })).map((m) => m.targetPublicId!));
    const out: ErpGlBankMatchDto[] = [];
    const now = new Date().toISOString();
    if (amount.lt(0)) {
      const pays = await tx.erpSupplierPayment.findMany({ where: { factoryId: scope.factory.id, amount: money(amount.abs()), paidOn: { gte: from, lte: to }, method: { not: 'cash' } } });
      for (const p of pays) if (!matched.has(p.publicId)) out.push({ targetType: 'supplier_payment', targetId: p.publicId, targetNo: p.paymentNo, entry: null, amount: money(amount.abs()), auto: true, matchedBy: null, matchedAt: now });
    } else {
      const recs = await tx.erpCustomerReceipt.findMany({ where: { factoryId: scope.factory.id, status: 'issued', kind: 'receipt', amount: money(amount), receivedOn: { gte: from, lte: to }, method: { not: 'cash' } } });
      for (const r of recs) if (!matched.has(r.publicId)) out.push({ targetType: 'customer_receipt', targetId: r.publicId, targetNo: r.receiptNo, entry: null, amount: money(amount), auto: true, matchedBy: null, matchedAt: now });
    }
    return out;
  }

  private async applyMatch(tx: Tx, scope: ErpScope, line: { id: bigint; publicId: string; amount: Prisma.Decimal }, m: { targetType: string; targetId: string | null; targetNo: string | null }, auto: boolean) {
    let entryId: bigint | null = null;
    if (m.targetType === 'bank_fee' || m.targetType === 'interest') {
      const [entry] = await this.posting.postSync(tx, scope.factory.publicId, 'erp_bank_line.matched', line.publicId, { targetType: m.targetType });
      entryId = entry?.id ?? null;
    }
    if (m.targetType === 'journal_entry' && m.targetId) {
      const e = await tx.erpGlJournalEntry.findFirst({ where: { factoryId: scope.factory.id, publicId: m.targetId, status: 'posted' } });
      if (!e) throw new DomainException('http.not_found');
      entryId = e.id;
    }
    await tx.erpGlBankMatch.create({
      data: { lineId: line.id, targetType: m.targetType as 'bank_fee', targetPublicId: m.targetId, targetNo: m.targetNo, entryId, amount: money(dec(line.amount).abs()), auto, matchedById: auto ? null : scope.actor.userId },
    });
    await tx.erpGlBankStatementLine.update({ where: { id: line.id }, data: { status: 'matched' } });
  }

  private async lineDto(tx: Tx, scope: ErpScope, id: bigint, perms: ReadonlySet<string>): Promise<ErpGlBankLineDto> {
    const l = await tx.erpGlBankStatementLine.findUniqueOrThrow({ where: { id }, include: { bankAccount: true, matches: { include: { entry: true, matchedBy: true } } } });
    return {
      id: l.publicId,
      bankAccount: { id: l.bankAccount.publicId, name: l.bankAccount.name },
      txnDate: dayOf(l.txnDate),
      amount: money(dec(l.amount)),
      description: l.description,
      reference: l.reference,
      status: l.status,
      ignoreReason: l.ignoreReason,
      matches: l.matches.map((m) => ({
        targetType: m.targetType,
        targetId: m.targetPublicId,
        targetNo: m.targetNo,
        entry: m.entry ? { type: 'erp_gl_journal_entry', id: m.entry.publicId, number: m.entry.entryNo } : null,
        amount: money(dec(m.amount)),
        auto: m.auto,
        matchedBy: m.matchedBy?.displayName ?? null,
        matchedAt: isoTs(m.matchedAt)!,
      })),
      candidates: l.status === 'open' ? await this.suggest(tx, scope, l) : [],
      importedAt: isoTs(l.importedAt)!,
      nextActions: nextActions({ status: l.status }, LINE_ACTIONS, perms),
    };
  }

  async listLines(scope: ErpScope, q: ErpGlBankLineListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpGlBankStatementLineWhereInput = {
      factoryId: scope.factory.id,
      ...(q.bankAccountId && { bankAccount: { publicId: q.bankAccountId } }),
      ...(q.status && { status: q.status as 'open' }),
      ...(q.month && { txnDate: { gte: dateOnly(`${q.month}-01`), lt: dateOnly(addMonths(`${q.month}-01`, 1)) } }),
    };
    const db = this.workspace.db;
    const [rows, total] = await Promise.all([
      db.erpGlBankStatementLine.findMany({ where, orderBy: [{ txnDate: 'desc' }, { id: 'desc' }], select: { id: true }, ...toSkipTake(q) }),
      db.erpGlBankStatementLine.count({ where }),
    ]);
    const data: ErpGlBankLineDto[] = [];
    for (const r of rows) data.push(await this.lineDto(db, scope, r.id, perms));
    return paginated(data, total, q);
  }

  private async line(tx: Tx, scope: ErpScope, publicId: string) {
    const l = await tx.erpGlBankStatementLine.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!l) throw new DomainException('http.not_found');
    return l;
  }

  async matchLine(scope: ErpScope, publicId: string, body: ErpGlMatchBankLineDto, perms: ReadonlySet<string>): Promise<ErpGlBankLineDto> {
    return this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const l = await this.line(tx, scope, publicId);
      if (l.status !== 'open') throw new DomainException('erp.ledger_bank_line_settled', { params: { status: l.status } });
      let targetNo: string | null = null;
      if (body.targetType === 'supplier_payment' || body.targetType === 'customer_receipt' || body.targetType === 'journal_entry') {
        if (!body.targetId) throw new DomainException('validation.failed', { errors: [{ path: 'targetId', code: 'required', message: 'The payment, receipt or entry is required' }] });
        if (body.targetType === 'supplier_payment') {
          const p = await tx.erpSupplierPayment.findFirst({ where: { factoryId: scope.factory.id, publicId: body.targetId } });
          if (!p) throw new DomainException('http.not_found');
          targetNo = p.paymentNo;
        } else if (body.targetType === 'customer_receipt') {
          const r = await tx.erpCustomerReceipt.findFirst({ where: { factoryId: scope.factory.id, publicId: body.targetId } });
          if (!r) throw new DomainException('http.not_found');
          targetNo = r.receiptNo;
        }
      } else if (body.targetType === 'bank_fee' && dec(l.amount).gt(0)) {
        throw new DomainException('validation.failed', { errors: [{ path: 'targetType', code: 'invalid', message: 'A bank fee is a withdrawal' }] });
      } else if (body.targetType === 'interest' && dec(l.amount).lt(0)) {
        throw new DomainException('validation.failed', { errors: [{ path: 'targetType', code: 'invalid', message: 'Interest received is a deposit' }] });
      }
      await this.applyMatch(tx, scope, l, { targetType: body.targetType, targetId: body.targetId ?? null, targetNo }, false);
      await this.workspace.record(tx, scope, 'erp_bank_line.matched_recorded', 'erp_gl_bank_statement_line', l.publicId, { targetType: body.targetType });
      return this.lineDto(tx, scope, l.id, perms);
    });
  }

  async ignoreLine(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>): Promise<ErpGlBankLineDto> {
    return this.workspace.tx(async (tx) => {
      const l = await this.line(tx, scope, publicId);
      if (l.status !== 'open') throw new DomainException('erp.ledger_bank_line_settled', { params: { status: l.status } });
      await tx.erpGlBankStatementLine.update({ where: { id: l.id }, data: { status: 'ignored', ignoreReason: reason } });
      await this.workspace.record(tx, scope, 'erp_bank_line.ignored', 'erp_gl_bank_statement_line', l.publicId, {});
      return this.lineDto(tx, scope, l.id, perms);
    });
  }

  /** Undoes a match (a fee / interest entry is reversed) or an ignore. */
  async unmatchLine(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlBankLineDto> {
    return this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const l = await this.line(tx, scope, publicId);
      if (l.status === 'open') throw new DomainException('erp.ledger_bank_line_settled', { params: { status: l.status } });
      const matches = await tx.erpGlBankMatch.findMany({ where: { lineId: l.id }, include: { entry: true } });
      for (const m of matches) {
        if (m.entry && (m.targetType === 'bank_fee' || m.targetType === 'interest') && m.entry.status === 'posted')
          await this.ledger.reverse(tx, settings, m.entry, bangkokDate(new Date()), 'ยกเลิกการจับคู่รายการธนาคาร', scope.actor, scope.actor.userId);
      }
      await tx.erpGlBankMatch.deleteMany({ where: { lineId: l.id } });
      await tx.erpGlBankStatementLine.update({ where: { id: l.id }, data: { status: 'open', ignoreReason: null } });
      await this.workspace.record(tx, scope, 'erp_bank_line.unmatched', 'erp_gl_bank_statement_line', l.publicId, {});
      return this.lineDto(tx, scope, l.id, perms);
    });
  }

  async cashPosition(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpGlCashPositionDto> {
    const settings = await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const db = this.workspace.db;
    const today = bangkokDate(new Date());
    const week = dateOnly(dayOf(new Date(dateOnly(today).getTime() + 7 * 86_400_000)));
    const [banks, balances, cash, ap, ar] = await Promise.all([
      this.listBanks(scope, perms),
      this.ledger.balances(db, scope.factory.id),
      db.erpGlAccount.findFirst({ where: { factoryId: scope.factory.id, code: this.ledger.methodAccount(settings, 'cash') } }),
      db.erpSupplierInvoice.findMany({ where: { factoryId: scope.factory.id, status: { in: ['matched', 'approved', 'partially_paid'] }, dueDate: { lte: week } }, select: { payableAmount: true, paidAmount: true } }),
      db.erpSalesInvoice.findMany({ where: { factoryId: scope.factory.id, status: { in: ['issued', 'partially_paid'] }, dueDate: { lte: week } }, select: { total: true, creditedAmount: true, debitedAmount: true, receivedAmount: true } }),
    ]);
    const rows = await Promise.all(
      banks.map(async (b) => {
        const open = await db.erpGlBankStatementLine.aggregate({ where: { bankAccount: { publicId: b.id }, status: 'open' }, _sum: { amount: true } });
        return { account: b, unreconciled: money(dec(open._sum.amount ?? 0)) };
      }),
    );
    const cashOnHand = cash ? this.ledger.signed(balances.get(cash.id)) : new MoneyDecimal(0);
    const total = banks.reduce((t, b) => t.plus(dec(b.ledgerBalance)), cashOnHand);
    return {
      asOf: today,
      cashOnHand: money(cashOnHand),
      banks: rows,
      total: money(total),
      payablesDue7d: money(ap.reduce((t, i) => t.plus(dec(i.payableAmount)).minus(dec(i.paidAmount)), new MoneyDecimal(0))),
      receivablesDue7d: money(ar.reduce((t, i) => t.plus(dec(i.total)).minus(dec(i.creditedAmount)).plus(dec(i.debitedAmount)).minus(dec(i.receivedAmount)), new MoneyDecimal(0))),
    };
  }

  // ============================================================================================= tax

  /** The month's returns (D-392): ledger amount vs the E4 tax reports, due date, filing status. */
  async filings(scope: ErpScope, year: number | undefined, perms: ReadonlySet<string>): Promise<ErpGlTaxFilingDto[]> {
    const settings = await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const today = bangkokDate(new Date());
    const y = year ?? Number(today.slice(0, 4));
    const start = dayOf(settings.ledgerStartOn).slice(0, 7);
    const months: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      if (month >= start && month <= today.slice(0, 7)) months.push(month);
    }
    const filed = await this.workspace.db.erpGlTaxFiling.findMany({ where: { factoryId: scope.factory.id, month: { gte: dateOnly(`${y}-01-01`), lte: dateOnly(`${y}-12-01`) } } });
    const out: ErpGlTaxFilingDto[] = [];
    for (const month of months.reverse()) {
      for (const form of ['pp30', 'pnd3', 'pnd53'] as const) {
        if (form === 'pp30' && !scope.factory.isVatRegistered) continue;
        const { ledgerAmount, documentsAmount } = await this.amounts(scope, settings.methodAccounts as Record<string, string>, form, month);
        const f = filed.find((x) => x.form === form && dayOf(x.month).slice(0, 7) === month);
        if (!f && ledgerAmount.isZero() && documentsAmount.isZero() && form !== 'pp30') continue;
        const dueOn = `${addMonths(`${month}-01`, 1).slice(0, 7)}-15`;
        const monthOver = month < today.slice(0, 7);
        out.push({
          form,
          month,
          dueOn,
          ledgerAmount: money(ledgerAmount),
          documentsAmount: money(documentsAmount),
          reconciled: ledgerAmount.minus(documentsAmount).abs().lte('0.005'),
          filed: !!f,
          filedOn: f ? dayOf(f.filedOn) : null,
          reference: f?.reference ?? null,
          filedAmount: f ? money(dec(f.amount)) : null,
          note: f?.note ?? null,
          nextActions: nextActions({ filed: !!f, due: monthOver }, FILING_ACTIONS, perms),
        });
      }
    }
    return out;
  }

  private async amounts(scope: ErpScope, overrides: Record<string, string>, form: ErpGlTaxReturn, month: string) {
    const from = `${month}-01`;
    const to = monthEnd(from);
    const db = this.workspace.db;
    const accounts = await db.erpGlAccount.findMany({ where: { factoryId: scope.factory.id } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const balances = await this.ledger.balances(db, scope.factory.id, { from, to });
    const move = (key: string, fallback: string) => {
      const a = byCode.get(overrides[key] ?? fallback);
      return a ? this.ledger.natural(a, balances.get(a.id)) : new MoneyDecimal(0);
    };
    if (form === 'pp30') {
      // the sales register carries the getpack statements the factory confirmed (F14, D-397 / D-401)
      const [sales, purchases] = await Promise.all([this.tax.salesVat(scope, month), this.tax.purchaseVat(scope, month)]);
      return { ledgerAmount: move('outputVat', '2121').minus(move('inputVat', '1151')), documentsAmount: dec(sales.vat).minus(dec(purchases.vat)) };
    }
    const report = await this.tax.wht(scope, month, form);
    return { ledgerAmount: form === 'pnd3' ? move('whtPnd3', '2131') : move('whtPnd53', '2132'), documentsAmount: dec(report.whtAmount) };
  }

  async markFiled(scope: ErpScope, body: ErpGlMarkFiledDto, perms: ReadonlySet<string>): Promise<ErpGlTaxFilingDto[]> {
    await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const exists = await tx.erpGlTaxFiling.findUnique({ where: { factoryId_form_month: { factoryId: scope.factory.id, form: body.form as ErpGlTaxReturn, month: dateOnly(`${body.month}-01`) } } });
      if (exists) throw new DomainException('erp.ledger_tax_filed', { params: { form: body.form, month: body.month } });
      const amount = body.amount ? dec(body.amount) : (await this.amounts(scope, settings.methodAccounts as Record<string, string>, body.form as ErpGlTaxReturn, body.month)).ledgerAmount;
      const f = await tx.erpGlTaxFiling.create({
        data: { factoryId: scope.factory.id, form: body.form as ErpGlTaxReturn, month: dateOnly(`${body.month}-01`), filedOn: dateOnly(body.filedOn), reference: body.reference ?? null, amount: money(amount), note: body.note ?? null, createdById: scope.actor.userId },
      });
      await this.audit.record(tx, { category: 'finance', action: 'erp_ledger.tax_filed', resourceType: 'erp_gl_tax_filing', resourcePublicId: f.publicId, data: { form: body.form, month: body.month, amount: money(amount) } });
      await this.workspace.record(tx, scope, 'erp_tax.filed', 'erp_gl_tax_filing', f.publicId, { form: body.form, month: body.month });
    });
    return this.filings(scope, Number(body.month.slice(0, 4)), perms);
  }
}
