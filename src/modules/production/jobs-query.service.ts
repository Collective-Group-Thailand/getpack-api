import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { currentMilestone, JOB_INCLUDE, type JobExtras, type JobRow } from './job-views';
import { type BoardColumnDto, type ProductionBoardDto } from './production.dto';
import { type RouteSnapshot } from './production.service';

/**
 * Reads of production jobs, scoped (schema-design §2.5): staff see every job; a factory principal only the
 * jobs of its own factories — anything else is "not found" (IDOR-safe, contract §5).
 */
@Injectable()
export class JobsQueryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoping: ScopingService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    // A factory reads the approved artwork (the locked copy) and the dieline of its own live jobs — never the
    // working files or earlier versions (B4.2 "approved version only").
    this.files.registerFileReader('production', async (actor, file) => {
      if (!(actor.type === 'api_client' || (actor.type === 'user' && actor.audience === 'partner')))
        return false;
      const scope = await this.scoping.scopeOf(actor, 'factory');
      if (scope === 'all' || scope.length === 0) return false;
      // D-442: a production copy of a customer original is readable by the factories making its approved proof.
      const copy = await this.prisma.artworkProductionCopy.findUnique({
        where: { copyFileId: file.id },
        select: {
          submissionFile: {
            select: {
              submission: {
                select: {
                  orderId: true,
                  proofs: { where: { status: 'approved' }, select: { publicId: true } },
                },
              },
            },
          },
        },
      });
      if (copy) {
        const { orderId, proofs } = copy.submissionFile.submission;
        if (proofs.length === 0) return false;
        const live = await this.prisma.productionJob.count({
          where: {
            factoryId: { in: [...scope] },
            orderId,
            status: { notIn: ['rejected', 'cancelled'] },
            OR: proofs.map((p) => ({ specSnapshot: { path: ['approvedProofId'], equals: p.publicId } })),
          },
        });
        return live > 0;
      }
      const n = await this.prisma.productionJob.count({
        where: {
          factoryId: { in: [...scope] },
          status: { notIn: ['rejected', 'cancelled'] },
          OR: [
            { specSnapshot: { path: ['approvedFileId'], equals: file.publicId } },
            { specSnapshot: { path: ['dielineFileId'], equals: file.publicId } },
          ],
        },
      });
      return n > 0;
    });
  }

  async scopeWhere(actor: Actor): Promise<Prisma.ProductionJobWhereInput> {
    const scope = await this.scoping.scopeOf(actor, 'factory');
    return scope === 'all' ? {} : { factoryId: { in: [...scope] } };
  }

  async get(actor: Actor, publicId: string, db: Tx = this.prisma): Promise<JobRow> {
    const row = await db.productionJob.findFirst({
      where: { publicId, ...(await this.scopeWhere(actor)) },
      include: JOB_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(actor: Actor, where: Prisma.ProductionJobWhereInput, page: number, perPage: number) {
    const scoped = { AND: [where, await this.scopeWhere(actor)] };
    return Promise.all([
      this.prisma.productionJob.findMany({
        where: scoped,
        include: JOB_INCLUDE,
        orderBy: [{ releasedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.productionJob.count({ where: scoped }),
    ]);
  }

  /** Photo evidence per milestone (attachments `milestone.photo`). */
  async photos(rows: JobRow[]): Promise<Map<bigint, string[]>> {
    const ids = rows.flatMap((r) => r.milestones.map((m) => m.id));
    const map = new Map<bigint, string[]>();
    if (ids.length === 0) return map;
    const attachments = await this.prisma.attachment.findMany({
      where: { subjectType: 'job_milestone', subjectId: { in: ids } },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    for (const a of attachments)
      map.set(a.subjectId, [...(map.get(a.subjectId) ?? []), a.fileObject.publicId]);
    return map;
  }

  /** Pieces of each destination already on live shipments of these jobs, and the approved proofs (U-B0.3). */
  async extras(rows: JobRow[]): Promise<JobExtras> {
    const jobIds = rows.map((r) => r.id);
    const proofIds = [
      ...new Set(
        rows.flatMap((r) => {
          const id = (r.specSnapshot as Record<string, unknown>)['approvedProofId'];
          return typeof id === 'string' ? [id] : [];
        }),
      ),
    ];
    const [items, proofs] = await Promise.all([
      jobIds.length
        ? this.prisma.shipmentItem.groupBy({
            by: ['orderDestinationId'],
            where: {
              productionJobId: { in: jobIds },
              shipment: { status: { notIn: ['cancelled', 'returned'] } },
            },
            _sum: { quantity: true },
          })
        : [],
      proofIds.length
        ? this.prisma.proof.findMany({
            where: { publicId: { in: proofIds } },
            select: {
              publicId: true,
              versionNo: true,
              decidedAt: true,
              // D-442: the customer originals behind the proof, as production copies (no customer identity).
              submission: {
                select: {
                  files: {
                    where: { productionCopy: { isNot: null } },
                    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
                    select: {
                      productionCopy: {
                        select: {
                          status: true,
                          failureReason: true,
                          copyFile: { select: { publicId: true, originalName: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        : [],
    ]);
    return {
      shipped: new Map(items.map((i) => [i.orderDestinationId, i._sum.quantity ?? 0])),
      proofs: new Map(
        proofs.map((p) => [
          p.publicId,
          {
            versionNo: p.versionNo,
            decidedAt: p.decidedAt,
            originalFiles: (p.submission?.files ?? []).flatMap(({ productionCopy: copy }) =>
              copy
                ? [
                    {
                      status: copy.status,
                      fileId: copy.copyFile?.publicId ?? null,
                      fileName: copy.copyFile?.originalName ?? null,
                      reason: copy.failureReason,
                    },
                  ]
                : [],
            ),
          },
        ]),
      ),
    };
  }

  /**
   * A shop-floor scan or a typed code (U-B0.3): a job number, a job id, or the label code of one of its cartons —
   * within the caller's factories only (404 otherwise).
   */
  async lookup(actor: Actor, code: string): Promise<{ publicId: string; jobNo: string }> {
    const scope = await this.scopeWhere(actor);
    const trimmed = code.trim();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const direct = await this.prisma.productionJob.findFirst({
      where: {
        ...scope,
        OR: [{ jobNo: { equals: trimmed, mode: 'insensitive' } }, ...(uuid ? [{ publicId: trimmed }] : [])],
      },
      select: { publicId: true, jobNo: true },
    });
    if (direct) return direct;
    const carton = await this.prisma.shipmentCarton.findUnique({
      where: { labelCode: trimmed.toUpperCase() },
      select: { shipment: { select: { items: { select: { productionJobId: true } } } } },
    });
    const jobIds = [...new Set(carton?.shipment.items.map((i) => i.productionJobId) ?? [])];
    if (jobIds.length === 1) {
      const job = await this.prisma.productionJob.findFirst({
        where: { ...scope, id: jobIds[0] },
        select: { publicId: true, jobNo: true },
      });
      if (job) return job;
    }
    throw new DomainException('http.not_found');
  }

  /**
   * The factory's day (U-B0.3, D-074, D-076): jobs to accept and how many are late, steps due today (Asia/Bangkok),
   * jobs at risk or on hold, planned inspections; alerts; and a work queue — acceptance by deadline, then at-risk
   * jobs, then steps due today (at most 20).
   */
  async today(factoryId: bigint, now = new Date()) {
    const start = startOfBangkokDay(bangkokDate(now));
    const end = new Date(start.getTime() + 86_400_000);
    const soon = new Date(now.getTime() + 4 * 3_600_000);
    const mine = { factoryId };
    const open = {
      status: { in: ['accepted', 'in_progress', 'on_hold'] as ('accepted' | 'in_progress' | 'on_hold')[] },
    };
    const [awaiting, overdue, dueToday, atRisk, onHold, inspections] = await Promise.all([
      this.prisma.productionJob.findMany({
        where: { ...mine, status: 'released' },
        include: JOB_INCLUDE,
        orderBy: { acceptDueAt: 'asc' },
        take: 20,
      }),
      this.prisma.productionJob.count({ where: { ...mine, status: 'released', acceptDueAt: { lt: now } } }),
      this.prisma.productionJob.findMany({
        where: {
          ...mine,
          ...open,
          milestones: { some: { status: { notIn: ['completed', 'skipped'] }, dueAt: { lt: end } } },
        },
        include: JOB_INCLUDE,
        orderBy: { promisedShipDate: 'asc' },
        take: 20,
      }),
      this.prisma.productionJob.findMany({
        where: { ...mine, ...open, atRiskSince: { not: null } },
        include: JOB_INCLUDE,
        orderBy: { atRiskSince: 'asc' },
        take: 20,
      }),
      this.prisma.productionJob.count({ where: { ...mine, status: 'on_hold' } }),
      this.prisma.inspection.findMany({
        where: { selected: true, status: { in: ['planned', 'in_progress'] }, job: { ...mine, ...open } },
        include: { job: { select: { publicId: true, jobNo: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);
    const milestonesDueToday = await this.prisma.jobMilestone.count({
      where: {
        job: { ...mine, ...open },
        status: { notIn: ['completed', 'skipped'] },
        dueAt: { gte: start, lt: end },
      },
    });
    const alerts = [
      ...awaiting
        .filter((j) => j.acceptDueAt < soon)
        .map((j) => ({
          kind: j.acceptDueAt < now ? 'acceptance_overdue' : 'acceptance_due_soon',
          jobId: j.publicId,
          jobNo: j.jobNo,
          dueAt: j.acceptDueAt,
        })),
      ...dueToday.flatMap((j) => {
        const current = currentMilestone(j);
        return current?.dueAt && current.dueAt < now
          ? [{ kind: 'step_overdue', jobId: j.publicId, jobNo: j.jobNo, dueAt: current.dueAt }]
          : [];
      }),
      ...inspections.map((i) => ({
        kind: 'inspection_planned',
        jobId: i.job.publicId,
        jobNo: i.job.jobNo,
        dueAt: i.scheduledAt,
      })),
    ];
    const seen = new Set<bigint>();
    const queue = [...awaiting, ...atRisk, ...dueToday]
      .filter((j) => !seen.has(j.id) && seen.add(j.id))
      .slice(0, 20);
    return {
      counters: {
        awaitingAcceptance: await this.prisma.productionJob.count({ where: { ...mine, status: 'released' } }),
        acceptanceOverdue: overdue,
        milestonesDueToday,
        atRisk: await this.prisma.productionJob.count({
          where: { ...mine, ...open, atRiskSince: { not: null } },
        }),
        onHold,
        inspectionsPlanned: inspections.length,
      },
      alerts,
      queue,
    };
  }

  /**
   * The production board (D-074, D-075): open jobs grouped by the step they are at — released jobs not accepted
   * yet under `awaiting_acceptance` — with totals and the jobs predicted to miss the promise.
   */
  async board(filters: { factoryId?: string; productTypeCode?: string }): Promise<ProductionBoardDto> {
    const jobs = await this.prisma.productionJob.findMany({
      where: {
        status: { in: ['released', 'accepted', 'in_progress', 'on_hold'] },
        ...(filters.factoryId && { factory: { publicId: filters.factoryId } }),
        ...(filters.productTypeCode && { order: { productType: { code: filters.productTypeCode } } }),
      },
      select: {
        status: true,
        atRiskSince: true,
        routeSnapshot: true,
        milestones: {
          orderBy: { seq: 'asc' },
          select: { seq: true, stepKey: true, status: true, dueAt: true },
        },
      },
      take: 5000,
    });
    const columns = new Map<string, BoardColumnDto & { order: number }>();
    for (const job of jobs) {
      const current = job.status === 'released' ? null : currentMilestone(job);
      const key = job.status === 'released' ? 'awaiting_acceptance' : (current?.stepKey ?? 'finishing');
      const route = job.routeSnapshot as unknown as RouteSnapshot;
      const step = current ? route.steps.find((s) => s.seq === current.seq) : undefined;
      const column = columns.get(key) ?? {
        key,
        labelTh: key === 'awaiting_acceptance' ? 'รอโรงงานรับงาน' : (step?.nameTh ?? key),
        labelEn: key === 'awaiting_acceptance' ? 'Awaiting acceptance' : (step?.nameEn ?? key),
        total: 0,
        atRisk: 0,
        order: key === 'awaiting_acceptance' ? -1 : (current?.seq ?? 999),
      };
      column.total += 1;
      if (job.atRiskSince) column.atRisk += 1;
      columns.set(key, column);
    }
    const list = [...columns.values()].sort((a, b) => a.order - b.order);
    return {
      columns: list.map(({ order: _o, ...c }) => c),
      total: jobs.length,
      atRisk: jobs.filter((j) => j.atRiskSince).length,
    };
  }
}
