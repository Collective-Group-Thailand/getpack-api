import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { decodeCursor, encodeCursor } from '@common/pagination/pagination';
import { PrismaService } from '@database/prisma.service';
import {
  type CustomerFileKind,
  type FileAccessChannel,
  type FileAccessPurpose,
  type FileObject,
  type Prisma,
} from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';

/** A file that is a customer's artwork / original, or made from one, and the order it belongs to. */
export interface CustomerFileRef {
  kind: CustomerFileKind;
  /** Internal order id; null for an artwork upload not (yet) part of a submission. */
  orderId: bigint | null;
}

export interface FileAccessLogFilter {
  orderId?: string;
  fileId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
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
 * - Support (`customer_files.read_handled`): orders whose open conversation (`conversations.subject_type = order`,
 *   not closed) is assigned to them.
 * - Every other staff role: none — `files.read` no longer covers these files. An approved proof's locked copy is a
 *   staff-made proof, so staff keep reading it with `files.read`; its downloads are logged all the same.
 * Customers, company members and factories keep their own rules (`FilesService.canRead` and the registered readers).
 */
@Injectable()
export class CustomerFileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
  ) {}

  /** The kind of customer file this is (a thumbnail is classified by its caller through the original), or null. */
  async classify(file: FileObject): Promise<CustomerFileRef | null> {
    const [copy, submitted, proof] = await Promise.all([
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
    ]);
    if (copy) return { kind: 'production_copy', orderId: copy.submissionFile.submission.orderId };
    if (submitted) return { kind: 'customer_original', orderId: submitted.submission.orderId };
    if (proof) return { kind: 'approved_proof_copy', orderId: proof.orderId };
    // An artwork upload not yet in a submission is still the customer's original.
    if (file.purpose === 'artwork') return { kind: 'customer_original', orderId: null };
    return null;
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

  /** "Handles the order": assigned to an open (not closed) conversation about that order. */
  async handles(userId: bigint, orderId: bigint): Promise<boolean> {
    const n = await this.prisma.conversation.count({
      where: { assignedUserId: userId, subjectType: 'order', subjectId: orderId, status: { not: 'closed' } },
    });
    return n > 0;
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
    },
  ): Promise<void> {
    if (actor.type !== 'user' && actor.type !== 'api_client') return;
    await this.prisma.customerFileAccessLog.create({
      data: {
        actorType: actor.type,
        actorUserId: actor.type === 'user' ? actor.userId : null,
        actorApiClientId: actor.type === 'api_client' ? actor.apiClientId : null,
        fileObjectId: entry.fileObjectId,
        fileKind: entry.ref.kind,
        orderId: entry.ref.orderId,
        channel: entry.channel,
        purpose: entry.purpose,
        requestId: RequestContext.current()?.requestId ?? null,
      },
    });
  }

  /** Newest first, cursor-paginated (Superadmin, `customer_file_access_logs.read`). */
  async list(filter: FileAccessLogFilter, cursor: string | undefined, limit: number) {
    const and: Prisma.CustomerFileAccessLogWhereInput[] = [];
    if (filter.orderId) and.push({ order: { publicId: filter.orderId } });
    if (filter.fileId) and.push({ fileObject: { publicId: filter.fileId } });
    if (filter.actorId)
      and.push({
        OR: [{ actorUser: { publicId: filter.actorId } }, { actorApiClient: { publicId: filter.actorId } }],
      });
    if (filter.from) and.push({ occurredAt: { gte: filter.from } });
    if (filter.to) and.push({ occurredAt: { lt: filter.to } });
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
