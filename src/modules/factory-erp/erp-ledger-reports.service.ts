import { DomainException } from '@common/errors/domain.exception';
import { dateOnly, dayOf, monthEnd } from '@common/ledger-core/dates';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type ErpTx } from '@database/erp-prisma.service';
import { type ErpGlAccount, type ErpGlSettings, Prisma } from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { dec } from './erp.math';
import {
  type ErpGlBalanceSheetDto,
  type ErpGlCashFlowDto,
  type ErpGlDetailDto,
  type ErpGlProfitAndLossDto,
  type ErpGlStatementAccountDto,
  type ErpGlStatementSectionDto,
  type ErpGlStockValuationDto,
  type ErpGlTrialBalanceDto,
} from './erp-e6.dto';
import { type AccountBalance, accountRef, ErpLedgerService, money } from './erp-ledger.service';
import { ITEM_KIND_ACCOUNTS, type StatementLine } from './erp-ledger.template';
import { ErpLedgerJournalsService } from './erp-ledger-journals.service';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * E6 reports (D-391): trial balance, general-ledger detail with drill-down, profit and loss (month and year to
 * date, DBD layout by statement line), balance sheet with the current-year profit, cash flow (indirect, by the
 * accounts' cash-flow class) and the stock valuation against the inventory accounts. Every report read is
 * audited (the auditor role, D-396).
 */

const PL_SECTIONS: { key: string; lines: StatementLine[]; sign: 1 | -1 }[] = [
  { key: 'revenue', lines: ['revenue'], sign: -1 },
  { key: 'cost_of_sales', lines: ['cost_of_sales'], sign: 1 },
  { key: 'manufacturing_overhead', lines: ['manufacturing_overhead'], sign: 1 },
  { key: 'other_income', lines: ['other_income'], sign: -1 },
  { key: 'selling_admin', lines: ['selling_admin'], sign: 1 },
  { key: 'finance_cost', lines: ['finance_cost'], sign: 1 },
  { key: 'income_tax', lines: ['income_tax'], sign: 1 },
];
const BS_SECTIONS: { key: string; lines: StatementLine[]; sign: 1 | -1 }[] = [
  {
    key: 'assets',
    lines: [
      'cash',
      'trade_receivables',
      'other_receivables',
      'inventory',
      'tax_assets',
      'other_current_assets',
      'ppe',
      'accumulated_depreciation',
    ],
    sign: 1,
  },
  {
    key: 'liabilities',
    lines: [
      'trade_payables',
      'tax_liabilities',
      'accrued_expenses',
      'customer_advances',
      'other_current_liabilities',
      'long_term_loans',
    ],
    sign: -1,
  },
  { key: 'equity', lines: ['capital', 'retained_earnings', 'current_year_profit'], sign: -1 },
];
const PL_TYPES = new Set(['revenue', 'cost_of_sales', 'expense']);

@Injectable()
export class ErpLedgerReportsService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
    private readonly audit: AuditService,
    private readonly journals: ErpLedgerJournalsService,
  ) {}

  async closeYearDto(scope: ErpScope, yearPublicId: string, perms: ReadonlySet<string>) {
    const entry = await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const year = await tx.erpGlFiscalYear.findFirst({
        where: { factoryId: scope.factory.id, publicId: yearPublicId },
      });
      if (!year) throw new DomainException('http.not_found');
      const e = await this.closeYear(tx, scope, settings, year.id);
      if (!e) await tx.erpGlFiscalYear.update({ where: { id: year.id }, data: { locked: true } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'erp_ledger.year_closed',
        resourceType: 'erp_gl_fiscal_year',
        resourcePublicId: year.publicId,
        data: { label: year.label, entryNo: e?.entryNo ?? null },
      });
      await this.workspace.record(tx, scope, 'erp_ledger.year_closed', 'erp_gl_fiscal_year', year.publicId, {
        label: year.label,
      });
      return e;
    });
    return entry ? [await this.journals.get(scope, entry.publicId, perms)] : [];
  }

  private async open(scope: ErpScope, report: string, params: Record<string, unknown>) {
    const settings = await this.workspace.tx((tx) =>
      this.ledger.book(tx, scope.factory.id, scope.actor.userId),
    );
    await this.audit.record(this.workspace.db, {
      category: 'data_access',
      action: `erp_ledger.report_read`,
      resourceType: 'factory',
      resourcePublicId: scope.factory.publicId,
      data: { report, ...params },
      actor: scope.actor,
    });
    return settings;
  }

  private async accounts(factoryId: bigint): Promise<ErpGlAccount[]> {
    return this.workspace.db.erpGlAccount.findMany({ where: { factoryId }, orderBy: { code: 'asc' } });
  }

  private checkRange(from: string, to: string): void {
    if (to < from)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'invalid', message: 'Before `from`' }],
      });
  }

  /** The fiscal year start holding `day`. */
  private yearStart(settings: ErpGlSettings, day: string): string {
    const [y, m] = day.split('-').map(Number) as [number, number];
    const startYear = m >= settings.fiscalYearStartMonth ? y : y - 1;
    return `${startYear}-${String(settings.fiscalYearStartMonth).padStart(2, '0')}-01`;
  }

  // ==================================================================================== trial balance

  async trialBalance(scope: ErpScope, from: string, to: string): Promise<ErpGlTrialBalanceDto> {
    this.checkRange(from, to);
    await this.open(scope, 'trial_balance', { from, to });
    const db = this.workspace.db;
    const [accounts, opening, period] = await Promise.all([
      this.accounts(scope.factory.id),
      this.ledger.balances(db, scope.factory.id, { to: dayOf(dateOnly(addDays(from, -1))) }),
      this.ledger.balances(db, scope.factory.id, { from, to }),
    ]);
    let totalDebit = new MoneyDecimal(0);
    let totalCredit = new MoneyDecimal(0);
    const rows = accounts
      .filter((a) => a.isPostable && (opening.has(a.id) || period.has(a.id)))
      .map((a) => {
        const open = this.ledger.signed(opening.get(a.id));
        const p = period.get(a.id) ?? { debit: new MoneyDecimal(0), credit: new MoneyDecimal(0) };
        const closing = open.plus(p.debit).minus(p.credit);
        if (closing.gt(0)) totalDebit = totalDebit.plus(closing);
        else totalCredit = totalCredit.plus(closing.abs());
        return {
          account: accountRef(a),
          accountType: a.accountType,
          opening: money(open),
          debit: money(p.debit),
          credit: money(p.credit),
          closing: money(closing),
        };
      });
    return {
      from,
      to,
      rows,
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
      balanced: totalDebit.eq(totalCredit),
    };
  }

  // ======================================================================================= GL detail

  async detail(scope: ErpScope, accountCode: string, from: string, to: string): Promise<ErpGlDetailDto> {
    this.checkRange(from, to);
    await this.open(scope, 'general_ledger', { accountCode, from, to });
    const db = this.workspace.db;
    const account = await db.erpGlAccount.findFirst({
      where: { factoryId: scope.factory.id, code: accountCode },
    });
    if (!account) throw new DomainException('http.not_found');
    const opening = this.ledger.signed(
      (await this.ledger.balances(db, scope.factory.id, { to: addDays(from, -1) })).get(account.id),
    );
    const lines = await db.erpGlJournalLine.findMany({
      where: {
        accountId: account.id,
        entry: { status: 'posted' },
        entryDate: { gte: dateOnly(from), lte: dateOnly(to) },
      },
      include: { entry: true },
      orderBy: [{ entryDate: 'asc' }, { entry: { entryNo: 'asc' } }, { lineNo: 'asc' }],
    });
    let balance = opening;
    const rows = lines.map((l) => {
      balance = balance.plus(dec(l.debit)).minus(dec(l.credit));
      const e = l.entry;
      return {
        entryId: e.publicId,
        entryNo: e.entryNo!,
        entryDate: dayOf(l.entryDate),
        description: l.description ?? e.description,
        source:
          e.sourceDocumentType && e.sourceDocumentPublicId
            ? { type: e.sourceDocumentType, id: e.sourceDocumentPublicId, number: e.sourceDocumentNo }
            : null,
        debit: money(dec(l.debit)),
        credit: money(dec(l.credit)),
        balance: money(balance),
      };
    });
    return { account: accountRef(account), from, to, opening: money(opening), rows, closing: money(balance) };
  }

  // ================================================================================== P&L / BS / CF

  private sections(
    accounts: ErpGlAccount[],
    specs: { key: string; lines: StatementLine[]; sign: 1 | -1 }[],
    amount: (a: ErpGlAccount) => MoneyValue,
    comparative: ((a: ErpGlAccount) => MoneyValue) | null,
    extra: Partial<Record<StatementLine, ErpGlStatementAccountDto[]>> = {},
  ): ErpGlStatementSectionDto[] {
    return specs.map((spec) => {
      const lines = spec.lines.map((line) => {
        const rows: ErpGlStatementAccountDto[] = accounts
          .filter((a) => a.isPostable && a.statementLine === line)
          .map((a) => ({
            account: accountRef(a),
            amount: money(amount(a).times(spec.sign)),
            comparative: comparative ? money(comparative(a).times(spec.sign)) : null,
          }))
          .filter((r) => r.amount !== '0.00' || (r.comparative !== null && r.comparative !== '0.00'));
        rows.push(...(extra[line] ?? []));
        const total = rows.reduce((t, r) => t.plus(dec(r.amount)), new MoneyDecimal(0));
        const ctotal = comparative
          ? rows.reduce((t, r) => t.plus(dec(r.comparative ?? 0)), new MoneyDecimal(0))
          : null;
        return {
          key: line,
          accounts: rows,
          amount: money(total),
          comparative: ctotal === null ? null : money(ctotal),
        };
      });
      const total = lines.reduce((t, l) => t.plus(dec(l.amount)), new MoneyDecimal(0));
      const ctotal = comparative
        ? lines.reduce((t, l) => t.plus(dec(l.comparative ?? 0)), new MoneyDecimal(0))
        : null;
      return {
        key: spec.key,
        lines,
        amount: money(total),
        comparative: ctotal === null ? null : money(ctotal),
      };
    });
  }

  /** Net profit (credit-positive) of P&L accounts in a balance map. */
  private netProfit(accounts: ErpGlAccount[], map: Map<bigint, AccountBalance>): MoneyValue {
    return accounts
      .filter((a) => PL_TYPES.has(a.accountType))
      .reduce((t, a) => t.minus(this.ledger.signed(map.get(a.id))), new MoneyDecimal(0));
  }

  async profitAndLoss(scope: ErpScope, month: string): Promise<ErpGlProfitAndLossDto> {
    const settings = await this.open(scope, 'profit_and_loss', { month });
    const from = `${month}-01`;
    const to = monthEnd(from);
    const yearStart = this.yearStart(settings, from);
    const db = this.workspace.db;
    const [accounts, monthMap, ytdMap] = await Promise.all([
      this.accounts(scope.factory.id),
      this.ledger.balances(db, scope.factory.id, { from, to }),
      this.ledger.balances(db, scope.factory.id, { from: yearStart, to }),
    ]);
    const sections = this.sections(
      accounts.filter((a) => PL_TYPES.has(a.accountType)),
      PL_SECTIONS,
      (a) => this.ledger.signed(monthMap.get(a.id)),
      (a) => this.ledger.signed(ytdMap.get(a.id)),
    );
    const of = (key: string) => dec(sections.find((s) => s.key === key)?.amount ?? 0);
    const revenue = of('revenue');
    const costOfSales = of('cost_of_sales').plus(of('manufacturing_overhead'));
    const expenses = of('selling_admin').plus(of('finance_cost')).plus(of('income_tax'));
    return {
      month,
      yearStart,
      sections,
      revenue: money(revenue),
      costOfSales: money(costOfSales),
      grossProfit: money(revenue.minus(costOfSales)),
      expenses: money(expenses),
      netProfit: money(this.netProfit(accounts, monthMap)),
      netProfitYtd: money(this.netProfit(accounts, ytdMap)),
    };
  }

  async balanceSheet(scope: ErpScope, asOf: string): Promise<ErpGlBalanceSheetDto> {
    const settings = await this.open(scope, 'balance_sheet', { asOf });
    const yearStart = this.yearStart(settings, asOf);
    const comparativeAsOf = dayOf(dateOnly(addDays(yearStart, -1)));
    const db = this.workspace.db;
    const [accounts, now, before, nowYtd, beforeYtd] = await Promise.all([
      this.accounts(scope.factory.id),
      this.ledger.balances(db, scope.factory.id, { to: asOf }),
      this.ledger.balances(db, scope.factory.id, { to: comparativeAsOf }),
      this.ledger.balances(db, scope.factory.id, { from: yearStart, to: asOf }),
      this.ledger.balances(db, scope.factory.id, {
        from: this.yearStart(settings, comparativeAsOf),
        to: comparativeAsOf,
      }),
    ]);
    const bsAccounts = accounts.filter((a) => !PL_TYPES.has(a.accountType));
    // P&L accounts not yet closed to retained earnings sit in equity as the current-year profit
    const profitNow = this.netProfit(accounts, nowYtd).plus(this.unclosedPriorProfit(accounts, now, nowYtd));
    const profitBefore = this.netProfit(accounts, beforeYtd).plus(
      this.unclosedPriorProfit(accounts, before, beforeYtd),
    );
    const retained = accounts.find((a) => a.statementLine === 'current_year_profit') ?? null;
    const extra: Partial<Record<StatementLine, ErpGlStatementAccountDto[]>> = {
      current_year_profit: [
        {
          account: retained
            ? accountRef(retained)
            : { id: scope.factory.publicId, code: '3300', name: 'กำไรขาดทุนปีปัจจุบัน' },
          amount: money(profitNow),
          comparative: money(profitBefore),
        },
      ],
    };
    const sections = this.sections(
      bsAccounts,
      BS_SECTIONS,
      (a) => this.ledger.signed(now.get(a.id)),
      (a) => this.ledger.signed(before.get(a.id)),
      extra,
    );
    const of = (key: string) => dec(sections.find((s) => s.key === key)?.amount ?? 0);
    const totalAssets = of('assets');
    const totalLiabilities = of('liabilities');
    const totalEquity = of('equity');
    return {
      asOf,
      comparativeAsOf,
      sections,
      totalAssets: money(totalAssets),
      totalLiabilities: money(totalLiabilities),
      totalEquity: money(totalEquity),
      currentYearProfit: money(profitNow),
      balanced: totalAssets.minus(totalLiabilities).minus(totalEquity).abs().lte('0.005'),
    };
  }

  /** P&L balances from before the fiscal year that were never closed (no closing entry): still equity. */
  private unclosedPriorProfit(
    accounts: ErpGlAccount[],
    all: Map<bigint, AccountBalance>,
    ytd: Map<bigint, AccountBalance>,
  ): MoneyValue {
    return this.netProfit(accounts, all).minus(this.netProfit(accounts, ytd));
  }

  async cashFlow(scope: ErpScope, from: string, to: string): Promise<ErpGlCashFlowDto> {
    this.checkRange(from, to);
    await this.open(scope, 'cash_flow', { from, to });
    const db = this.workspace.db;
    const [accounts, period, opening, closing] = await Promise.all([
      this.accounts(scope.factory.id),
      this.ledger.balances(db, scope.factory.id, { from, to }),
      this.ledger.balances(db, scope.factory.id, { to: addDays(from, -1) }),
      this.ledger.balances(db, scope.factory.id, { to }),
    ]);
    const netProfit = this.netProfit(accounts, period);
    const isCash = (a: ErpGlAccount) => a.cashFlowClass === 'cash';
    const bs = accounts.filter((a) => a.isPostable && !PL_TYPES.has(a.accountType) && !isCash(a));
    // a balance-sheet account's increase (debit) uses cash, a decrease frees it; P&L non-cash items add back
    const change = (a: ErpGlAccount) => this.ledger.signed(period.get(a.id)).negated();
    const nonCashPl = accounts.filter(
      (a) => a.isPostable && PL_TYPES.has(a.accountType) && a.cashFlowClass === 'non_cash',
    );
    const nonCash = nonCashPl.reduce(
      (t, a) => t.plus(this.ledger.signed(period.get(a.id))),
      new MoneyDecimal(0),
    );
    const section = (
      key: 'operating' | 'investing' | 'financing',
      extraRows: ErpGlStatementAccountDto[] = [],
    ) => {
      const rows = bs
        .filter(
          (a) =>
            a.cashFlowClass === key ||
            (key === 'operating' && a.cashFlowClass === 'non_cash' && a.accountType !== 'equity'),
        )
        .map((a) => ({ account: accountRef(a), amount: money(change(a)), comparative: null }))
        .filter((r) => r.amount !== '0.00');
      const all = [...extraRows, ...rows];
      return {
        key,
        accounts: all,
        amount: money(all.reduce((t, r) => t.plus(dec(r.amount)), new MoneyDecimal(0))),
      };
    };
    const equityRows = bs
      .filter((a) => a.accountType === 'equity' && a.cashFlowClass !== 'financing')
      .map((a) => ({ account: accountRef(a), amount: money(change(a)), comparative: null }))
      .filter((r) => r.amount !== '0.00');
    const sections = [
      section('operating', [
        {
          account: { id: scope.factory.publicId, code: 'NP', name: 'กำไรสุทธิ' },
          amount: money(netProfit),
          comparative: null,
        },
        ...nonCashPl
          .map((a) => ({
            account: accountRef(a),
            amount: money(this.ledger.signed(period.get(a.id))),
            comparative: null,
          }))
          .filter((r) => r.amount !== '0.00'),
      ]),
      section('investing'),
      { ...section('financing', equityRows) },
    ];
    const cashAccounts = accounts.filter((a) => a.isPostable && isCash(a));
    const openingCash = cashAccounts.reduce(
      (t, a) => t.plus(this.ledger.signed(opening.get(a.id))),
      new MoneyDecimal(0),
    );
    const closingCash = cashAccounts.reduce(
      (t, a) => t.plus(this.ledger.signed(closing.get(a.id))),
      new MoneyDecimal(0),
    );
    return {
      from,
      to,
      netProfit: money(netProfit),
      nonCash: money(nonCash),
      sections,
      netChange: money(closingCash.minus(openingCash)),
      openingCash: money(openingCash),
      closingCash: money(closingCash),
    };
  }

  // ================================================================================= stock valuation

  async stockValuation(scope: ErpScope, asOf: string): Promise<ErpGlStockValuationDto> {
    const settings = await this.open(scope, 'stock_valuation', { asOf });
    const db = this.workspace.db;
    const next = new Date(`${dayOf(dateOnly(addDays(asOf, 1)))}T00:00:00+07:00`);
    const [stock, accounts, balances] = await Promise.all([
      db.$queryRaw<{ kind: string; value: Prisma.Decimal; items: bigint }[]>(Prisma.sql`
        SELECT i.kind::text AS kind, coalesce(sum(m.value), 0) AS value, count(DISTINCT m.item_id) AS items
          FROM erp_stock_movements m JOIN erp_items i ON i.id = m.item_id
         WHERE m.factory_id = ${scope.factory.id} AND m.occurred_at < ${next}
         GROUP BY i.kind`),
      this.accounts(scope.factory.id),
      this.ledger.balances(db, scope.factory.id, { to: asOf }),
    ]);
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const kinds = Object.keys(ITEM_KIND_ACCOUNTS);
    const rows = kinds.map((kind) => {
      const code = this.ledger.itemKindAccount(settings, kind);
      const account = byCode.get(code);
      const s = stock.find((r) => r.kind === kind);
      const stockValue = dec(s?.value ?? 0);
      const sameAccount = kinds.filter((k) => this.ledger.itemKindAccount(settings, k) === code);
      const ledgerBalance = account
        ? this.ledger.signed(balances.get(account.id)).div(sameAccount.length)
        : new MoneyDecimal(0);
      return {
        kind,
        account: account ? accountRef(account) : { id: scope.factory.publicId, code, name: code },
        items: Number(s?.items ?? 0),
        stockValue: money(stockValue),
        ledgerBalance: money(ledgerBalance),
        difference: money(stockValue.minus(ledgerBalance)),
      };
    });
    const stockValue = rows.reduce((t, r) => t.plus(dec(r.stockValue)), new MoneyDecimal(0));
    const ledgerBalance = rows.reduce((t, r) => t.plus(dec(r.ledgerBalance)), new MoneyDecimal(0));
    return {
      asOf,
      rows,
      stockValue: money(stockValue),
      ledgerBalance: money(ledgerBalance),
      difference: money(stockValue.minus(ledgerBalance)),
    };
  }

  /** Year-end closing (D-390): P&L balances of the fiscal year to retained earnings, dated the year end. */
  async closeYear(tx: ErpTx, scope: ErpScope, settings: ErpGlSettings, yearId: bigint) {
    const year = await tx.erpGlFiscalYear.findFirstOrThrow({
      where: { id: yearId, factoryId: scope.factory.id },
      include: { periods: true },
    });
    // months 1 – 11 closed, the last month soft-closed: the closing entry lands in it, then it closes (D-390)
    const last = year.periods.reduce((a, p) => (p.periodNo > a.periodNo ? p : a));
    const open = year.periods.filter((p) =>
      p.id === last.id ? p.status !== 'soft_closed' : p.status !== 'closed' && p.status !== 'locked',
    );
    if (open.length > 0)
      throw new DomainException('erp.ledger_close_blocked', {
        params: { count: open.length, items: open.map((p) => dayOf(p.startDate).slice(0, 7)).join(', ') },
      });
    if (year.closingEntryId)
      throw new DomainException('erp.ledger_already_posted', { params: { entryNo: 'closing' } });
    const accounts = await tx.erpGlAccount.findMany({ where: { factoryId: scope.factory.id } });
    const balances = await this.ledger.balances(tx, scope.factory.id, { to: dayOf(year.endDate) });
    const retained = this.ledger.methodAccount(settings, 'retainedEarnings');
    const lines = accounts
      .filter((a) => PL_TYPES.has(a.accountType))
      .map((a) => ({ a, bal: this.ledger.signed(balances.get(a.id)) }))
      .filter((x) => !x.bal.isZero())
      .map((x) => ({
        accountCode: x.a.code,
        side: x.bal.gt(0) ? ('credit' as const) : ('debit' as const),
        amount: x.bal.abs(),
        description: null,
      }));
    const net = lines.reduce(
      (t, l) => (l.side === 'credit' ? t.minus(l.amount) : t.plus(l.amount)),
      new MoneyDecimal(0),
    );
    if (lines.length === 0) return null;
    lines.push({
      accountCode: retained,
      side: net.gt(0) ? 'credit' : 'debit',
      amount: net.abs(),
      description: null,
    });
    // the closed periods take the closing entry: post into the last period of the year, allowed by the close permission
    const entry = await this.ledger.post(
      tx,
      scope.factory.id,
      settings,
      {
        kind: 'closing',
        documentDate: dayOf(year.endDate),
        description: `ปิดบัญชีปี ${year.label}`,
        createdById: scope.actor.userId,
        approvedById: scope.actor.userId,
        allowSoftClosed: true,
        lines,
      },
      scope.actor,
    );
    await tx.erpGlFiscalYear.update({
      where: { id: year.id },
      data: { locked: true, closingEntryId: entry.id },
    });
    return entry;
  }
}

function addDays(day: string, n: number): string {
  const d = dateOnly(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}
