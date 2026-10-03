import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DesignServiceStatus, type Prisma } from '@generated/prisma/client';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { OrdersService } from '@modules/orders/orders.service';
import { OrderChargesService } from '@modules/payment-schedules/order-charges.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type DesignServiceDto, type NextRevisionDto } from './design-services.dto';

const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
const HIRED: readonly string[] = ['hired_design', 'free_design'];
const CLOSED: readonly DesignServiceStatus[] = ['approved', 'cancelled', 'requoted'];

export const REQUEST_INCLUDE = {
  order: {
    select: { id: true, publicId: true, orderCode: true, customerUserId: true, paidForProductionAt: true },
  },
  assignedUser: { select: { publicId: true, displayName: true } },
  rounds: {
    include: { submission: { select: { publicId: true } }, instalment: { select: { publicId: true } } },
    orderBy: { roundNo: 'asc' },
  },
} satisfies Prisma.DesignServiceRequestInclude;
export type RequestRow = Prisma.DesignServiceRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

interface Brief {
  schemaVersion: 1;
  brandName: string;
  brandCategory: string;
  description: string;
  attachmentFileIds: string[];
}

interface PolicyRefs {
  settingVersionIds: Record<string, string>;
}

/**
 * Hired design (D-071): a request opens with every hired-design order (free rounds and the design fee
 * snapshotted with the setting versions used); work starts once the brief is in **and** the order is paid
 * for production — target 5 / maximum 10 business days from then. The designer's delivery is an artwork
 * submission (source `design_service`) that goes through preflight and a proof like any other; the proof
 * decision closes the round: approved → the design is approved; changes → the next revision, free for the
 * first `free_rounds` revisions, then a chargeable add-on of max(minimum, % × design fee) the customer
 * confirms and pays before it starts (an order line + fixed instalment, ADR-0008 item 6). A change to the
 * structure or the concept is re-quoted, not revised.
 */
@Injectable()
export class DesignServicesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly artwork: ArtworkService,
    private readonly charges: OrderChargesService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    // Brief attachments are read by the order's customer (and staff with files.read).
    this.files.registerAttachmentPolicy('design_service_request', async (actor, subjectId) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const request = await this.prisma.designServiceRequest.findUnique({
        where: { id: subjectId },
        include: { order: true },
      });
      return request?.order.customerUserId === actor.userId;
    });
  }

  // --- opening and starting --------------------------------------------------------------------------

  @OnDomainEvent('order.placed', { consumer: 'design_services.open' })
  async onPlaced(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      include: { lines: true },
    });
    if (!order || !HIRED.includes(order.designOption)) return;
    if (await tx.designServiceRequest.findUnique({ where: { orderId: order.id } })) return;
    const at = order.createdAt;
    const free = await this.settings.at('design.free_revision_rounds', { at, tx });
    const sla = await this.settings.at('design.hired_design_sla', { at, tx });
    const extra = await this.settings.at('design.extra_revision_fee', { at, tx });
    const fee = order.lines
      .filter((l) => l.lineType === 'design_fee')
      .reduce(
        (sum, l) => sum.add(l.netAmount.toString()).sub(l.discountAmount.toString()),
        new MoneyDecimal(0),
      );
    // D-286: a studio hand-off — the service works on that design; its brief starts from it.
    const design = order.designDocumentId
      ? await tx.designDocument.findUnique({ where: { id: order.designDocumentId }, select: { title: true } })
      : null;
    const request = await tx.designServiceRequest.create({
      data: {
        orderId: order.id,
        designDocumentId: order.designDocumentId,
        ...(design && {
          brief: {
            schemaVersion: 1,
            brandName: '',
            brandCategory: '',
            description: `Studio design "${design.title}" (handed over from the studio)`,
            attachmentFileIds: [],
          },
        }),
        freeRounds: free.value,
        designFeeNet: formatMoney(fee),
        policyRefs: {
          settingVersionIds: {
            'design.free_revision_rounds': String(free.versionId),
            'design.hired_design_sla': String(sla.versionId),
            'design.extra_revision_fee': String(extra.versionId),
          },
        },
      },
    });
    await this.record(
      tx,
      order.publicId,
      'design_service.opened',
      { designServiceId: request.publicId },
      systemActor('design_services.open'),
      order.customerUserId,
    );
  }

  @OnDomainEvent('order.fact_recorded', { consumer: 'design_services.paid' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'paid_for_production') return;
    const request = await tx.designServiceRequest.findFirst({
      where: { order: { publicId: event.aggregateId } },
    });
    if (request) await this.tryStart(tx, request.id, systemActor('design_services.paid'));
  }

  async submitBrief(
    actor: UserActor,
    orderPublicId: string,
    brief: Omit<Brief, 'schemaVersion'>,
  ): Promise<RequestRow> {
    return this.prisma.withTx(async (tx) => {
      const request = await this.forOrder(tx, orderPublicId, actor.userId);
      if (request.status !== 'brief_pending')
        throw new DomainException('design_services.invalid_status', { params: { status: request.status } });
      const fileIds = brief.attachmentFileIds ?? [];
      const files = await tx.fileObject.findMany({ where: { publicId: { in: fileIds } } });
      if (
        files.length !== fileIds.length ||
        files.some(
          (f) =>
            f.ownerUserId !== actor.userId || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected',
        )
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId: fileIds.join(', ') } });
      await tx.attachment.deleteMany({
        where: { subjectType: 'design_service_request', subjectId: request.id },
      });
      for (const [sort, f] of files.entries()) {
        await tx.attachment.create({
          data: {
            fileObjectId: f.id,
            subjectType: 'design_service_request',
            subjectId: request.id,
            role: 'design.brief',
            sort,
          },
        });
      }
      const stored: Brief = { schemaVersion: 1, ...brief, attachmentFileIds: fileIds };
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: {
          brief: stored as unknown as Prisma.InputJsonValue,
          briefSubmittedAt: new Date(),
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        request.order.publicId,
        'design_service.brief_submitted',
        { designServiceId: request.publicId },
        actor,
        request.order.customerUserId,
      );
      await this.tryStart(tx, request.id, actor);
      return this.load(tx, request.id);
    });
  }

  /** Starts the initial round once the brief is in and the order is paid for production (D-071). */
  private async tryStart(tx: Tx, requestId: bigint, actor: Actor): Promise<void> {
    const request = await tx.designServiceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { order: true },
    });
    if (request.status !== 'brief_pending' || !request.briefSubmittedAt || !request.order.paidForProductionAt)
      return;
    const at = new Date();
    const sla = (await this.policyValue(tx, request.policyRefs, 'design.hired_design_sla')) as {
      targetBusinessDays: number;
      maxBusinessDays: number;
    };
    const calendar = await this.calendars.calendar();
    await tx.designRound.create({
      data: { requestId, roundNo: 1, kind: 'initial', status: 'in_progress', requestedAt: at, startedAt: at },
    });
    await tx.designServiceRequest.update({
      where: { id: requestId },
      data: {
        status: 'in_progress',
        targetDueAt: calendar.addWorkingDays(at, sla.targetBusinessDays),
        maxDueAt: calendar.addWorkingDays(at, sla.maxBusinessDays),
        rowVersion: { increment: 1 },
      },
    });
    await this.record(
      tx,
      request.order.publicId,
      'design_service.started',
      { designServiceId: request.publicId, roundNo: 1 },
      actor,
      request.order.customerUserId,
    );
  }

  // --- staff -------------------------------------------------------------------------------------------

  async assign(
    actor: UserActor,
    publicId: string,
    input: { assigneeUserId?: string; vendorId?: string },
  ): Promise<RequestRow> {
    return this.prisma.withTx(async (tx) => {
      const request = await this.byPublicId(tx, publicId);
      if (CLOSED.includes(request.status))
        throw new DomainException('design_services.invalid_status', { params: { status: request.status } });
      const user = input.assigneeUserId
        ? await tx.user.findFirst({
            where: { publicId: input.assigneeUserId, kind: 'staff', status: 'active' },
          })
        : null;
      const vendor = input.vendorId
        ? await tx.vendor.findFirst({ where: { publicId: input.vendorId, kind: 'freelancer' } })
        : null;
      if ((input.assigneeUserId && !user) || (input.vendorId && !vendor) || (!user && !vendor))
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'assigneeUserId',
              code: 'invalid',
              message: 'an active staff member or a freelancer vendor',
            },
          ],
        });
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: {
          assignedUserId: user?.id ?? null,
          assignedVendorId: vendor?.id ?? null,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        request.order.publicId,
        'design_service.assigned',
        { designServiceId: request.publicId, assigneeId: user?.publicId ?? null },
        actor,
        null,
        ['internal'],
      );
      return this.load(tx, request.id);
    });
  }

  /** The designer's delivery becomes an artwork version (source `design_service`), then preflight and proof. */
  async deliver(
    actor: UserActor,
    publicId: string,
    input: { fileIds: string[]; note?: string },
  ): Promise<RequestRow> {
    return this.prisma.withTx(async (tx) => {
      const request = await this.byPublicId(tx, publicId);
      const round = request.rounds.at(-1);
      if (
        !round ||
        !['in_progress', 'delivered'].includes(round.status) ||
        !['in_progress', 'delivered'].includes(request.status)
      )
        throw new DomainException('design_services.invalid_status', {
          params: { status: round?.status ?? request.status },
        });
      const submissionId = await this.artwork.submitIn(
        tx,
        actor,
        request.order.publicId,
        { files: input.fileIds.map((fileId) => ({ fileId, role: 'artwork' as const })), note: input.note },
        { channel: 'cs', source: 'design_service' },
      );
      await tx.designRound.update({
        where: { id: round.id },
        data: { status: 'delivered', submissionId, deliveredAt: new Date(), rowVersion: { increment: 1 } },
      });
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: { status: 'delivered', updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        request.order.publicId,
        'design_service.delivered',
        { designServiceId: request.publicId, roundNo: round.roundNo },
        actor,
        request.order.customerUserId,
      );
      return this.load(tx, request.id);
    });
  }

  async close(
    actor: UserActor,
    publicId: string,
    status: 'requoted' | 'cancelled',
    reason: string,
  ): Promise<RequestRow> {
    return this.prisma.withTx(async (tx) => {
      const request = await this.byPublicId(tx, publicId);
      if (CLOSED.includes(request.status))
        throw new DomainException('design_services.invalid_status', { params: { status: request.status } });
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: { status, cancelReason: reason, updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        request.order.publicId,
        `design_service.${status}`,
        { designServiceId: request.publicId, reason },
        actor,
        request.order.customerUserId,
      );
      return this.load(tx, request.id);
    });
  }

  // --- proof outcomes and revisions ----------------------------------------------------------------------

  @OnDomainEvent(['proof.approved', 'proof.changes_requested'], { consumer: 'design_services.proofs' })
  async onProofDecision(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const request = await tx.designServiceRequest.findFirst({
      where: { order: { publicId: event.aggregateId } },
      include: { rounds: { orderBy: { roundNo: 'desc' }, take: 1 }, order: true },
    });
    const round = request?.rounds[0];
    if (!request || !round || request.status !== 'delivered' || round.status !== 'delivered') return;
    const actor = systemActor('design_services.proofs');
    const at = new Date(event.occurredAt);
    if (event.type === 'proof.approved') {
      await tx.designRound.update({
        where: { id: round.id },
        data: { status: 'approved', decidedAt: at, rowVersion: { increment: 1 } },
      });
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: { status: 'approved', rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        request.order.publicId,
        'design_service.approved',
        { designServiceId: request.publicId, roundNo: round.roundNo },
        actor,
        request.order.customerUserId,
      );
      return;
    }
    const proof = await tx.proof.findUnique({ where: { publicId: String(event.payload['proofId']) } });
    await tx.designRound.update({
      where: { id: round.id },
      data: {
        status: 'changes_requested',
        decidedAt: at,
        changeRequest: proof?.decisionComment ?? null,
        rowVersion: { increment: 1 },
      },
    });
    const revisionNo = round.roundNo; // the next round's revision number (round 1 is the initial design)
    if (revisionNo <= request.freeRounds) {
      await tx.designRound.create({
        data: {
          requestId: request.id,
          roundNo: round.roundNo + 1,
          kind: 'revision',
          status: 'in_progress',
          changeRequest: proof?.decisionComment ?? null,
          requestedAt: at,
          startedAt: at,
        },
      });
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: { status: 'in_progress', rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        request.order.publicId,
        'design_service.revision_started',
        { designServiceId: request.publicId, roundNo: round.roundNo + 1, revisionNo, chargeable: false },
        actor,
        request.order.customerUserId,
      );
    } else {
      await tx.designServiceRequest.update({
        where: { id: request.id },
        data: { status: 'revision_requested', rowVersion: { increment: 1 } },
      });
      const fee = await this.extraFee(
        tx,
        request.orderId,
        request.policyRefs,
        request.designFeeNet.toString(),
      );
      await this.record(
        tx,
        request.order.publicId,
        'design_service.extra_round_offered',
        { designServiceId: request.publicId, revisionNo, feeGross: fee.gross },
        actor,
        request.order.customerUserId,
      );
    }
  }

  /** The customer agrees to (and is charged for) a revision beyond the free ones (D-071). */
  async confirmExtraRound(
    actor: UserActor,
    orderPublicId: string,
    input: { expectedFeeGross: string; changeRequest: string; referenceFileIds?: string[] },
  ): Promise<RequestRow> {
    return this.prisma.withTx(async (tx) => {
      const request = await this.forOrder(tx, orderPublicId, actor.userId);
      const fileIds = [...new Set(input.referenceFileIds ?? [])];
      const files = await tx.fileObject.findMany({ where: { publicId: { in: fileIds } } });
      if (
        files.length !== fileIds.length ||
        files.some(
          (f) =>
            f.ownerUserId !== actor.userId || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected',
        )
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId: fileIds.join(', ') } });
      const last = request.rounds.at(-1);
      if (request.status !== 'revision_requested' || !last || last.roundNo <= request.freeRounds)
        throw new DomainException('design_services.no_extra_round');
      const fee = await this.extraFee(
        tx,
        request.order.id,
        request.policyRefs,
        request.designFeeNet.toString(),
      );
      if (fee.gross !== input.expectedFeeGross)
        throw new DomainException('design_services.fee_changed', { params: { fee: fee.gross } });
      const roundNo = last.roundNo + 1;
      const revisionNo = roundNo - 1;
      const charge = await this.charges.addCharge(
        tx,
        request.order.id,
        {
          lineType: 'extra_revision',
          descriptionTh: `ค่าแก้ไขแบบครั้งที่ ${revisionNo}`,
          descriptionEn: `Design revision ${revisionNo}`,
          unit: 'round',
          netAmount: fee.net,
          whtCategory: 'service',
          revenueCategory: 'design_service',
          reason: `D-071 revision ${revisionNo} beyond ${request.freeRounds} free rounds`,
          instalmentLabelTh: `ค่าแก้ไขแบบครั้งที่ ${revisionNo}`,
          instalmentLabelEn: `Design revision ${revisionNo}`,
        },
        actor,
      );
      await tx.designRound.create({
        data: {
          requestId: request.id,
          roundNo,
          kind: 'revision',
          chargeable: true,
          feeAmount: fee.net,
          orderLineId: charge.orderLineId,
          instalmentId: charge.instalmentId,
          status: 'awaiting_payment',
          changeRequest: input.changeRequest,
          referenceFileIds: fileIds,
        },
      });
      // The designer opens them through the request's attachment policy (U-B0.1).
      for (const [sort, f] of files.entries()) {
        await tx.attachment.create({
          data: {
            fileObjectId: f.id,
            subjectType: 'design_service_request',
            subjectId: request.id,
            role: `design.revision_${roundNo}`,
            sort,
          },
        });
      }
      await this.record(
        tx,
        request.order.publicId,
        'design_service.extra_round_confirmed',
        {
          designServiceId: request.publicId,
          roundNo,
          revisionNo,
          feeGross: charge.gross,
          instalmentId: charge.instalmentPublicId,
        },
        actor,
        request.order.customerUserId,
      );
      return this.load(tx, request.id);
    });
  }

  /** A paid extra round starts (the instalment of its add-on charge). */
  @OnDomainEvent('instalment.paid', { consumer: 'design_services.charges' })
  async onInstalmentPaid(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const instalmentId = event.payload['instalmentId'];
    if (typeof instalmentId !== 'string' || event.payload['fixedAmount'] !== true) return;
    const round = await tx.designRound.findFirst({
      where: { instalment: { publicId: instalmentId }, status: 'awaiting_payment' },
      include: { request: { include: { order: true } } },
    });
    if (!round) return;
    const at = new Date();
    await tx.designRound.update({
      where: { id: round.id },
      data: { status: 'in_progress', startedAt: at, rowVersion: { increment: 1 } },
    });
    await tx.designServiceRequest.update({
      where: { id: round.requestId },
      data: { status: 'in_progress', rowVersion: { increment: 1 } },
    });
    await this.record(
      tx,
      round.request.order.publicId,
      'design_service.revision_started',
      {
        designServiceId: round.request.publicId,
        roundNo: round.roundNo,
        revisionNo: round.roundNo - 1,
        chargeable: true,
      },
      systemActor('design_services.charges'),
      round.request.order.customerUserId,
    );
  }

  // --- reads --------------------------------------------------------------------------------------------

  async forOrderView(orderPublicId: string, customerUserId?: bigint): Promise<RequestRow> {
    return this.forOrder(this.prisma, orderPublicId, customerUserId);
  }

  async get(publicId: string): Promise<RequestRow> {
    return this.byPublicId(this.prisma, publicId);
  }

  async list(where: Prisma.DesignServiceRequestWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.designServiceRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ targetDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.designServiceRequest.count({ where }),
    ]);
  }

  /** What the next revision would cost (shown once changes were requested). */
  async nextRevision(row: RequestRow): Promise<NextRevisionDto | null> {
    const last = row.rounds.at(-1);
    if (!last || row.status !== 'revision_requested') return null;
    const revisionNo = last.roundNo;
    if (revisionNo <= row.freeRounds) return { revisionNo, chargeable: false, feeNet: null, feeGross: null };
    const fee = await this.extraFee(this.prisma, row.order.id, row.policyRefs, row.designFeeNet.toString());
    return { revisionNo, chargeable: true, feeNet: fee.net, feeGross: fee.gross };
  }

  toDto(
    row: RequestRow,
    next: NextRevisionDto | null,
    forCustomer: boolean,
    now = new Date(),
  ): DesignServiceDto {
    const brief = row.brief as unknown as Brief | null;
    const dueState = CLOSED.includes(row.status)
      ? 'closed'
      : !row.targetDueAt
        ? 'not_started'
        : row.maxDueAt && row.maxDueAt < now
          ? 'max_breached'
          : row.targetDueAt < now
            ? 'target_missed'
            : 'on_track';
    return {
      id: row.publicId,
      orderId: row.order.publicId,
      orderCode: row.order.orderCode,
      status: row.status,
      brief: brief
        ? {
            brandName: brief.brandName,
            brandCategory: brief.brandCategory,
            description: brief.description,
            attachmentFileIds: brief.attachmentFileIds,
          }
        : null,
      briefSubmittedAt: row.briefSubmittedAt ? toBangkokIso(row.briefSubmittedAt) : null,
      assignee:
        !forCustomer && row.assignedUser
          ? { id: row.assignedUser.publicId, displayName: row.assignedUser.displayName }
          : null,
      targetDueAt: row.targetDueAt ? toBangkokIso(row.targetDueAt) : null,
      maxDueAt: row.maxDueAt ? toBangkokIso(row.maxDueAt) : null,
      dueState,
      freeRounds: row.freeRounds,
      revisionsUsed: row.rounds.filter((r) => r.kind === 'revision').length,
      designFeeNet: row.designFeeNet.toFixed(2),
      nextRevision: next,
      closeReason: row.cancelReason,
      rounds: row.rounds.map((r) => ({
        id: r.publicId,
        roundNo: r.roundNo,
        kind: r.kind,
        chargeable: r.chargeable,
        feeNet: r.feeAmount?.toFixed(2) ?? null,
        status: r.status,
        changeRequest: r.changeRequest,
        referenceFileIds: r.referenceFileIds,
        submissionId: r.submission?.publicId ?? null,
        instalmentId: r.instalment?.publicId ?? null,
        requestedAt: toBangkokIso(r.requestedAt),
        startedAt: r.startedAt ? toBangkokIso(r.startedAt) : null,
        deliveredAt: r.deliveredAt ? toBangkokIso(r.deliveredAt) : null,
      })),
    };
  }

  // --- helpers --------------------------------------------------------------------------------------------

  /** max(minimum, % × design fee) net (D-071), from the setting version snapshotted when the request opened. */
  private async extraFee(
    db: Tx,
    orderId: bigint,
    refs: unknown,
    designFeeNet: string,
  ): Promise<{ net: string; gross: string }> {
    const rule = (await this.policyValue(db, refs, 'design.extra_revision_fee')) as {
      minimumAmount: string;
      pctOfDesignFee: string;
    };
    const net = MoneyDecimal.max(
      D(rule.minimumAmount),
      D(designFeeNet).mul(rule.pctOfDesignFee).div(100),
    ).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    const line = await db.orderLine.findFirst({ where: { orderId, lineType: 'product' } });
    const vat = net
      .mul(line?.vatRatePct.toString() ?? '0')
      .div(100)
      .toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    return { net: formatMoney(net), gross: formatMoney(net.add(vat)) };
  }

  private async policyValue(db: Tx, refs: unknown, key: string): Promise<unknown> {
    const id = (refs as PolicyRefs).settingVersionIds[key];
    const version = id ? await db.settingVersion.findUnique({ where: { id: BigInt(id) } }) : null;
    return version ? version.value : (await this.settings.at(key, { tx: db })).value;
  }

  private async forOrder(db: Tx, orderPublicId: string, customerUserId?: bigint): Promise<RequestRow> {
    const order = await this.orders.order({ publicId: orderPublicId }, customerUserId, db);
    const row = await db.designServiceRequest.findUnique({
      where: { orderId: order.id },
      include: REQUEST_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private async byPublicId(db: Tx, publicId: string): Promise<RequestRow> {
    const row = await db.designServiceRequest.findUnique({ where: { publicId }, include: REQUEST_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private load(db: Tx, id: bigint): Promise<RequestRow> {
    return db.designServiceRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
  }

  private async record(
    tx: Tx,
    orderPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
    customerUserId: bigint | null,
    visibility: ('internal' | 'customer')[] = ['internal', 'customer'],
  ): Promise<void> {
    const customerId =
      customerUserId === null ? null : await this.artwork.customerPublicId(tx, customerUserId);
    await this.artwork.record(tx, orderPublicId, type, data, actor, customerId, visibility);
  }
}
