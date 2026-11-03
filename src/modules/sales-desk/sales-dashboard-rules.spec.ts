import { buildDashboard, dashboardCsv, median, periodKey } from './sales-dashboard-rules';

const at = (s: string) => new Date(s);
const lead = (id: number, stage: string, over: Record<string, unknown> = {}) => ({
  id: BigInt(id),
  agentId: 1n,
  agentKind: 'employee' as const,
  stage,
  source: 'manual',
  createdAt: at('2026-11-02T03:00:00Z'),
  wonAt: null,
  expectedValue: '1000.00',
  ...over,
});

describe('sales dashboard (D-469 item 5)', () => {
  it('takes medians and Bangkok periods', () => {
    expect(median([3, 1, 2])).toBe('2.0');
    expect(median([1, 2, 3, 4])).toBe('2.5');
    expect(median([])).toBeNull();
    // Sunday 2026-11-08 23:30 Bangkok is in the week of Monday 2026-11-02.
    expect(periodKey(at('2026-11-08T16:30:00Z'), 'week')).toBe('2026-11-02');
    expect(periodKey(at('2026-11-08T17:30:00Z'), 'week')).toBe('2026-11-09');
    expect(periodKey(at('2026-11-30T18:00:00Z'), 'month')).toBe('2026-12');
  });

  it('builds the funnel, win rate, days per stage, sources, reps and the freelance split', () => {
    const d = buildDashboard({
      leads: [
        lead(1, 'won', { wonAt: at('2026-11-06T03:00:00Z') }),
        lead(2, 'lost'),
        lead(3, 'contacted', { agentKind: 'freelance', agentId: 2n, source: 'link' }),
        lead(4, 'new'),
      ],
      changes: [
        { leadId: 1n, to: 'contacted', at: at('2026-11-03T03:00:00Z') },
        { leadId: 1n, to: 'quoted', at: at('2026-11-04T03:00:00Z') },
        { leadId: 1n, to: 'won', at: at('2026-11-06T03:00:00Z') },
        { leadId: 2n, to: 'quoted', at: at('2026-11-05T03:00:00Z') },
        { leadId: 2n, to: 'lost', at: at('2026-11-07T03:00:00Z') },
        { leadId: 3n, to: 'contacted', at: at('2026-11-02T15:00:00Z') },
      ],
      reps: [{ agentId: 1n, agentPublicId: 'r1', name: 'Rep 1' }],
      inbound: [
        { source: 'contact_form', due: at('2026-11-02T07:00:00Z'), respondedAt: at('2026-11-02T06:00:00Z') },
        { source: 'contact_form', due: at('2026-11-02T07:00:00Z'), respondedAt: null },
      ],
      period: 'week',
      now: at('2026-11-10T00:00:00Z'),
    });
    expect(d.funnel.map((f) => f.count)).toEqual([4, 3, 2, 1, 1]);
    expect(d.funnel[1]!.dropOffPct).toBe('25.0');
    expect(d.totals).toMatchObject({ leads: 4, won: 1, lost: 1, winRatePct: '50.0', openValue: '2000.00' });
    expect(d.medianDays.find((m) => m.stage === 'new')).toEqual({
      stage: 'new',
      medianDays: '1.0',
      samples: 3,
    });
    expect(d.medianDays.find((m) => m.stage === 'quoted')!.medianDays).toBe('2.0');
    expect(d.byRep[0]).toMatchObject({ leads: 3, won: 1, lost: 1 });
    expect(d.split.map((s) => s.leads)).toEqual([3, 1]);
    expect(d.byPeriod).toEqual([{ period: '2026-11-02', leads: 4, won: 1 }]);
    expect(d.inbound.firstResponseSlaPct).toBe('50.0');
    expect(dashboardCsv(d).startsWith('﻿"section"')).toBe(true);
  });
});
