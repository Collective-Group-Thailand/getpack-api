import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { type ErpRecordStatus, type ErpSkillLevel, type Prisma } from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { dec, fmtQty } from './erp.math';
import {
  type ErpGrantSupportDto,
  type ErpOperatorSkillDto,
  type ErpSaveShiftDto,
  type ErpSaveSkillDto,
  type ErpShiftDto,
  type ErpSkillListQuery,
  type ErpSupportGrantDto,
  type ErpSupportViewDto,
  type ErpWorkLogDto,
  type ErpWorkLogRowDto,
} from './erp-e5.dto';
import { operationSegments, type OpEvent, overlapMinutes, shiftMinutes } from './erp-e5.math';
import { ErpInsightService } from './erp-insight.service';
import { ErpMasterService } from './erp-master.service';
import { day, factoryUser, iso, userRef } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const MAX_VIEWS = 50;
const SKILL_INCLUDE = { user: true, machine: true } as const;
type SkillRow = Prisma.ErpOperatorSkillGetPayload<{ include: typeof SKILL_INCLUDE }>;
const GRANT_INCLUDE = {
  createdBy: true,
  revokedBy: true,
  views: { include: { staff: true }, orderBy: { viewedAt: 'desc' }, take: MAX_VIEWS },
} as const;
type GrantRow = Prisma.ErpSupportGrantGetPayload<{ include: typeof GRANT_INCLUDE }>;

export const GRANT_ACTIONS: ActionRule<{ active: boolean }>[] = [
  { key: 'erp_support.revoke', permissions: ['factory_support.grant'], when: (g) => g.active },
];

/**
 * People-lite (D-380) — shifts, operator skills per machine and the work log the floor's events make — and
 * getpack support's access (D-381): the owner grants a few days of read-only access, may revoke it, and sees
 * every read; staff with partners.read read the dashboard and settings only while a grant is active.
 */
@Injectable()
export class ErpPeopleService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly insight: ErpInsightService,
    private readonly master: ErpMasterService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------------------------- shifts

  async shifts(scope: ErpScope): Promise<ErpShiftDto[]> {
    const rows = await this.workspace.db.erpShift.findMany({
      where: { factoryId: scope.factory.id },
      orderBy: [{ status: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(shiftDto);
  }

  async createShift(scope: ErpScope, body: ErpSaveShiftDto): Promise<ErpShiftDto> {
    return this.workspace.tx(async (tx) => {
      await this.nameFree(tx, scope, body.name, null);
      const s = await tx.erpShift.create({
        data: {
          factoryId: scope.factory.id,
          name: body.name,
          startTime: body.startTime,
          endTime: body.endTime,
          days: [...new Set(body.days)].sort(),
          note: body.note ?? null,
          status: (body.status ?? 'active') as ErpRecordStatus,
          createdById: scope.actor.userId,
        },
      });
      await this.workspace.record(tx, scope, 'erp_shift.created', 'erp_shift', s.publicId);
      return shiftDto(s);
    });
  }

  async updateShift(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: ErpSaveShiftDto) {
    return this.workspace.tx(async (tx) => {
      const s = await tx.erpShift.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!s) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(s.publicId, s.rowVersion));
      await this.nameFree(tx, scope, body.name, s.id);
      const updated = await tx.erpShift.update({
        where: { id: s.id },
        data: {
          name: body.name,
          startTime: body.startTime,
          endTime: body.endTime,
          days: [...new Set(body.days)].sort(),
          note: body.note ?? null,
          ...(body.status && { status: body.status as ErpRecordStatus }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_shift.updated', 'erp_shift', publicId);
      return shiftDto(updated);
    });
  }

  private async nameFree(tx: Prisma.TransactionClient, scope: ErpScope, name: string, self: bigint | null) {
    const taken = await tx.erpShift.findFirst({
      where: { factoryId: scope.factory.id, name, NOT: self ? { id: self } : undefined },
    });
    if (taken) throw new DomainException('erp.code_taken', { params: { code: name } });
  }

  // ----------------------------------------------------------------------------------- skills

  async skills(scope: ErpScope, q: ErpSkillListQuery): Promise<ErpOperatorSkillDto[]> {
    const rows = await this.workspace.db.erpOperatorSkill.findMany({
      where: {
        factoryId: scope.factory.id,
        ...(q.userId && { user: { publicId: q.userId } }),
        ...(q.machineId && { machine: { publicId: q.machineId } }),
      },
      include: SKILL_INCLUDE,
      orderBy: [{ machineId: 'asc' }, { level: 'desc' }, { id: 'asc' }],
    });
    return rows.map(skillDto);
  }

  /** One skill per person and machine: saving again updates it. */
  async saveSkill(scope: ErpScope, body: ErpSaveSkillDto): Promise<ErpOperatorSkillDto> {
    const id = await this.workspace.tx(async (tx) => {
      const user = await factoryUser(tx, scope.factory.id, body.userId);
      const machine = await tx.factoryMachine.findFirst({
        where: { publicId: body.machineId, factoryId: scope.factory.id },
      });
      if (!machine) throw new DomainException('http.not_found');
      const data = {
        level: body.level as ErpSkillLevel,
        certifiedOn: body.certifiedOn ? day(body.certifiedOn) : null,
        note: body.note ?? null,
      };
      const s = await tx.erpOperatorSkill.upsert({
        where: {
          factoryId_userId_machineId: { factoryId: scope.factory.id, userId: user.id, machineId: machine.id },
        },
        create: {
          factoryId: scope.factory.id,
          userId: user.id,
          machineId: machine.id,
          ...data,
          createdById: scope.actor.userId,
        },
        update: { ...data, updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
      });
      await this.workspace.record(tx, scope, 'erp_operator_skill.saved', 'erp_operator_skill', s.publicId, {
        level: s.level,
      });
      return s.id;
    });
    return skillDto(
      await this.workspace.db.erpOperatorSkill.findUniqueOrThrow({ where: { id }, include: SKILL_INCLUDE }),
    );
  }

  async deleteSkill(scope: ErpScope, publicId: string): Promise<void> {
    await this.workspace.tx(async (tx) => {
      const s = await tx.erpOperatorSkill.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!s) throw new DomainException('http.not_found');
      await tx.erpOperatorSkill.delete({ where: { id: s.id } });
      await this.workspace.record(tx, scope, 'erp_operator_skill.removed', 'erp_operator_skill', publicId);
    });
  }

  // --------------------------------------------------------------------------------- work log

  /**
   * D-380: per person and day — the operations they started, resumed or finished, the running time they
   * opened (from their start / resume to the next pause or finish) and the good and scrap they reported.
   */
  async workLog(scope: ErpScope, from: string, to: string, userPublicId?: string): Promise<ErpWorkLogDto> {
    if (to < from || addCalendarDays(from, 31) < to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'invalid', message: 'On or after from, at most 31 days' }],
      });
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const events = await this.workspace.db.erpOperationEvent.findMany({
      where: {
        factoryId: scope.factory.id,
        occurredAt: { gte: start, lt: end },
        ...(userPublicId && { createdBy: { publicId: userPublicId } }),
      },
      select: { operationId: true },
      distinct: ['operationId'],
    });
    const ops = await this.workspace.db.erpProductionOperation.findMany({
      where: { id: { in: events.map((e) => e.operationId) } },
      include: { machine: true, events: { include: { createdBy: true }, orderBy: { occurredAt: 'asc' } } },
    });
    type Acc = {
      user: { publicId: string; displayName: string };
      day: string;
      ops: Set<bigint>;
      run: number;
      good: ReturnType<typeof dec>;
      scrap: ReturnType<typeof dec>;
      machines: Set<string>;
    };
    const acc = new Map<string, Acc>();
    const get = (u: { publicId: string; displayName: string }, d: string) => {
      const k = `${u.publicId}:${d}`;
      const e = acc.get(k) ?? {
        user: u,
        day: d,
        ops: new Set(),
        run: 0,
        good: dec(0),
        scrap: dec(0),
        machines: new Set(),
      };
      acc.set(k, e);
      return e;
    };
    const now = Date.now();
    for (const o of ops) {
      const evs = o.events;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i]!;
        if (userPublicId && e.createdBy.publicId !== userPublicId) continue;
        if (e.occurredAt < start || e.occurredAt >= end) continue;
        const d = bangkokDate(e.occurredAt);
        const a = get(e.createdBy, d);
        if (e.kind === 'pause') continue;
        a.ops.add(o.id);
        if (o.machine) a.machines.add(o.machine.name);
        if (e.kind === 'finish') {
          a.good = a.good.plus(dec(e.goodQty ?? 0));
          a.scrap = a.scrap.plus(dec(e.scrapQty ?? 0));
        }
        if (e.kind === 'start' || e.kind === 'resume') {
          const next = evs.slice(i + 1).find((x) => x.kind !== 'start' && x.kind !== 'resume');
          const seg = operationSegments(
            [
              { kind: 'start', at: e.occurredAt.getTime() },
              ...(next
                ? [
                    {
                      kind: next.kind === 'pause' ? 'pause' : 'finish',
                      at: next.occurredAt.getTime(),
                    } as OpEvent,
                  ]
                : []),
            ],
            Math.min(now, end.getTime()),
          );
          a.run += seg.run.reduce((x, [s, t]) => x + overlapMinutes(s, t, start.getTime(), end.getTime()), 0);
        }
      }
    }
    const rows: ErpWorkLogRowDto[] = [...acc.values()]
      .filter((a) => a.ops.size > 0)
      .map((a) => ({
        user: userRef(a.user)!,
        day: a.day,
        operations: a.ops.size,
        runMinutes: Math.round(a.run),
        good: fmtQty(a.good),
        scrap: fmtQty(a.scrap),
        machines: [...a.machines].sort(),
      }))
      .sort((x, y) =>
        x.day === y.day ? x.user.name.localeCompare(y.user.name, 'th') : y.day.localeCompare(x.day),
      );
    return { from, to, rows };
  }

  // ---------------------------------------------------------------------------------- support

  async grants(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpSupportGrantDto[]> {
    const rows = await this.workspace.db.erpSupportGrant.findMany({
      where: { factoryId: scope.factory.id },
      include: GRANT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => grantDto(r, perms));
  }

  /** D-381: up to 7 days, one at a time. */
  async grant(
    scope: ErpScope,
    body: ErpGrantSupportDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpSupportGrantDto> {
    const id = await this.workspace.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM factories WHERE id = ${scope.factory.id} FOR UPDATE`;
      const active = await tx.erpSupportGrant.count({
        where: { factoryId: scope.factory.id, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (active > 0) throw new DomainException('erp.support_grant_active');
      const now = new Date();
      const g = await tx.erpSupportGrant.create({
        data: {
          factoryId: scope.factory.id,
          reason: body.reason,
          expiresAt: new Date(now.getTime() + body.days * 86_400_000),
          createdAt: now,
          createdById: scope.actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'erp_support.granted',
        resourceType: 'factory',
        resourcePublicId: scope.factory.publicId,
        data: { grantId: g.publicId, days: body.days },
      });
      await this.workspace.record(tx, scope, 'erp_support.granted', 'erp_support_grant', g.publicId, {
        days: body.days,
      });
      return g.id;
    });
    return grantDto(
      await this.workspace.db.erpSupportGrant.findUniqueOrThrow({ where: { id }, include: GRANT_INCLUDE }),
      perms,
    );
  }

  async revoke(
    scope: ErpScope,
    publicId: string,
    reason: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpSupportGrantDto> {
    const id = await this.workspace.tx(async (tx) => {
      const g = await tx.erpSupportGrant.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!g) throw new DomainException('http.not_found');
      if (g.revokedAt || g.expiresAt <= new Date())
        throw new DomainException('erp.invalid_status', { params: { status: 'ended' } });
      await tx.erpSupportGrant.update({
        where: { id: g.id },
        data: {
          revokedAt: new Date(),
          revokedById: scope.actor.userId,
          revokeReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'erp_support.revoked',
        resourceType: 'factory',
        resourcePublicId: scope.factory.publicId,
        data: { grantId: g.publicId },
      });
      await this.workspace.record(tx, scope, 'erp_support.revoked', 'erp_support_grant', g.publicId);
      return g.id;
    });
    return grantDto(
      await this.workspace.db.erpSupportGrant.findUniqueOrThrow({ where: { id }, include: GRANT_INCLUDE }),
      perms,
    );
  }

  /** D-381: what staff see under an active grant — the dashboard and the ERP settings; every read is kept. */
  async supportView(staff: UserActor, factoryPublicId: string): Promise<ErpSupportViewDto> {
    const factory = await this.workspace.db.factory.findUnique({ where: { publicId: factoryPublicId } });
    if (!factory) throw new DomainException('http.not_found');
    const grant = await this.workspace.db.erpSupportGrant.findFirst({
      where: { factoryId: factory.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    if (!grant) {
      await this.audit.recordStandalone({
        category: 'data_access',
        action: 'erp_support.viewed',
        outcome: 'denied',
        resourceType: 'factory',
        resourcePublicId: factory.publicId,
      });
      throw new DomainException('erp.support_not_granted');
    }
    const [dashboard, settings] = await Promise.all([
      this.insight.dashboard({ factory }),
      this.master.getSettings({ factory, actor: staff }),
    ]);
    await this.workspace.tx(async (tx) => {
      await tx.erpSupportView.create({
        data: { grantId: grant.id, staffId: staff.userId, what: 'dashboard,settings' },
      });
      await tx.erpSupportGrant.update({
        where: { id: grant.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'erp_support.viewed',
        resourceType: 'factory',
        resourcePublicId: factory.publicId,
        data: { grantId: grant.publicId },
      });
      await this.workspace.recordSystem(
        tx,
        factory.publicId,
        'erp_support.viewed',
        'erp_support_grant',
        grant.publicId,
      );
    });
    return {
      factory: { id: factory.publicId, code: factory.code, name: factory.tradeName ?? factory.legalName },
      expiresAt: toBangkokIso(grant.expiresAt),
      reason: grant.reason,
      dashboard,
      settings,
    };
  }
}

function shiftDto(s: Prisma.ErpShiftGetPayload<object>): ErpShiftDto {
  return {
    id: s.publicId,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    days: Array.isArray(s.days) ? (s.days as number[]) : [],
    minutes: shiftMinutes(s.startTime, s.endTime),
    note: s.note,
    status: s.status,
    version: s.rowVersion,
  };
}

function skillDto(s: SkillRow): ErpOperatorSkillDto {
  return {
    id: s.publicId,
    user: userRef(s.user)!,
    machine: { id: s.machine.publicId, name: s.machine.name },
    level: s.level,
    certifiedOn: iso(s.certifiedOn),
    note: s.note,
    version: s.rowVersion,
  };
}

function grantDto(g: GrantRow, perms: ReadonlySet<string>): ErpSupportGrantDto {
  const active = !g.revokedAt && g.expiresAt > new Date();
  return {
    id: g.publicId,
    reason: g.reason,
    expiresAt: toBangkokIso(g.expiresAt),
    active,
    revokedAt: g.revokedAt ? toBangkokIso(g.revokedAt) : null,
    revokedBy: g.revokedBy?.displayName ?? null,
    revokeReason: g.revokeReason,
    viewCount: g.viewCount,
    grantedBy: g.createdBy.displayName,
    createdAt: toBangkokIso(g.createdAt),
    views: g.views.map((v) => ({ at: toBangkokIso(v.viewedAt), staff: v.staff.displayName, what: v.what })),
    nextActions: nextActions({ active }, GRANT_ACTIONS, perms),
  };
}
