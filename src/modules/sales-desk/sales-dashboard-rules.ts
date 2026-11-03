import { MoneyDecimal } from '@common/money/money';
import { addCalendarDays, bangkokDate, bangkokDayOfWeek } from '@common/time/bangkok';
import { csvCell } from '@modules/agents/agent-lead-rules';

import { slaPct } from './sales-desk-rules';

/**
 * D-469 item 5: the sales manager's dashboard, computed from plain rows (no I/O): funnel by stage with drop-off,
 * win rate, median days per stage (from the timeline's stage changes), by source, by rep, by period (Bangkok week —
 * Monday — or month), the inbound first-response SLA %, freelance vs employee. Money as decimal strings.
 */

export const FUNNEL_STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won'] as const;
const ORDER: Record<string, number> = { new: 0, contacted: 1, quoted: 2, negotiating: 3, won: 4 };
export const PERIODS = ['week', 'month'] as const;
export type Period = (typeof PERIODS)[number];

export interface DashLead {
  id: bigint;
  agentId: bigint;
  agentKind: 'employee' | 'freelance';
  stage: string;
  source: string;
  createdAt: Date;
  wonAt: Date | null;
  expectedValue: string | null;
}

export interface DashStageChange {
  leadId: bigint;
  to: string;
  at: Date;
}

export interface DashRep {
  agentId: bigint;
  agentPublicId: string;
  name: string;
}

export interface DashInbound {
  source: string;
  due: Date;
  respondedAt: Date | null;
}

const D = (v: string | number) => new MoneyDecimal(v);
const pct = (n: number, d: number) => (d === 0 ? null : ((n * 100) / d).toFixed(1));

/** The median of numbers, one decimal; null for none. */
export function median(values: readonly number[]): string | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return m.toFixed(1);
}

/** The Bangkok week (Monday, `YYYY-MM-DD`) or month (`YYYY-MM`) of an instant. */
export function periodKey(at: Date, period: Period): string {
  const day = bangkokDate(at);
  if (period === 'month') return day.slice(0, 7);
  const dow = bangkokDayOfWeek(at);
  return addCalendarDays(day, -((dow + 6) % 7));
}

function winRate(leads: readonly DashLead[]) {
  const won = leads.filter((l) => l.stage === 'won').length;
  const lost = leads.filter((l) => l.stage === 'lost').length;
  return { won, lost, winRatePct: pct(won, won + lost) };
}

export function buildDashboard(input: {
  leads: readonly DashLead[];
  changes: readonly DashStageChange[];
  reps: readonly DashRep[];
  inbound: readonly DashInbound[];
  period: Period;
  now: Date;
}) {
  const { leads, changes, reps, inbound, period, now } = input;
  const byLead = new Map<bigint, DashStageChange[]>();
  for (const c of changes) byLead.set(c.leadId, [...(byLead.get(c.leadId) ?? []), c]);
  for (const list of byLead.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Furthest funnel stage each lead reached (a lost lead keeps the stages it passed).
  const reached = (l: DashLead) =>
    Math.max(ORDER[l.stage] ?? 0, ...(byLead.get(l.id) ?? []).map((c) => ORDER[c.to] ?? 0), 0);
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    count: leads.filter((l) => reached(l) >= i).length,
  }));
  const funnelWithDrop = funnel.map((f, i) => ({
    ...f,
    dropOffPct: i === 0 ? null : pct(funnel[i - 1]!.count - f.count, funnel[i - 1]!.count),
  }));

  // Days spent in each stage: from entering it (created = `new`) to the next change.
  const days: Record<string, number[]> = {};
  for (const l of leads) {
    let stage = 'new';
    let since = l.createdAt;
    for (const c of byLead.get(l.id) ?? []) {
      (days[stage] ??= []).push((c.at.getTime() - since.getTime()) / 86_400_000);
      stage = c.to;
      since = c.at;
    }
  }
  const medianDays = ['new', 'contacted', 'quoted', 'negotiating'].map((stage) => ({
    stage,
    medianDays: median(days[stage] ?? []),
    samples: (days[stage] ?? []).length,
  }));

  const group = <K extends string>(key: (l: DashLead) => K) => {
    const out = new Map<K, DashLead[]>();
    for (const l of leads) out.set(key(l), [...(out.get(key(l)) ?? []), l]);
    return out;
  };
  const openValue = (ls: readonly DashLead[]) =>
    ls
      .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
      .reduce((a, l) => a.add(l.expectedValue ?? 0), D(0))
      .toFixed(2);

  const bySource = [...group((l) => l.source)].map(([source, ls]) => ({
    source,
    leads: ls.length,
    ...winRate(ls),
    inbound: inbound.filter((i) => i.source === source).length,
  }));
  const byRep = reps.map((r) => {
    const ls = leads.filter((l) => l.agentId === r.agentId);
    return {
      agentId: r.agentPublicId,
      name: r.name,
      leads: ls.length,
      ...winRate(ls),
      openValue: openValue(ls),
    };
  });
  const periods = new Map<string, { leads: number; won: number }>();
  for (const l of leads) {
    const k = periodKey(l.createdAt, period);
    periods.set(k, { leads: (periods.get(k)?.leads ?? 0) + 1, won: periods.get(k)?.won ?? 0 });
    if (l.wonAt) {
      const w = periodKey(l.wonAt, period);
      periods.set(w, { leads: periods.get(w)?.leads ?? 0, won: (periods.get(w)?.won ?? 0) + 1 });
    }
  }
  const byPeriod = [...periods]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ period: key, leads: v.leads, won: v.won }));
  const split = (['employee', 'freelance'] as const).map((kind) => {
    const ls = leads.filter((l) => l.agentKind === kind);
    return { agentKind: kind, leads: ls.length, ...winRate(ls), openValue: openValue(ls) };
  });
  return {
    totals: { leads: leads.length, ...winRate(leads), openValue: openValue(leads) },
    funnel: funnelWithDrop,
    medianDays,
    bySource,
    byRep,
    byPeriod,
    split,
    inbound: {
      total: inbound.length,
      firstResponseSlaPct: slaPct(
        inbound.map((i) => ({ due: i.due, respondedAt: i.respondedAt })),
        now,
      ),
    },
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;

/** CSV of the dashboard (UTF-8 BOM, formula-safe cells): one section per block. */
export function dashboardCsv(d: Dashboard): string {
  const rows: unknown[][] = [['section', 'key', 'leads', 'won', 'lost', 'win_rate_pct', 'value', 'extra']];
  rows.push([
    'totals',
    '',
    d.totals.leads,
    d.totals.won,
    d.totals.lost,
    d.totals.winRatePct,
    d.totals.openValue,
    '',
  ]);
  for (const f of d.funnel) rows.push(['funnel', f.stage, f.count, '', '', '', '', f.dropOffPct]);
  for (const m of d.medianDays) rows.push(['median_days', m.stage, m.samples, '', '', '', m.medianDays, '']);
  for (const s of d.bySource)
    rows.push(['source', s.source, s.leads, s.won, s.lost, s.winRatePct, '', s.inbound]);
  for (const r of d.byRep) rows.push(['rep', r.name, r.leads, r.won, r.lost, r.winRatePct, r.openValue, '']);
  for (const p of d.byPeriod) rows.push(['period', p.period, p.leads, p.won, '', '', '', '']);
  for (const k of d.split)
    rows.push(['agent_kind', k.agentKind, k.leads, k.won, k.lost, k.winRatePct, k.openValue, '']);
  rows.push([
    'inbound',
    'first_response_sla_pct',
    d.inbound.total,
    '',
    '',
    '',
    d.inbound.firstResponseSlaPct,
    '',
  ]);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
