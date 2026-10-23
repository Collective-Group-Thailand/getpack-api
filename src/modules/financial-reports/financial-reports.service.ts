import { DomainException } from '@common/errors/domain.exception';
import { addMonths, dateOnly, dayOf, isDay, monthEnd } from '@common/ledger-core/dates';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { EntitiesService } from '@platform/entities/entities.service';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal((v ?? 0).toString());
const ZERO = () => new MoneyDecimal(0);
const m = (v: MoneyValue) => formatMoney(v);

export const PL_DIMENSIONS = [
  'none',
  'factory',
  'product_type',
  'channel',
  'campaign',
  'cost_centre',
] as const;
export type PlDimension = (typeof PL_DIMENSIONS)[number];

interface AccountMovement {
  id: bigint;
  code: string;
  name_th: string;
  name_en: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cost_of_sales' | 'expense';
  normal_side: 'debit' | 'credit';
  cash_flow_class: 'cash' | 'operating' | 'investing' | 'financing' | 'equity' | 'non_cash';
  is_postable: boolean;
  opening: Prisma.Decimal | null;
  debit: Prisma.Decimal | null;
  credit: Prisma.Decimal | null;
}

const BALANCE_SHEET = ['asset', 'liability', 'equity'];
const PROFIT_AND_LOSS = ['revenue', 'cost_of_sales', 'expense'];

/**
 * Financial reports from the posted ledger (accounting-design §6 GL, §1.7): trial balance, GL detail with
 * drill-down (journal → source document → domain event → user), balance sheet (with prior-year and current-year
 * profit computed while there are no closing entries), profit and loss by dimension (margin per factory, product
 * type, channel, campaign, cost centre — dimensions, not extra accounts, §3) and the indirect cash-flow statement
 * from each account's cash-flow class. Each report carries its own integrity check (Σ debit = Σ credit,
 * assets = liabilities + equity, cash change = cash accounts' movement).
 */
@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
  ) {}

  /** `YYYY-MM` .. `YYYY-MM` as dates (first day of `from`, last day of `to`). */
  range(from: string, to: string): { start: string; end: string } {
    const ok = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
    if (!ok(from) || !ok(to) || from > to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'from', code: 'range', message: 'from and to are YYYY-MM with from ≤ to' }],
      });
    return { start: `${from}-01`, end: monthEnd(`${to}-01`) };
  }

  private async movements(entityId: bigint, start: string, end: string): Promise<AccountMovement[]> {
    return this.prisma.$queryRaw<AccountMovement[]>`
      WITH mv AS (
        SELECT l.account_id,
               sum(CASE WHEN l.entry_date < ${dateOnly(start)}::date THEN l.debit - l.credit ELSE 0 END) AS opening,
               sum(CASE WHEN l.entry_date >= ${dateOnly(start)}::date THEN l.debit ELSE 0 END) AS debit,
               sum(CASE WHEN l.entry_date >= ${dateOnly(start)}::date THEN l.credit ELSE 0 END) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.status = 'posted' AND l.entity_id = ${entityId} AND l.entry_date <= ${dateOnly(end)}::date
        GROUP BY l.account_id)
      SELECT a.id, a.code, a.name_th, a.name_en, a.account_type::text AS account_type, a.normal_side::text AS normal_side,
             a.cash_flow_class::text AS cash_flow_class, a.is_postable, mv.opening, mv.debit, mv.credit
      FROM accounts a LEFT JOIN mv ON mv.account_id = a.id
      WHERE a.entity_id = ${entityId}
      ORDER BY a.code`;
  }

  // --- trial balance ------------------------------------------------------------------------------------------

  async trialBalance(from: string, to: string, includeZero = false) {
    const { start, end } = this.range(from, to);
    const entityId = await this.entities.defaultEntityId();
    const rows = (await this.movements(entityId, start, end))
      .map((a) => {
        const opening = D(a.opening);
        const debit = D(a.debit);
        const credit = D(a.credit);
        return { a, opening, debit, credit, closing: opening.add(debit).sub(credit) };
      })
      .filter((r) => includeZero || !(r.opening.isZero() && r.debit.isZero() && r.credit.isZero()));
    const sum = (f: (r: (typeof rows)[number]) => MoneyValue) => rows.reduce((s, r) => s.add(f(r)), ZERO());
    const totals = {
      opening: sum((r) => r.opening),
      debit: sum((r) => r.debit),
      credit: sum((r) => r.credit),
      closing: sum((r) => r.closing),
    };
    return {
      from,
      to,
      accounts: rows.map((r) => ({
        accountCode: r.a.code,
        nameTh: r.a.name_th,
        nameEn: r.a.name_en,
        accountType: r.a.account_type,
        normalSide: r.a.normal_side,
        opening: m(r.opening),
        debit: m(r.debit),
        credit: m(r.credit),
        closing: m(r.closing),
      })),
      totals: {
        opening: m(totals.opening),
        debit: m(totals.debit),
        credit: m(totals.credit),
        closing: m(totals.closing),
      },
      // Balances are debit-positive, so a balanced ledger sums to 0 and Σ debit = Σ credit.
      balanced: totals.opening.isZero() && totals.closing.isZero() && totals.debit.eq(totals.credit),
    };
  }

  // --- GL detail ----------------------------------------------------------------------------------------------

  async glDetail(accountCode: string, from: string, to: string, page: number, perPage: number) {
    const { start, end } = this.range(from, to);
    const entityId = await this.entities.defaultEntityId();
    const account = await this.prisma.account.findUnique({
      where: { entityId_code: { entityId, code: accountCode } },
    });
    if (!account) throw new DomainException('http.not_found');
    const base: Prisma.JournalLineWhereInput = { accountId: account.id, journalEntry: { status: 'posted' } };
    const before = await this.prisma.journalLine.aggregate({
      where: { ...base, entryDate: { lt: dateOnly(start) } },
      _sum: { debit: true, credit: true },
    });
    const within: Prisma.JournalLineWhereInput = {
      ...base,
      entryDate: { gte: dateOnly(start), lte: dateOnly(end) },
    };
    const skipped = (page - 1) * perPage;
    // The running balance of the page starts after the lines of earlier pages.
    const earlier = skipped
      ? await this.prisma.journalLine.findMany({
          where: within,
          orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
          take: skipped,
          select: { debit: true, credit: true },
        })
      : [];
    const [lines, total, sums] = await Promise.all([
      this.prisma.journalLine.findMany({
        where: within,
        include: {
          journalEntry: {
            select: {
              publicId: true,
              entryNo: true,
              jvNumber: true,
              kind: true,
              documentDate: true,
              description: true,
              sourceDocumentType: true,
              sourceDocumentPublicId: true,
              sourceDocumentNo: true,
              domainEventId: true,
              postedBy: { select: { publicId: true, displayName: true } },
              postingRule: { select: { key: true } },
            },
          },
          order: { select: { publicId: true, orderCode: true } },
          vendor: { select: { publicId: true, legalName: true } },
          customer: { select: { publicId: true, displayName: true } },
        },
        orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
        skip: skipped,
        take: perPage,
      }),
      this.prisma.journalLine.count({ where: within }),
      this.prisma.journalLine.aggregate({ where: within, _sum: { debit: true, credit: true } }),
    ]);
    const opening = D(before._sum.debit).sub(D(before._sum.credit));
    let running = earlier.reduce((s, l) => s.add(D(l.debit)).sub(D(l.credit)), opening);
    return {
      accountCode: account.code,
      nameTh: account.nameTh,
      from,
      to,
      opening: m(opening),
      debit: m(D(sums._sum.debit)),
      credit: m(D(sums._sum.credit)),
      closing: m(opening.add(D(sums._sum.debit)).sub(D(sums._sum.credit))),
      total,
      lines: lines.map((l) => {
        running = running.add(D(l.debit)).sub(D(l.credit));
        const e = l.journalEntry;
        return {
          journalEntryId: e.publicId,
          entryNo: e.entryNo,
          jvNumber: e.jvNumber,
          kind: e.kind,
          ruleKey: e.postingRule?.key ?? null,
          entryDate: dayOf(l.entryDate),
          documentDate: dayOf(e.documentDate),
          description: l.description ?? e.description,
          sourceType: e.sourceDocumentType,
          sourceId: e.sourceDocumentPublicId,
          sourceNo: e.sourceDocumentNo,
          domainEventId: e.domainEventId,
          postedBy: e.postedBy ? { id: e.postedBy.publicId, name: e.postedBy.displayName } : null,
          orderCode: l.order?.orderCode ?? null,
          vendorName: l.vendor?.legalName ?? null,
          customerName: l.customer?.displayName ?? null,
          taxCode: l.taxCode,
          debit: m(D(l.debit)),
          credit: m(D(l.credit)),
          balance: m(running),
        };
      }),
    };
  }

  // --- account roll-forward (U-B0.3) ----------------------------------------------------------------------

  /**
   * Month by month for one account, in its normal direction: opening, increases and decreases split by posting
   * rule (`manual` for journals without one), closing — so the screen never adds money up (§1.7).
   */
  async rollForward(accountCode: string, from: string, to: string) {
    const { start, end } = this.range(from, to);
    const entityId = await this.entities.defaultEntityId();
    const account = await this.prisma.account.findUnique({
      where: { entityId_code: { entityId, code: accountCode } },
    });
    if (!account) throw new DomainException('http.not_found');
    const sign = account.normalSide === 'debit' ? 1 : -1;
    const base: Prisma.JournalLineWhereInput = { accountId: account.id, journalEntry: { status: 'posted' } };
    const before = await this.prisma.journalLine.aggregate({
      where: { ...base, entryDate: { lt: dateOnly(start) } },
      _sum: { debit: true, credit: true },
    });
    const lines = await this.prisma.journalLine.findMany({
      where: { ...base, entryDate: { gte: dateOnly(start), lte: dateOnly(end) } },
      select: {
        entryDate: true,
        debit: true,
        credit: true,
        journalEntry: { select: { postingRule: { select: { key: true } } } },
      },
    });
    let balance = D(before._sum.debit).sub(D(before._sum.credit)).mul(sign);
    const months: {
      month: string;
      opening: string;
      increases: string;
      decreases: string;
      closing: string;
      byRule: { ruleKey: string; increase: string; decrease: string }[];
    }[] = [];
    for (let month = from; month <= to; month = addMonths(`${month}-01`, 1).slice(0, 7)) {
      const mine = lines.filter((l) => dayOf(l.entryDate).startsWith(month));
      const rules = new Map<string, { inc: MoneyValue; dec: MoneyValue }>();
      let inc = D(0);
      let dec = D(0);
      for (const l of mine) {
        const net = D(l.debit).sub(D(l.credit)).mul(sign);
        const key = l.journalEntry.postingRule?.key ?? 'manual';
        const r = rules.get(key) ?? { inc: D(0), dec: D(0) };
        if (net.gte(0)) {
          inc = inc.add(net);
          r.inc = r.inc.add(net);
        } else {
          dec = dec.add(net.neg());
          r.dec = r.dec.add(net.neg());
        }
        rules.set(key, r);
      }
      const opening = balance;
      balance = balance.add(inc).sub(dec);
      months.push({
        month,
        opening: m(opening),
        increases: m(inc),
        decreases: m(dec),
        closing: m(balance),
        byRule: [...rules]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ruleKey, r]) => ({ ruleKey, increase: m(r.inc), decrease: m(r.dec) })),
      });
    }
    return { accountCode: account.code, nameTh: account.nameTh, normalSide: account.normalSide, months };
  }

  // --- balance sheet --------------------------------------------------------------------------------------

  async balanceSheet(asOf: string) {
    if (!isDay(asOf))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'asOf', code: 'date', message: 'YYYY-MM-DD' }],
      });
    const entityId = await this.entities.defaultEntityId();
    const year = await this.prisma.fiscalYear.findFirst({
      where: { entityId, startDate: { lte: dateOnly(asOf) }, endDate: { gte: dateOnly(asOf) } },
    });
    const yearStart = year ? dayOf(year.startDate) : `${asOf.slice(0, 4)}-01-01`;
    // Opening = before the fiscal year; movement = the year to date: P&L before the year is prior-year profit.
    const rows = await this.movements(entityId, yearStart, asOf);
    const section = (type: string, sign: 1 | -1) =>
      rows
        .filter((a) => a.account_type === type)
        .map((a) => ({ a, balance: D(a.opening).add(D(a.debit)).sub(D(a.credit)).mul(sign) }))
        .filter((r) => !r.balance.isZero())
        .map((r) => ({
          accountCode: r.a.code,
          nameTh: r.a.name_th,
          nameEn: r.a.name_en,
          balance: m(r.balance),
        }));
    const total = (lines: { balance: string }[]) => lines.reduce((s, l) => s.add(l.balance), ZERO());
    const assets = section('asset', 1);
    const liabilities = section('liability', -1);
    const equity = section('equity', -1);
    const pl = rows.filter((a) => PROFIT_AND_LOSS.includes(a.account_type));
    const priorYears = pl.reduce((s, a) => s.sub(D(a.opening)), ZERO());
    const currentYear = pl.reduce((s, a) => s.add(D(a.credit)).sub(D(a.debit)), ZERO());
    const totalAssets = total(assets);
    const totalLiabilities = total(liabilities);
    const totalEquity = total(equity).add(priorYears).add(currentYear);
    const difference = totalAssets.sub(totalLiabilities).sub(totalEquity);
    return {
      asOf,
      fiscalYearStart: yearStart,
      assets,
      liabilities,
      equity,
      priorYearsProfit: m(priorYears),
      currentYearProfit: m(currentYear),
      totals: { assets: m(totalAssets), liabilities: m(totalLiabilities), equity: m(totalEquity) },
      difference: m(difference),
    };
  }

  // --- profit and loss by dimension -------------------------------------------------------------------------

  async profitAndLoss(from: string, to: string, dimension: PlDimension) {
    const { start, end } = this.range(from, to);
    const entityId = await this.entities.defaultEntityId();
    const column = {
      none: Prisma.sql`NULL::text`,
      factory: Prisma.sql`f.code || ' ' || f.legal_name`,
      product_type: Prisma.sql`pt.code`,
      channel: Prisma.sql`l.channel::text`,
      campaign: Prisma.sql`c.name`,
      cost_centre: Prisma.sql`cc.code`,
    }[dimension];
    const rows = await this.prisma.$queryRaw<
      { dim: string | null; account_type: string; code: string; amount: Prisma.Decimal }[]
    >`
      SELECT ${column} AS dim, a.account_type::text AS account_type, a.code, sum(l.credit - l.debit) AS amount
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      LEFT JOIN factories f ON f.id = l.factory_id
      LEFT JOIN product_types pt ON pt.id = l.product_type_id
      LEFT JOIN campaigns c ON c.id = l.campaign_id
      LEFT JOIN cost_centres cc ON cc.id = l.cost_centre_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId}
        AND l.entry_date BETWEEN ${dateOnly(start)}::date AND ${dateOnly(end)}::date
        AND a.account_type IN ('revenue', 'cost_of_sales', 'expense')
      GROUP BY 1, 2, 3
      ORDER BY 1 NULLS LAST, 3`;
    const groups = new Map<
      string,
      {
        revenue: MoneyValue;
        costOfSales: MoneyValue;
        expenses: MoneyValue;
        accounts: Map<string, MoneyValue>;
      }
    >();
    for (const r of rows) {
      const key = r.dim ?? '(none)';
      const g = groups.get(key) ?? {
        revenue: ZERO(),
        costOfSales: ZERO(),
        expenses: ZERO(),
        accounts: new Map<string, MoneyValue>(),
      };
      const amount = D(r.amount);
      if (r.account_type === 'revenue') g.revenue = g.revenue.add(amount);
      else if (r.account_type === 'cost_of_sales') g.costOfSales = g.costOfSales.sub(amount);
      else g.expenses = g.expenses.sub(amount);
      g.accounts.set(r.code, (g.accounts.get(r.code) ?? ZERO()).add(amount));
      groups.set(key, g);
    }
    const lines = [...groups.entries()].map(([key, g]) => {
      const gross = g.revenue.sub(g.costOfSales);
      return {
        dimension: key,
        revenue: m(g.revenue),
        costOfSales: m(g.costOfSales),
        grossMargin: m(gross),
        grossMarginPct: g.revenue.isZero() ? null : gross.div(g.revenue).mul(100).toFixed(2),
        expenses: m(g.expenses),
        netProfit: m(gross.sub(g.expenses)),
        accounts: [...g.accounts.entries()].map(([code, amount]) => ({
          accountCode: code,
          amount: m(amount),
        })),
      };
    });
    const total = (k: 'revenue' | 'costOfSales' | 'grossMargin' | 'expenses' | 'netProfit') =>
      m(lines.reduce((s, l) => s.add(l[k]), ZERO()));
    return {
      from,
      to,
      dimension,
      lines,
      totals: {
        revenue: total('revenue'),
        costOfSales: total('costOfSales'),
        grossMargin: total('grossMargin'),
        expenses: total('expenses'),
        netProfit: total('netProfit'),
      },
    };
  }

  // --- cash flow (indirect) -------------------------------------------------------------------------------

  /**
   * Net profit, then the movement of every balance-sheet account by its cash-flow class (a debit increase of
   * an asset uses cash: credit − debit); the result must equal the movement of the cash accounts.
   */
  async cashFlow(from: string, to: string) {
    const { start, end } = this.range(from, to);
    const entityId = await this.entities.defaultEntityId();
    const rows = await this.movements(entityId, start, end);
    const net = rows
      .filter((a) => PROFIT_AND_LOSS.includes(a.account_type))
      .reduce((s, a) => s.add(D(a.credit)).sub(D(a.debit)), ZERO());
    const sections: Record<
      'operating' | 'investing' | 'financing' | 'equity',
      { accountCode: string; nameTh: string; amount: string }[]
    > = { operating: [], investing: [], financing: [], equity: [] };
    let cash = ZERO();
    const totals = { operating: net, investing: ZERO(), financing: ZERO(), equity: ZERO() };
    for (const a of rows.filter((r) => BALANCE_SHEET.includes(r.account_type))) {
      const movement = D(a.credit).sub(D(a.debit));
      if (movement.isZero()) continue;
      if (a.cash_flow_class === 'cash') {
        cash = cash.sub(movement);
        continue;
      }
      const key = a.cash_flow_class === 'non_cash' ? 'operating' : a.cash_flow_class;
      totals[key] = totals[key].add(movement);
      sections[key].push({ accountCode: a.code, nameTh: a.name_th, amount: m(movement) });
    }
    const change = totals.operating.add(totals.investing).add(totals.financing).add(totals.equity);
    return {
      from,
      to,
      netProfit: m(net),
      operating: { adjustments: sections.operating, total: m(totals.operating) },
      investing: { lines: sections.investing, total: m(totals.investing) },
      financing: {
        lines: [...sections.financing, ...sections.equity],
        total: m(totals.financing.add(totals.equity)),
      },
      netChange: m(change),
      cashMovement: m(cash),
      difference: m(change.sub(cash)),
    };
  }

  /** Helper for the close: the balance of accounts at a date (debit-positive). */
  async balanceOf(entityId: bigint, codes: string[], asOf: string): Promise<MoneyValue> {
    const sum = await this.prisma.journalLine.aggregate({
      where: {
        entityId,
        account: { code: { in: codes } },
        entryDate: { lte: dateOnly(asOf) },
        journalEntry: { status: 'posted' },
      },
      _sum: { debit: true, credit: true },
    });
    return D(sum._sum.debit).sub(D(sum._sum.credit));
  }

  static previousMonth = (month: string) => addMonths(`${month}-01`, -1).slice(0, 7);
}
