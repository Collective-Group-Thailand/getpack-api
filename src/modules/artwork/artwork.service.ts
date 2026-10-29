import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { statusLabels } from '@common/labels/status-labels';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ArtworkSource,
  type ArtworkStatus,
  type Prisma,
  type UploadChannel,
} from '@generated/prisma/client';
import { OrdersService } from '@modules/orders/orders.service';
import { pricedConfiguration } from '@modules/quotes/quote-input';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import {
  type ArtworkRulesDto,
  MAX_ARTWORK_FILES,
  MAX_ARTWORK_LINKS,
  type PrepressQueueItemDto,
} from './artwork.dto';
import { SUBMISSION_INCLUDE, type SubmissionRow } from './artwork-views';
import { profileOf, rulesFor } from './preflight/rules';

/** Artwork may change until it is approved and production starts (D-073). */
const TAKES_ARTWORK: readonly string[] = ['waiting_payment', 'paid_for_production', 'artwork_approved'];

/** B-API-4b: the prepress review queue holds only paid orders (production gate D-073). */
const PAID_ORDER = { paidForProductionAt: { not: null } } satisfies Prisma.OrderWhereInput;

/**
 * B-API-6 (DECISIONS-STAGE-A §7): Prepress reviews paid orders only — accepting or rejecting a submission of an
 * unpaid order is refused (409 `artwork.order_unpaid`), even by direct id. The file check still runs before payment.
 */
export function assertPaidForReview(paidForProductionAt: Date | null): void {
  if (paidForProductionAt === null) throw new DomainException('artwork.order_unpaid');
}

function latest(a: Date, b: Date | null): Date {
  return b && b > a ? b : a;
}

export interface SubmitInput {
  files?: { fileId: string; role?: 'artwork' | 'font' | 'reference' }[];
  links?: string[];
  note?: string;
}

export interface SubmitOptions {
  /** The customer owning the order (store surface); staff pass none. */
  customerUserId?: bigint;
  channel: UploadChannel;
  source?: ArtworkSource;
  designDocumentVersionId?: bigint | null;
}

/**
 * Artwork submissions (D-070): each upload is a new version of the order's artwork; the worker preflights
 * it (ADR-0009); Prepress accepts it for a proof or rejects it with a reason. The order's artwork status
 * follows (`uploaded → in_review | changes_requested`, then proofs, B4.1). Customers read their own orders'
 * files; staff read with `artwork.read` / `files.read`.
 */
@Injectable()
export class ArtworkService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
  ) {}

  onModuleInit(): void {
    // The customer of an order reads the files its artwork, proofs and templates reference (§2.8).
    this.files.registerFileReader('artwork', async (actor, file) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const customerUserId = actor.userId;
      const [submitted, proofs, templates] = await Promise.all([
        this.prisma.artworkSubmissionFile.count({
          where: { fileObjectId: file.id, submission: { order: { customerUserId } } },
        }),
        this.prisma.proof.count({
          where: {
            order: { customerUserId },
            OR: [{ proofFileId: file.id }, { dielineFileId: file.id }, { approvedFileId: file.id }],
          },
        }),
        this.prisma.dielineDelivery.count({
          where: {
            order: { customerUserId },
            OR: [{ fileObjectId: file.id }, { drawingJob: { outputFileId: file.id } }],
          },
        }),
      ]);
      return submitted + proofs + templates > 0;
    });
  }

  // --- reads ----------------------------------------------------------------------------------------

  /** The rules of the upload page for one of my orders (U-B0.1): file limits, D-070 checks, checklist, dieline. */
  async rules(orderPublicId: string, customerUserId: bigint): Promise<ArtworkRulesDto> {
    const order = await this.orders.order({ publicId: orderPublicId }, customerUserId);
    const now = new Date();
    // C12 (D-460): the order's print profile (corrugated board has its own thresholds).
    const productType = await this.prisma.productType.findUnique({
      where: { id: order.productTypeId },
      select: { calculatorKey: true },
    });
    const rules = rulesFor(
      (await this.settings.at('artwork.preflight_rules', { at: now })).value,
      profileOf({ calculatorKey: productType?.calculatorKey ?? null }),
    );
    let checklist: ArtworkRulesDto['approvalChecklist'] = [];
    try {
      checklist = (await this.settings.at('artwork.approval_checklist', { at: now })).value ?? [];
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    // The size priced — inside dimensions for a box (D-182), what the dieline is drawn from.
    const cfg = pricedConfiguration(order.quote.input) as {
      patternId?: string;
      w?: number;
      l?: number;
      d?: number;
    } | null;
    const pattern = cfg?.patternId
      ? await this.prisma.pattern.findUnique({
          where: { publicId: cfg.patternId },
          select: { code: true, styleCode: true, dielineKey: true },
        })
      : null;
    const purpose = FILE_PURPOSES.artwork;
    return {
      purpose: 'artwork',
      accept: [...purpose.mimeTypes],
      maxBytes: purpose.maxBytes,
      maxFiles: MAX_ARTWORK_FILES,
      maxLinks: MAX_ARTWORK_LINKS,
      bleedMm: rules.bleedMm,
      safeZoneMm: rules.safeZoneMm,
      minEffectivePpi: rules.minEffectivePpi,
      colourMode: 'cmyk',
      checks: Object.entries(rules.severities).map(([check, severity]) => ({ check, severity })),
      approvalChecklist: checklist,
      dieline:
        pattern && cfg
          ? {
              patternCode: pattern.code,
              styleCode: pattern.styleCode,
              dielineKey: pattern.dielineKey,
              widthMm: Number(cfg.w),
              lengthMm: Number(cfg.l),
              depthMm: Number(cfg.d),
            }
          : null,
    };
  }

  async list(orderPublicId: string, customerUserId?: bigint): Promise<SubmissionRow[]> {
    const order = await this.orders.order({ publicId: orderPublicId }, customerUserId);
    return this.prisma.artworkSubmission.findMany({
      where: { orderId: order.id },
      include: SUBMISSION_INCLUDE,
      orderBy: { versionNo: 'desc' },
    });
  }

  async get(
    publicId: string,
    opts: { customerUserId?: bigint; orderPublicId?: string } = {},
  ): Promise<SubmissionRow> {
    const row = await this.prisma.artworkSubmission.findUnique({
      where: { publicId },
      include: SUBMISSION_INCLUDE,
    });
    if (
      !row ||
      (opts.customerUserId !== undefined && row.order.customerUserId !== opts.customerUserId) ||
      (opts.orderPublicId !== undefined && row.order.publicId !== opts.orderPublicId)
    )
      throw new DomainException('http.not_found');
    return row;
  }

  // --- submit ---------------------------------------------------------------------------------------

  async submit(
    actor: Actor,
    orderPublicId: string,
    input: SubmitInput,
    opts: SubmitOptions,
  ): Promise<SubmissionRow> {
    const id = await this.prisma.withTx((tx) => this.submitIn(tx, actor, orderPublicId, input, opts));
    return this.prisma.artworkSubmission.findUniqueOrThrow({ where: { id }, include: SUBMISSION_INCLUDE });
  }

  /** `submit` in the caller's transaction (a designer's delivery, B4.1); returns the submission id. */
  async submitIn(
    tx: Tx,
    actor: Actor,
    orderPublicId: string,
    input: SubmitInput,
    opts: SubmitOptions,
  ): Promise<bigint> {
    const order = await this.orders.order({ publicId: orderPublicId }, opts.customerUserId, tx);
    const files = input.files ?? [];
    const links = input.links ?? [];
    // An online design (source `designer`) is its own artwork; otherwise a file or a link is needed.
    if (
      !opts.designDocumentVersionId &&
      !files.some((f) => (f.role ?? 'artwork') === 'artwork') &&
      links.length === 0
    )
      throw new DomainException('validation.failed', {
        errors: [{ path: 'files', code: 'required', message: 'at least one artwork file or link' }],
      });
    const objects = await tx.fileObject.findMany({
      where: { publicId: { in: files.map((f) => f.fileId) } },
    });
    for (const f of files) {
      const object = objects.find((o) => o.publicId === f.fileId);
      const owned =
        object !== undefined &&
        (object.ownerUserId === order.customerUserId ||
          (actor.type === 'user' && object.createdById === actor.userId));
      if (!object || !owned || object.uploadStatus !== 'uploaded' || object.scanStatus === 'infected')
        throw new DomainException('artwork.file_not_usable', { params: { fileId: f.fileId } });
    }

    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    this.assertTakesArtwork(current.status, current.artworkStatus);
    const last = await tx.artworkSubmission.findFirst({
      where: { orderId: order.id },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const versionNo = (last?.versionNo ?? 0) + 1;
    const at = new Date();
    // A newer version replaces what was waiting, and a proof the customer has not answered yet.
    await tx.artworkSubmission.updateMany({
      where: { orderId: order.id, status: { in: ['submitted', 'accepted_for_proof'] } },
      data: { status: 'superseded', rowVersion: { increment: 1 } },
    });
    await tx.proof.updateMany({
      where: { orderId: order.id, status: 'pending_customer' },
      data: { status: 'superseded', decidedAt: at, rowVersion: { increment: 1 } },
    });
    const submission = await tx.artworkSubmission.create({
      data: {
        orderId: order.id,
        versionNo,
        source: opts.source ?? 'upload',
        channel: opts.channel,
        designDocumentVersionId: opts.designDocumentVersionId ?? null,
        note: input.note ?? null,
        submittedById: actor.type === 'user' ? actor.userId : current.customerUserId,
        submittedAt: at,
      },
    });
    let sort = 0;
    for (const f of files) {
      await tx.artworkSubmissionFile.create({
        data: {
          submissionId: submission.id,
          fileObjectId: objects.find((o) => o.publicId === f.fileId)!.id,
          role: f.role ?? 'artwork',
          sort: sort++,
        },
      });
    }
    for (const url of links) {
      await tx.artworkSubmissionFile.create({
        data: { submissionId: submission.id, linkUrl: url, role: 'link', sort: sort++ },
      });
    }
    await this.setArtworkStatus(tx, current.id, 'uploaded', actor);
    // B-API-4b: before payment the file is received (and preflighted) but Prepress is told only after payment
    // (`artwork.prepress_after_payment`), so no `artwork.submitted` reaches its notification route yet.
    await this.record(
      tx,
      current.publicId,
      current.paidForProductionAt ? 'artwork.submitted' : 'artwork.submitted_before_payment',
      {
        submissionId: submission.publicId,
        versionNo,
        source: submission.source,
        channel: submission.channel,
        files: files.length + links.length,
      },
      actor,
      await this.customerPublicId(tx, current.customerUserId),
    );
    return submission.id;
  }

  /**
   * B-API-4b: when an order is paid, the file it received before payment reaches Prepress — its submission is
   * already in the queue (paid orders only) and `artwork.submitted` (internal) routes Prepress's notification.
   */
  @OnDomainEvent('order.fact_recorded', { consumer: 'artwork.prepress_after_payment' })
  async onPaid(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'paid_for_production') return;
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true, publicId: true, customerUserId: true, cancelledAt: true },
    });
    if (!order || order.cancelledAt) return;
    const pending = await tx.artworkSubmission.findFirst({
      where: { orderId: order.id, status: 'submitted' },
      orderBy: { versionNo: 'desc' },
      include: { _count: { select: { files: true } } },
    });
    if (!pending) return;
    await this.record(
      tx,
      order.publicId,
      'artwork.submitted',
      {
        submissionId: pending.publicId,
        versionNo: pending.versionNo,
        source: pending.source,
        channel: pending.channel,
        files: pending._count.files,
        afterPayment: true,
      },
      systemActor('artwork.prepress_after_payment'),
      await this.customerPublicId(tx, order.customerUserId),
      ['internal'],
    );
  }

  // --- prepress review -------------------------------------------------------------------------------

  /** The Prepress owner of an order's artwork (U-B0.2): an active staff member, or null to unassign (activity + event). */
  async assignPrepress(
    actor: UserActor,
    orderPublicId: string,
    assigneePublicId: string | null,
  ): Promise<void> {
    const assignee = assigneePublicId
      ? await this.prisma.user.findFirst({
          where: { publicId: assigneePublicId, kind: 'staff', status: 'active' },
        })
      : null;
    if (assigneePublicId && !assignee)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'assigneeId', code: 'exists', message: 'not an active staff user' }],
      });
    await this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({ where: { publicId: orderPublicId } });
      if (!order) throw new DomainException('http.not_found');
      await tx.order.update({
        where: { id: order.id },
        data: { prepressAssigneeId: assignee?.id ?? null, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        order.publicId,
        'artwork.prepress_assigned',
        { assigneeId: assignee?.publicId ?? null },
        actor,
        null,
        ['internal'],
      );
    });
  }

  async accept(actor: UserActor, publicId: string, note?: string): Promise<SubmissionRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await this.lockSubmission(tx, publicId);
      if (row.status !== 'submitted')
        throw new DomainException('artwork.invalid_status', { params: { status: row.status } });
      if (row.preflightStatus === 'pending' || row.preflightStatus === 'running')
        throw new DomainException('artwork.preflight_pending');
      if (row.preflightStatus === 'blocked') throw new DomainException('artwork.preflight_blocked');
      const order = await tx.order.findUniqueOrThrow({ where: { id: row.orderId } });
      this.assertTakesArtwork(order.status, order.artworkStatus);
      assertPaidForReview(order.paidForProductionAt);
      await tx.artworkSubmission.update({
        where: { id: row.id },
        data: {
          status: 'accepted_for_proof',
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.setArtworkStatus(tx, order.id, 'in_review', actor);
      await this.record(
        tx,
        order.publicId,
        'artwork.accepted_for_proof',
        {
          submissionId: row.publicId,
          versionNo: row.versionNo,
          preflightStatus: row.preflightStatus,
        },
        actor,
        await this.customerPublicId(tx, order.customerUserId),
      );
      if (note?.trim())
        await this.record(
          tx,
          order.publicId,
          'artwork.review_note',
          { submissionId: row.publicId, note: note.trim() },
          actor,
          null,
          ['internal'],
        );
      return tx.artworkSubmission.findUniqueOrThrow({ where: { id: row.id }, include: SUBMISSION_INCLUDE });
    });
  }

  async reject(actor: UserActor, publicId: string, reason: string): Promise<SubmissionRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await this.lockSubmission(tx, publicId);
      if (row.status !== 'submitted' && row.status !== 'accepted_for_proof')
        throw new DomainException('artwork.invalid_status', { params: { status: row.status } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: row.orderId } });
      this.assertTakesArtwork(order.status, order.artworkStatus);
      assertPaidForReview(order.paidForProductionAt);
      await tx.artworkSubmission.update({
        where: { id: row.id },
        data: {
          status: 'rejected',
          rejectReason: reason,
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.setArtworkStatus(tx, order.id, 'changes_requested', actor);
      await this.record(
        tx,
        order.publicId,
        'artwork.rejected',
        {
          submissionId: row.publicId,
          versionNo: row.versionNo,
          reason,
        },
        actor,
        await this.customerPublicId(tx, order.customerUserId),
      );
      return tx.artworkSubmission.findUniqueOrThrow({ where: { id: row.id }, include: SUBMISSION_INCLUDE });
    });
  }

  /** Runs preflight again (after an error, or once the rules or the dieline changed). */
  async rerunPreflight(actor: UserActor, publicId: string): Promise<SubmissionRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await this.lockSubmission(tx, publicId);
      if (row.status !== 'submitted')
        throw new DomainException('artwork.invalid_status', { params: { status: row.status } });
      if (row.preflightStatus === 'pending' || row.preflightStatus === 'running')
        throw new DomainException('artwork.preflight_pending');
      await tx.artworkSubmission.update({
        where: { id: row.id },
        data: {
          preflightStatus: 'pending',
          preflightAttempts: 0,
          preflightLockedUntil: null,
          preflightCompletedAt: null,
          rowVersion: { increment: 1 },
        },
      });
      const order = await tx.order.findUniqueOrThrow({ where: { id: row.orderId } });
      await this.record(
        tx,
        order.publicId,
        'artwork.preflight_requeued',
        { submissionId: row.publicId },
        actor,
        null,
        ['internal'],
      );
      return tx.artworkSubmission.findUniqueOrThrow({ where: { id: row.id }, include: SUBMISSION_INCLUDE });
    });
  }

  // --- prepress queue ---------------------------------------------------------------------------------

  async queue(
    kind: 'submissions' | 'proofs_waiting' | 'changes_requested',
    page: number,
    perPage: number,
    now = new Date(),
    filters: { assigneeId?: string; productTypeCode?: string; artworkStatus?: ArtworkStatus } = {},
  ): Promise<{ data: PrepressQueueItemDto[]; total: number }> {
    const skip = (page - 1) * perPage;
    const liveOrder: Prisma.OrderWhereInput = {
      status: { not: 'cancelled' as const },
      ...(filters.assigneeId === 'none' && { prepressAssigneeId: null }),
      ...(filters.assigneeId &&
        filters.assigneeId !== 'none' && { prepressAssignee: { publicId: filters.assigneeId } }),
      ...(filters.productTypeCode && { productType: { code: filters.productTypeCode } }),
      ...(filters.artworkStatus && { artworkStatus: filters.artworkStatus }),
    };
    const orderRef = {
      select: {
        publicId: true,
        orderCode: true,
        artworkStatus: true,
        paidForProductionAt: true,
        productType: { select: { code: true } },
        orderGroup: { select: { customer: { select: { publicId: true, displayName: true } } } },
        prepressAssignee: { select: { publicId: true, displayName: true } },
      },
    } as const;
    type OrderRef = Prisma.OrderGetPayload<typeof orderRef>;
    let items: {
      order: OrderRef;
      orderId: string;
      orderCode: string;
      itemId: string;
      versionNo: number;
      preflight: string | null;
      since: Date;
    }[];
    let total: number;
    if (kind === 'submissions') {
      // B-API-4b: a file uploaded before payment is preflighted at once but reaches Prepress only once paid.
      const where: Prisma.ArtworkSubmissionWhereInput = {
        status: 'submitted',
        preflightStatus: { notIn: ['pending', 'running'] },
        order: { ...liveOrder, ...PAID_ORDER },
      };
      const [rows, count] = await Promise.all([
        this.prisma.artworkSubmission.findMany({
          where,
          include: { order: orderRef },
          orderBy: { submittedAt: 'asc' },
          skip,
          take: perPage,
        }),
        this.prisma.artworkSubmission.count({ where }),
      ]);
      items = rows.map((r) => ({
        order: r.order,
        orderId: r.order.publicId,
        orderCode: r.order.orderCode,
        itemId: r.publicId,
        versionNo: r.versionNo,
        preflight: r.preflightStatus,
        // Waiting for Prepress since the later of the check and the payment (B-API-4b).
        since: latest(r.preflightCompletedAt ?? r.submittedAt, r.order.paidForProductionAt),
      }));
      total = count;
    } else {
      const where: Prisma.ProofWhereInput = {
        status: kind === 'proofs_waiting' ? 'pending_customer' : 'changes_requested',
        // B-API-6: like the submissions queue, "changes requested" lists paid orders only.
        order: {
          ...liveOrder,
          ...(kind === 'changes_requested' && { artworkStatus: 'changes_requested', ...PAID_ORDER }),
        },
        ...(kind === 'changes_requested' && { nextProofs: { none: {} } }),
      };
      const [rows, count] = await Promise.all([
        this.prisma.proof.findMany({
          where,
          include: { order: orderRef },
          orderBy: kind === 'proofs_waiting' ? { sentAt: 'asc' } : { decidedAt: 'asc' },
          skip,
          take: perPage,
        }),
        this.prisma.proof.count({ where }),
      ]);
      items = rows.map((r) => ({
        order: r.order,
        orderId: r.order.publicId,
        orderCode: r.order.orderCode,
        itemId: r.publicId,
        versionNo: r.versionNo,
        preflight: null,
        since: kind === 'proofs_waiting' ? r.sentAt : (r.decidedAt ?? r.sentAt),
      }));
      total = count;
    }
    // The prepress SLA applies to work waiting for Prepress, not to proofs waiting for the customer.
    const sla = kind === 'proofs_waiting' ? null : await this.prepressSla(now);
    const data = await Promise.all(
      items.map(async (i) => {
        const dueAt = sla ? await sla(i.since) : null;
        return {
          orderId: i.orderId,
          orderCode: i.orderCode,
          kind,
          itemId: i.itemId,
          versionNo: i.versionNo,
          preflightStatus: i.preflight,
          ...statusLabels('PreflightStatus', i.preflight, 'preflightStatus'),
          since: toBangkokIso(i.since),
          dueAt: dueAt ? toBangkokIso(dueAt) : null,
          overdue: dueAt !== null && dueAt < now,
          customer: {
            id: i.order.orderGroup.customer.publicId,
            displayName: i.order.orderGroup.customer.displayName,
          },
          productTypeCode: i.order.productType.code,
          artworkStatus: i.order.artworkStatus,
          ...statusLabels('ArtworkStatus', i.order.artworkStatus, 'artworkStatus'),
          assignee: i.order.prepressAssignee
            ? { id: i.order.prepressAssignee.publicId, displayName: i.order.prepressAssignee.displayName }
            : null,
        };
      }),
    );
    return { data, total };
  }

  /** Due time of prepress work from `artwork.prepress_sla_business_hours` (no value → no due time). */
  private async prepressSla(at: Date): Promise<((since: Date) => Promise<Date>) | null> {
    let hours: number;
    try {
      hours = (await this.settings.at('artwork.prepress_sla_business_hours', { at })).value;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
    const window = (await this.settings.at('calendar.business_hours', { at })).value;
    const calendar = await this.calendars.calendar();
    return (since) => Promise.resolve(calendar.addBusinessMinutes(since, hours * 60, window));
  }

  // --- helpers ----------------------------------------------------------------------------------------

  assertTakesArtwork(status: string, artworkStatus: ArtworkStatus): void {
    if (!TAKES_ARTWORK.includes(status) || artworkStatus === 'approved')
      throw new DomainException('artwork.not_accepting', {
        params: { status: artworkStatus === 'approved' ? 'approved' : status },
      });
  }

  private async lockSubmission(tx: Tx, publicId: string) {
    const row = await tx.artworkSubmission.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM artwork_submissions WHERE id = ${row.id} FOR UPDATE`;
    return tx.artworkSubmission.findUniqueOrThrow({ where: { id: row.id } });
  }

  async setArtworkStatus(tx: Tx, orderId: bigint, status: ArtworkStatus, actor: Actor): Promise<void> {
    await tx.order.update({
      where: { id: orderId },
      data: {
        artworkStatus: status,
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
  }

  async customerPublicId(tx: Tx, userId: bigint): Promise<string> {
    return (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } })).publicId;
  }

  /**
   * Event + activity on the order (its timeline, B4.4). `customerId` in the payload lets the notification
   * matrix reach the customer (D-143).
   */
  async record(
    tx: Tx,
    orderPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
    customerId: string | null,
    visibility: ('internal' | 'customer' | 'partner')[] = ['internal', 'customer'],
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'order',
        aggregateId: orderPublicId,
        payload: { orderId: orderPublicId, ...(customerId && { customerId }), ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: orderPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility,
      domainEventId: event.id,
      actor,
    });
  }
}
