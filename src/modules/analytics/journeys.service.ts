import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, bangkokDayOfWeek, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { writeReport } from '@modules/reports/report-writer';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { JOURNEYS } from './journeys';

export interface JourneyFunnel {
  journey: string;
  task: string;
  steps: { step: string; sessions: number; fromPreviousPct: string | null }[];
  conversionPct: string | null;
}

export interface JourneyWeekCheck {
  weekStart: string;
  journey: string;
  firstSessions: number;
  lastSessions: number;
  previousFirstSessions: number;
  previousLastSessions: number;
  conversionPct: string | null;
  previousConversionPct: string | null;
  dropPct: string | null;
  alert: boolean;
}

const pct = (n: number, d: number) => (d > 0 ? ((n * 100) / d).toFixed(2) : null);
const MAX_RANGE_DAYS = 400;

function checkRange(from: string, to: string) {
  if (from > to)
    throw new DomainException('validation.failed', {
      errors: [{ path: 'to', code: 'range', message: '`to` is before `from`' }],
    });
  if (addCalendarDays(from, MAX_RANGE_DAYS) < to)
    throw new DomainException('validation.failed', {
      errors: [{ path: 'to', code: 'range', message: `at most ${MAX_RANGE_DAYS} days` }],
    });
}

/**
 * D-303 journey analytics for the UX scorecard: per-journey funnels from the nightly `fact_journey_steps` (consented
 * sessions per step and day), the Monday week-over-week check that alerts ops when a journey's first-to-last
 * conversion fell by more than `analytics.journey_drop_alert_pct` (with at least `analytics.journey_alert_min_sessions`
 * sessions in both weeks), and the anonymised export for scorecard rounds (aggregates, small cells suppressed).
 */
@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** Sessions per step over the Bangkok days `from`–`to` (summed per day), each journey in step order. */
  async funnels(from: string, to: string): Promise<JourneyFunnel[]> {
    checkRange(from, to);
    const rows = await this.prisma.$queryRaw<{ journey: string; step: string; sessions: bigint }[]>`
      SELECT journey, step, sum(sessions) AS sessions FROM analytics.fact_journey_steps
       WHERE date_key BETWEEN ${from}::date AND ${to}::date
       GROUP BY journey, step`;
    const count = (journey: string, step: string) =>
      Number(rows.find((r) => r.journey === journey && r.step === step)?.sessions ?? 0);
    return JOURNEYS.map((j) => {
      const counts = j.steps.map((s) => count(j.key, s.key));
      return {
        journey: j.key,
        task: j.task,
        steps: j.steps.map((s, i) => ({
          step: s.key,
          sessions: counts[i]!,
          fromPreviousPct: i === 0 ? null : pct(counts[i]!, counts[i - 1]!),
        })),
        conversionPct: pct(counts.at(-1)!, counts[0]!),
      };
    });
  }

  /** The latest weekly check (or that of `weekStart`). */
  async weekChecks(weekStart?: string): Promise<JourneyWeekCheck[]> {
    const rows = await this.prisma.$queryRaw<
      {
        week_start: Date;
        journey: string;
        first_sessions: number;
        last_sessions: number;
        previous_first_sessions: number;
        previous_last_sessions: number;
        conversion_pct: string | null;
        previous_conversion_pct: string | null;
        drop_pct: string | null;
        alert: boolean;
      }[]
    >`
      SELECT * FROM analytics.journey_week_checks
       WHERE week_start = coalesce(${weekStart ?? null}::date, (SELECT max(week_start) FROM analytics.journey_week_checks))
       ORDER BY journey`;
    const order = new Map(JOURNEYS.map((j, i) => [j.key, i]));
    return rows
      .map((r) => ({
        weekStart: r.week_start.toISOString().slice(0, 10),
        journey: r.journey,
        firstSessions: r.first_sessions,
        lastSessions: r.last_sessions,
        previousFirstSessions: r.previous_first_sessions,
        previousLastSessions: r.previous_last_sessions,
        conversionPct: r.conversion_pct === null ? null : Number(r.conversion_pct).toFixed(2),
        previousConversionPct:
          r.previous_conversion_pct === null ? null : Number(r.previous_conversion_pct).toFixed(2),
        dropPct: r.drop_pct === null ? null : Number(r.drop_pct).toFixed(2),
        alert: r.alert,
      }))
      .sort((a, b) => (order.get(a.journey) ?? 99) - (order.get(b.journey) ?? 99));
  }

  /** Mondays 04:00 Bangkok, after the nightly rollups: last week against the week before. */
  @ScheduledJob({ name: 'analytics.journey_week_check', cron: '0 4 * * 1' })
  async weeklyCheck(now = new Date()): Promise<number> {
    const today = bangkokDate(now);
    // The Monday of this week; the checked week is the 7 days before it.
    const monday = addCalendarDays(today, -((bangkokDayOfWeek(now) + 6) % 7));
    return this.checkWeek(addCalendarDays(monday, -7), now);
  }

  /** D-303: one week (`weekStart` = its Monday) against the one before; raises one ops alert listing the drops. */
  async checkWeek(weekStart: string, now = new Date()): Promise<number> {
    const threshold = Number((await this.settings.at('analytics.journey_drop_alert_pct', { at: now })).value);
    const minSessions = Number(
      (await this.settings.at('analytics.journey_alert_min_sessions', { at: now })).value,
    );
    const current = await this.funnels(weekStart, addCalendarDays(weekStart, 6));
    const previous = await this.funnels(addCalendarDays(weekStart, -7), addCalendarDays(weekStart, -1));
    const drops: string[] = [];
    await this.prisma.withTx(async (tx) => {
      for (const c of current) {
        const p = previous.find((x) => x.journey === c.journey)!;
        const first = c.steps[0]!.sessions;
        const last = c.steps.at(-1)!.sessions;
        const pFirst = p.steps[0]!.sessions;
        const pLast = p.steps.at(-1)!.sessions;
        const conv = first > 0 ? (last * 100) / first : null;
        const pConv = pFirst > 0 ? (pLast * 100) / pFirst : null;
        // A relative drop of the conversion (scorecard §4: "drops > 15 % week over week").
        const drop = conv !== null && pConv !== null && pConv > 0 ? ((pConv - conv) * 100) / pConv : null;
        const alert = drop !== null && drop > threshold && first >= minSessions && pFirst >= minSessions;
        if (alert) drops.push(c.journey);
        await tx.$executeRaw`
          INSERT INTO analytics.journey_week_checks (week_start, journey, first_sessions, last_sessions,
            previous_first_sessions, previous_last_sessions, conversion_pct, previous_conversion_pct, drop_pct, alert,
            threshold_pct, min_sessions, computed_at)
          VALUES (${weekStart}::date, ${c.journey}, ${first}, ${last}, ${pFirst}, ${pLast},
            ${conv === null ? null : conv.toFixed(2)}::numeric, ${pConv === null ? null : pConv.toFixed(2)}::numeric,
            ${drop === null ? null : drop.toFixed(2)}::numeric, ${alert}, ${threshold}, ${minSessions}, ${now})
          ON CONFLICT (week_start, journey) DO UPDATE SET first_sessions = EXCLUDED.first_sessions,
            last_sessions = EXCLUDED.last_sessions, previous_first_sessions = EXCLUDED.previous_first_sessions,
            previous_last_sessions = EXCLUDED.previous_last_sessions, conversion_pct = EXCLUDED.conversion_pct,
            previous_conversion_pct = EXCLUDED.previous_conversion_pct, drop_pct = EXCLUDED.drop_pct,
            alert = EXCLUDED.alert, threshold_pct = EXCLUDED.threshold_pct, min_sessions = EXCLUDED.min_sessions,
            computed_at = EXCLUDED.computed_at`;
      }
      if (drops.length)
        await this.events.record(tx, {
          type: 'ops.alert_raised',
          aggregateType: 'ops_alert',
          aggregateId: crypto.randomUUID(),
          payload: {
            signal: 'journey_conversion_drops',
            value: drops.length,
            threshold: 1,
            status: 'alert',
            description: `Journeys whose conversion fell more than ${threshold} % week over week (D-303): ${drops.join(', ')}`,
            weekStart,
          },
        });
    });
    if (drops.length) this.logger.warn(`journey conversion drops week ${weekStart}: ${drops.join(', ')}`);
    return drops.length;
  }

  /**
   * D-303 the scorecard export: rows (Bangkok day, journey, task, step, sessions) — aggregates only, a cell under
   * `analytics.prospectus_min_group_size` sessions shown as suppressed (D-160). Audited, a 5-minute signed URL.
   */
  async export(actor: UserActor, from: string, to: string, format: 'xlsx' | 'csv') {
    checkRange(from, to);
    const k = Number((await this.settings.at('analytics.prospectus_min_group_size')).value);
    const task = new Map(JOURNEYS.map((j) => [j.key, j.task]));
    const prisma = this.prisma;
    async function* cells() {
      const rows = await prisma.$queryRaw<
        { date_key: Date; journey: string; step: string; step_index: number; sessions: number }[]
      >`
        SELECT date_key, journey, step, step_index, sessions FROM analytics.fact_journey_steps
         WHERE date_key BETWEEN ${from}::date AND ${to}::date
         ORDER BY date_key, journey, step_index`;
      for (const r of rows)
        yield {
          day: r.date_key.toISOString().slice(0, 10),
          journey: r.journey,
          task: task.get(r.journey) ?? null,
          step: r.step,
          stepIndex: r.step_index,
          sessions: r.sessions >= k ? r.sessions : null,
          suppressed: r.sessions > 0 && r.sessions < k,
        };
    }
    const now = new Date();
    const written = await writeReport(
      {
        key: 'journey_steps',
        nameTh: 'ขั้นตอนเส้นทางผู้ใช้ (scorecard)',
        nameEn: 'Journey steps (scorecard)',
        columns: [
          { key: 'day', labelTh: 'วัน', labelEn: 'Day', type: 'date' },
          { key: 'journey', labelTh: 'เส้นทาง', labelEn: 'Journey', type: 'text' },
          { key: 'task', labelTh: 'งานทดสอบ', labelEn: 'Task', type: 'text' },
          { key: 'step', labelTh: 'ขั้นตอน', labelEn: 'Step', type: 'text' },
          { key: 'stepIndex', labelTh: 'ลำดับ', labelEn: 'Step no.', type: 'integer', total: false },
          { key: 'sessions', labelTh: 'เซสชัน', labelEn: 'Sessions', type: 'integer' },
          {
            key: 'suppressed',
            labelTh: 'ปิดค่า (น้อยกว่าเกณฑ์)',
            labelEn: `Suppressed (< ${k})`,
            type: 'boolean',
          },
        ],
      },
      cells(),
      format,
      { filters: { from, to }, generatedAt: now },
    );
    const file = await this.files.storeSystem({
      body: written.body,
      fileName: `journey-steps-${from}-${to}.${written.extension}`,
      mimeType: written.mimeType,
      retentionClass: 'transient',
      ownerUserId: actor.userId,
    });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: 'journey_steps',
      data: { from, to, rows: written.rowCount, minGroupSize: k, fileId: file.publicId, format },
    });
    const signed = (await this.files.signedUrl(file))!;
    return {
      fileId: file.publicId,
      url: signed.url,
      rows: written.rowCount,
      truncated: false,
      expiresAt: toBangkokIso(signed.expiresAt),
    };
  }
}
