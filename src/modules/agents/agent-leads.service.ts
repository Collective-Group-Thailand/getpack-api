import { randomUUID } from 'node:crypto';

import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { cursorPaginated } from '@common/pagination/pagination';
import { SortOrder } from '@common/pagination/pagination.dto';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent, type SalesAgentLead } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { AgentAttributionService, cleanTags, LEAD_INCLUDE, type LeadRow } from './agent-attribution.service';
import {
  type AGENT_ACTIVITY_KINDS,
  type AGENT_STAGE_TARGETS,
  type ImportRow,
  inQuietHours,
  leadsCsv,
  type LOST_REASONS,
  parseImport,
  stageMoveRefusal,
  systemStageAfter,
} from './agent-lead-rules';
import { appendLeadActivity, DAY_MS, invalid, normalisePhone, recordAgentEvent } from './agent-shared';
import { type AgentLeadListQuery, type UpdateAgentLeadDto } from './agents-pipeline.dto';

/** Technical limits of the CSV import pipeline (not business values): rows per file, preview lifetime. */
export const IMPORT_MAX_ROWS = 500;
const IMPORT_PREVIEW_MS = DAY_MS;
const EXPORT_URL_TTL_SECONDS = 5 * 60;
const FOLLOW_UP_BATCH = 500;

export const leadEtag = (l: { publicId: string; rowVersion: number }) => etagOf(l.publicId, l.rowVersion);

type StoredImportRow = ImportRow & { leadId?: string | null };

/**
 * D-468 (PLAN A-06): an agent's lead pipeline over `SalesAgentLead` (D-417 protection and expiry unchanged) — list,
 * edit, stages (won only by the system on the first payment; lost releases the protection), the timeline, follow-up
 * reminders outside the quiet hours, CSV export / import. Every change: one transaction, an activity / domain event
 * through the outbox; agent-written entries also land in the lead's own timeline.
 */
@Injectable()
export class AgentLeadsService {
  private readonly logger = new Logger(AgentLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly attribution: AgentAttributionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  // --- reads ------------------------------------------------------------------------------------------------------

  /** One of the agent's own customer leads; anything else is 404. */
  async mine(agent: SalesAgent, publicId: string, db: Tx = this.prisma): Promise<LeadRow> {
    const row = await db.salesAgentLead.findUnique({ where: { publicId }, include: LEAD_INCLUDE });
    if (!row || row.agentId !== agent.id || row.kind !== 'customer')
      throw new DomainException('http.not_found');
    return row;
  }

  /** The neutral duplicate check (D-440) for the agent zone's new-lead form. */
  check(agent: SalesAgent, keys: { phone: string | null; email: string | null; taxId: string | null }) {
    return this.attribution.availability(this.prisma, agent.id, keys);
  }

  async list(agent: SalesAgent, q: AgentLeadListQuery, now = new Date()) {
    const where = leadListWhere(agent.id, q, now);
    const dir = q.order === SortOrder.Asc ? 'asc' : 'desc';
    const orderBy: Prisma.SalesAgentLeadOrderByWithRelationInput[] = [
      q.sort === 'nextFollowUpAt' || q.sort === 'expectedValue'
        ? { [q.sort]: { sort: dir, nulls: 'last' } }
        : { [q.sort]: dir },
      { id: dir },
    ];
    const cursor = q.cursor ? decodeLeadCursor(q.cursor) : null;
    const rows = await this.prisma.salesAgentLead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy,
      take: q.limit + 1,
      ...(cursor && { cursor: { publicId: cursor }, skip: 1 }),
    });
    return cursorPaginated(rows, q.limit, (r) => ({ id: r.publicId }));
  }

  async activities(agent: SalesAgent, leadId: string, cursor: string | undefined, limit: number) {
    const lead = await this.mine(agent, leadId);
    const at = cursor ? decodeLeadCursor(cursor) : null;
    const rows = await this.prisma.salesAgentLeadActivity.findMany({
      where: { leadId: lead.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(at && { cursor: { publicId: at }, skip: 1 }),
    });
    return cursorPaginated(rows, limit, (r) => ({ id: r.publicId }));
  }

  // --- changes ------------------------------------------------------------------------------------------------------

  async update(
    actor: UserActor,
    agent: SalesAgent,
    publicId: string,
    body: UpdateAgentLeadDto,
    ifMatch: string | undefined,
  ): Promise<LeadRow> {
    await this.prisma.withTx(async (tx) => {
      const lead = await this.mine(agent, publicId, tx);
      assertIfMatch(ifMatch, leadEtag(lead), { required: true });
      const keys = {
        phone: body.phone === undefined ? lead.phone : normalisePhone(body.phone),
        email: body.email === undefined ? lead.email : body.email?.trim().toLowerCase() || null,
        taxId: body.taxId === undefined ? lead.taxId : body.taxId?.trim() || null,
      };
      const keysChanged = keys.phone !== lead.phone || keys.email !== lead.email || keys.taxId !== lead.taxId;
      if (keysChanged) {
        if (lead.status !== 'registered') invalid('phone', 'contact keys of a closed lead', 'locked');
        if (!keys.phone && !keys.email && !keys.taxId)
          invalid('phone', 'a phone number, e-mail or tax id', 'contact');
        const check = await this.attribution.availability(tx, agent.id, keys, lead.id);
        if (check.reason === 'own_lead') throw new DomainException('agents.lead_duplicate');
        if (!check.available) throw new DomainException('agents.lead_unavailable');
      }
      const follow =
        body.nextFollowUpAt === undefined
          ? undefined
          : body.nextFollowUpAt === null
            ? null
            : new Date(body.nextFollowUpAt);
      const data: Prisma.SalesAgentLeadUpdateInput = {
        ...(body.contactName !== undefined && { contactName: body.contactName.trim() }),
        ...(body.organisationName !== undefined && {
          organisationName: body.organisationName?.trim() || null,
        }),
        ...(keysChanged && keys),
        ...(body.note !== undefined && { note: body.note?.trim() || null }),
        ...(body.expectedValue !== undefined && { expectedValue: body.expectedValue }),
        ...(follow !== undefined && { nextFollowUpAt: follow, followUpRemindedAt: null }),
        ...(body.industry !== undefined && { industry: body.industry?.trim() || null }),
        ...(body.lineId !== undefined && { lineId: body.lineId?.trim() || null }),
        ...(body.tags !== undefined && { tags: cleanTags(body.tags) }),
        rowVersion: { increment: 1 },
      };
      await tx.salesAgentLead.update({ where: { id: lead.id }, data });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.updated',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        // Field names only: no contact data in events (PDPA).
        payload: { leadId: lead.publicId, fields: Object.keys(body).sort() },
        actor,
      });
    });
    return this.mine(agent, publicId);
  }

  async changeStage(
    actor: UserActor,
    agent: SalesAgent,
    publicId: string,
    input: {
      stage: (typeof AGENT_STAGE_TARGETS)[number];
      lostReason?: (typeof LOST_REASONS)[number];
      note?: string;
    },
  ): Promise<LeadRow> {
    if (input.stage === 'lost' && !input.lostReason)
      invalid('lostReason', 'why the lead was lost', 'required');
    await this.prisma.withTx(async (tx) => {
      const lead = await this.mine(agent, publicId, tx);
      const refusal = stageMoveRefusal(lead, input.stage);
      if (refusal) throw new DomainException(refusal, { params: { stage: lead.stage, status: lead.status } });
      if (lead.stage === input.stage) return;
      const now = new Date();
      const lost = input.stage === 'lost';
      await tx.salesAgentLead.update({
        where: { id: lead.id },
        data: {
          stage: input.stage,
          stageChangedAt: now,
          ...(lost && {
            lostReason: input.lostReason!,
            lostNote: input.note?.trim() || null,
            nextFollowUpAt: null,
            // D-468: lost releases the protection at once (a converted customer keeps their link, D-417).
            ...(lead.status === 'registered' && {
              status: 'withdrawn' as const,
              closedReason: 'lost',
              protectedUntil: now,
            }),
          }),
          rowVersion: { increment: 1 },
        },
      });
      await appendLeadActivity(tx, {
        leadId: lead.id,
        kind: 'stage_change',
        body: input.note?.trim() || null,
        data: { from: lead.stage, to: input.stage, ...(lost && { lostReason: input.lostReason }) },
        createdById: actor.userId,
        occurredAt: now,
      });
      if (lost) await this.onLost(tx, lead, actor);
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.stage_changed',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: {
          leadId: lead.publicId,
          from: lead.stage,
          to: input.stage,
          ...(lost && { lostReason: input.lostReason }),
        },
        actor,
      });
    });
    return this.mine(agent, publicId);
  }

  /** Item 4 hook: a lost lead's deal registrations end (protection released). */
  protected async onLost(_tx: Tx, _lead: SalesAgentLead, _actor: Actor): Promise<void> {
    // Filled by deal registration (D-468 item 4).
  }

  async addActivity(
    actor: UserActor,
    agent: SalesAgent,
    publicId: string,
    input: {
      kind: (typeof AGENT_ACTIVITY_KINDS)[number];
      body: string;
      occurredAt?: string;
      nextFollowUpAt?: string | null;
    },
  ) {
    const now = new Date();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
    if (occurredAt.getTime() > now.getTime() + 5 * 60_000)
      invalid('occurredAt', 'not in the future', 'future');
    return this.prisma.withTx(async (tx) => {
      const lead = await this.mine(agent, publicId, tx);
      if (lead.status !== 'registered' && lead.status !== 'converted')
        throw new DomainException('agents.lead_closed', { params: { status: lead.status } });
      const row = await appendLeadActivity(tx, {
        leadId: lead.id,
        kind: input.kind,
        body: input.body.trim(),
        occurredAt,
        createdById: actor.userId,
      });
      // The first contact moves a new lead to `contacted` (never backwards).
      const contacted = lead.stage === 'new';
      await tx.salesAgentLead.update({
        where: { id: lead.id },
        data: {
          ...(contacted && { stage: 'contacted', stageChangedAt: now }),
          ...(input.nextFollowUpAt !== undefined && {
            nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
            followUpRemindedAt: null,
          }),
          rowVersion: { increment: 1 },
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.activity_added',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: { leadId: lead.publicId, activityId: row.publicId, kind: input.kind },
        actor,
      });
      return row;
    });
  }

  /**
   * The system moves a lead forward in the caller's transaction (quote sent → quoted, discount asked → negotiating)
   * and writes the timeline entry. Never backwards, never out of won / lost.
   */
  async systemAdvance(
    tx: Tx,
    leadId: bigint,
    event: 'quote_sent' | 'discount_requested',
    entry: { body?: string | null; data?: Record<string, unknown>; createdById?: bigint | null },
  ): Promise<void> {
    const lead = await tx.salesAgentLead.findUniqueOrThrow({ where: { id: leadId } });
    const next = systemStageAfter(lead.stage, event);
    const now = new Date();
    if (next)
      await tx.salesAgentLead.update({
        where: { id: lead.id },
        data: { stage: next, stageChangedAt: now, rowVersion: { increment: 1 } },
      });
    await appendLeadActivity(tx, {
      leadId: lead.id,
      kind: event === 'quote_sent' ? 'quote_sent' : 'system',
      body: entry.body ?? null,
      data: {
        ...(entry.data ?? {}),
        ...(event === 'discount_requested' && { event: 'discount_requested' }),
        ...(next && { from: lead.stage, to: next }),
      },
      createdById: entry.createdById ?? null,
      occurredAt: now,
    });
  }

  // --- won: the converted customer's first payment (A-06) -----------------------------------------------------------

  @OnDomainEvent(['payment.received', 'payment.allocated'], { consumer: 'agents.lead_won' })
  async onPayment(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const payment = await tx.payment.findUnique({
      where: { publicId: String(event.payload['paymentId']) },
      select: { orderGroupId: true },
    });
    if (!payment?.orderGroupId) return;
    const group = await tx.orderGroup.findUnique({
      where: { id: payment.orderGroupId },
      select: { publicId: true, customerUserId: true, companyId: true },
    });
    if (!group) return;
    const leads = await tx.salesAgentLead.findMany({
      where: {
        stage: { not: 'won' },
        status: 'converted',
        OR: [
          { convertedUserId: group.customerUserId },
          ...(group.companyId ? [{ convertedCompanyId: group.companyId }] : []),
        ],
      },
    });
    const actor = systemActor('agents.lead_won');
    for (const lead of leads) {
      const now = new Date();
      const { count } = await tx.salesAgentLead.updateMany({
        where: { id: lead.id, stage: { not: 'won' } },
        data: {
          stage: 'won',
          stageChangedAt: now,
          wonAt: now,
          nextFollowUpAt: null,
          rowVersion: { increment: 1 },
        },
      });
      if (count === 0) continue;
      await appendLeadActivity(tx, {
        leadId: lead.id,
        kind: 'system',
        data: { event: 'won', from: lead.stage, to: 'won' },
        occurredAt: now,
      });
      await this.onWon(tx, lead, actor);
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.won',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: { leadId: lead.publicId, orderGroupId: group.publicId },
        actor,
      });
    }
  }

  /** Item 4 hook: the lead's deal registration is won. */
  protected async onWon(_tx: Tx, _lead: SalesAgentLead, _actor: Actor): Promise<void> {
    // Filled by deal registration (D-468 item 4).
  }

  // --- follow-up reminders --------------------------------------------------------------------------------------------

  /**
   * Scheduled: leads whose follow-up time has come get one `sales_agent_lead.follow_up_due` (the agent's channel
   * choices apply, D-467) — never inside `agents.follow_up_quiet_hours` (21:00–08:00 Bangkok): the reminder waits
   * for the end of the quiet hours. Claimed with a conditional update (one reminder per time set).
   */
  async remindFollowUps(now = new Date()): Promise<number> {
    const quiet = await this.settings.value('agents.follow_up_quiet_hours', now);
    if (inQuietHours(now, quiet)) return 0;
    const due = await this.prisma.salesAgentLead.findMany({
      where: {
        nextFollowUpAt: { lte: now },
        followUpRemindedAt: null,
        status: { in: ['registered', 'converted'] },
        stage: { notIn: ['won', 'lost'] },
        agent: { status: { in: ['active', 'suspended'] } },
      },
      select: { id: true },
      orderBy: { nextFollowUpAt: 'asc' },
      take: FOLLOW_UP_BATCH,
    });
    let sent = 0;
    for (const { id } of due) {
      const done = await this.prisma.withTx(async (tx) => {
        const lead = await tx.salesAgentLead.findUniqueOrThrow({
          where: { id },
          include: { agent: { select: { user: { select: { publicId: true } } } } },
        });
        const { count } = await tx.salesAgentLead.updateMany({
          where: { id, followUpRemindedAt: null, nextFollowUpAt: lead.nextFollowUpAt },
          data: { followUpRemindedAt: now },
        });
        if (count === 0 || !lead.nextFollowUpAt) return false;
        await recordAgentEvent(this, tx, {
          type: 'sales_agent_lead.follow_up_due',
          aggregateType: 'sales_agent_lead',
          aggregateId: lead.publicId,
          // `customerId` addresses the agent's notification (they are a customer account).
          payload: {
            leadId: lead.publicId,
            contactName: lead.contactName,
            followUpAt: toBangkokIso(lead.nextFollowUpAt),
            followUpTime: toBangkokIso(lead.nextFollowUpAt).slice(11, 16),
            customerId: lead.agent.user.publicId,
          },
          actor: systemActor('agents.follow_up'),
        });
        return true;
      });
      if (done) sent += 1;
    }
    return sent;
  }

  // --- CSV export / import ---------------------------------------------------------------------------------------------

  /** The agent's own customer leads as CSV behind a 5-minute link (transient file); audited as an export. */
  async exportCsv(actor: UserActor, agent: SalesAgent): Promise<{ url: string; expiresAt: Date }> {
    const rows = await this.prisma.salesAgentLead.findMany({
      where: { agentId: agent.id, kind: 'customer' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const body = Buffer.from(leadsCsv(rows), 'utf8');
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: `leads-${bangkokDate(now)}.csv`,
        mimeType: 'text/csv',
        sizeBytes: BigInt(body.length),
        uploadStatus: 'uploaded',
        // Generated by the system from its own data: nothing to scan.
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: 'transient',
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `transient/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, body, 'text/csv; charset=utf-8');
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: 'sales_agent',
      resourcePublicId: agent.publicId,
      data: { kind: 'agent_leads', rows: rows.length, fileId: file.publicId },
    });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: EXPORT_URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: 'text/csv',
    });
    return { url, expiresAt: new Date(now.getTime() + EXPORT_URL_TTL_SECONDS * 1000) };
  }

  /**
   * Dry run of a CSV import: every row through the field checks, the same duplicate check as a new lead and the
   * open-leads limit; kept 24 h for the commit. Nothing is created.
   */
  async previewImport(actor: UserActor, agent: SalesAgent, csv: string, consentConfirmed: boolean) {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    if (!consentConfirmed) invalid('consentConfirmed', 'every lead agreed to be contacted', 'required');
    const parsed = parseImport(csv);
    if (!parsed.headerOk) invalid('csv', 'a header row with contact_name', 'header');
    if (parsed.rows.length === 0) invalid('csv', 'at least one row', 'empty');
    if (parsed.rows.length > IMPORT_MAX_ROWS)
      invalid('csv', `at most ${IMPORT_MAX_ROWS} rows`, 'too_many_rows');
    const rows = await this.checkRows(this.prisma, agent, parsed.rows);
    const now = new Date();
    const row = await this.prisma.withTx(async (tx) => {
      const created = await tx.salesAgentLeadImport.create({
        data: {
          agentId: agent.id,
          rows: rows as unknown as Prisma.InputJsonValue,
          rowCount: rows.length,
          validCount: rows.filter((r) => r.errors.length === 0).length,
          expiresAt: new Date(now.getTime() + IMPORT_PREVIEW_MS),
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead_import.previewed',
        aggregateType: 'sales_agent_lead_import',
        aggregateId: created.publicId,
        payload: { importId: created.publicId, rows: created.rowCount, valid: created.validCount },
        actor,
      });
      return created;
    });
    return { row, rows };
  }

  /** Creates the valid rows of a preview (each re-checked now); the preview's contact data is dropped. */
  async commitImport(actor: UserActor, agent: SalesAgent, importId: string) {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    const now = new Date();
    const result = await this.prisma.withTx(async (tx) => {
      const imp = await tx.salesAgentLeadImport.findUnique({ where: { publicId: importId } });
      if (!imp || imp.agentId !== agent.id) throw new DomainException('http.not_found');
      if (imp.status !== 'previewed' || imp.expiresAt <= now)
        throw new DomainException('agents.lead_import_closed', { params: { status: imp.status } });
      const stored = imp.rows as unknown as StoredImportRow[];
      const rows = await this.checkRows(
        tx,
        agent,
        stored.map((r) => ({ ...r, errors: r.errors.filter((e) => !RECHECKED.has(e.code)) })),
      );
      let created = 0;
      for (const r of rows) {
        if (r.errors.length > 0) continue;
        const lead = await this.attribution.registerLead(
          actor,
          agent,
          {
            kind: 'customer',
            contactName: r.contactName,
            organisationName: r.organisationName,
            phone: r.phone,
            email: r.email,
            taxId: r.taxId,
            note: r.note,
            consentConfirmed: true,
            source: 'csv_import',
            expectedValue: r.expectedValue,
            nextFollowUpAt: r.nextFollowUpAt,
            industry: r.industry,
            lineId: r.lineId,
            tags: r.tags,
          },
          { tx },
        );
        r.leadId = lead.publicId;
        created += 1;
      }
      // PDPA: after the commit only row numbers, errors and the created lead ids are kept.
      const kept = rows.map((r) => ({ rowNo: r.rowNo, errors: r.errors, leadId: r.leadId ?? null }));
      const updated = await tx.salesAgentLeadImport.update({
        where: { id: imp.id },
        data: {
          status: 'committed',
          committedAt: now,
          createdCount: created,
          rows: kept,
          purgedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead_import.committed',
        aggregateType: 'sales_agent_lead_import',
        aggregateId: imp.publicId,
        payload: { importId: imp.publicId, created },
        actor,
      });
      return { row: updated, rows };
    });
    return result;
  }

  /** Field errors from the parser + availability, own-lead and the open-leads limit (in file order). */
  private async checkRows(db: Tx, agent: SalesAgent, rows: StoredImportRow[]): Promise<StoredImportRow[]> {
    const rules = (await this.settings.at('agents.rules', { at: new Date(), tx: db })).value;
    let room =
      rules.maxOpenLeads -
      (await db.salesAgentLead.count({ where: { agentId: agent.id, status: 'registered' } }));
    for (const row of rows) {
      if (row.errors.length > 0) continue;
      const check = await this.attribution.availability(db, agent.id, row);
      if (!check.available) {
        row.errors.push({ field: 'phone', code: check.reason === 'own_lead' ? 'own_lead' : 'unavailable' });
        continue;
      }
      if (room <= 0) {
        row.errors.push({ field: 'contactName', code: 'too_many_leads' });
        continue;
      }
      room -= 1;
    }
    return rows;
  }

  /** Scheduled: previews past their 24 h lose their contact data (PDPA) and become `expired`. */
  async expireImports(now = new Date()): Promise<number> {
    const { count } = await this.prisma.salesAgentLeadImport.updateMany({
      where: { status: 'previewed', expiresAt: { lte: now } },
      data: { status: 'expired', rows: [], purgedAt: now },
    });
    return count;
  }
}

/** Availability errors are recomputed at commit (the world may have changed since the preview). */
const RECHECKED = new Set(['own_lead', 'unavailable', 'too_many_leads']);

export function decodeLeadCursor(cursor: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: unknown };
    if (typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id)) return parsed.id;
  } catch {
    // fall through
  }
  return invalid('cursor', 'an opaque cursor from a previous page', 'invalid');
}

/** The list filters (pure; unit-tested). */
export function leadListWhere(
  agentId: bigint,
  q: Pick<AgentLeadListQuery, 'view' | 'stage' | 'source' | 'due' | 'q'>,
  now: Date,
): Prisma.SalesAgentLeadWhereInput {
  const endOfToday = startOfBangkokDay(addCalendarDays(bangkokDate(now), 1));
  const and: Prisma.SalesAgentLeadWhereInput[] = [{ agentId, kind: 'customer' }];
  const open: Prisma.SalesAgentLeadWhereInput = {
    status: { in: ['registered', 'converted'] },
    stage: { notIn: ['won', 'lost'] },
  };
  switch (q.view) {
    case 'open':
      and.push(open);
      break;
    case 'follow_up_today':
      and.push(open, { nextFollowUpAt: { lt: endOfToday } });
      break;
    case 'protection_ending':
      and.push({
        status: 'registered',
        protectedUntil: { gt: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
      });
      break;
    case 'closed':
      and.push({
        OR: [{ stage: { in: ['won', 'lost'] } }, { status: { in: ['expired', 'withdrawn', 'rejected'] } }],
      });
      break;
    default:
      break;
  }
  if (q.stage?.length) and.push({ stage: { in: q.stage } });
  if (q.source) and.push({ source: q.source });
  if (q.due === 'today') and.push({ nextFollowUpAt: { lt: endOfToday } });
  if (q.due === 'overdue') and.push({ nextFollowUpAt: { lt: now } });
  const text = q.q?.trim();
  if (text) {
    const contains = { contains: text, mode: 'insensitive' as const };
    and.push({
      OR: [
        { contactName: contains },
        { organisationName: contains },
        { phone: { contains: text.replace(/^0/, '') } },
        { email: contains },
        { taxId: { contains: text } },
        { lineId: contains },
      ],
    });
  }
  return { AND: and };
}
