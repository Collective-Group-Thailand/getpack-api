import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { type WorkingDayCalendar } from '@common/time/working-days';
import { type ErpProductionStatus, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { SettingsService } from '@platform/settings/settings.service';

import {
  type ErpAutoPlanResultDto,
  type ErpMoveOperationDto,
  type ErpScheduleDto,
  type ErpScheduleQuery,
  type ErpScheduleSlotDto,
} from './erp-e3.dto';
import { ErpMaintenanceService } from './erp-maintenance.service';
import { type Busy, type PlanOperation, planSchedule } from './erp-schedule.plan';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const OPEN: ErpProductionStatus[] = ['planned', 'released', 'in_progress'];
const ACTIVE_OPS = ['pending', 'in_progress', 'paused'] as const;
/** How long a breakdown with no end yet is assumed to keep its machine down when planning (business minutes). */
const BREAKDOWN_MINUTES = 120;

const OP_INCLUDE = {
  machine: true,
  productionOrder: true,
} as const;
type OpRow = Prisma.ErpProductionOperationGetPayload<{ include: typeof OP_INCLUDE }>;

/** The end of a due date, Bangkok: an order due on the 20th is late if it finishes on the 21st. */
const dueEnd = (dueOn: Date | null) =>
  dueOn ? startOfBangkokDay(addCalendarDays(iso(dueOn)!, 1)).getTime() : null;

/**
 * The machine schedule (D-352): every open operation's slot on its machine in the factory's business hours
 * (D-292) — planned automatically forward from now around running and locked operations and maintenance
 * windows, or moved by hand (which locks it).
 */
@Injectable()
export class ErpScheduleService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly calendars: BusinessCalendarService,
    private readonly settings: SettingsService,
    private readonly maintenance: ErpMaintenanceService,
  ) {}

  /** The factory's calendar and the platform window its own hours replace. */
  private async clock(scope: ErpScope): Promise<{
    calendar: WorkingDayCalendar;
    window: { from: string; to: string };
    add: (start: number, minutes: number) => number;
  }> {
    const factory = await this.workspace.db.factory.findUniqueOrThrow({
      where: { id: scope.factory.id },
      include: { calendar: true },
    });
    const calendar = await this.calendars.calendar(factory.calendar?.code);
    const window = (await this.settings.at('calendar.business_hours', {})).value as {
      from: string;
      to: string;
    };
    return {
      calendar,
      window,
      add: (start, minutes) =>
        calendar.addBusinessMinutes(new Date(start), Math.max(0, Math.ceil(minutes)), window).getTime(),
    };
  }

  private slot(o: OpRow): ErpScheduleSlotDto {
    const end = o.scheduledEnd!.getTime();
    const due = dueEnd(o.productionOrder.dueOn);
    return {
      operationId: o.publicId,
      seq: o.seq,
      name: o.name,
      order: {
        id: o.productionOrder.publicId,
        moNo: o.productionOrder.moNo,
        title: o.productionOrder.title,
        priority: o.productionOrder.priority,
        dueOn: iso(o.productionOrder.dueOn),
        status: o.productionOrder.status,
      },
      status: o.status,
      start: toBangkokIso(o.scheduledStart!),
      end: toBangkokIso(o.scheduledEnd!),
      locked: o.locked,
      plannedMinutes: o.plannedMinutes,
      late: due !== null && end > due,
    };
  }

  /** The board (D-352): per machine its slots and maintenance windows from `from` for `days` days. */
  async board(scope: ErpScope, q: ErpScheduleQuery): Promise<ErpScheduleDto> {
    const fromDay = q.from ?? bangkokDate(new Date());
    const days = q.days ?? 7;
    const from = startOfBangkokDay(fromDay);
    const to = startOfBangkokDay(addCalendarDays(fromDay, days));
    const factoryId = scope.factory.id;
    const [{ calendar, window }, machines, ops, unscheduled, orders] = await Promise.all([
      this.clock(scope),
      this.maintenance.machines(scope),
      this.workspace.db.erpProductionOperation.findMany({
        where: {
          productionOrder: { factoryId, status: { in: [...OPEN, 'completed'] } },
          status: { not: 'skipped' },
          scheduledStart: { lt: to },
          scheduledEnd: { gte: from },
        },
        include: OP_INCLUDE,
        orderBy: { scheduledStart: 'asc' },
      }),
      this.workspace.db.erpProductionOperation.count({
        where: {
          productionOrder: { factoryId, status: { in: OPEN } },
          status: { in: [...ACTIVE_OPS] },
          scheduledStart: null,
        },
      }),
      this.workspace.db.erpMaintenanceOrder.findMany({
        where: {
          factoryId,
          OR: [
            { status: { in: ['open', 'scheduled', 'in_progress'] }, kind: 'breakdown' },
            { scheduledStart: { lt: to }, scheduledEnd: { gte: from }, status: { not: 'cancelled' } },
          ],
        },
        include: { machine: true },
      }),
    ]);
    const hours: Record<string, { from: string; to: string } | null> = {};
    for (let i = 0; i < days; i++) {
      const d = addCalendarDays(fromDay, i);
      hours[d] = calendar.isWorkingDay(d) ? (calendar.hoursOn(d) ?? window) : null;
    }
    const now = new Date();
    return {
      from: toBangkokIso(from),
      to: toBangkokIso(to),
      hours,
      machines: machines
        .filter((m) => m.status === 'active')
        .map((m) => {
          const slots = ops.filter((o) => o.machine?.publicId === m.id).map((o) => this.slot(o));
          const blocks = orders
            .filter((o) => o.machine.publicId === m.id)
            .map((o) => ({
              maintenanceOrder: { id: o.publicId, code: o.mtNo, name: o.title },
              kind: o.kind,
              start: toBangkokIso(o.scheduledStart ?? o.reportedAt),
              end: toBangkokIso(o.scheduledEnd ?? o.finishedAt ?? (now > to ? now : to)),
            }));
          return {
            machine: { id: m.id, name: m.name },
            state: m.state,
            slots,
            blocks,
            loadMinutes: slots.reduce((a, s) => a + s.plannedMinutes, 0),
          };
        }),
      unassigned: ops.filter((o) => o.machineId === null).map((o) => this.slot(o)),
      unscheduled,
    };
  }

  /**
   * Auto-plan (D-352): every not-started, unlocked operation of the open orders gets a new slot forward from
   * now; running, paused and locked ones stay; maintenance windows and open breakdowns keep their machines.
   */
  async autoPlan(scope: ErpScope): Promise<ErpAutoPlanResultDto> {
    const factoryId = scope.factory.id;
    const { add } = await this.clock(scope);
    const now = Date.now();
    return this.workspace.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM erp_factory_settings WHERE factory_id = ${factoryId} FOR UPDATE`;
      const ops = await tx.erpProductionOperation.findMany({
        where: { productionOrder: { factoryId, status: { in: OPEN } }, status: { not: 'skipped' } },
        include: OP_INCLUDE,
      });
      const maint = await tx.erpMaintenanceOrder.findMany({
        where: { factoryId, status: { in: ['open', 'scheduled', 'in_progress'] } },
      });
      const busy: Busy[] = [];
      for (const m of maint) {
        if (m.scheduledStart && m.scheduledEnd)
          busy.push({
            machineId: m.machineId,
            start: m.scheduledStart.getTime(),
            end: m.scheduledEnd.getTime(),
          });
        else if (m.kind === 'breakdown')
          busy.push({
            machineId: m.machineId,
            start: m.reportedAt.getTime(),
            end: add(now, BREAKDOWN_MINUTES),
          });
      }
      let kept = 0;
      const plan: PlanOperation[] = ops.map((o) => {
        const running = o.status === 'in_progress' || o.status === 'paused';
        let fixed: { start: number; end: number } | null = null;
        if (running) {
          const start = (o.startedAt ?? o.scheduledStart ?? new Date(now)).getTime();
          const planned = o.scheduledEnd?.getTime() ?? add(start, o.plannedMinutes);
          fixed = { start, end: Math.max(planned, add(now, 15)) };
        } else if (o.locked && o.scheduledStart && o.scheduledEnd && o.status === 'pending')
          fixed = { start: o.scheduledStart.getTime(), end: o.scheduledEnd.getTime() };
        if (fixed) kept += 1;
        return {
          id: o.id,
          orderId: o.productionOrderId,
          seq: o.seq,
          machineId: o.machineId,
          minutes: o.plannedMinutes,
          priority: o.productionOrder.priority,
          dueOn: iso(o.productionOrder.dueOn),
          orderRank: o.productionOrder.id,
          fixed,
          finishedAt: o.status === 'done' ? (o.finishedAt ?? new Date(now)).getTime() : null,
        };
      });
      const placed = planSchedule(plan, busy, now, add);
      for (const p of placed)
        await tx.erpProductionOperation.update({
          where: { id: p.id },
          data: { scheduledStart: new Date(p.start), scheduledEnd: new Date(p.end) },
        });
      // Late orders: the last slot ends after the end of the due date.
      const ends = new Map<bigint, number>();
      for (const o of plan) {
        const p = placed.find((x) => x.id === o.id);
        const end = p?.end ?? o.fixed?.end ?? o.finishedAt ?? 0;
        ends.set(o.orderId, Math.max(ends.get(o.orderId) ?? 0, end));
      }
      const late = [];
      for (const [orderId, end] of ends) {
        const mo = ops.find((o) => o.productionOrderId === orderId)!.productionOrder;
        const due = dueEnd(mo.dueOn);
        if (due !== null && end > due)
          late.push({
            order: {
              id: mo.publicId,
              moNo: mo.moNo,
              title: mo.title,
              priority: mo.priority,
              dueOn: iso(mo.dueOn),
              status: mo.status,
            },
            finishesAt: toBangkokIso(new Date(end)),
          });
      }
      await this.workspace.record(tx, scope, 'erp_schedule.planned', 'factory', scope.factory.publicId, {
        placed: placed.length,
        late: late.length,
      });
      return { placed: placed.length, kept, late };
    });
  }

  private async op(scope: ErpScope, moId: string, opId: string) {
    const o = await this.workspace.db.erpProductionOperation.findFirst({
      where: { publicId: opId, productionOrder: { factoryId: scope.factory.id, publicId: moId } },
      include: OP_INCLUDE,
    });
    if (!o) throw new DomainException('http.not_found');
    return o;
  }

  /** Moves an operation by hand (D-352): to a start (in business hours), maybe another machine; it is locked. */
  async move(
    scope: ErpScope,
    moId: string,
    opId: string,
    body: ErpMoveOperationDto,
  ): Promise<ErpScheduleSlotDto> {
    const current = await this.op(scope, moId, opId);
    if (
      !OPEN.includes(current.productionOrder.status) ||
      current.status === 'done' ||
      current.status === 'skipped'
    )
      throw new DomainException('erp.invalid_status', { params: { status: current.status } });
    let machineId = current.machineId;
    if (body.machineId !== undefined) {
      if (body.machineId === null) machineId = null;
      else {
        const m = await this.workspace.db.factoryMachine.findFirst({
          where: { factoryId: scope.factory.id, publicId: body.machineId },
        });
        if (!m) throw new DomainException('http.not_found');
        machineId = m.id;
      }
    }
    const { add } = await this.clock(scope);
    const minutes = body.plannedMinutes ?? current.plannedMinutes;
    const start = add(new Date(body.start).getTime(), 0);
    const end = add(start, minutes);
    await this.workspace.tx(async (tx) => {
      await tx.erpProductionOperation.update({
        where: { id: current.id },
        data: {
          machineId,
          plannedMinutes: minutes,
          scheduledStart: new Date(start),
          scheduledEnd: new Date(end),
          locked: body.locked ?? true,
        },
      });
      await this.workspace.record(tx, scope, 'erp_schedule.moved', 'erp_production_order', moId, {
        moNo: current.productionOrder.moNo,
        seq: current.seq,
      });
    });
    return this.slot(await this.op(scope, moId, opId));
  }

  /** Locks or unlocks an operation's slot (D-352). */
  async lock(scope: ErpScope, moId: string, opId: string, locked: boolean): Promise<ErpScheduleSlotDto> {
    const current = await this.op(scope, moId, opId);
    if (!current.scheduledStart && locked)
      throw new DomainException('erp.invalid_status', { params: { status: 'unscheduled' } });
    await this.workspace.db.erpProductionOperation.update({ where: { id: current.id }, data: { locked } });
    const after = await this.op(scope, moId, opId);
    if (!after.scheduledStart)
      throw new DomainException('erp.invalid_status', { params: { status: 'unscheduled' } });
    return this.slot(after);
  }
}
