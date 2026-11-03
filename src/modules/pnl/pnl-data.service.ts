import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { FixedAssetsService } from '@modules/fixed-assets/fixed-assets.service';
import { Injectable } from '@nestjs/common';

import { type Balance, type GlAmount, type MonthInfo, signedAmount } from './pnl-auto';
import {
  type ClassRevenueCost,
  type CustomerMonthRevenue,
  monthsFrom,
  type PipelineLead,
} from './pnl-engine';
import { type PnlGlMapping, type PnlLineCatalogue, type PnlLineKey } from './pnl-lines';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal((v ?? 0).toString());

/** `YYYY-MM` → the first day as a date. */
export const monthDate = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

interface GlRow {
  code: string;
  rule_key: string | null;
  month: string;
  debit: Prisma.Decimal | null;
  credit: Prisma.Decimal | null;
  n: number;
}

/** A journal line passes a mapping entry when its account matches and its posting rule passes the filters. */
export function matchesMapping(mapping: PnlGlMapping, code: string, ruleKey: string | null): boolean {
  if (mapping.code !== code) return false;
  if (mapping.onlyRules?.length && (ruleKey === null || !mapping.onlyRules.includes(ruleKey))) return false;
  if (mapping.excludeRules?.length && ruleKey !== null && mapping.excludeRules.includes(ruleKey))
    return false;
  return true;
}

/**
 * D-472: what the P&L planner reads — the posted ledger by fiscal-period month (a late posting belongs to the period
 * it was posted in, §1.4), the open pipeline with each agent plan's effective rate, AR / AP balances, the fixed-asset
 * register. Reads only; nothing here writes.
 */
@Injectable()
export class PnlDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fixedAssets: FixedAssetsService,
  ) {}

  /** Status of each month's fiscal period (null = no period). */
  async periodStatus(entityId: bigint, months: string[]): Promise<Map<string, MonthInfo['periodStatus']>> {
    const rows = await this.prisma.fiscalPeriod.findMany({
      where: { entityId, startDate: { in: months.map(monthDate) } },
      select: { startDate: true, status: true },
    });
    return new Map(rows.map((r) => [monthOf(r.startDate), r.status]));
  }

  /** Posted lines grouped by account, effective posting rule (a reversal takes its original's) and month. */
  private async glRows(entityId: bigint, codes: string[], from: string, to: string): Promise<GlRow[]> {
    if (codes.length === 0) return [];
    return this.prisma.$queryRaw<GlRow[]>`
      SELECT a.code, coalesce(pr.key, rpr.key) AS rule_key, to_char(fp.start_date, 'YYYY-MM') AS month,
             sum(l.debit) AS debit, sum(l.credit) AS credit, count(*)::int AS n
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id
      LEFT JOIN posting_rules pr ON pr.id = e.posting_rule_id
      LEFT JOIN journal_entries re ON re.id = e.reverses_entry_id
      LEFT JOIN posting_rules rpr ON rpr.id = re.posting_rule_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId}
        AND fp.start_date >= ${monthDate(from)}::date AND fp.start_date <= ${monthDate(to)}::date
        AND a.code = ANY(${codes}::text[])
      GROUP BY 1, 2, 3`;
  }

  /** Amount per mapped line and month (the line's normal side), with the number of journal lines. */
  async glByLine(
    entityId: bigint,
    catalogue: PnlLineCatalogue,
    keys: PnlLineKey[],
    from: string,
    to: string,
  ): Promise<Map<PnlLineKey, Map<string, GlAmount>>> {
    const codes = [...new Set(keys.flatMap((k) => catalogue.lines[k].glAccounts.map((g) => g.code)))];
    const rows = await this.glRows(entityId, codes, from, to);
    const out = new Map<PnlLineKey, Map<string, GlAmount>>();
    for (const key of keys) {
      const mapping = catalogue.lines[key].glAccounts;
      if (mapping.length === 0) continue;
      const byMonth = new Map<string, { debit: MoneyValue; credit: MoneyValue; lines: number }>();
      for (const r of rows) {
        if (!mapping.some((g) => matchesMapping(g, r.code, r.rule_key))) continue;
        const m = byMonth.get(r.month) ?? { debit: D(0), credit: D(0), lines: 0 };
        m.debit = m.debit.add(D(r.debit));
        m.credit = m.credit.add(D(r.credit));
        m.lines += r.n;
        byMonth.set(r.month, m);
      }
      out.set(
        key,
        new Map(
          [...byMonth].map(([month, m]) => [
            month,
            { amount: signedAmount(key, m.debit, m.credit), lines: m.lines },
          ]),
        ),
      );
    }
    return out;
  }

  /** Goods revenue per customer (company, else person) and month of the window, for the repeat run rate. */
  async revenueByCustomer(
    entityId: bigint,
    catalogue: PnlLineCatalogue,
    window: string[],
  ): Promise<CustomerMonthRevenue[]> {
    const mapping = catalogue.lines.revenue_goods.glAccounts;
    if (mapping.length === 0 || window.length === 0) return [];
    const rows = await this.prisma.$queryRaw<(Omit<GlRow, 'n'> & { customer_key: string | null })[]>`
      SELECT a.code, coalesce(pr.key, rpr.key) AS rule_key, to_char(fp.start_date, 'YYYY-MM') AS month,
             coalesce('c:' || l.company_id::text, 'u:' || l.customer_user_id::text) AS customer_key,
             sum(l.debit) AS debit, sum(l.credit) AS credit
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id
      LEFT JOIN posting_rules pr ON pr.id = e.posting_rule_id
      LEFT JOIN journal_entries re ON re.id = e.reverses_entry_id
      LEFT JOIN posting_rules rpr ON rpr.id = re.posting_rule_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId}
        AND fp.start_date >= ${monthDate(window[0]!)}::date AND fp.start_date <= ${monthDate(window.at(-1)!)}::date
        AND a.code = ANY(${mapping.map((g) => g.code)}::text[])
        AND (l.company_id IS NOT NULL OR l.customer_user_id IS NOT NULL)
      GROUP BY 1, 2, 3, 4`;
    return rows
      .filter((r) => r.customer_key && mapping.some((g) => matchesMapping(g, r.code, r.rule_key)))
      .map((r) => ({
        customerKey: r.customer_key!,
        month: r.month,
        amount: signedAmount('revenue_goods', D(r.debit), D(r.credit)).toFixed(2),
      }));
  }

  /** Goods revenue and factory cost by product class (product type code) over the window. */
  async revenueCostByClass(
    entityId: bigint,
    catalogue: PnlLineCatalogue,
    window: string[],
  ): Promise<ClassRevenueCost[]> {
    const revenue = catalogue.lines.revenue_goods.glAccounts;
    const cost = catalogue.lines.factory_cost.glAccounts;
    if (revenue.length === 0 || cost.length === 0 || window.length === 0) return [];
    const rows = await this.prisma.$queryRaw<(Omit<GlRow, 'n' | 'month'> & { class_key: string })[]>`
      SELECT a.code, coalesce(pr.key, rpr.key) AS rule_key, coalesce(pt.code, 'unclassified') AS class_key,
             sum(l.debit) AS debit, sum(l.credit) AS credit
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id
      LEFT JOIN product_types pt ON pt.id = l.product_type_id
      LEFT JOIN posting_rules pr ON pr.id = e.posting_rule_id
      LEFT JOIN journal_entries re ON re.id = e.reverses_entry_id
      LEFT JOIN posting_rules rpr ON rpr.id = re.posting_rule_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId}
        AND fp.start_date >= ${monthDate(window[0]!)}::date AND fp.start_date <= ${monthDate(window.at(-1)!)}::date
        AND a.code = ANY(${[...revenue, ...cost].map((g) => g.code)}::text[])
      GROUP BY 1, 2, 3`;
    const byClass = new Map<string, { revenue: MoneyValue; cost: MoneyValue }>();
    for (const r of rows) {
      const c = byClass.get(r.class_key) ?? { revenue: D(0), cost: D(0) };
      if (revenue.some((g) => matchesMapping(g, r.code, r.rule_key)))
        c.revenue = c.revenue.add(signedAmount('revenue_goods', D(r.debit), D(r.credit)));
      if (cost.some((g) => matchesMapping(g, r.code, r.rule_key)))
        c.cost = c.cost.add(signedAmount('factory_cost', D(r.debit), D(r.credit)));
      byClass.set(r.class_key, c);
    }
    return [...byClass].map(([classKey, c]) => ({
      classKey,
      revenue: c.revenue.toFixed(2),
      cost: c.cost.toFixed(2),
    }));
  }

  /**
   * Opening and closing balance per month of the given accounts (debit-normal: debit − credit; credit-normal:
   * credit − debit). Null when no account is mapped.
   */
  async balances(
    entityId: bigint,
    codes: string[],
    creditNormal: boolean,
    from: string,
    to: string,
  ): Promise<Map<string, Balance> | null> {
    if (codes.length === 0) return null;
    const [before] = await this.prisma.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
      SELECT sum(l.debit - l.credit) AS amount
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId} AND fp.start_date < ${monthDate(from)}::date
        AND a.code = ANY(${codes}::text[])`;
    const moves = await this.prisma.$queryRaw<{ month: string; amount: Prisma.Decimal | null }[]>`
      SELECT to_char(fp.start_date, 'YYYY-MM') AS month, sum(l.debit - l.credit) AS amount
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id
      WHERE e.status = 'posted' AND l.entity_id = ${entityId}
        AND fp.start_date >= ${monthDate(from)}::date AND fp.start_date <= ${monthDate(to)}::date
        AND a.code = ANY(${codes}::text[])
      GROUP BY 1`;
    const sign = creditNormal ? -1 : 1;
    const byMonth = new Map(moves.map((m) => [m.month, D(m.amount).mul(sign)]));
    const out = new Map<string, Balance>();
    let running = D(before?.amount).mul(sign);
    const [fy, fm] = from.split('-').map(Number) as [number, number];
    const [ty, tm] = to.split('-').map(Number) as [number, number];
    for (const month of monthsFrom(from, (ty - fy) * 12 + (tm - fm) + 1)) {
      const closing = running.add(byMonth.get(month) ?? 0);
      out.set(month, { opening: running, closing });
      running = closing;
    }
    return out;
  }

  /**
   * Open customer leads of active agents and reps with an expected value (D-468 pipeline), each with its agent
   * plan's effective first-order rate. Factory leads are history (D-464) and never counted.
   */
  async pipeline(now: Date): Promise<(PipelineLead & { leadId: string })[]> {
    const leads = await this.prisma.salesAgentLead.findMany({
      where: {
        kind: 'customer',
        status: 'registered',
        stage: { in: ['new', 'contacted', 'quoted', 'negotiating'] },
        expectedValue: { gt: 0 },
        agent: { status: 'active' },
      },
      select: {
        publicId: true,
        stage: true,
        expectedValue: true,
        agent: { select: { kind: true, planId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const planIds = [...new Set(leads.map((l) => l.agent.planId))];
    const versions = await this.prisma.salesAgentPlanVersion.findMany({
      where: { planId: { in: planIds }, status: 'approved', effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { planId: true, firstOrderPct: true },
    });
    const rate = new Map<bigint, string>();
    for (const v of versions) if (!rate.has(v.planId)) rate.set(v.planId, v.firstOrderPct.toFixed(4));
    return leads.map((l) => ({
      leadId: l.publicId,
      value: l.expectedValue!.toFixed(2),
      stage: l.stage,
      agentKind: l.agent.kind,
      ratePct: rate.get(l.agent.planId) ?? null,
    }));
  }

  /** Straight-line depreciation the register will post in each month (active assets, as the monthly run computes). */
  async depreciation(
    entityId: bigint,
    months: string[],
  ): Promise<{ byMonth: Map<string, MoneyValue>; assetCount: number }> {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { entityId, status: { in: ['active', 'fully_depreciated'] } },
      select: {
        id: true,
        cost: true,
        residualValue: true,
        usefulLifeMonths: true,
        depreciationStartOn: true,
      },
    });
    const byMonth = new Map<string, MoneyValue>();
    for (const month of months) {
      const start = monthDate(month);
      const prev = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
      byMonth.set(
        month,
        assets.reduce(
          (a, asset) =>
            a.add(
              this.fixedAssets
                .expectedAccumulated(asset, start)
                .sub(this.fixedAssets.expectedAccumulated(asset, prev)),
            ),
          D(0),
        ),
      );
    }
    return { byMonth, assetCount: assets.length };
  }
}
