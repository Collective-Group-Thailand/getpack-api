import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DocumentCorrectionReason, Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import { type BuyerSnapshot } from './customer-documents.service';
import { DocumentFilesService } from './document-files.service';
import { REPLACEMENT_REASON_TH } from './document-render';

export interface CorrectedBuyer {
  name: string;
  taxId: string | null;
  branchCode: string | null;
  address: string | null;
  documentEmail?: string | null;
}

export interface CorrectionInput {
  reason: DocumentCorrectionReason;
  note?: string | null;
  buyer: CorrectedBuyer;
}

const REQUEST_INCLUDE = {
  customerDocument: {
    select: { publicId: true, docNumber: true, docType: true, documentDate: true, buyerSnapshot: true },
  },
  replacementDocument: { select: { publicId: true, docNumber: true } },
  requestedBy: { select: { publicId: true, displayName: true } },
  decidedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.DocumentCorrectionRequestInclude;
export type CorrectionRow = Prisma.DocumentCorrectionRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/**
 * Corrections of issued tax documents (D-431, ป.86/2542 ข้อ 25). A tax invoice whose buyer is wrong is not
 * credited and re-invoiced: it is cancelled and issued again — a new number of the same series, the original's
 * date and amounts, the corrected buyer and the note "เป็นการยกเลิกและออกใบกำกับภาษีฉบับใหม่แทนฉบับเดิมเลขที่ …".
 * The ledger does not move (the sales tax report notes the cancellation in the month of the new one); the
 * receivable, the customer's WHT certificate to collect and the document links follow the new document. The
 * cancelled original keeps its number, gets a copy stamped "ยกเลิก" and, when it went out by e-Tax e-mail, a CIV.
 *
 * A customer asks for a correction from their account; Finance approves (which replaces the document) or rejects.
 * Finance can also replace a document directly (a phone or e-mail request).
 */
@Injectable()
export class DocumentCorrectionsService {
  private readonly logger = new Logger(DocumentCorrectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly files: DocumentFilesService,
    private readonly audit: AuditService,
    private readonly activity: ActivityLogService,
    private readonly events: DomainEvents,
  ) {}

  // ------------------------------------------------------------------------------------------- customer side

  async request(actor: UserActor, documentId: bigint, input: CorrectionInput): Promise<CorrectionRow> {
    const buyer = normalise(input.buyer);
    return this.prisma.withTx(async (tx) => {
      const doc = await tx.customerDocument.findUniqueOrThrow({ where: { id: documentId } });
      assertReplaceable(doc);
      const open = await tx.documentCorrectionRequest.count({
        where: { customerDocumentId: doc.id, status: 'pending' },
      });
      if (open > 0) throw new DomainException('receivables.correction_pending');
      const row = await tx.documentCorrectionRequest.create({
        data: {
          entityId: doc.entityId,
          customerDocumentId: doc.id,
          requestedById: actor.userId,
          reason: input.reason,
          note: input.note?.trim() || null,
          buyer: buyer as unknown as Prisma.InputJsonValue,
        },
        include: REQUEST_INCLUDE,
      });
      const event = await this.events.record(
        tx,
        {
          type: 'customer_document.correction_requested',
          aggregateType: 'customer_document',
          aggregateId: doc.publicId,
          entityId: doc.entityId,
          payload: {
            documentId: doc.publicId,
            docNumber: doc.docNumber,
            requestId: row.publicId,
            reason: input.reason,
          },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'customer_document',
        aggregatePublicId: doc.publicId,
        action: 'customer_document.correction_requested',
        messageKey: 'activity.customer_document.correction_requested',
        messageParams: { docNumber: doc.docNumber },
        visibility: ['internal', 'customer'],
        entityId: doc.entityId,
        domainEventId: event.id,
        actor,
      });
      return row;
    });
  }

  async withdraw(actor: UserActor, requestPublicId: string): Promise<CorrectionRow> {
    return this.prisma.withTx(async (tx) => {
      const r = await tx.documentCorrectionRequest.findUnique({ where: { publicId: requestPublicId } });
      if (!r || r.requestedById !== actor.userId) throw new DomainException('http.not_found');
      if (r.status !== 'pending') throw new DomainException('receivables.correction_decided');
      return tx.documentCorrectionRequest.update({
        where: { id: r.id },
        data: { status: 'withdrawn', decidedAt: new Date() },
        include: REQUEST_INCLUDE,
      });
    });
  }

  // ------------------------------------------------------------------------------------------- finance side

  async list(where: Prisma.DocumentCorrectionRequestWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.documentCorrectionRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.documentCorrectionRequest.count({ where }),
    ]);
    return { rows, total };
  }

  async get(publicId: string): Promise<CorrectionRow> {
    const r = await this.prisma.documentCorrectionRequest.findUnique({
      where: { publicId },
      include: REQUEST_INCLUDE,
    });
    if (!r) throw new DomainException('http.not_found');
    return r;
  }

  /** Approve (replaces the document with the requested buyer) or reject with a note. */
  async decide(
    actor: UserActor,
    requestPublicId: string,
    decision: { approve: boolean; note?: string | null; buyer?: CorrectedBuyer | null },
  ): Promise<CorrectionRow> {
    const replacementId = await this.prisma.withTx(async (tx) => {
      const r = await tx.documentCorrectionRequest.findUnique({
        where: { publicId: requestPublicId },
        include: { customerDocument: true },
      });
      if (!r) throw new DomainException('http.not_found');
      if (r.status !== 'pending') throw new DomainException('receivables.correction_decided');
      if (!decision.approve) {
        if (!decision.note?.trim())
          throw new DomainException('validation.failed', { params: { field: 'note' } });
        await tx.documentCorrectionRequest.update({
          where: { id: r.id },
          data: {
            status: 'rejected',
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: decision.note.trim(),
          },
        });
        const event = await this.events.record(
          tx,
          {
            type: 'customer_document.correction_rejected',
            aggregateType: 'customer_document',
            aggregateId: r.customerDocument.publicId,
            entityId: r.entityId,
            payload: {
              documentId: r.customerDocument.publicId,
              docNumber: r.customerDocument.docNumber,
              requestId: r.publicId,
            },
          },
          actor,
        );
        await this.activity.record(tx, {
          aggregateType: 'customer_document',
          aggregatePublicId: r.customerDocument.publicId,
          action: 'customer_document.correction_rejected',
          messageKey: 'activity.customer_document.correction_rejected',
          messageParams: { docNumber: r.customerDocument.docNumber },
          visibility: ['internal', 'customer'],
          entityId: r.entityId,
          domainEventId: event.id,
          actor,
        });
        await this.audit.record(tx, {
          category: 'finance',
          action: 'customer_document.correction_rejected',
          actor,
          resourceType: 'customer_document',
          resourcePublicId: r.customerDocument.publicId,
          entityId: r.entityId,
          data: { requestId: r.publicId },
        });
        return null;
      }
      const buyer = decision.buyer ? normalise(decision.buyer) : (r.buyer as unknown as CorrectedBuyer);
      const replacement = await this.replaceIn(tx, actor, r.customerDocument.id, {
        reason: r.reason,
        note: decision.note?.trim() || r.note,
        buyer,
      });
      await tx.documentCorrectionRequest.update({
        where: { id: r.id },
        data: {
          status: 'approved',
          decidedById: actor.userId,
          decidedAt: new Date(),
          decisionNote: decision.note?.trim() || null,
          replacementDocumentId: replacement.id,
          buyer: buyer as unknown as Prisma.InputJsonValue,
        },
      });
      return replacement.originalId;
    });
    if (replacementId) await this.afterReplace(replacementId);
    return this.get(requestPublicId);
  }

  /** Finance replaces a document directly; returns the new document's public id. */
  async replace(actor: UserActor, documentPublicId: string, input: CorrectionInput): Promise<string> {
    const buyer = normalise(input.buyer);
    const { publicId, originalId } = await this.prisma.withTx(async (tx) => {
      const doc = await tx.customerDocument.findUnique({ where: { publicId: documentPublicId } });
      if (!doc) throw new DomainException('http.not_found');
      const r = await this.replaceIn(tx, actor, doc.id, { ...input, buyer });
      // A pending customer request on the same document is answered by this replacement.
      await tx.documentCorrectionRequest.updateMany({
        where: { customerDocumentId: doc.id, status: 'pending' },
        data: {
          status: 'approved',
          decidedById: actor.userId,
          decidedAt: new Date(),
          replacementDocumentId: r.id,
        },
      });
      return r;
    });
    await this.afterReplace(originalId);
    return publicId;
  }

  /** The cancelled copy (and its CIV) right away; the new document's PDF follows in the render job. */
  private async afterReplace(originalId: bigint): Promise<void> {
    try {
      await this.files.renderPending(10);
      await this.files.renderCancelledCopy(originalId);
    } catch (error) {
      this.logger.error(`after-replace rendering deferred to the job: ${(error as Error).message}`);
    }
  }

  private async replaceIn(
    tx: Tx,
    actor: UserActor,
    documentId: bigint,
    input: CorrectionInput,
  ): Promise<{ id: bigint; publicId: string; originalId: bigint }> {
    const doc = await tx.customerDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, links: true, receivableItem: true },
    });
    assertReplaceable(doc);
    const was = doc.buyerSnapshot as unknown as BuyerSnapshot;
    const buyer: BuyerSnapshot = {
      ...was,
      name: input.buyer.name,
      taxId: input.buyer.taxId,
      branchCode: input.buyer.taxId ? (input.buyer.branchCode ?? '00000') : null,
      branchType: input.buyer.taxId
        ? (input.buyer.branchCode ?? '00000') === '00000'
          ? 'head_office'
          : 'branch'
        : null,
      address: input.buyer.address,
      documentEmail: input.buyer.documentEmail === undefined ? was.documentEmail : input.buyer.documentEmail,
      taxType: input.buyer.taxId ? (was.taxType === 'individual' ? 'juristic' : was.taxType) : was.taxType,
    };
    const docNumber = await this.numbering.next(tx, doc.docType, doc.documentDate, doc.entityId);
    const reasonText = `${REPLACEMENT_REASON_TH[input.reason] ?? ''}${input.note ? ` (${input.note})` : ''}`;
    const created = await tx.customerDocument.create({
      data: {
        entityId: doc.entityId,
        docType: doc.docType,
        docKind: doc.docKind,
        docNumber,
        documentDate: doc.documentDate,
        taxPointDate: doc.taxPointDate,
        isTaxInvoice: doc.isTaxInvoice,
        isFullForm: true,
        customerUserId: doc.customerUserId,
        companyId: doc.companyId,
        companyBranchId: doc.companyBranchId,
        buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
        sellerSnapshot: doc.sellerSnapshot as Prisma.InputJsonValue,
        orderGroupId: doc.orderGroupId,
        orderId: doc.orderId,
        paymentId: doc.paymentId,
        originalDocumentId: doc.originalDocumentId,
        creditNoteReasonId: doc.creditNoteReasonId,
        cnKind: doc.cnKind,
        receiptVia: doc.receiptVia,
        taxNature: doc.taxNature,
        netAmount: doc.netAmount,
        discountAmount: doc.discountAmount,
        vatRatePct: doc.vatRatePct,
        vatAmount: doc.vatAmount,
        grossAmount: doc.grossAmount,
        whtAmount: doc.whtAmount,
        cashAmount: doc.cashAmount,
        deductedPriorAmount: doc.deductedPriorAmount,
        roundingAmount: doc.roundingAmount,
        amountDue: doc.amountDue,
        dueDate: doc.dueDate,
        replacesDocumentId: doc.id,
        replacementReason: input.reason,
        replacementNote: input.note?.trim() || null,
        createdById: actor.userId,
        lines: {
          create: doc.lines.map((l) => ({
            lineNo: l.lineNo,
            orderId: l.orderId,
            orderLineId: l.orderLineId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            netAmount: l.netAmount,
            discountAmount: l.discountAmount,
            vatRatePct: l.vatRatePct,
            vatAmount: l.vatAmount,
            grossAmount: l.grossAmount,
            whtAmount: l.whtAmount,
            revenueCategory: l.revenueCategory,
            taxNature: l.taxNature,
          })),
        },
      },
    });
    for (const link of doc.links)
      await tx.customerDocumentLink.create({
        data: {
          documentId: created.id,
          linkedDocumentId: link.linkedDocumentId,
          kind: link.kind,
          amount: link.amount,
        },
      });
    if (doc.receivableItem)
      await tx.receivableItem.update({
        where: { id: doc.receivableItem.id },
        data: { customerDocumentId: created.id, rowVersion: { increment: 1 } },
      });
    await tx.customerWhtCertificate.updateMany({
      where: { customerDocumentId: doc.id },
      data: { customerDocumentId: created.id },
    });
    await tx.customerDocument.update({
      where: { id: doc.id },
      data: {
        status: 'void',
        voidReason: `ยกเลิกและออกใบกำกับภาษีฉบับใหม่แทน เลขที่ ${docNumber} — ${reasonText}`,
        voidedAt: new Date(),
        voidedById: actor.userId,
      },
    });
    await this.audit.record(tx, {
      category: 'finance',
      action: 'customer_document.replaced',
      actor,
      resourceType: 'customer_document',
      resourcePublicId: doc.publicId,
      entityId: doc.entityId,
      data: {
        docNumber: doc.docNumber,
        replacementNumber: docNumber,
        reason: input.reason,
        buyerBefore: { name: was.name, taxId: was.taxId, branchCode: was.branchCode },
        buyerAfter: { name: buyer.name, taxId: buyer.taxId, branchCode: buyer.branchCode },
      },
    });
    // Not `customer_document.voided` (that reverses the journals) nor `.issued` (that posts them): the money
    // and the tax point are the original's, only the paper changes.
    const event = await this.events.record(
      tx,
      {
        type: 'customer_document.replaced',
        aggregateType: 'customer_document',
        aggregateId: doc.publicId,
        entityId: doc.entityId,
        payload: {
          documentId: doc.publicId,
          docType: doc.docType,
          docNumber: doc.docNumber,
          replacementId: created.publicId,
          replacementNumber: docNumber,
          reason: input.reason,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'customer_document',
      aggregatePublicId: doc.publicId,
      action: 'customer_document.replaced',
      messageKey: 'activity.customer_document.replaced',
      messageParams: { docNumber: doc.docNumber, replacementNumber: docNumber },
      visibility: ['internal', 'customer'],
      entityId: doc.entityId,
      domainEventId: event.id,
      actor,
    });
    return { id: created.id, publicId: created.publicId, originalId: doc.id };
  }
}

function assertReplaceable(doc: {
  status: string;
  isTaxInvoice: boolean;
  replacesDocumentId?: bigint | null;
}) {
  if (doc.status === 'void')
    throw new DomainException('receivables.document_not_replaceable', { params: { reason: 'it is void' } });
  if (!doc.isTaxInvoice)
    throw new DomainException('receivables.document_not_replaceable', {
      params: { reason: 'only tax documents are cancelled and reissued; void an invoice instead' },
    });
}

/** Trims, blanks to null; a tax id is 13 digits and a branch 5 (validated again in the DTO). */
function normalise(b: CorrectedBuyer): CorrectedBuyer {
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const taxId = blank(b.taxId)?.replace(/\D/g, '') ?? null;
  if (taxId !== null && taxId.length !== 13)
    throw new DomainException('validation.failed', { params: { field: 'buyer.taxId' } });
  const branch = blank(b.branchCode);
  if (branch !== null && !/^\d{5}$/.test(branch))
    throw new DomainException('validation.failed', { params: { field: 'buyer.branchCode' } });
  const name = blank(b.name);
  if (!name) throw new DomainException('validation.failed', { params: { field: 'buyer.name' } });
  return {
    name,
    taxId,
    branchCode: taxId ? (branch ?? '00000') : null,
    address: blank(b.address),
    ...(b.documentEmail !== undefined ? { documentEmail: blank(b.documentEmail) } : {}),
  };
}

export const correctionDto = (r: CorrectionRow) => {
  const buyer = r.buyer as unknown as CorrectedBuyer;
  const before = r.customerDocument.buyerSnapshot as unknown as BuyerSnapshot;
  return {
    id: r.publicId,
    document: {
      id: r.customerDocument.publicId,
      docNumber: r.customerDocument.docNumber,
      docType: r.customerDocument.docType,
      documentDate: toBangkokIso(r.customerDocument.documentDate).slice(0, 10),
    },
    reason: r.reason,
    note: r.note,
    buyer: { name: buyer.name, taxId: buyer.taxId, branchCode: buyer.branchCode, address: buyer.address },
    currentBuyer: {
      name: before.name,
      taxId: before.taxId,
      branchCode: before.branchCode,
      address: before.address,
    },
    status: r.status,
    requestedBy: { id: r.requestedBy.publicId, name: r.requestedBy.displayName },
    decidedBy: r.decidedBy ? { id: r.decidedBy.publicId, name: r.decidedBy.displayName } : null,
    decidedAt: r.decidedAt ? toBangkokIso(r.decidedAt) : null,
    decisionNote: r.decisionNote,
    replacement: r.replacementDocument
      ? { id: r.replacementDocument.publicId, docNumber: r.replacementDocument.docNumber }
      : null,
    createdAt: toBangkokIso(r.createdAt),
  };
};
