import { createHash } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type PnlPlan, type PnlPlanCell, Prisma } from '@generated/prisma/client';
import { recordAgentEvent } from '@modules/agents/agent-shared';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';

import { type AutoCell, yearMonths } from './pnl-auto';
import { applyEdit, calculatedCell, type CellEdit, mergeAuto, type StoredCell } from './pnl-cell-rules';
import { type PnlAutoValues, PnlComputeService, type PnlSettingsInForce } from './pnl-compute.service';
import { computePlan, type LineValues } from './pnl-engine';
import { isPnlLineKey, PNL_LINE_BY_KEY, PNL_LINES, type PnlLineKey } from './pnl-lines';

export type PnlScenario = 'base' | 'best' | 'worst' | 'custom';
export const PNL_SCENARIOS = ['base', 'best', 'worst', 'custom'] as const;

export const PLAN_INCLUDE = {
  owner: { select: { publicId: true, displayName: true } },
  lockedBy: { select: { publicId: true, displayName: true } },
  copiedFrom: { select: { publicId: true } },
} as const satisfies Prisma.PnlPlanInclude;
export type PlanRow = Prisma.PnlPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

export const planEtag = (p: { publicId: string; rowVersion: number }) => etagOf(p.publicId, p.rowVersion);
export const cellEtag = (planPublicId: string, lineKey: string, month: string, rowVersion: number) =>
  etagOf(planPublicId, lineKey, month, rowVersion);

/** Whole-plan writes touch ~350 cells: a longer transaction timeout than Prisma's 5 s. */
const TX = { timeout: 30_000 };
const D = (v: { toString(): string } | null) => (v === null ? null : new MoneyDecimal(v.toString()));
const monthDate = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function storedOf(c: PnlPlanCell): StoredCell {
  return {
    value: D(c.value),
    mode: c.mode,
    autoValue: D(c.autoValue),
    source: c.source,
    sourceRef: (c.sourceRef as Record<string, unknown> | null) ?? null,
    note: c.note,
  };
}

/** SHA-256 of every cell (line, month, value, mode, auto value), sorted — the lock snapshot. */
export function snapshotOf(cells: Pick<PnlPlanCell, 'lineKey' | 'month' | 'value' | 'mode' | 'autoValue'>[]) {
  const lines = cells
    .map((c) =>
      [c.lineKey, monthOf(c.month), c.value?.toFixed(2) ?? '', c.mode, c.autoValue?.toFixed(2) ?? ''].join(
        '|',
      ),
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest();
}

export interface CreatePlanInput {
  name: string;
  fiscalYear: number;
  scenario: PnlScenario;
  note?: string | null;
}

/**
 * D-472: P&L plans — create (computed at once), edit name / note, soft-delete drafts, recompute from the system,
 * edit cells under the manual input rules, copy to another scenario (new version), lock. Every change: one
 * transaction with the plan row locked, an audit row, an activity and an outbox event. Never posts to the ledger.
 */
@Injectable()
export class PnlPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: PnlComputeService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  async get(publicId: string, db: Tx = this.prisma): Promise<PlanRow> {
    const row = await db.pnlPlan.findFirst({ where: { publicId, deletedAt: null }, include: PLAN_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(q: {
    fiscalYear?: number;
    scenario?: PnlScenario;
    status?: 'draft' | 'locked';
    page: number;
    perPage: number;
  }) {
    const where: Prisma.PnlPlanWhereInput = {
      deletedAt: null,
      ...(q.fiscalYear && { fiscalYear: q.fiscalYear }),
      ...(q.scenario && { scenario: q.scenario }),
      ...(q.status && { status: q.status }),
    };
    return Promise.all([
      this.prisma.pnlPlan.findMany({
        where,
        include: PLAN_INCLUDE,
        orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }, { scenario: 'asc' }, { version: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.pnlPlan.count({ where }),
    ]);
  }

  /** Locks the plan row for the transaction and checks it is a draft (and the `If-Match` when given). */
  private async lockDraft(tx: Tx, publicId: string, ifMatch?: string, required = true): Promise<PlanRow> {
    const [locked] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM pnl_plans WHERE public_id = ${publicId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!locked) throw new DomainException('http.not_found');
    const plan = await this.get(publicId, tx);
    if (plan.status === 'locked') throw new DomainException('pnl.plan_locked');
    if (ifMatch !== undefined || required) assertIfMatch(ifMatch, planEtag(plan));
    return plan;
  }

  private async nextVersion(tx: Tx, entityId: bigint, i: Omit<CreatePlanInput, 'note'>): Promise<number> {
    const max = await tx.pnlPlan.aggregate({
      where: { entityId, fiscalYear: i.fiscalYear, scenario: i.scenario, name: i.name },
      _max: { version: true },
    });
    return (max._max.version ?? 0) + 1;
  }

  async create(actor: UserActor, input: CreatePlanInput): Promise<PlanRow> {
    const entityId = await this.entities.defaultEntityId();
    const auto = await this.compute.autoValues(input.fiscalYear);
    const id = await this.prisma.withTx(async (tx) => {
      const plan = await tx.pnlPlan.create({
        data: {
          entityId,
          name: input.name.trim(),
          fiscalYear: input.fiscalYear,
          scenario: input.scenario,
          version: await this.nextVersion(tx, entityId, input),
          note: input.note?.trim() || null,
          ownerUserId: actor.userId,
          createdById: actor.userId,
        },
      });
      await this.writeAuto(tx, plan, auto);
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_plan.created',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: {
          name: plan.name,
          fiscalYear: plan.fiscalYear,
          scenario: plan.scenario,
          version: plan.version,
        },
      });
      await this.recordEvent(tx, plan, 'pnl_plan.created', actor);
      return plan.publicId;
    }, TX);
    return this.get(id);
  }

  async update(
    actor: UserActor,
    publicId: string,
    input: { name?: string; note?: string | null },
    ifMatch: string | undefined,
  ): Promise<PlanRow> {
    await this.prisma.withTx(async (tx) => {
      const plan = await this.lockDraft(tx, publicId, ifMatch);
      const name = input.name?.trim();
      const data: Prisma.PnlPlanUpdateInput = {
        ...(name &&
          name !== plan.name && {
            name,
            version: await this.nextVersion(tx, plan.entityId, { ...plan, name }),
          }),
        ...(input.note !== undefined && { note: input.note?.trim() || null }),
        rowVersion: { increment: 1 },
      };
      await tx.pnlPlan.update({ where: { id: plan.id }, data });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_plan.updated',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: { before: { name: plan.name, note: plan.note }, after: input },
      });
      await this.recordEvent(tx, plan, 'pnl_plan.updated', actor);
    });
    return this.get(publicId);
  }

  /** Drafts only, soft (the audit trail and any copy keep their reference). */
  async remove(actor: UserActor, publicId: string, ifMatch: string | undefined): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const plan = await this.lockDraft(tx, publicId, ifMatch);
      await tx.pnlPlan.update({
        where: { id: plan.id },
        data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_plan.deleted',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: {
          name: plan.name,
          fiscalYear: plan.fiscalYear,
          scenario: plan.scenario,
          version: plan.version,
        },
      });
      await this.recordEvent(tx, plan, 'pnl_plan.deleted', actor);
    });
  }

  /** Refreshes every auto value from the system; manual and override values are kept (rules in pnl-cell-rules). */
  async recompute(actor: UserActor, publicId: string, ifMatch: string | undefined): Promise<PlanRow> {
    const pre = await this.get(publicId);
    if (pre.status === 'locked') throw new DomainException('pnl.plan_locked');
    const auto = await this.compute.autoValues(pre.fiscalYear);
    await this.prisma.withTx(async (tx) => {
      const plan = await this.lockDraft(tx, publicId, ifMatch);
      await this.writeAuto(tx, plan, auto);
      await this.recordEvent(tx, plan, 'pnl_plan.recomputed', actor);
    }, TX);
    return this.get(publicId);
  }

  /** Merges the system's values into the plan's cells, recomputes the formulas and stamps the plan. */
  private async writeAuto(tx: Tx, plan: PnlPlan, auto: PnlAutoValues): Promise<void> {
    const existing = await tx.pnlPlanCell.findMany({ where: { planId: plan.id } });
    const byKey = new Map(existing.map((c) => [`${c.lineKey}|${monthOf(c.month)}`, c]));
    const cells = new Map<string, StoredCell & { periodOpen: boolean }>();
    for (const line of PNL_LINES) {
      if (line.calc !== 'source') continue;
      const row: AutoCell[] = auto.cells.get(line.key)!;
      auto.months.forEach((info, i) => {
        const prior = byKey.get(`${line.key}|${info.month}`);
        cells.set(`${line.key}|${info.month}`, {
          ...mergeAuto(line, prior ? storedOf(prior) : null, row[i]!),
          periodOpen: info.periodOpen,
        });
      });
    }
    this.derive(
      cells,
      auto.months.map((m) => m.month),
      auto.settings,
      (key, month) => auto.months.find((m) => m.month === month)?.periodOpen ?? false,
    );
    await this.persist(tx, plan, cells, byKey, auto.asOf, true, null);
    await tx.pnlPlan.update({
      where: { id: plan.id },
      data: {
        computedAt: auto.asOf,
        catalogueVersionId: auto.settings.catalogueVersionId,
        forecastRulesVersionId: auto.settings.rulesVersionId,
        citRatesVersionId: auto.settings.citVersionId,
        rowVersion: { increment: 1 },
      },
    });
  }

  /** Formula lines from the source lines' final values. */
  private derive(
    cells: Map<string, StoredCell & { periodOpen: boolean }>,
    months: string[],
    settings: PnlSettingsInForce,
    periodOpen: (key: PnlLineKey, month: string) => boolean,
  ): void {
    const values: LineValues = {};
    for (const line of PNL_LINES)
      if (line.calc === 'source')
        values[line.key] = months.map((m) => cells.get(`${line.key}|${m}`)?.value ?? null);
    const result = computePlan({
      months,
      values,
      cit: settings.cit,
      costOfCapitalPct: settings.costOfCapitalPct,
    });
    for (const line of PNL_LINES) {
      if (line.calc !== 'formula') continue;
      months.forEach((m, i) =>
        cells.set(`${line.key}|${m}`, {
          ...calculatedCell(result.months[line.key][i] ?? null),
          // The tax estimate tells whether the SME bands applied (shown "ประมาณการ").
          ...(line.key === 'cit_estimate' && { sourceRef: { smeApplied: result.smeApplied } }),
          periodOpen: periodOpen(line.key, m),
        }),
      );
    }
  }

  private async persist(
    tx: Tx,
    plan: PnlPlan,
    cells: Map<string, StoredCell & { periodOpen: boolean }>,
    existing: Map<string, PnlPlanCell>,
    asOf: Date,
    stampAsOf: boolean,
    edited: { key: string; userId: bigint } | null,
  ): Promise<void> {
    const creates: Prisma.PnlPlanCellCreateManyInput[] = [];
    for (const [k, c] of cells) {
      const [lineKey, month] = k.split('|') as [string, string];
      const prior = existing.get(k);
      const data = {
        value: c.value?.toFixed(2) ?? null,
        mode: c.mode,
        autoValue: c.autoValue?.toFixed(2) ?? null,
        source: c.source,
        sourceRef: (c.sourceRef ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        note: c.note,
        periodOpen: c.periodOpen,
      };
      if (!prior) {
        creates.push({
          planId: plan.id,
          lineKey,
          month: monthDate(month),
          ...data,
          asOf,
          updatedById: edited?.key === k ? edited.userId : null,
        });
        continue;
      }
      const same =
        (prior.value?.toFixed(2) ?? null) === data.value &&
        prior.mode === data.mode &&
        (prior.autoValue?.toFixed(2) ?? null) === data.autoValue &&
        prior.source === data.source &&
        prior.note === data.note &&
        prior.periodOpen === data.periodOpen &&
        JSON.stringify(prior.sourceRef ?? null) === JSON.stringify(c.sourceRef ?? null);
      const isEdited = edited?.key === k;
      if (same && !stampAsOf && !isEdited) continue;
      await tx.pnlPlanCell.update({
        where: { id: prior.id },
        data: {
          ...data,
          ...(stampAsOf && { asOf }),
          // Who last changed a person's value: a system refresh never takes it over.
          ...(isEdited && { updatedById: edited.userId }),
          ...((!same || isEdited) && { rowVersion: { increment: 1 } }),
        },
      });
    }
    if (creates.length) await tx.pnlPlanCell.createMany({ data: creates });
  }

  /** A person's edit of one cell (manual input rules), then the formulas of the plan. */
  async updateCell(
    actor: UserActor,
    publicId: string,
    lineKey: string,
    month: string,
    edit: CellEdit,
    ifMatch: string | undefined,
  ): Promise<PlanRow> {
    if (!isPnlLineKey(lineKey)) throw new DomainException('http.not_found');
    const line = PNL_LINE_BY_KEY.get(lineKey)!;
    const pre = await this.get(publicId);
    if (!yearMonths(pre.fiscalYear).includes(month)) throw new DomainException('http.not_found');
    const settings = await this.compute.settingsInForce(new Date());
    await this.prisma.withTx(async (tx) => {
      const plan = await this.lockDraft(tx, publicId, undefined, false);
      const existing = await tx.pnlPlanCell.findMany({ where: { planId: plan.id } });
      const byKey = new Map(existing.map((c) => [`${c.lineKey}|${monthOf(c.month)}`, c]));
      const prior = byKey.get(`${lineKey}|${month}`);
      assertIfMatch(ifMatch, cellEtag(plan.publicId, lineKey, month, prior?.rowVersion ?? 0));
      const before: StoredCell = prior
        ? storedOf(prior)
        : { value: null, mode: 'manual', autoValue: null, source: 'none', sourceRef: null, note: null };
      const after = applyEdit(line, before, edit);
      const cells = new Map<string, StoredCell & { periodOpen: boolean }>(
        existing.map((c) => [
          `${c.lineKey}|${monthOf(c.month)}`,
          { ...storedOf(c), periodOpen: c.periodOpen },
        ]),
      );
      cells.set(`${lineKey}|${month}`, { ...after, periodOpen: prior?.periodOpen ?? false });
      const months = yearMonths(plan.fiscalYear);
      this.derive(cells, months, settings, (key, m) => byKey.get(`${key}|${m}`)?.periodOpen ?? false);
      await this.persist(
        tx,
        plan,
        cells,
        byKey,
        new Date(),
        false,
        after === before ? null : { key: `${lineKey}|${month}`, userId: actor.userId },
      );
      await tx.pnlPlan.update({
        where: { id: plan.id },
        data: { citRatesVersionId: settings.citVersionId, rowVersion: { increment: 1 } },
      });
      const fmt = (v: MoneyValue | null) => v?.toFixed(2) ?? null;
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_cell.updated',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: {
          lineKey,
          month,
          before: {
            value: fmt(before.value),
            mode: before.mode,
            autoValue: fmt(before.autoValue),
            note: before.note,
          },
          after: {
            value: fmt(after.value),
            mode: after.mode,
            autoValue: fmt(after.autoValue),
            note: after.note,
          },
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'pnl_cell.updated',
        aggregateType: 'pnl_plan',
        aggregateId: plan.publicId,
        payload: { planId: plan.publicId, lineKey, month, mode: after.mode },
        actor,
        entityId: plan.entityId,
      });
    }, TX);
    return this.get(publicId);
  }

  /** A copy of any plan (locked or draft) as a new draft of a scenario — next version of that name — recomputed. */
  async copy(
    actor: UserActor,
    publicId: string,
    input: { name?: string; scenario: PnlScenario; note?: string | null },
  ): Promise<PlanRow> {
    const source = await this.get(publicId);
    const auto = await this.compute.autoValues(source.fiscalYear);
    const id = await this.prisma.withTx(async (tx) => {
      const name = input.name?.trim() || source.name;
      const plan = await tx.pnlPlan.create({
        data: {
          entityId: source.entityId,
          name,
          fiscalYear: source.fiscalYear,
          scenario: input.scenario,
          version: await this.nextVersion(tx, source.entityId, {
            name,
            fiscalYear: source.fiscalYear,
            scenario: input.scenario,
          }),
          note: input.note !== undefined ? input.note?.trim() || null : source.note,
          ownerUserId: actor.userId,
          createdById: actor.userId,
          copiedFromPlanId: source.id,
        },
      });
      const cells = await tx.pnlPlanCell.findMany({ where: { planId: source.id } });
      if (cells.length)
        await tx.pnlPlanCell.createMany({
          data: cells.map((c) => ({
            planId: plan.id,
            lineKey: c.lineKey,
            month: c.month,
            value: c.value,
            mode: c.mode,
            autoValue: c.autoValue,
            source: c.source,
            sourceRef: (c.sourceRef ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            note: c.note,
            periodOpen: c.periodOpen,
            asOf: c.asOf,
            updatedById: c.updatedById,
          })),
        });
      await this.writeAuto(tx, plan, auto);
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_plan.copied',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: { from: source.publicId, scenario: plan.scenario, version: plan.version },
      });
      await this.recordEvent(tx, plan, 'pnl_plan.copied', actor, { from: source.publicId });
      return plan.publicId;
    }, TX);
    return this.get(id);
  }

  /**
   * Locks a draft for plan vs actual: final (trigger), with the SHA-256 of its cells. No maker-checker — a
   * management plan is neither money-moving nor configuration (accounting-design §8); `If-Match` makes sure the
   * plan locked is the one the person saw.
   */
  async lock(actor: UserActor, publicId: string, ifMatch: string | undefined): Promise<PlanRow> {
    await this.prisma.withTx(async (tx) => {
      const plan = await this.lockDraft(tx, publicId, ifMatch);
      if (!plan.computedAt) throw new DomainException('pnl.not_computed');
      const cells = await tx.pnlPlanCell.findMany({
        where: { planId: plan.id },
        select: { lineKey: true, month: true, value: true, mode: true, autoValue: true },
      });
      const snapshot = snapshotOf(cells);
      const now = new Date();
      await tx.pnlPlan.update({
        where: { id: plan.id },
        data: {
          status: 'locked',
          lockedAt: now,
          lockedById: actor.userId,
          snapshotSha256: new Uint8Array(snapshot),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_plan.locked',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: { snapshotSha256: snapshot.toString('hex'), cells: cells.length },
      });
      await this.recordEvent(tx, plan, 'pnl_plan.locked', actor);
    });
    return this.get(publicId);
  }

  recordEvent(
    tx: Tx,
    plan: PnlPlan,
    type: string,
    actor: Actor,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return recordAgentEvent(this, tx, {
      type,
      aggregateType: 'pnl_plan',
      aggregateId: plan.publicId,
      payload: {
        planId: plan.publicId,
        fiscalYear: plan.fiscalYear,
        scenario: plan.scenario,
        version: plan.version,
        ...extra,
      },
      actor,
      entityId: plan.entityId,
    });
  }
}
