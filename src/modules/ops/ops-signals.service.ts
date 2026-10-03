import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { QUEUES } from '@platform/domain-events/worker/queues';
import { holdersOfRole, type Recipient, RecipientDirectory } from '@platform/notifications/recipients';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

/**
 * Operational signals for launch monitoring (B6.3): what the database and the queues can tell about the health of
 * the asynchronous work — outbox dead letters and backlog, queue depth, webhook failures, payout / bank failures,
 * ledger posting failures and SLA breaches (factory acceptance D-074, production at risk, RFQ first response,
 * approvals, slip verification D-061). Error rate and latency come from the APM (OpenTelemetry / Sentry,
 * docs/launch/MONITORING.md). Thresholds are the setting `ops.alert_thresholds` (proposed, superadmin).
 */
export const SIGNAL_KEYS = [
  'outbox_dead_letters',
  'outbox_backlog_minutes',
  'queue_depth',
  'webhook_failures_24h',
  'payout_item_failures_7d',
  'ledger_posting_failures',
  'acceptance_overdue',
  'production_at_risk',
  'rfq_first_response_overdue',
  'approvals_overdue',
  'slip_verification_wait_hours',
  'claim_response_overdue',
  'claim_decision_overdue',
  'conversation_first_response_overdue',
  'journey_conversion_drops',
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface Signal {
  key: SignalKey;
  /** Null when the source could not be read (e.g. Redis down) — itself worth an alert. */
  value: number | null;
  threshold: number | null;
  status: 'ok' | 'alert' | 'unknown';
}

const DESCRIPTIONS: Record<SignalKey, string> = {
  outbox_dead_letters: 'Domain events dead-lettered after every retry (replay from the outbox admin)',
  outbox_backlog_minutes: 'Age in minutes of the oldest outbox message due for relay',
  queue_depth: 'Jobs waiting in the worker queues',
  webhook_failures_24h: 'Provider callbacks that failed in the last 24 hours',
  payout_item_failures_7d: 'Payout items the bank rejected in the last 7 days',
  ledger_posting_failures: 'Ledger postings dead-lettered (the books miss an event)',
  acceptance_overdue: 'Production jobs past the factory acceptance SLA (D-074)',
  production_at_risk: 'Production jobs predicted to miss their promised date',
  rfq_first_response_overdue: 'RFQs past their first-response SLA',
  approvals_overdue: 'Approval steps past their due time',
  slip_verification_wait_hours:
    'Hours the oldest transfer slip has waited for Finance (D-061: 4 business hours)',
  claim_response_overdue: 'Claims without a first response past the guarantee’s response time (D-263)',
  claim_decision_overdue: 'Open claims past the guarantee’s decision time from complete evidence (D-263)',
  conversation_first_response_overdue:
    'Live CS conversations whose first customer message is past its first-response due time (D-221, D-300)',
  journey_conversion_drops:
    'Scorecard journeys whose conversion fell more than `analytics.journey_drop_alert_pct` last week (D-303)',
};
export const signalDescription = (key: SignalKey) => DESCRIPTIONS[key];

/** One alert per signal per hour at most — a weekly signal once a week (its Monday check alerts on its own). */
const REPEAT_AFTER_MS = 60 * 60_000;
const REPEAT_AFTER_MS_OF: Partial<Record<SignalKey, number>> = { journey_conversion_drops: 7 * 86_400_000 };

@Injectable()
export class OpsSignalsService implements OnModuleInit {
  private readonly logger = new Logger(OpsSignalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly directory: RecipientDirectory,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.directory.registerAssignees('ops_alert', (_event, _route, tx) => this.operators(tx));
  }

  private async count(query: Promise<{ n: bigint | number | null }[]>): Promise<number> {
    const [row] = await query;
    return Number(row?.n ?? 0);
  }

  async values(): Promise<Record<SignalKey, number | null>> {
    const p = this.prisma;
    return {
      outbox_dead_letters: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM outbox_messages WHERE status = 'dead'`,
      ),
      outbox_backlog_minutes: await this.count(
        p.$queryRaw`SELECT floor(extract(epoch FROM now() - min(next_attempt_at)) / 60) AS n FROM outbox_messages
                    WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()`,
      ),
      queue_depth: await this.queueDepth(),
      webhook_failures_24h: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM webhook_inbox WHERE status = 'failed' AND received_at > now() - interval '24 hours'`,
      ),
      payout_item_failures_7d: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM payout_items WHERE status = 'failed' AND created_at > now() - interval '7 days'`,
      ),
      ledger_posting_failures: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM outbox_messages WHERE status = 'dead' AND last_error LIKE 'ledger.%'`,
      ),
      acceptance_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM production_jobs WHERE status = 'released' AND accepted_at IS NULL AND accept_due_at < now()`,
      ),
      production_at_risk: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM production_jobs WHERE at_risk_since IS NOT NULL AND status IN ('accepted', 'in_progress', 'on_hold')`,
      ),
      rfq_first_response_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM rfqs WHERE first_response_at IS NULL AND sla_due_at < now() AND status IN ('submitted', 'in_review')`,
      ),
      approvals_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM approval_request_steps WHERE status = 'pending' AND due_at < now()`,
      ),
      slip_verification_wait_hours: await this.count(
        p.$queryRaw`SELECT floor(extract(epoch FROM now() - min(created_at)) / 3600) AS n FROM payments WHERE status = 'awaiting_verification'`,
      ),
      claim_response_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM claims WHERE first_responded_at IS NULL AND response_due_at < now()
                    AND status IN ('submitted', 'under_review', 'need_info', 'factory_review')`,
      ),
      claim_decision_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM claims WHERE decided_at IS NULL AND decision_due_at < now()
                    AND status IN ('submitted', 'under_review', 'factory_review')`,
      ),
      journey_conversion_drops: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM analytics.journey_week_checks
                    WHERE alert AND week_start = (SELECT max(week_start) FROM analytics.journey_week_checks)`,
      ),
      conversation_first_response_overdue: await this.count(
        p.$queryRaw`SELECT count(*) AS n FROM conversations WHERE status <> 'closed' AND first_responded_at IS NULL
                    AND first_response_due_at < now()`,
      ),
    };
  }

  /** Waiting + prioritised jobs of the worker queues (delayed ones are retries and repeatable schedules). */
  private async queueDepth(): Promise<number | null> {
    try {
      let depth = 0;
      for (const queue of Object.values(QUEUES)) {
        depth += await this.redis.llen(`packio:${queue}:wait`);
        depth += await this.redis.zcard(`packio:${queue}:prioritized`);
      }
      return depth;
    } catch {
      return null;
    }
  }

  async signals(): Promise<Signal[]> {
    const thresholds = (await this.settings.at('ops.alert_thresholds')).value;
    const values = await this.values();
    return SIGNAL_KEYS.map((key) => {
      const value = values[key];
      const threshold = thresholds[key] ?? null;
      const status = value === null ? 'unknown' : threshold !== null && value >= threshold ? 'alert' : 'ok';
      return { key, value, threshold, status };
    });
  }

  /** Worker: raises `ops.alert_raised` for each signal in alert (or unreadable), at most once an hour per signal. */
  async raiseAlerts(now = new Date()): Promise<number> {
    let raised = 0;
    for (const s of (await this.signals()).filter((x) => x.status !== 'ok')) {
      const recent = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM domain_events
        WHERE type = 'ops.alert_raised' AND payload->>'signal' = ${s.key} AND occurred_at > ${new Date(now.getTime() - (REPEAT_AFTER_MS_OF[s.key] ?? REPEAT_AFTER_MS))}`;
      if (Number(recent[0]?.n ?? 0) > 0) continue;
      await this.prisma.withTx((tx) =>
        this.events.record(tx, {
          type: 'ops.alert_raised',
          aggregateType: 'ops_alert',
          aggregateId: crypto.randomUUID(),
          payload: {
            signal: s.key,
            value: s.value,
            threshold: s.threshold,
            status: s.status,
            description: DESCRIPTIONS[s.key],
          },
        }),
      );
      this.logger.warn(`ops alert ${s.key}: ${s.value ?? 'unreadable'} (threshold ${s.threshold ?? '—'})`);
      raised++;
    }
    return raised;
  }

  /** Superadmins and admins hear about operational alerts (in-app + e-mail). */
  private async operators(tx: Tx): Promise<Recipient[]> {
    const roles = await tx.role.findMany({ where: { key: { in: ['superadmin', 'admin'] } } });
    const all = (await Promise.all(roles.map((r) => holdersOfRole(tx, r.id, null)))).flat();
    return [...new Map(all.map((r) => [r.userId!.toString(), r])).values()];
  }
}
