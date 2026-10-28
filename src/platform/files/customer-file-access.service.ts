import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { decodeCursor, encodeCursor } from '@common/pagination/pagination';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ClaimStatus,
  type CustomerFileKind,
  type FileAccessChannel,
  type FileAccessPurpose,
  type FileObject,
  type Prisma,
} from '@generated/prisma/client';
import { FINAL_CLAIM_STATUSES } from '@modules/claims/liability';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

/** A file that is a customer's artwork / original, or made from one, and the order it belongs to. */
export interface CustomerFileRef {
  kind: CustomerFileKind;
  /** Internal order id; null for an artwork upload not (yet) part of a submission. */
  orderId: bigint | null;
}

export interface FileAccessLogFilter {
  orderId?: string;
  /** C1f (D-451): the order's code, exact, case-insensitive. */
  orderCode?: string;
  fileId?: string;
  actorId?: string;
  /** C1f: one kind of customer file. */
  fileKind?: 'customer_original' | 'production_copy' | 'approved_proof_copy';
  /** C1f: true = only Superadmin accesses with a typed reason (D-449 (1)); false = only the others. */
  withReason?: boolean;
  from?: Date;
  to?: Date;
}

/** C1f (D-451): the log's filter as Prisma conditions — shared by the list and its export. */
export function fileAccessLogWhere(filter: FileAccessLogFilter): Prisma.CustomerFileAccessLogWhereInput[] {
  const and: Prisma.CustomerFileAccessLogWhereInput[] = [];
  if (filter.orderId) and.push({ order: { publicId: filter.orderId } });
  if (filter.orderCode) and.push({ order: { orderCode: { equals: filter.orderCode, mode: 'insensitive' } } });
  if (filter.fileId) and.push({ fileObject: { publicId: filter.fileId } });
  if (filter.actorId)
    and.push({
      OR: [{ actorUser: { publicId: filter.actorId } }, { actorApiClient: { publicId: filter.actorId } }],
    });
  if (filter.fileKind) and.push({ fileKind: filter.fileKind });
  if (filter.withReason !== undefined) and.push({ reason: filter.withReason ? { not: null } : null });
  if (filter.from) and.push({ occurredAt: { gte: filter.from } });
  if (filter.to) and.push({ occurredAt: { lt: filter.to } });
  return and;
}

const LOG_INCLUDE = {
  actorUser: { select: { publicId: true, displayName: true } },
  actorApiClient: { select: { publicId: true, name: true } },
  fileObject: { select: { publicId: true } },
  order: { select: { publicId: true, orderCode: true } },
} satisfies Prisma.CustomerFileAccessLogInclude;
export type FileAccessLogRow = Prisma.CustomerFileAccessLogGetPayload<{ include: typeof LOG_INCLUDE }>;

/**
 * Customer file access (D-444, DECISIONS-STAGE-A §7): who on staff may read a customer's artwork / originals and
 * their production copies, and the append-only log of every download URL issued for them.
 *
 * - Prepress (`customer_files.read`): any order.
 * - Support (`customer_files.read_handled`): orders explicitly assigned to them (`order_support_assignments`, set
 *   by CS Lead / Admin, B-API-6) or whose open conversation (`conversations.subject_type = order`, not closed) is
 *   assigned to them.
 * - Studio print-job files, design-studio assets and Studio design renders / thumbnails are customer artwork too
 *   (B-API-6): same rules, same log.
 * - Every other staff role: none — `files.read` no longer covers these files. An approved proof's locked copy is a
 *   staff-made proof, so staff keep reading it with `files.read`; its downloads are logged all the same.
 * Customers, company members and factories keep their own rules (`FilesService.canRead` and the registered readers).
 */
const ASSIGNMENT_INCLUDE = {
  user: { select: { publicId: true, displayName: true } },
  assignedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.OrderSupportAssignmentInclude;
export type SupportAssignmentRow = Prisma.OrderSupportAssignmentGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;
export interface SupportAssignmentView {
  order: { publicId: string; orderCode: string };
  assignment: SupportAssignmentRow | null;
}

@Injectable()
export class CustomerFileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  /** The kind of customer file this is (a thumbnail is classified by its caller through the original), or null. */
  async classify(file: FileObject): Promise<CustomerFileRef | null> {
    const [copy, submitted, proof, studioJob, studio] = await Promise.all([
      this.prisma.artworkProductionCopy.findUnique({
        where: { copyFileId: file.id },
        select: { submissionFile: { select: { submission: { select: { orderId: true } } } } },
      }),
      this.prisma.artworkSubmissionFile.findFirst({
        where: { fileObjectId: file.id },
        select: { submission: { select: { orderId: true } } },
        orderBy: { id: 'desc' },
      }),
      this.prisma.proof.findFirst({
        where: { approvedFileId: file.id },
        select: { orderId: true },
        orderBy: { id: 'desc' },
      }),
      // B-API-6: the files of a Studio print job (print-ready file, soft proof, snapshot) are the customer's design.
      this.prisma.studioPrintJob.findFirst({
        where: { OR: [{ printFileId: file.id }, { proofFileId: file.id }, { snapshotFileId: file.id }] },
        select: { orderId: true },
        orderBy: { id: 'desc' },
      }),
      this.isStudioDesignFile(file.id),
    ]);
    if (copy) return { kind: 'production_copy', orderId: copy.submissionFile.submission.orderId };
    if (submitted) return { kind: 'customer_original', orderId: submitted.submission.orderId };
    if (proof) return { kind: 'approved_proof_copy', orderId: proof.orderId };
    if (studioJob) return { kind: 'customer_original', orderId: studioJob.orderId };
    // An artwork upload not yet in a submission is still the customer's original; so are (B-API-6) design-studio
    // assets and the renders / thumbnails of a Studio design — customer artwork with no order yet.
    if (file.purpose === 'artwork' || file.purpose === 'design_asset' || studio)
      return { kind: 'customer_original', orderId: null };
    return null;
  }

  /** A Studio design's asset, render or thumbnail (B-API-6: classed as customer artwork). */
  private async isStudioDesignFile(fileId: bigint): Promise<boolean> {
    const [asset, render, document, version] = await Promise.all([
      this.prisma.designAsset.count({ where: { fileObjectId: fileId } }),
      this.prisma.designVersionRender.count({ where: { fileId } }),
      this.prisma.designDocument.count({ where: { thumbnailFileId: fileId } }),
      this.prisma.designDocumentVersion.count({ where: { thumbnailFileId: fileId } }),
    ]);
    return asset + render + document + version > 0;
  }

  /** Whether a staff member may read this customer file (the uploader rule is checked before, by the caller). */
  async staffMayRead(userId: bigint, ref: CustomerFileRef): Promise<boolean> {
    const granted = (await this.permissions.forUser(userId)).permissions;
    if (ref.kind === 'approved_proof_copy') return granted.has('files.read');
    if (granted.has('customer_files.read')) return true;
    if (granted.has('customer_files.read_handled') && ref.orderId !== null)
      return this.handles(userId, ref.orderId);
    return false;
  }

  /**
   * "Handles the order": the live explicit support assignment of the order (B-API-6, set by CS Lead / Admin), or an
   * open (not closed) conversation about that order assigned to the user.
   */
  async handles(userId: bigint, orderId: bigint): Promise<boolean> {
    const [assigned, conversations] = await Promise.all([
      this.prisma.orderSupportAssignment.count({ where: { orderId, userId, endedAt: null } }),
      this.prisma.conversation.count({
        where: {
          assignedUserId: userId,
          subjectType: 'order',
          subjectId: orderId,
          status: { not: 'closed' },
        },
      }),
    ]);
    return assigned + conversations > 0;
  }

  /**
   * B-API-7: the orders made from the design version a Studio render belongs to (its Studio print jobs with an
   * order). Empty when the file is not a render or no order uses it.
   */
  async renderOrders(fileId: bigint): Promise<bigint[]> {
    const jobs = await this.prisma.studioPrintJob.findMany({
      where: { orderId: { not: null }, version: { renders: { some: { fileId } } } },
      select: { orderId: true },
      orderBy: { id: 'asc' },
    });
    return jobs.map((j) => j.orderId).filter((id): id is bigint => id !== null);
  }

  /**
   * B-API-7: whether a staff member may read the preview (thumbnail) of a Studio render — Prepress
   * (`customer_files.read`) for any render, support (`customer_files.read_handled`) for a render of an order they
   * handle. Returns the reference to log (with that order), or null when denied. The render itself is not covered.
   */
  async staffMayPreview(userId: bigint, renderFileId: bigint): Promise<CustomerFileRef | null> {
    const orders = await this.renderOrders(renderFileId);
    const granted = (await this.permissions.forUser(userId)).permissions;
    if (granted.has('customer_files.read')) {
      const isRender =
        orders.length > 0 ||
        (await this.prisma.designVersionRender.count({ where: { fileId: renderFileId } })) > 0;
      return isRender ? { kind: 'customer_original', orderId: orders[0] ?? null } : null;
    }
    if (!granted.has('customer_files.read_handled')) return null;
    for (const orderId of orders)
      if (await this.handles(userId, orderId)) return { kind: 'customer_original', orderId };
    return null;
  }

  /**
   * B-API-7 (worker, `orders.support_assignment_end`): ends every live support assignment whose order's claim window
   * (`orders.claim_window_ends_at`, set at delivery) has ended, unless a claim on the order is still open (the window
   * stays open for it, D-437). One transaction per order with an audit row and the `order.support_unassigned` event
   * (reason `claim_window_ended`).
   */
  async endAfterClaimWindow(now: Date = new Date(), limit = 200): Promise<number> {
    const openClaim = { status: { notIn: [...FINAL_CLAIM_STATUSES] as ClaimStatus[] } };
    const due = await this.prisma.orderSupportAssignment.findMany({
      where: { endedAt: null, order: { claimWindowEndsAt: { lte: now }, claims: { none: openClaim } } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    const actor = systemActor('orders.support_assignment_end');
    let ended = 0;
    for (const { id } of due) {
      const done = await this.prisma.withTx(async (tx) => {
        const live = await tx.orderSupportAssignment.findUnique({
          where: { id },
          include: { order: { select: { id: true, publicId: true } }, user: { select: { publicId: true } } },
        });
        if (!live || live.endedAt) return false;
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${live.order.id} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({
          where: { id: live.order.id },
          select: { claimWindowEndsAt: true, _count: { select: { claims: { where: openClaim } } } },
        });
        if (!order.claimWindowEndsAt || order.claimWindowEndsAt > now || order._count.claims > 0)
          return false;
        const changed = await tx.orderSupportAssignment.updateMany({
          where: { id, endedAt: null },
          data: { endedAt: now < live.assignedAt ? live.assignedAt : now, endedById: null },
        });
        if (changed.count === 0) return false;
        const data = {
          orderId: live.order.publicId,
          userId: live.user.publicId,
          assignmentId: live.publicId,
          reason: 'claim_window_ended',
        };
        await this.audit.record(tx, {
          category: 'iam',
          action: 'order.support_unassigned',
          actor,
          resourceType: 'order',
          resourcePublicId: live.order.publicId,
          data,
        });
        await this.events.record(
          tx,
          {
            type: 'order.support_unassigned',
            aggregateType: 'order',
            aggregateId: live.order.publicId,
            payload: data,
          },
          actor,
        );
        return true;
      });
      if (done) ended += 1;
    }
    return ended;
  }

  /** The live support assignment of an order (B-API-6), with the order. 404 for an unknown order. */
  async supportAssignment(orderPublicId: string): Promise<SupportAssignmentView> {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      select: { id: true, publicId: true, orderCode: true },
    });
    if (!order) throw new DomainException('http.not_found');
    const live = await this.prisma.orderSupportAssignment.findFirst({
      where: { orderId: order.id, endedAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
    return { order, assignment: live };
  }

  /**
   * B-API-6 (D-444): CS Lead / Admin (`orders.assign_support`) sets who on support handles an order — an active staff
   * member holding `customer_files.read_handled` — or `null` to end the assignment. The live row is ended and a new
   * one added (history kept), in one transaction with an audit row and the `order.support_assigned` event.
   */
  async assignSupport(
    actor: UserActor,
    orderPublicId: string,
    userPublicId: string | null,
  ): Promise<SupportAssignmentView> {
    const assignee = userPublicId
      ? await this.prisma.user.findFirst({
          where: { publicId: userPublicId, kind: 'staff', status: 'active' },
          select: { id: true, publicId: true },
        })
      : null;
    if (userPublicId && !assignee)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'supportUserId', code: 'exists', message: 'not an active staff user' }],
      });
    if (
      assignee &&
      !(await this.permissions.forUser(assignee.id)).permissions.has('customer_files.read_handled')
    )
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'supportUserId',
            code: 'invalid',
            message: 'the user does not hold customer_files.read_handled (support)',
          },
        ],
      });
    return this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        select: { id: true, publicId: true, orderCode: true },
      });
      if (!order) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const live = await tx.orderSupportAssignment.findFirst({ where: { orderId: order.id, endedAt: null } });
      if ((live?.userId ?? null) === (assignee?.id ?? null)) {
        return {
          order,
          assignment: live
            ? await tx.orderSupportAssignment.findUniqueOrThrow({
                where: { id: live.id },
                include: ASSIGNMENT_INCLUDE,
              })
            : null,
        };
      }
      const now = new Date();
      if (live)
        await tx.orderSupportAssignment.update({
          where: { id: live.id },
          data: { endedAt: now, endedById: actor.userId },
        });
      const created = assignee
        ? await tx.orderSupportAssignment.create({
            data: { orderId: order.id, userId: assignee.id, assignedAt: now, assignedById: actor.userId },
            include: ASSIGNMENT_INCLUDE,
          })
        : null;
      const data = {
        orderId: order.publicId,
        userId: assignee?.publicId ?? null,
        previousAssignmentId: live?.publicId ?? null,
        assignmentId: created?.publicId ?? null,
      };
      await this.audit.record(tx, {
        category: 'iam',
        action: 'order.support_assigned',
        resourceType: 'order',
        resourcePublicId: order.publicId,
        data,
      });
      await this.events.record(tx, {
        type: 'order.support_assigned',
        aggregateType: 'order',
        aggregateId: order.publicId,
        payload: data,
      });
      return { order, assignment: created };
    });
  }

  /**
   * Appends the access row in the request that issues the URL; a failure fails the request (no URL without a row).
   * Never stores the URL, a token or the storage key. System actors (jobs) are not logged here.
   */
  async record(
    actor: Actor,
    entry: {
      fileObjectId: bigint;
      ref: CustomerFileRef;
      channel: FileAccessChannel;
      purpose: FileAccessPurpose;
      /** D-449 (1): the typed reason of a Superadmin download. */
      reason?: string;
    },
    tx?: Tx,
  ): Promise<void> {
    if (actor.type !== 'user' && actor.type !== 'api_client') return;
    await (tx ?? this.prisma).customerFileAccessLog.create({
      data: {
        actorType: actor.type,
        actorUserId: actor.type === 'user' ? actor.userId : null,
        actorApiClientId: actor.type === 'api_client' ? actor.apiClientId : null,
        fileObjectId: entry.fileObjectId,
        fileKind: entry.ref.kind,
        orderId: entry.ref.orderId,
        channel: entry.channel,
        purpose: entry.purpose,
        reason: entry.reason ?? null,
        requestId: RequestContext.current()?.requestId ?? null,
      },
    });
  }

  /** Newest first, cursor-paginated (Superadmin, `customer_file_access_logs.read`). */
  async list(filter: FileAccessLogFilter, cursor: string | undefined, limit: number) {
    const and = fileAccessLogWhere(filter);
    if (cursor) {
      const position = decodeCursor(cursor);
      const at = new Date(String(position['at']));
      const id = BigInt(String(position['id']));
      and.push({ OR: [{ occurredAt: { lt: at } }, { occurredAt: at, id: { lt: id } }] });
    }
    const rows = await this.prisma.customerFileAccessLog.findMany({
      where: { AND: and },
      include: LOG_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = rows.length > limit ? page.at(-1) : undefined;
    return {
      rows: page,
      nextCursor: last ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id.toString() }) : null,
    };
  }
}
