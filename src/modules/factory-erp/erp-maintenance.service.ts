import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpMaintenanceKind,
  type ErpMaintenancePriority,
  type ErpMaintenanceStatus,
  Prisma,
} from '@generated/prisma/client';
import { type CreateMachineDto, type UpdateMachineDto } from '@modules/partners/capability/capability.dto';
import { CapabilityService } from '@modules/partners/capability/capability.service';
import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { dec, fmtCost, fmtMoney, fmtQty, maintenanceDue } from './erp.math';
import { ErpAlertsService } from './erp-alerts.service';
import {
  type ErpFinishMaintenanceDto,
  type ErpMachineDto,
  type ErpMaintenanceListQuery,
  type ErpMaintenanceOrderDto,
  type ErpMaintenanceOrderSummaryDto,
  type ErpMaintenancePartsDto,
  type ErpMaintenancePlanDto,
  type ErpMaintenanceRefDto,
  type ErpReportBreakdownDto,
  type ErpSaveMaintenancePlanDto,
  type ErpScheduleMaintenanceDto,
} from './erp-e3.dto';
import { MO_INCLUDE, moSummary, operationDto } from './erp-production.service';
import { ErpStockService } from './erp-stock.service';
import { itemRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const today = () => bangkokDate(new Date());
const OPEN_MT: ErpMaintenanceStatus[] = ['open', 'scheduled', 'in_progress'];
const DAY_MS = 86_400_000;

const PLAN_INCLUDE = {
  machine: true,
  parts: { include: { item: true }, orderBy: { id: 'asc' } },
  orders: { where: { status: { in: OPEN_MT } }, orderBy: { id: 'desc' }, take: 1 },
} as const;
type PlanRow = Prisma.ErpMaintenancePlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

const MT_INCLUDE = {
  machine: true,
  plan: { include: { parts: { include: { item: true } } } },
  reportedBy: { select: { displayName: true } },
  photos: { include: { file: true }, orderBy: { id: 'asc' } },
  parts: {
    include: { item: true, warehouse: true, createdBy: { select: { displayName: true } } },
    orderBy: { id: 'asc' },
  },
} as const;
type MtRow = Prisma.ErpMaintenanceOrderGetPayload<{ include: typeof MT_INCLUDE }>;

interface MtFacts {
  status: string;
}

/** The factory's actions on a maintenance order (D-355). */
export const MT_ACTIONS: ActionRule<MtFacts>[] = [
  {
    key: 'erp_mt.schedule',
    permissions: ['factory_maintenance.manage'],
    when: (m) => m.status === 'open' || m.status === 'scheduled',
  },
  {
    key: 'erp_mt.start',
    permissions: ['factory_maintenance.manage'],
    when: (m) => m.status === 'open' || m.status === 'scheduled',
  },
  {
    key: 'erp_mt.parts',
    permissions: ['factory_maintenance.manage'],
    when: (m) => OPEN_MT.includes(m.status as never),
  },
  {
    key: 'erp_mt.finish',
    permissions: ['factory_maintenance.manage'],
    irreversible: true,
    when: (m) => OPEN_MT.includes(m.status as never),
  },
  {
    key: 'erp_mt.cancel',
    permissions: ['factory_maintenance.manage'],
    irreversible: true,
    when: (m) => m.status === 'open' || m.status === 'scheduled',
  },
];

export const mtEtag = (m: { publicId: string; rowVersion: number }) => etagOf(m.publicId, m.rowVersion);

/**
 * Maintenance (D-355): the factory's machines and their state, breakdown reports that take a machine down
 * until fixed, preventive plans (every N days and / or N impressions) that open orders when due, windows that
 * block the schedule, and spare parts issued from stock.
 */
@Injectable()
export class ErpMaintenanceService {
  private readonly logger = new Logger(ErpMaintenanceService.name);

  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly alerts: ErpAlertsService,
    private readonly capability: CapabilityService,
  ) {}

  // ------------------------------------------------------------------------------- machines

  /** Impressions (good + scrap) finished on each machine since a moment. */
  async impressions(db: Tx | PrismaService, machineIds: bigint[], since: Date): Promise<Map<bigint, number>> {
    if (machineIds.length === 0) return new Map();
    const rows = await db.$queryRaw<{ machine_id: bigint; n: Prisma.Decimal }[]>(Prisma.sql`
      SELECT machine_id, coalesce(sum(good_qty + scrap_qty), 0) AS n FROM erp_production_operations
       WHERE machine_id IN (${Prisma.join(machineIds)}) AND status = 'done' AND finished_at >= ${since}
       GROUP BY machine_id`);
    return new Map(rows.map((r) => [r.machine_id, Number(r.n)]));
  }

  /** How far each plan is from due (D-355). */
  async planDue(
    db: Tx | PrismaService,
    plans: {
      machineId: bigint;
      everyDays: number | null;
      everyImpressions: number | null;
      lastDoneAt: Date | null;
      createdAt: Date;
    }[],
  ) {
    const now = Date.now();
    const out = [];
    for (const p of plans) {
      const since = p.lastDoneAt ?? p.createdAt;
      const imp =
        p.everyImpressions === null
          ? 0
          : ((await this.impressions(db, [p.machineId], since)).get(p.machineId) ?? 0);
      out.push(
        maintenanceDue({
          everyDays: p.everyDays,
          everyImpressions: p.everyImpressions,
          daysSince: Math.floor((now - since.getTime()) / DAY_MS),
          impressionsSince: imp,
        }),
      );
    }
    return out;
  }

  /** The machines with what runs on them, their queue, open maintenance and plans (D-353, D-355). */
  async machines(scope: ErpScope, onlyId?: string): Promise<ErpMachineDto[]> {
    const factoryId = scope.factory.id;
    const machines = await this.workspace.db.factoryMachine.findMany({
      where: { factoryId, ...(onlyId && { publicId: onlyId }) },
      include: {
        erpMaintenancePlans: { where: { status: 'active' }, orderBy: { id: 'asc' } },
        erpMaintenanceOrders: {
          where: { status: { in: OPEN_MT } },
          orderBy: [{ kind: 'asc' }, { id: 'desc' }],
        },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    if (onlyId && machines.length === 0) throw new DomainException('http.not_found');
    const ids = machines.map((m) => m.id);
    const [running, queued, imp30] = await Promise.all([
      this.workspace.db.erpProductionOperation.findMany({
        where: {
          machineId: { in: ids },
          status: { in: ['in_progress', 'paused'] },
          productionOrder: { factoryId },
        },
        include: { ...MO_INCLUDE.operations.include, productionOrder: { include: MO_INCLUDE } },
        orderBy: { startedAt: 'desc' },
      }),
      this.workspace.db.erpProductionOperation.groupBy({
        by: ['machineId'],
        where: {
          machineId: { in: ids },
          status: 'pending',
          productionOrder: { factoryId, status: { in: ['released', 'in_progress'] } },
        },
        _count: { _all: true },
      }),
      this.impressions(this.workspace.db, ids, new Date(Date.now() - 30 * DAY_MS)),
    ]);
    const out: ErpMachineDto[] = [];
    for (const m of machines) {
      const run = running.find((r) => r.machineId === m.id) ?? null;
      const open = m.erpMaintenanceOrders[0] ?? null;
      const breakdown = m.erpMaintenanceOrders.find((o) => o.kind === 'breakdown');
      const working = m.erpMaintenanceOrders.find((o) => o.status === 'in_progress');
      const dues = await this.planDue(this.workspace.db, m.erpMaintenancePlans);
      out.push({
        id: m.publicId,
        name: m.name,
        details: m.details,
        maxWidthMm: m.maxWidthMm === null ? null : Number(m.maxWidthMm),
        maxLengthMm: m.maxLengthMm === null ? null : Number(m.maxLengthMm),
        status: m.status,
        state: breakdown
          ? 'down'
          : working
            ? 'maintenance'
            : run?.status === 'in_progress'
              ? 'running'
              : 'idle',
        running: run ? { operation: operationDto(run), order: moSummary(run.productionOrder) } : null,
        queued: queued.find((q) => q.machineId === m.id)?._count._all ?? 0,
        openMaintenance: open ? mtRef(breakdown ?? open) : null,
        plans: m.erpMaintenancePlans.map((p, i) => ({
          planId: p.publicId,
          title: p.title,
          daysLeft: dues[i]!.daysLeft,
          impressionsLeft: dues[i]!.impressionsLeft,
          due: dues[i]!.due,
        })),
        impressions30d: String(imp30.get(m.id) ?? 0),
      });
    }
    return out;
  }

  /** Adds or edits one of the factory's machines (the same record Packio's capability profile shows). */
  async saveMachine(scope: ErpScope, input: CreateMachineDto | UpdateMachineDto, machineId?: string) {
    const saved = await this.capability.saveMachine(scope.actor, scope.factory.publicId, input, machineId);
    return (await this.machines(scope, saved.id))[0]!;
  }

  private async machine(db: Tx | PrismaService, scope: ErpScope, publicId: string) {
    const m = await db.factoryMachine.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!m) throw new DomainException('http.not_found');
    return m;
  }

  // ---------------------------------------------------------------------------------- plans

  async listPlans(scope: ErpScope, machineId?: string): Promise<ErpMaintenancePlanDto[]> {
    const rows = await this.workspace.db.erpMaintenancePlan.findMany({
      where: { factoryId: scope.factory.id, ...(machineId && { machine: { publicId: machineId } }) },
      include: PLAN_INCLUDE,
      orderBy: [{ status: 'asc' }, { machine: { name: 'asc' } }, { title: 'asc' }],
    });
    const dues = await this.planDue(this.workspace.db, rows);
    return rows.map((r, i) => planDto(r, dues[i]!));
  }

  async getPlan(scope: ErpScope, publicId: string): Promise<ErpMaintenancePlanDto> {
    const row = await this.workspace.db.erpMaintenancePlan.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: PLAN_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return planDto(row, (await this.planDue(this.workspace.db, [row]))[0]!);
  }

  private async planParts(tx: Tx, scope: ErpScope, body: ErpSaveMaintenancePlanDto) {
    if (body.everyDays == null && body.everyImpressions == null)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'everyDays', code: 'required', message: 'Every N days or every N impressions' }],
      });
    const machine = await this.machine(tx, scope, body.machineId);
    const parts = body.parts ?? [];
    const items = await this.stock.items(
      tx,
      scope.factory.id,
      parts.map((p) => p.itemId),
    );
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'parts', code: 'duplicate', message: 'Each part once' }],
      });
    return {
      machine,
      parts: parts.map((p, i) => {
        if (!dec(p.quantity).gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `parts.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        return { itemId: items[i]!.id, quantity: fmtQty(p.quantity) };
      }),
    };
  }

  async createPlan(scope: ErpScope, body: ErpSaveMaintenancePlanDto): Promise<ErpMaintenancePlanDto> {
    const id = await this.workspace.tx(async (tx) => {
      const { machine, parts } = await this.planParts(tx, scope, body);
      const plan = await tx.erpMaintenancePlan.create({
        data: {
          factoryId: scope.factory.id,
          machineId: machine.id,
          title: body.title.trim(),
          instructions: body.instructions ?? null,
          everyDays: body.everyDays ?? null,
          everyImpressions: body.everyImpressions ?? null,
          durationMinutes: body.durationMinutes ?? 60,
          createdById: scope.actor.userId,
          parts: { create: parts },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_maintenance_plan.created',
        'erp_maintenance_plan',
        plan.publicId,
      );
      return plan.publicId;
    });
    return this.getPlan(scope, id);
  }

  async updatePlan(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveMaintenancePlanDto,
  ): Promise<ErpMaintenancePlanDto> {
    await this.workspace.tx(async (tx) => {
      const current = await tx.erpMaintenancePlan.findFirst({
        where: { factoryId: scope.factory.id, publicId },
      });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(current.publicId, current.rowVersion));
      const { machine, parts } = await this.planParts(tx, scope, body);
      await tx.erpMaintenancePlanPart.deleteMany({ where: { planId: current.id } });
      await tx.erpMaintenancePlan.update({
        where: { id: current.id },
        data: {
          machineId: machine.id,
          title: body.title.trim(),
          instructions: body.instructions ?? null,
          everyDays: body.everyDays ?? null,
          everyImpressions: body.everyImpressions ?? null,
          durationMinutes: body.durationMinutes ?? current.durationMinutes,
          ...(body.status && { status: body.status as 'active' | 'archived' }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          parts: { create: parts },
        },
      });
    });
    return this.getPlan(scope, publicId);
  }

  /**
   * Opens the plan's preventive order (by hand, or when the daily check finds it due); one open per plan.
   * Returns the existing one when it is already open.
   */
  async openPreventive(
    db: Tx,
    plan: {
      id: bigint;
      publicId: string;
      factoryId: bigint;
      machineId: bigint;
      title: string;
      instructions: string | null;
    },
    factoryPublicId: string,
    userId: bigint | null,
  ) {
    const open = await db.erpMaintenanceOrder.findFirst({
      where: { planId: plan.id, status: { in: OPEN_MT } },
    });
    if (open) return { order: open, created: false };
    const mtNo = await this.workspace.nextNumber(db, plan.factoryId, 'mt');
    const order = await db.erpMaintenanceOrder.create({
      data: {
        factoryId: plan.factoryId,
        mtNo,
        machineId: plan.machineId,
        kind: 'preventive',
        planId: plan.id,
        priority: 'normal',
        title: plan.title,
        description: plan.instructions,
        reportedById: userId,
      },
    });
    await this.workspace.recordSystem(
      db,
      factoryPublicId,
      'erp_maintenance.opened',
      'erp_maintenance_order',
      order.publicId,
      {
        mtNo,
        kind: 'preventive',
      },
    );
    return { order, created: true };
  }

  async openPlanNow(scope: ErpScope, planPublicId: string, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const plan = await tx.erpMaintenancePlan.findFirst({
        where: { factoryId: scope.factory.id, publicId: planPublicId },
      });
      if (!plan) throw new DomainException('http.not_found');
      if (plan.status === 'archived')
        throw new DomainException('erp.archived', { params: { name: plan.title } });
      return (await this.openPreventive(tx, plan, scope.factory.publicId, scope.actor.userId)).order.publicId;
    });
    return this.get(scope, id, perms);
  }

  // --------------------------------------------------------------------------------- orders

  async list(scope: ErpScope, q: ErpMaintenanceListQuery) {
    const where: Prisma.ErpMaintenanceOrderWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open_all') where.status = { in: OPEN_MT };
    else if (q.status) where.status = q.status as ErpMaintenanceStatus;
    if (q.kind) where.kind = q.kind as ErpMaintenanceKind;
    if (q.machineId) where.machine = { publicId: q.machineId };
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { mtNo: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { machine: { name: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpMaintenanceOrder.findMany({
        where,
        include: { machine: true, reportedBy: { select: { displayName: true } } },
        orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpMaintenanceOrder.count({ where }),
    ]);
    return paginated(rows.map(mtSummary), total, q);
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpMaintenanceOrderDto> {
    const row = await this.workspace.db.erpMaintenanceOrder.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: MT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return mtDto(row, perms);
  }

  private async lock(tx: Tx, scope: ErpScope, publicId: string) {
    const found = await tx.erpMaintenanceOrder.findFirst({
      where: { factoryId: scope.factory.id, publicId },
    });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_maintenance_orders WHERE id = ${found.id} FOR UPDATE`;
    return (await tx.erpMaintenanceOrder.findUnique({
      where: { id: found.id },
      include: { machine: true },
    }))!;
  }

  /** Photos the reporter uploaded for this factory (presign → upload → complete). */
  private async photos(tx: Tx, scope: ErpScope, publicIds: string[]): Promise<bigint[]> {
    if (publicIds.length === 0) return [];
    const files = await tx.fileObject.findMany({ where: { publicId: { in: publicIds } } });
    if (
      files.length !== new Set(publicIds).size ||
      files.some(
        (f) =>
          f.ownerFactoryId !== scope.factory.id ||
          f.uploadStatus !== 'uploaded' ||
          f.scanStatus === 'infected',
      )
    )
      throw new DomainException('erp.file_not_usable');
    return files.map((f) => f.id);
  }

  /**
   * A breakdown (D-355): anyone on the floor reports it with photos and a priority; the machine is down until
   * the order is done, and the factory is told at once.
   */
  async reportBreakdown(
    scope: ErpScope,
    body: ErpReportBreakdownDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpMaintenanceOrderDto> {
    const id = await this.workspace.tx(async (tx) => {
      const machine = await this.machine(tx, scope, body.machineId);
      const fileIds = await this.photos(tx, scope, body.photoFileIds ?? []);
      const mtNo = await this.workspace.nextNumber(tx, scope.factory.id, 'mt');
      const reporter = await tx.user.findUniqueOrThrow({
        where: { id: scope.actor.userId },
        select: { displayName: true },
      });
      const order = await tx.erpMaintenanceOrder.create({
        data: {
          factoryId: scope.factory.id,
          mtNo,
          machineId: machine.id,
          kind: 'breakdown',
          priority: (body.priority ?? 'high') as ErpMaintenancePriority,
          title: body.title.trim(),
          description: body.description ?? null,
          reportedById: scope.actor.userId,
          photos: { create: fileIds.map((fileId) => ({ fileId, createdById: scope.actor.userId })) },
        },
      });
      await this.alerts.raise(tx, {
        factoryId: scope.factory.id,
        factoryPublicId: scope.factory.publicId,
        kind: 'machine_breakdown',
        dedupeKey: `machine_breakdown:${order.publicId}`,
        subjectType: 'maintenance_order',
        subjectPublicId: order.publicId,
        payload: {
          mtNo,
          machine: machine.name,
          title: order.title,
          priority: order.priority,
          reportedBy: reporter.displayName,
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_maintenance.reported',
        'erp_maintenance_order',
        order.publicId,
        {
          mtNo,
          kind: 'breakdown',
        },
      );
      return order.publicId;
    });
    return this.get(scope, id, perms);
  }

  /** A window on the schedule (D-352): the auto-planner keeps the machine free then. */
  async schedule(
    scope: ErpScope,
    publicId: string,
    body: ErpScheduleMaintenanceDto,
    perms: ReadonlySet<string>,
  ) {
    const start = new Date(body.start);
    const end = new Date(body.end);
    if (!(end > start))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'end', code: 'invalid', message: 'After the start' }],
      });
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'open' && current.status !== 'scheduled')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpMaintenanceOrder.update({
        where: { id: current.id },
        data: {
          status: 'scheduled',
          scheduledStart: start,
          scheduledEnd: end,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_maintenance.scheduled', 'erp_maintenance_order', publicId, {
        mtNo: current.mtNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  async start(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'open' && current.status !== 'scheduled')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpMaintenanceOrder.update({
        where: { id: current.id },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_maintenance.started', 'erp_maintenance_order', publicId, {
        mtNo: current.mtNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** Spare parts taken from stock for the order (`maintenance_issue` movements, D-322 applies). */
  async issueParts(
    scope: ErpScope,
    publicId: string,
    body: ErpMaintenancePartsDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (!OPEN_MT.includes(current.status))
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
      const items = await this.stock.items(
        tx,
        scope.factory.id,
        body.lines.map((l) => l.itemId),
      );
      const entries = body.lines.map((l, i) => {
        const q = dec(l.quantity);
        if (!q.gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        return {
          item: items[i]!,
          warehouse,
          kind: 'maintenance_issue' as const,
          quantity: q.negated(),
          reason: `ซ่อมบำรุง ${current.mtNo} · ${current.machine.name}`,
        };
      });
      const moves = await this.stock.post(tx, scope, settings, entries, {
        type: 'maintenance_order',
        publicId: current.publicId,
        documentNo: current.mtNo,
      });
      for (const [i, m] of moves.entries())
        await tx.erpMaintenancePart.create({
          data: {
            orderId: current.id,
            itemId: entries[i]!.item.id,
            warehouseId: warehouse.id,
            quantity: fmtQty(dec(m.quantity).negated()),
            unitCost: fmtCost(m.unitCost),
            value: fmtMoney(dec(m.value).negated()),
            createdById: scope.actor.userId,
          },
        });
      await tx.erpMaintenanceOrder.update({
        where: { id: current.id },
        data: { rowVersion: { increment: 1 } },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_maintenance.parts_issued',
        'erp_maintenance_order',
        publicId,
        {
          mtNo: current.mtNo,
          lines: entries.length,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Done (D-355): the resolution and the downtime (default: since it started — or, for a breakdown, since it
   * was reported — until now); a preventive plan counts again from now; its alerts close.
   */
  async finish(scope: ErpScope, publicId: string, body: ErpFinishMaintenanceDto, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (!OPEN_MT.includes(current.status))
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const now = new Date();
      const from = current.kind === 'breakdown' ? current.reportedAt : (current.startedAt ?? now);
      const downtime =
        body.downtimeMinutes ?? Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
      await tx.erpMaintenanceOrder.update({
        where: { id: current.id },
        data: {
          status: 'done',
          startedAt: current.startedAt ?? now,
          finishedAt: now,
          resolution: body.resolution.trim(),
          downtimeMinutes: downtime,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (current.planId) {
        await tx.erpMaintenancePlan.update({ where: { id: current.planId }, data: { lastDoneAt: now } });
        const plan = await tx.erpMaintenancePlan.findUniqueOrThrow({ where: { id: current.planId } });
        await this.alerts.settle(tx, scope.factory.id, 'maintenance_due', plan.publicId);
      }
      await this.alerts.settle(tx, scope.factory.id, 'machine_breakdown', current.publicId);
      await this.workspace.record(tx, scope, 'erp_maintenance.done', 'erp_maintenance_order', publicId, {
        mtNo: current.mtNo,
        downtimeMinutes: downtime,
      });
    });
    return this.get(scope, publicId, perms);
  }

  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'open' && current.status !== 'scheduled')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpMaintenanceOrder.update({
        where: { id: current.id },
        data: {
          status: 'cancelled',
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.alerts.settle(tx, scope.factory.id, 'machine_breakdown', current.publicId);
      await this.workspace.record(tx, scope, 'erp_maintenance.cancelled', 'erp_maintenance_order', publicId, {
        mtNo: current.mtNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  // ---------------------------------------------------------------------------- daily check

  /**
   * D-355, D-358: every active plan that is due (3 days or 10 % of its impressions left) gets its preventive
   * order and an alert, once per cycle.
   */
  @ScheduledJob({ name: 'factory_erp.maintenance_due', cron: '15 7 * * *' })
  async dueCheck(): Promise<number> {
    const plans = await this.workspace.db.erpMaintenancePlan.findMany({
      where: { status: 'active', machine: { status: 'active' } },
      include: { machine: true, factory: true },
    });
    const dues = await this.planDue(this.workspace.db, plans);
    let raised = 0;
    for (const [i, plan] of plans.entries()) {
      const due = dues[i]!;
      if (!due.due) continue;
      try {
        await this.workspace.tx(async (tx) => {
          const { order } = await this.openPreventive(tx, plan, plan.factory.publicId, null);
          const fresh = await this.alerts.raise(tx, {
            factoryId: plan.factoryId,
            factoryPublicId: plan.factory.publicId,
            kind: 'maintenance_due',
            dedupeKey: `maintenance_due:${plan.publicId}:${(plan.lastDoneAt ?? plan.createdAt).toISOString()}`,
            subjectType: 'maintenance_plan',
            subjectPublicId: plan.publicId,
            payload: {
              title: plan.title,
              machine: plan.machine.name,
              mtNo: order.mtNo,
              daysLeft: due.daysLeft,
              impressionsLeft: due.impressionsLeft,
            },
            dueOn: due.daysLeft === null ? null : addCalendarDays(today(), Math.max(0, due.daysLeft)),
          });
          if (fresh) raised += 1;
        });
      } catch (e) {
        this.logger.warn(`maintenance due ${plan.publicId}: ${(e as Error).message}`);
      }
    }
    return raised;
  }
}

export function mtRef(m: {
  publicId: string;
  mtNo: string;
  title: string;
  status: string;
  priority: string;
}): ErpMaintenanceRefDto {
  return { id: m.publicId, mtNo: m.mtNo, title: m.title, status: m.status, priority: m.priority };
}

function mtSummary(
  m: Prisma.ErpMaintenanceOrderGetPayload<{
    include: { machine: true; reportedBy: { select: { displayName: true } } };
  }>,
): ErpMaintenanceOrderSummaryDto {
  return {
    ...mtRef(m),
    kind: m.kind,
    machine: { id: m.machine.publicId, name: m.machine.name },
    reportedAt: toBangkokIso(m.reportedAt),
    reportedBy: m.reportedBy?.displayName ?? null,
    scheduledStart: m.scheduledStart ? toBangkokIso(m.scheduledStart) : null,
    scheduledEnd: m.scheduledEnd ? toBangkokIso(m.scheduledEnd) : null,
    downtimeMinutes: m.downtimeMinutes,
  };
}

export function mtDto(m: MtRow, perms: ReadonlySet<string>): ErpMaintenanceOrderDto {
  return {
    ...mtSummary(m),
    description: m.description,
    plan: m.plan ? { id: m.plan.publicId, code: m.machine.name, name: m.plan.title } : null,
    instructions: m.plan?.instructions ?? null,
    startedAt: m.startedAt ? toBangkokIso(m.startedAt) : null,
    finishedAt: m.finishedAt ? toBangkokIso(m.finishedAt) : null,
    resolution: m.resolution,
    cancelReason: m.cancelReason,
    photos: m.photos.map((p) => ({
      fileId: p.file.publicId,
      name: p.file.originalName,
      mimeType: p.file.mimeType,
    })),
    parts: m.parts.map((p) => ({
      id: p.publicId,
      item: itemRef(p.item),
      warehouse: warehouseRef(p.warehouse),
      quantity: fmtQty(p.quantity),
      unitCost: fmtCost(p.unitCost),
      value: fmtMoney(p.value),
      at: toBangkokIso(p.createdAt),
      by: p.createdBy.displayName,
    })),
    partsValue: fmtMoney(m.parts.reduce((a, p) => a.plus(dec(p.value)), dec(0))),
    plannedParts: (m.plan?.parts ?? []).map((p) => ({ item: itemRef(p.item), quantity: fmtQty(p.quantity) })),
    nextActions: nextActions({ status: m.status }, MT_ACTIONS, perms),
    version: m.rowVersion,
  };
}

function planDto(
  p: PlanRow,
  due: { daysLeft: number | null; impressionsLeft: number | null; due: boolean },
): ErpMaintenancePlanDto {
  return {
    id: p.publicId,
    machine: { id: p.machine.publicId, name: p.machine.name },
    title: p.title,
    instructions: p.instructions,
    everyDays: p.everyDays,
    everyImpressions: p.everyImpressions,
    durationMinutes: p.durationMinutes,
    lastDoneAt: p.lastDoneAt ? toBangkokIso(p.lastDoneAt) : null,
    daysLeft: due.daysLeft,
    impressionsLeft: due.impressionsLeft,
    due: due.due,
    parts: p.parts.map((x) => ({ item: itemRef(x.item), quantity: fmtQty(x.quantity) })),
    status: p.status,
    openOrder: p.orders[0] ? mtRef(p.orders[0]) : null,
    version: p.rowVersion,
  };
}
