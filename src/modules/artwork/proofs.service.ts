import { type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DecisionChannel, type FileObject, type Prisma } from '@generated/prisma/client';
import { OrdersService } from '@modules/orders/orders.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { FilesService } from '@platform/files/files.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { ArtworkService } from './artwork.service';
import { type AnnotationDto, type DielineDeliveryDto, type ProofDto } from './proofs.dto';

export const PROOF_INCLUDE = {
  order: { select: { id: true, publicId: true, orderCode: true, customerUserId: true } },
  submission: { select: { publicId: true } },
  proofFile: true,
  dielineFile: { select: { publicId: true } },
  decidedBy: { select: { displayName: true, kind: true } },
  approvedFile: { select: { publicId: true } },
  previousProof: {
    include: {
      proofFile: { select: { publicId: true } },
      annotations: { where: { resolvedAt: null }, select: { id: true } },
    },
  },
  annotations: {
    include: {
      author: { select: { kind: true, displayName: true } },
      parent: { select: { publicId: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ProofInclude;
export type ProofRow = Prisma.ProofGetPayload<{ include: typeof PROOF_INCLUDE }>;

export interface SendProofInput {
  submissionId?: string;
  proofFileId: string;
  dielineFileId?: string;
  changeNote?: string;
}

export interface AnnotationInput {
  parentId?: string;
  /** Required for a new annotation; a reply takes its parent's when left out (U-B0.1). */
  page?: number;
  kind?: 'pin' | 'rect' | 'draw';
  geometry?: Record<string, unknown>;
  comment: string;
}

export interface DecisionOptions {
  channel: DecisionChannel;
  /** The customer deciding (store / LIFF); CS decisions on behalf pass none. */
  customerUserId?: bigint;
  onBehalf?: { reason: string; confirmedVia: string };
  /** The checklist keys the customer confirmed and an optional note (U-B0.1 approval evidence). */
  checklist?: string[];
  note?: string | null;
}

/** Bound of a drawn annotation (technical). */
const MAX_POINTS = 500;

/** Page-relative geometry per kind (0–1 on both axes). */
export function validGeometry(kind: string, g: Record<string, unknown>): boolean {
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  switch (kind) {
    case 'pin':
      return unit(g['x']) && unit(g['y']);
    case 'rect':
      return unit(g['x']) && unit(g['y']) && unit(g['w']) && unit(g['h']);
    case 'draw': {
      const points = g['points'];
      return (
        Array.isArray(points) &&
        points.length >= 2 &&
        points.length <= MAX_POINTS &&
        points.every((p) => Array.isArray(p) && p.length === 2 && unit(p[0]) && unit(p[1]))
      );
    }
    default:
      return false;
  }
}

/**
 * Proofs (D-070, D-073): Prepress sends a proof version answering an accepted submission (the previous
 * pending one is superseded; `previous_proof_id` gives the version compare); the customer annotates it
 * (pin / rect / draw, with replies) and approves it or requests changes — on the web, in LINE LIFF, or CS
 * on their behalf with a reason and how the customer confirmed (audited). Approval locks a copy of the
 * proof file with its SHA-256 and the decision evidence (who, when, channel, IP, user agent) and records
 * the order fact `artwork_approved`, which may start production (D-073). Prepress also sends templates.
 */
@Injectable()
export class ProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly artwork: ArtworkService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // --- reads ----------------------------------------------------------------------------------------

  async list(orderPublicId: string, customerUserId?: bigint): Promise<ProofRow[]> {
    const order = await this.orders.order({ publicId: orderPublicId }, customerUserId);
    return this.prisma.proof.findMany({
      where: { orderId: order.id },
      include: PROOF_INCLUDE,
      orderBy: { versionNo: 'desc' },
    });
  }

  async get(publicId: string, customerUserId?: bigint, db: Tx = this.prisma): Promise<ProofRow> {
    const row = await db.proof.findUnique({ where: { publicId }, include: PROOF_INCLUDE });
    if (!row || (customerUserId !== undefined && row.order.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    return row;
  }

  // --- prepress: send a proof -------------------------------------------------------------------------

  async send(actor: UserActor, orderPublicId: string, input: SendProofInput): Promise<ProofRow> {
    const order = await this.orders.order({ publicId: orderPublicId });
    const proofFile = await this.staffFile(actor, input.proofFileId);
    const dielineFile = input.dielineFileId ? await this.staffFile(actor, input.dielineFileId) : null;
    const id = await this.prisma.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      this.artwork.assertTakesArtwork(current.status, current.artworkStatus);
      const submission = input.submissionId
        ? await tx.artworkSubmission.findFirst({ where: { publicId: input.submissionId, orderId: order.id } })
        : await tx.artworkSubmission.findFirst({
            where: { orderId: order.id, status: 'accepted_for_proof' },
            orderBy: { versionNo: 'desc' },
          });
      if (!submission || submission.status !== 'accepted_for_proof')
        throw new DomainException('proofs.no_accepted_artwork');
      const previous = await tx.proof.findFirst({
        where: { orderId: order.id },
        orderBy: { versionNo: 'desc' },
      });
      const at = new Date();
      await tx.proof.updateMany({
        where: { orderId: order.id, status: 'pending_customer' },
        data: { status: 'superseded', decidedAt: at, rowVersion: { increment: 1 } },
      });
      const proof = await tx.proof.create({
        data: {
          orderId: order.id,
          versionNo: (previous?.versionNo ?? 0) + 1,
          submissionId: submission.id,
          previousProofId: previous?.id ?? null,
          changeNote: input.changeNote ?? null,
          proofFileId: proofFile.id,
          dielineFileId: dielineFile?.id ?? null,
          preparedById: actor.userId,
          sentAt: at,
        },
      });
      await this.artwork.setArtworkStatus(tx, order.id, 'proof_sent', actor);
      await this.artwork.record(
        tx,
        order.publicId,
        'proof.sent',
        {
          proofId: proof.publicId,
          versionNo: proof.versionNo,
          submissionId: submission.publicId,
        },
        actor,
        await this.artwork.customerPublicId(tx, current.customerUserId),
      );
      return proof.id;
    });
    return this.prisma.proof.findUniqueOrThrow({ where: { id }, include: PROOF_INCLUDE });
  }

  // --- annotations ------------------------------------------------------------------------------------

  async annotate(
    actor: UserActor,
    proofPublicId: string,
    input: AnnotationInput,
    customerUserId?: bigint,
  ): Promise<ProofRow> {
    return this.prisma.withTx(async (tx) => {
      const proof = await this.get(proofPublicId, customerUserId, tx);
      // Customers annotate while they decide; Prepress also answers after changes were requested.
      const open =
        customerUserId !== undefined ? ['pending_customer'] : ['pending_customer', 'changes_requested'];
      if (!open.includes(proof.status))
        throw new DomainException('proofs.annotation_closed', { params: { status: proof.status } });
      let parentId: bigint | null = null;
      let place = { page: input.page, kind: input.kind, geometry: input.geometry };
      if (input.parentId) {
        const parent = await tx.proofAnnotation.findUnique({ where: { publicId: input.parentId } });
        if (!parent || parent.proofId !== proof.id) throw new DomainException('http.not_found');
        parentId = parent.id;
        place = {
          page: input.page ?? parent.page,
          kind: input.kind ?? (parent.kind),
          geometry: input.geometry ?? (parent.geometry as Record<string, unknown>),
        };
      }
      if (place.page === undefined || !place.kind || !place.geometry || !validGeometry(place.kind, place.geometry))
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'geometry',
              code: 'invalid',
              message: `not a valid ${place.kind ?? 'annotation'} geometry (page-relative 0–1)`,
            },
          ],
        });
      const annotation = await tx.proofAnnotation.create({
        data: {
          proofId: proof.id,
          parentId,
          page: place.page,
          kind: place.kind,
          geometry: place.geometry as Prisma.InputJsonValue,
          comment: input.comment,
          authorUserId: actor.userId,
        },
      });
      await this.artwork.record(
        tx,
        proof.order.publicId,
        'proof.annotated',
        {
          proofId: proof.publicId,
          annotationId: annotation.publicId,
          by: actor.audience,
          reply: parentId !== null,
        },
        actor,
        await this.artwork.customerPublicId(tx, proof.order.customerUserId),
        ['internal', 'customer'],
      );
      return this.get(proofPublicId, undefined, tx);
    });
  }

  async resolveAnnotation(
    actor: UserActor,
    annotationPublicId: string,
    customerUserId?: bigint,
  ): Promise<ProofRow> {
    return this.prisma.withTx(async (tx) => {
      const annotation = await tx.proofAnnotation.findUnique({
        where: { publicId: annotationPublicId },
        include: { proof: { include: { order: true } } },
      });
      if (
        !annotation ||
        (customerUserId !== undefined && annotation.proof.order.customerUserId !== customerUserId)
      )
        throw new DomainException('http.not_found');
      // Customers resolve their own notes; Prepress resolves any.
      if (customerUserId !== undefined && annotation.authorUserId !== actor.userId)
        throw new DomainException('auth.forbidden');
      if (annotation.resolvedAt === null) {
        await tx.proofAnnotation.update({
          where: { id: annotation.id },
          data: { resolvedAt: new Date(), resolvedById: actor.userId },
        });
      }
      return this.get(annotation.proof.publicId, undefined, tx);
    });
  }

  // --- decisions --------------------------------------------------------------------------------------

  async approve(actor: UserActor, proofPublicId: string, opts: DecisionOptions): Promise<ProofRow> {
    return this.prisma.withTx(async (tx) => {
      const proof = await this.lockPending(tx, proofPublicId, opts.customerUserId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: proof.orderId } });
      this.artwork.assertTakesArtwork(order.status, order.artworkStatus);
      const source = await tx.fileObject.findUniqueOrThrow({ where: { id: proof.proofFileId } });
      const checklist = await this.confirmedChecklist(opts, new Date());
      const locked = await this.files.lockedCopy(tx, source);
      const context = RequestContext.current();
      const at = new Date();
      await tx.proof.update({
        where: { id: proof.id },
        data: {
          status: 'approved',
          decidedAt: at,
          decidedByUserId: actor.userId,
          decisionChannel: opts.channel,
          onBehalfReason: opts.onBehalf ? `${opts.onBehalf.reason} (${opts.onBehalf.confirmedVia})` : null,
          decisionIp: context?.ip ?? null,
          decisionUserAgent: context?.userAgent ?? null,
          approvedFileId: locked.id,
          approvedFileSha256: locked.sha256,
          decisionChecklist: checklist,
          ...(opts.note ? { decisionComment: opts.note } : {}),
          rowVersion: { increment: 1 },
        },
      });
      const customerId = await this.artwork.customerPublicId(tx, order.customerUserId);
      await this.artwork.record(
        tx,
        order.publicId,
        'proof.approved',
        {
          proofId: proof.publicId,
          versionNo: proof.versionNo,
          channel: opts.channel,
          approvedFileSha256: Buffer.from(locked.sha256!).toString('hex'),
        },
        actor,
        customerId,
      );
      if (opts.onBehalf)
        await this.auditOnBehalf(tx, 'proof.approved_on_behalf', proof.publicId, opts.onBehalf);
      await this.orders.applyFact(tx, order.id, { kind: 'artwork_approved' }, actor, at);
      return this.get(proofPublicId, undefined, tx);
    });
  }

  /**
   * The customer confirms every item of `artwork.approval_checklist` (none while it is not set); staff approving on
   * behalf confirm nothing. Unknown keys are refused.
   */
  private async confirmedChecklist(opts: DecisionOptions, at: Date): Promise<string[]> {
    if (opts.customerUserId === undefined) return [];
    let items: { key: string }[] = [];
    try {
      items = (await this.settings.at('artwork.approval_checklist', { at })).value ?? [];
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    const given = [...new Set(opts.checklist ?? [])];
    const known = new Set(items.map((i) => i.key));
    const unknown = given.find((k) => !known.has(k));
    const missing = items.find((i) => !given.includes(i.key));
    if (unknown || missing)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'checklist',
            code: unknown ? 'unknown' : 'required',
            message: unknown ? `unknown checklist item ${unknown}` : `confirm ${missing!.key}`,
          },
        ],
      });
    return items.map((i) => i.key);
  }

  async requestChanges(
    actor: UserActor,
    proofPublicId: string,
    comment: string,
    opts: DecisionOptions,
  ): Promise<ProofRow> {
    return this.prisma.withTx(async (tx) => {
      const proof = await this.lockPending(tx, proofPublicId, opts.customerUserId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: proof.orderId } });
      this.artwork.assertTakesArtwork(order.status, order.artworkStatus);
      const context = RequestContext.current();
      await tx.proof.update({
        where: { id: proof.id },
        data: {
          status: 'changes_requested',
          decidedAt: new Date(),
          decidedByUserId: actor.userId,
          decisionChannel: opts.channel,
          decisionComment: comment,
          onBehalfReason: opts.onBehalf ? `${opts.onBehalf.reason} (${opts.onBehalf.confirmedVia})` : null,
          decisionIp: context?.ip ?? null,
          decisionUserAgent: context?.userAgent ?? null,
          rowVersion: { increment: 1 },
        },
      });
      await this.artwork.setArtworkStatus(tx, order.id, 'changes_requested', actor);
      await this.artwork.record(
        tx,
        order.publicId,
        'proof.changes_requested',
        {
          proofId: proof.publicId,
          versionNo: proof.versionNo,
          channel: opts.channel,
        },
        actor,
        await this.artwork.customerPublicId(tx, order.customerUserId),
      );
      if (opts.onBehalf)
        await this.auditOnBehalf(tx, 'proof.changes_requested_on_behalf', proof.publicId, opts.onBehalf);
      return this.get(proofPublicId, undefined, tx);
    });
  }

  // --- templates ----------------------------------------------------------------------------------------

  /** Prepress sends a template / dieline to the customer (legacy "upload-graphic-template"). */
  async sendTemplate(actor: UserActor, orderPublicId: string, input: { fileId: string; note?: string }) {
    const order = await this.orders.order({ publicId: orderPublicId });
    const file = await this.staffFile(actor, input.fileId);
    return this.prisma.withTx(async (tx) => {
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      this.artwork.assertTakesArtwork(current.status, current.artworkStatus);
      const delivery = await tx.dielineDelivery.create({
        data: {
          orderId: order.id,
          fileObjectId: file.id,
          trigger: 'manual',
          note: input.note ?? null,
          sentById: actor.userId,
        },
        include: { fileObject: { select: { publicId: true } } },
      });
      if (current.artworkStatus === 'awaiting_template')
        await this.artwork.setArtworkStatus(tx, order.id, 'awaiting_upload', actor);
      await this.artwork.record(
        tx,
        order.publicId,
        'dieline.sent',
        {
          deliveryId: delivery.publicId,
          trigger: 'manual',
          fileId: file.publicId,
        },
        actor,
        await this.artwork.customerPublicId(tx, current.customerUserId),
      );
      return delivery;
    });
  }

  async templates(orderPublicId: string, customerUserId?: bigint) {
    const order = await this.orders.order({ publicId: orderPublicId }, customerUserId);
    return this.prisma.dielineDelivery.findMany({
      where: { orderId: order.id },
      include: {
        fileObject: { select: { publicId: true } },
        drawingJob: { include: { outputFile: { select: { publicId: true } } } },
      },
      orderBy: { sentAt: 'desc' },
    });
  }

  // --- helpers ----------------------------------------------------------------------------------------

  private async lockPending(tx: Tx, publicId: string, customerUserId?: bigint) {
    const found = await tx.proof.findUnique({ where: { publicId }, include: { order: true } });
    if (!found || (customerUserId !== undefined && found.order.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM proofs WHERE id = ${found.id} FOR UPDATE`;
    const proof = await tx.proof.findUniqueOrThrow({ where: { id: found.id } });
    if (proof.status !== 'pending_customer')
      throw new DomainException('proofs.not_pending', { params: { status: proof.status } });
    return proof;
  }

  /** A clean file this staff member uploaded (proofs and templates come from Prepress). */
  private async staffFile(actor: UserActor, publicId: string): Promise<FileObject> {
    const file = await this.prisma.fileObject.findUnique({ where: { publicId } });
    if (
      !file ||
      file.createdById !== actor.userId ||
      file.uploadStatus !== 'uploaded' ||
      file.scanStatus !== 'clean'
    )
      throw new DomainException('artwork.file_not_usable', { params: { fileId: publicId } });
    return file;
  }

  private async auditOnBehalf(
    tx: Tx,
    action: string,
    proofPublicId: string,
    onBehalf: { reason: string; confirmedVia: string },
  ) {
    await this.audit.record(tx, {
      category: 'approval',
      action,
      resourceType: 'proof',
      resourcePublicId: proofPublicId,
      data: { reason: onBehalf.reason, confirmedVia: onBehalf.confirmedVia },
    });
  }
}

/** Store and admin projection; `forCustomer` hides staff identities (names are "Packio"). */
export function proofDto(row: ProofRow, forCustomer: boolean): ProofDto {
  const annotation = (a: ProofRow['annotations'][number]): AnnotationDto => ({
    id: a.publicId,
    parentId: a.parent?.publicId ?? null,
    page: a.page,
    kind: a.kind,
    geometry: a.geometry as Record<string, unknown>,
    comment: a.comment,
    author: {
      kind: a.author.kind === 'customer' ? 'customer' : 'staff',
      displayName: a.author.kind !== 'customer' && forCustomer ? 'Packio' : a.author.displayName,
    },
    resolvedAt: a.resolvedAt ? toBangkokIso(a.resolvedAt) : null,
    createdAt: toBangkokIso(a.createdAt),
  });
  const previous = row.previousProof;
  return {
    id: row.publicId,
    orderId: row.order.publicId,
    orderCode: row.order.orderCode,
    versionNo: row.versionNo,
    status: row.status,
    submissionId: row.submission?.publicId ?? null,
    proofFile: {
      id: row.proofFile.publicId,
      originalName: row.proofFile.originalName,
      mimeType: row.proofFile.mimeType,
      pageCount: row.proofFile.pageCount,
    },
    dielineFileId: row.dielineFile?.publicId ?? null,
    changeNote: row.changeNote,
    sentAt: toBangkokIso(row.sentAt),
    decidedAt: row.decidedAt ? toBangkokIso(row.decidedAt) : null,
    decisionChannel: row.decisionChannel,
    decisionComment: row.decisionComment,
    decidedByName: row.decidedBy ? (row.decidedBy.kind === 'staff' ? 'Packio' : row.decidedBy.displayName) : null,
    decisionChecklist: row.decisionChecklist,
    onBehalfReason: row.onBehalfReason,
    approvedFileId: row.approvedFile?.publicId ?? null,
    approvedFileSha256: row.approvedFileSha256 ? Buffer.from(row.approvedFileSha256).toString('hex') : null,
    compare: previous
      ? {
          previousProofId: previous.publicId,
          previousVersionNo: previous.versionNo,
          previousProofFileId: previous.proofFile.publicId,
          previousStatus: previous.status,
          previousDecisionComment: previous.decisionComment,
          openAnnotationsOnPrevious: previous.annotations.length,
        }
      : null,
    annotations: row.annotations.map(annotation),
  };
}

export function deliveryDto(row: {
  publicId: string;
  trigger: string;
  note: string | null;
  sentAt: Date;
  fileObject: { publicId: string } | null;
  drawingJob?: { outputFile: { publicId: string } | null } | null;
}): DielineDeliveryDto {
  return {
    id: row.publicId,
    trigger: row.trigger,
    fileId: row.fileObject?.publicId ?? row.drawingJob?.outputFile?.publicId ?? null,
    note: row.note,
    sentAt: toBangkokIso(row.sentAt),
  };
}
