import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type JobMilestone, type Prisma, type ProductionJob, type QcResult } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { JobsQueryService } from './jobs-query.service';
import { ProductionService, type RouteSnapshot } from './production.service';

const WORKING: readonly string[] = ['accepted', 'in_progress'];

export interface MilestoneUpdate {
  action: 'start' | 'complete';
  quantityIn?: number;
  quantityOut?: number;
  quantityScrap?: number;
  note?: string;
  photoFileIds?: string[];
  /** Photos the customer may see on their timeline (customer-visible milestones only). */
  shareWithCustomer?: boolean;
  /** The device's id of this update; a replay with the same id changes nothing. */
  clientRef: string;
  clientReportedAt?: Date;
}

export interface MilestoneOutcome {
  applied: boolean;
  /** Why nothing changed: `duplicate` (same client ref) or the server's state won (`already_started`…). */
  reason: 'duplicate' | 'already_started' | 'already_completed' | 'skipped' | null;
}

export interface QcInput {
  checklistVersion: string;
  checklist: Record<string, unknown>;
  result: QcResult;
  defects?: { code: string; severity: 'critical' | 'major' | 'minor'; count: number; note?: string }[];
  quantityChecked?: number;
  quantityDefective?: number;
  note?: string;
  photoFileIds: string[];
}

/**
 * The factory's progress (D-075, D-076): milestones are started and completed along the job's route with
 * quantities in / out / scrap and the evidence the step requires (photos, the QC form); updates are
 * idempotent (`Idempotency-Key` + the device's `clientRef`) and the server wins on conflict — a stale or
 * repeated update returns the current state with `applied = false`. The first start moves the job to
 * `in_progress`; the last completion completes it with the good and scrap quantities. QC checks carry photos
 * (D-076); the first one decides "first pass" for the scorecard (D-155). Issues are raised by the factory
 * and resolved by staff.
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsQueryService,
    private readonly production: ProductionService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async update(
    actor: Actor,
    jobPublicId: string,
    milestonePublicId: string,
    input: MilestoneUpdate,
  ): Promise<MilestoneOutcome> {
    const scoped = await this.jobs.get(actor, jobPublicId);
    return this.prisma.withTx(async (tx) => {
      const job = await this.production.lockJob(tx, scoped.id);
      const milestone = await tx.jobMilestone.findFirst({
        where: { publicId: milestonePublicId, jobId: job.id },
      });
      if (!milestone) throw new DomainException('http.not_found');
      if (milestone.clientRef === input.clientRef) return { applied: false, reason: 'duplicate' };
      if (!WORKING.includes(job.status))
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      if (milestone.status === 'skipped') return { applied: false, reason: 'skipped' };
      if (input.action === 'start' && milestone.status !== 'pending')
        return { applied: false, reason: 'already_started' };
      if (input.action === 'complete' && milestone.status === 'completed')
        return { applied: false, reason: 'already_completed' };

      const all = await tx.jobMilestone.findMany({ where: { jobId: job.id }, orderBy: { seq: 'asc' } });
      if (all.some((m) => m.seq < milestone.seq && m.status === 'pending'))
        throw new DomainException('production.milestone_out_of_order');
      const photoIds = await this.photos(tx, job, input.photoFileIds ?? []);
      const at = new Date();
      const who = {
        reportedById: actor.type === 'user' ? actor.userId : null,
        reportedByClientId: actor.type === 'api_client' ? actor.apiClientId : null,
        clientRef: input.clientRef,
        clientReportedAt: input.clientReportedAt ?? null,
      };
      if (input.action === 'start') {
        await tx.jobMilestone.update({
          where: { id: milestone.id },
          data: {
            status: 'in_progress',
            startedAt: at,
            quantityIn: input.quantityIn ?? null,
            note: input.note ?? milestone.note,
            ...who,
            rowVersion: { increment: 1 },
          },
        });
      } else {
        await this.checkEvidence(tx, job, milestone, photoIds.length);
        const quantities = this.quantities(job, milestone, all, input);
        await tx.jobMilestone.update({
          where: { id: milestone.id },
          data: {
            status: 'completed',
            startedAt: milestone.startedAt ?? at,
            completedAt: at,
            ...quantities,
            onTime: milestone.dueAt ? at <= milestone.dueAt : null,
            note: input.note ?? milestone.note,
            ...who,
            rowVersion: { increment: 1 },
          },
        });
      }
      await this.attach(
        tx,
        'job_milestone',
        milestone.id,
        photoIds,
        'milestone.photo',
        (input.shareWithCustomer ?? false) && milestone.customerVisible,
      );
      if (job.status === 'accepted') {
        await tx.productionJob.update({
          where: { id: job.id },
          data: {
            status: 'in_progress',
            statusChangedAt: at,
            actualStartAt: at,
            rowVersion: { increment: 1 },
          },
        });
      }
      const type =
        input.action === 'start' ? 'production_job.milestone_started' : 'production_job.milestone_completed';
      const current = await tx.jobMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
      await this.production.record(
        tx,
        job.id,
        type,
        {
          milestoneId: milestone.publicId,
          stepKey: milestone.stepKey,
          onTime: current.onTime,
          photos: photoIds.length,
        },
        actor,
      );
      if (input.action === 'complete' && milestone.customerVisible)
        await this.customerMilestone(tx, job, milestone, actor);
      await this.completeIfDone(tx, job.id, actor);
      return { applied: true, reason: null };
    });
  }

  /** The step's evidence: photos (new or already attached) and / or a passing QC form (D-076). */
  private async checkEvidence(tx: Tx, job: ProductionJob, milestone: JobMilestone, newPhotos: number) {
    const needsPhoto = milestone.evidence === 'photo' || milestone.evidence === 'photo_and_qc_form';
    const needsQc = milestone.evidence === 'qc_form' || milestone.evidence === 'photo_and_qc_form';
    if (needsPhoto) {
      const existing = await tx.attachment.count({
        where: { subjectType: 'job_milestone', subjectId: milestone.id },
      });
      if (existing + newPhotos === 0)
        throw new DomainException('production.evidence_missing', { params: { evidence: 'photo' } });
    }
    if (needsQc) {
      const qc = await tx.qcCheck.findFirst({ where: { jobId: job.id }, orderBy: { performedAt: 'desc' } });
      if (!qc || qc.result === 'fail')
        throw new DomainException('production.evidence_missing', { params: { evidence: 'qc_form' } });
    }
  }

  /**
   * Quantities of a tracked step: out and scrap never exceed what came in — the step's own input, else the
   * previous tracked step's output, else the ordered quantity plus the overage tolerance.
   */
  private quantities(
    job: ProductionJob,
    milestone: JobMilestone,
    all: JobMilestone[],
    input: MilestoneUpdate,
  ) {
    if (!milestone.tracksQuantity) return {};
    if (input.quantityOut === undefined)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'quantityOut', code: 'required', message: 'this step tracks quantities' }],
      });
    const previous = [...all]
      .reverse()
      .find((m) => m.seq < milestone.seq && m.tracksQuantity && m.quantityOut !== null);
    const overage = job.toleranceOveragePct ? Number(job.toleranceOveragePct) : 0;
    const ceiling =
      input.quantityIn ??
      milestone.quantityIn ??
      previous?.quantityOut ??
      Math.floor(job.quantityOrdered * (1 + overage / 100) + 1e-9);
    const scrap = input.quantityScrap ?? 0;
    if (input.quantityOut + scrap > ceiling)
      throw new DomainException('production.quantity_invalid', { params: { available: ceiling } });
    return {
      quantityIn: input.quantityIn ?? milestone.quantityIn ?? previous?.quantityOut ?? null,
      quantityOut: input.quantityOut,
      quantityScrap: scrap,
    };
  }

  private async completeIfDone(tx: Tx, jobId: bigint, actor: Actor) {
    const milestones = await tx.jobMilestone.findMany({ where: { jobId }, orderBy: { seq: 'asc' } });
    if (!milestones.every((m) => m.status === 'completed' || m.status === 'skipped')) return;
    const tracked = milestones.filter((m) => m.tracksQuantity && m.quantityOut !== null);
    const at = new Date();
    await tx.productionJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        statusChangedAt: at,
        actualFinishAt: at,
        quantityGood: tracked.at(-1)?.quantityOut ?? null,
        quantityScrap: tracked.reduce((a, m) => a + (m.quantityScrap ?? 0), 0),
        atRiskSince: null,
        rowVersion: { increment: 1 },
      },
    });
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
    await this.production.record(
      tx,
      jobId,
      'production_job.completed',
      { quantityGood: job.quantityGood, quantityScrap: job.quantityScrap },
      actor,
    );
  }

  /** A customer-visible step reached: the order's timeline and notifications (label only, no factory, D-050). */
  private async customerMilestone(tx: Tx, job: ProductionJob, milestone: JobMilestone, actor: Actor) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: job.orderId },
      include: { customer: { select: { publicId: true } } },
    });
    const step = (job.routeSnapshot as unknown as RouteSnapshot).steps.find((s) => s.seq === milestone.seq);
    const data = {
      milestoneId: milestone.publicId,
      stepKey: milestone.stepKey,
      labelTh: step?.customerLabelTh ?? null,
      labelEn: step?.customerLabelEn ?? null,
    };
    const event = await this.events.record(
      tx,
      {
        type: 'production.milestone_reached',
        aggregateType: 'order',
        aggregateId: order.publicId,
        payload: { orderId: order.publicId, customerId: order.customer.publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: order.publicId,
      action: 'production.milestone_reached',
      messageKey: 'activity.production.milestone_reached',
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }

  // --- QC (D-076) ------------------------------------------------------------------------------------

  async recordQc(actor: Actor, jobPublicId: string, input: QcInput) {
    const scoped = await this.jobs.get(actor, jobPublicId);
    return this.prisma.withTx(async (tx) => {
      const job = await this.production.lockJob(tx, scoped.id);
      if (!WORKING.includes(job.status))
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      if (input.photoFileIds.length === 0)
        throw new DomainException('production.evidence_missing', { params: { evidence: 'photo' } });
      const photoIds = await this.photos(tx, job, input.photoFileIds);
      const earlier = await tx.qcCheck.count({ where: { jobId: job.id } });
      const qc = await tx.qcCheck.create({
        data: {
          jobId: job.id,
          factoryId: job.factoryId,
          checklistVersion: input.checklistVersion,
          checklist: input.checklist as Prisma.InputJsonValue,
          result: input.result,
          isFirstPass: earlier === 0 && input.result === 'pass',
          defects: (input.defects ?? []),
          quantityChecked: input.quantityChecked ?? null,
          quantityDefective: input.quantityDefective ?? null,
          note: input.note ?? null,
          performedById: actor.type === 'user' ? actor.userId : null,
        },
      });
      await this.attach(tx, 'qc_check', qc.id, photoIds, 'qc.photo', false);
      await this.production.record(
        tx,
        job.id,
        'production_job.qc_recorded',
        { qcCheckId: qc.publicId, result: qc.result, isFirstPass: qc.isFirstPass },
        actor,
      );
      return qc;
    });
  }

  async qcChecks(actor: Actor, jobPublicId: string) {
    const job = await this.jobs.get(actor, jobPublicId);
    const checks = await this.prisma.qcCheck.findMany({
      where: { jobId: job.id },
      orderBy: { performedAt: 'asc' },
    });
    const photos = await this.prisma.attachment.findMany({
      where: { subjectType: 'qc_check', subjectId: { in: checks.map((c) => c.id) } },
      include: { fileObject: { select: { publicId: true } } },
    });
    return checks.map((c) => ({
      ...c,
      photoFileIds: photos.filter((p) => p.subjectId === c.id).map((p) => p.fileObject.publicId),
    }));
  }

  // --- issues --------------------------------------------------------------------------------------------

  async raiseIssue(
    actor: Actor,
    jobPublicId: string,
    input: { kind: string; description: string; photoFileIds?: string[] },
  ) {
    const scoped = await this.jobs.get(actor, jobPublicId);
    return this.prisma.withTx(async (tx) => {
      const job = await tx.productionJob.findUniqueOrThrow({ where: { id: scoped.id } });
      const photoIds = await this.photos(tx, job, input.photoFileIds ?? []);
      const issue = await tx.jobIssue.create({
        data: {
          jobId: job.id,
          factoryId: job.factoryId,
          kind: input.kind,
          description: input.description,
          raisedById: actor.type === 'user' ? actor.userId : null,
        },
      });
      await this.attach(tx, 'job_issue', issue.id, photoIds, 'issue.photo', false);
      await this.production.record(
        tx,
        job.id,
        'production_job.issue_raised',
        { issueId: issue.publicId, kind: issue.kind },
        actor,
      );
      return issue;
    });
  }

  async resolveIssue(actor: UserActor, issuePublicId: string, note: string) {
    return this.prisma.withTx(async (tx) => {
      const issue = await tx.jobIssue.findUnique({ where: { publicId: issuePublicId } });
      if (!issue) throw new DomainException('http.not_found');
      if (issue.status === 'resolved')
        throw new DomainException('production.invalid_status', { params: { status: 'resolved' } });
      const resolved = await tx.jobIssue.update({
        where: { id: issue.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedById: actor.userId,
          resolutionNote: note,
        },
      });
      await this.production.record(
        tx,
        issue.jobId,
        'production_job.issue_resolved',
        { issueId: issue.publicId },
        actor,
      );
      return resolved;
    });
  }

  async issues(actor: Actor, jobPublicId: string) {
    const job = await this.jobs.get(actor, jobPublicId);
    return this.prisma.jobIssue.findMany({ where: { jobId: job.id }, orderBy: { createdAt: 'asc' } });
  }

  // --- hold / resume (staff) --------------------------------------------------------------------------

  async hold(actor: UserActor, jobPublicId: string, reason: string) {
    return this.prisma.withTx(async (tx) => {
      const found = await tx.productionJob.findUnique({ where: { publicId: jobPublicId } });
      if (!found) throw new DomainException('http.not_found');
      const job = await this.production.lockJob(tx, found.id);
      if (!WORKING.includes(job.status))
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status: 'on_hold',
          statusChangedAt: new Date(),
          holdReason: reason,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.production.record(tx, job.id, 'production_job.held', { reason }, actor);
    });
  }

  async resume(actor: UserActor, jobPublicId: string) {
    return this.prisma.withTx(async (tx) => {
      const found = await tx.productionJob.findUnique({ where: { publicId: jobPublicId } });
      if (!found) throw new DomainException('http.not_found');
      const job = await this.production.lockJob(tx, found.id);
      if (job.status !== 'on_hold')
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      const status = job.actualStartAt ? 'in_progress' : 'accepted';
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status,
          statusChangedAt: new Date(),
          holdReason: null,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.production.record(tx, job.id, 'production_job.resumed', { status }, actor);
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------

  /** Evidence files must belong to the job's factory (uploaded through the partner surface) and be clean. */
  private async photos(tx: Tx, job: ProductionJob, publicIds: string[]): Promise<bigint[]> {
    if (publicIds.length === 0) return [];
    const files = await tx.fileObject.findMany({ where: { publicId: { in: publicIds } } });
    if (
      files.length !== publicIds.length ||
      files.some(
        (f) =>
          f.ownerFactoryId !== job.factoryId || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected',
      )
    )
      throw new DomainException('artwork.file_not_usable', { params: { fileId: publicIds.join(', ') } });
    return files.map((f) => f.id);
  }

  private async attach(
    tx: Tx,
    subject: 'job_milestone' | 'qc_check' | 'job_issue',
    subjectId: bigint,
    fileIds: bigint[],
    role: string,
    shareable: boolean,
  ) {
    const existing = await tx.attachment.count({ where: { subjectType: subject, subjectId } });
    for (const [i, fileObjectId] of fileIds.entries()) {
      await tx.attachment.upsert({
        where: {
          subjectType_subjectId_fileObjectId_role: { subjectType: subject, subjectId, fileObjectId, role },
        },
        create: {
          subjectType: subject,
          subjectId,
          fileObjectId,
          role,
          sort: existing + i,
          customerShareable: shareable,
        },
        update: { customerShareable: shareable },
      });
    }
  }
}
