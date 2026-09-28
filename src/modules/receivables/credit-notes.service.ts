import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ApprovalRequest,
  type CreditNoteKind,
  type CreditSettlement,
  type CustomerDocument,
  type Prisma,
  type StoreCreditSource,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { CustomerDocumentsService } from './customer-documents.service';
import { StoreCreditService } from './store-credit.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const POLICY = 'credit_note';

/** Default statutory reason per business kind (the controlled list, §2). */
export const REASON_OF_KIND: Record<CreditNoteKind, string> = {
  shortage: 'shortage_within_tolerance',
  claim: 'defective_goods',
  cancellation: 'cancellation_before_production',
  price_reduction: 'price_reduction',
  return: 'returned_goods',
  discount: 'post_sale_discount',
};

const WALLET_SOURCE: Record<CreditNoteKind, StoreCreditSource> = {
  shortage: 'shortage_credit',
  claim: 'claim',
  cancellation: 'cancellation',
  price_reduction: 'manual',
  return: 'manual',
  discount: 'manual',
};

export interface CreditNoteInput {
  orderId: bigint;
  cnKind: CreditNoteKind;
  reasonCode?: string;
  /** Gross credited (incl. VAT); or explicit net + VAT (tolerance credits come computed, D-021). */
  gross?: MoneyValue;
  net?: MoneyValue;
  vat?: MoneyValue;
  settleTo?: CreditSettlement | null;
  note: string;
  approvalRequestId?: bigint | null;
  createdById?: bigint | null;
}

export interface CreditNoteRequestInput {
  amount: string;
  cnKind: CreditNoteKind;
  reasonCode?: string;
  settleTo?: CreditSettlement;
  note: string;
}

export const CN_REQUEST_INCLUDE = {
  order: { select: { publicId: true, orderCode: true } },
  reason: { select: { code: true, nameTh: true, statutoryCategory: true } },
  approvalRequest: { select: { publicId: true, status: true } },
  customerDocument: { select: { publicId: true, docNumber: true } },
  claim: { select: { publicId: true, claimNo: true } },
} as const satisfies Prisma.CreditNoteRequestInclude;
export type CreditNoteRequestRow = Prisma.CreditNoteRequestGetPayload<{ include: typeof CN_REQUEST_INCLUDE }>;

/**
 * Credit notes (accounting-design §2, §5 P19, P23; §8 maker-checker): always against the original tax
 * invoice, with a reason from the controlled list mapped to its statutory category. Credits a decision fixes
 * by rule — a shortage within tolerance (D-021) and a cancellation before production — are issued when they
 * happen; every other credit note (claims, price reductions, returns, discounts after sale) is requested and
 * issued only when a Finance Manager other than the requester approves it (`credit_note`, D-169). A credit
 * reduces what is still owed, the rest goes to the customer's credit balance (store credit, 2320).
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: CustomerDocumentsService,
    private readonly storeCredit: StoreCreditService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  /** Issues a credit note now (rule-driven, or an approved request). */
  async issue(tx: Tx, input: CreditNoteInput, actor: Actor): Promise<CustomerDocument> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { orderGroup: true },
    });
    const delivery = await tx.customerDocument.findFirst({
      where: { orderId: order.id, docKind: { in: ['final', 'delivery'] }, status: 'issued' },
      include: { receivableItem: true },
    });
    const advances = await tx.customerDocumentLine.findMany({
      where: { orderId: order.id, document: { docKind: 'instalment', status: 'issued' } },
      include: { document: true },
      orderBy: { id: 'desc' },
    });
    const original = delivery ?? advances[0]?.document ?? null;
    if (!original) throw new DomainException('receivables.credit_exceeds', { params: { amount: '0.00' } });
    const rate = D(original.vatRatePct);
    const gross = input.gross ?? input.net!.add(input.vat!);
    const vat = input.vat ?? round(gross.mul(rate).div(rate.add(100)));
    const net = input.net ?? gross.sub(vat);
    // Never credit more than was invoiced (after delivery) or paid in advance (before), less earlier credits.
    const credited = await tx.customerDocument.aggregate({
      where: { orderId: order.id, docType: 'cn', status: 'issued' },
      _sum: { grossAmount: true },
    });
    const base = delivery
      ? D(order.grossAmount)
      : advances.reduce((a, l) => a.add(l.grossAmount.toString()), ZERO());
    const creditable = base.sub(credited._sum.grossAmount?.toString() ?? '0');
    if (gross.lte(0) || gross.gt(creditable))
      throw new DomainException('receivables.credit_exceeds', {
        params: { amount: formatMoney(MoneyDecimal.max(creditable, 0)) },
      });
    const item = delivery?.receivableItem ?? null;
    const openItem = item && ['open', 'partially_paid'].includes(item.status) ? item : null;
    const settleTo: CreditSettlement =
      input.settleTo ?? (openItem && D(openItem.openAmount).gte(gross) ? 'receivable' : 'store_credit');
    if (settleTo === 'receivable' && (!openItem || D(openItem.openAmount).lt(gross)))
      throw new DomainException('receivables.credit_exceeds', {
        params: { amount: formatMoney(openItem ? D(openItem.openAmount) : 0) },
      });
    const notDue = openItem && settleTo === 'receivable' && D(openItem.vatNotDueAmount).gte(vat) && vat.gt(0);
    const reason = await tx.creditNoteReason.findUniqueOrThrow({
      where: { code: input.reasonCode ?? REASON_OF_KIND[input.cnKind] },
    });
    const { buyer, fullForm } = await this.documents.buyerOfGroup(tx, order.orderGroupId);
    const doc = await this.documents.issue(
      tx,
      {
        entityId: order.entityId,
        docType: 'cn',
        docKind: 'credit_note',
        documentDate: bangkokDate(new Date()),
        isTaxInvoice: original.isTaxInvoice || !notDue,
        customerUserId: order.customerUserId,
        companyId: order.orderGroup.companyId,
        companyBranchId: order.orderGroup.companyBranchId,
        buyer,
        isFullForm: fullForm,
        orderGroupId: order.orderGroupId,
        orderId: order.id,
        originalDocumentId: original.id,
        creditNoteReasonId: reason.id,
        cnKind: input.cnKind,
        taxNature: order.taxNature,
        lines: [
          {
            description: `${reason.nameTh} — ${input.note}`.slice(0, 500),
            orderId: order.id,
            net,
            vatRatePct: rate.toFixed(4),
            vat,
            taxNature: order.taxNature,
          },
        ],
        links: [{ documentId: original.id, kind: 'credits', amount: gross }],
        posting: {
          revenueStage: delivery ? 'recognised' : 'advance',
          vatStage: notDue ? 'not_due' : 'due',
          settleTo,
        },
        approvalRequestId: input.approvalRequestId ?? null,
        createdById: input.createdById ?? null,
      },
      actor,
    );
    if (settleTo === 'receivable' && openItem) {
      const left = D(openItem.openAmount).sub(gross);
      await tx.receivableApplication.create({
        data: { receivableItemId: openItem.id, documentId: doc.id, amount: formatMoney(gross) },
      });
      await tx.receivableItem.update({
        where: { id: openItem.id },
        data: {
          openAmount: formatMoney(left),
          status: left.isZero() ? 'paid' : 'partially_paid',
          ...(notDue && {
            vatNotDueAmount: formatMoney(D(openItem.vatNotDueAmount).sub(vat)),
            vatNotDueBase: formatMoney(MoneyDecimal.max(D(openItem.vatNotDueBase).sub(net), 0)),
          }),
          rowVersion: { increment: 1 },
        },
      });
    } else {
      await this.storeCredit.credit(tx, {
        entityId: order.entityId,
        customerUserId: order.customerUserId,
        amount: gross,
        source: WALLET_SOURCE[input.cnKind],
        customerDocumentId: doc.id,
        orderId: order.id,
        note: doc.docNumber,
      });
    }
    return doc;
  }

  /**
   * Debit note (ใบเพิ่มหนี้, §2) against the order's delivery document: an additional amount the customer owes,
   * with a reason from the controlled list; issued by a Finance Manager and collected like an invoice.
   */
  async issueDebitNote(
    actor: UserActor,
    orderPublicId: string,
    input: { net: string; reasonCode: string; note: string; dueDate?: string },
  ) {
    const doc = await this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderGroup: true },
      });
      if (!order) throw new DomainException('http.not_found');
      const original = await tx.customerDocument.findFirst({
        where: { orderId: order.id, docKind: { in: ['final', 'delivery'] }, status: 'issued' },
      });
      if (!original)
        throw new DomainException('receivables.document_not_voidable', {
          params: { reason: 'the order has no delivery document yet' },
        });
      const reason = await tx.creditNoteReason.findUnique({ where: { code: input.reasonCode } });
      if (!reason?.active)
        throw new DomainException('receivables.reason_invalid', { params: { code: input.reasonCode } });
      const net = D(input.net);
      const rate = D(original.vatRatePct);
      const vat = round(net.mul(rate).div(100));
      const { buyer, fullForm } = await this.documents.buyerOfGroup(tx, order.orderGroupId);
      const today = bangkokDate(new Date());
      const issued = await this.documents.issue(
        tx,
        {
          entityId: order.entityId,
          docType: 'dn',
          docKind: 'debit_note',
          documentDate: today,
          isTaxInvoice: true,
          customerUserId: order.customerUserId,
          companyId: order.orderGroup.companyId,
          companyBranchId: order.orderGroup.companyBranchId,
          buyer,
          isFullForm: fullForm,
          orderGroupId: order.orderGroupId,
          orderId: order.id,
          originalDocumentId: original.id,
          creditNoteReasonId: reason.id,
          taxNature: order.taxNature,
          lines: [
            {
              description: `${reason.nameTh} — ${input.note}`.slice(0, 500),
              orderId: order.id,
              net,
              vatRatePct: rate.toFixed(4),
              vat,
              taxNature: order.taxNature,
            },
          ],
          amountDue: net.add(vat),
          dueDate: input.dueDate ?? today,
          links: [{ documentId: original.id, kind: 'debits', amount: net.add(vat) }],
          createdById: actor.userId,
        },
        actor,
      );
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_document.debit_note_issued',
        actor,
        resourceType: 'customer_document',
        resourcePublicId: issued.publicId,
        entityId: order.entityId,
        data: { order: order.orderCode, net: formatMoney(net), reason: reason.code },
      });
      return issued;
    });
    return doc;
  }

  // --- requests under maker-checker ------------------------------------------------------------------------

  async request(
    actor: UserActor,
    orderPublicId: string,
    input: CreditNoteRequestInput,
    claimId?: bigint | null,
  ) {
    const row = await this.prisma.withTx((tx) => this.requestIn(tx, actor, orderPublicId, input, claimId));
    return this.getRequest(row.publicId);
  }

  async requestIn(
    tx: Tx,
    actor: UserActor,
    orderPublicId: string,
    input: CreditNoteRequestInput,
    claimId?: bigint | null,
  ) {
    const order = await tx.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new DomainException('http.not_found');
    const reason = await tx.creditNoteReason.findUnique({
      where: { code: input.reasonCode ?? REASON_OF_KIND[input.cnKind] },
    });
    if (!reason?.active)
      throw new DomainException('receivables.reason_invalid', {
        params: { code: input.reasonCode ?? input.cnKind },
      });
    const amount = D(input.amount);
    const request = await tx.creditNoteRequest.create({
      data: {
        entityId: order.entityId,
        orderId: order.id,
        reasonId: reason.id,
        cnKind: input.cnKind,
        amount: formatMoney(amount),
        settleTo: input.settleTo ?? null,
        note: input.note,
        claimId: claimId ?? null,
        requestedById: actor.userId,
      },
    });
    const approval = await this.approvals.create(tx, {
      policyKey: POLICY,
      subject: { type: 'customer_document', id: request.id, publicId: request.publicId },
      requester: actor,
      amount: formatMoney(amount),
      entityId: order.entityId,
      payload: {
        order: order.orderCode,
        amount: formatMoney(amount),
        reason: reason.code,
        kind: input.cnKind,
        note: input.note,
      },
    });
    await tx.creditNoteRequest.update({
      where: { id: request.id },
      data: { approvalRequestId: approval.id },
    });
    await this.audit.record(tx, {
      category: 'finance',
      action: 'customer_document.request',
      actor,
      resourceType: 'customer_document',
      resourcePublicId: request.publicId,
      entityId: order.entityId,
      data: { order: order.orderCode, amount: formatMoney(amount), kind: input.cnKind },
    });
    await this.events.record(
      tx,
      {
        type: 'credit_note.requested',
        aggregateType: 'order',
        aggregateId: order.publicId,
        entityId: order.entityId,
        payload: {
          requestId: request.publicId,
          orderId: order.publicId,
          amount: formatMoney(amount),
          kind: input.cnKind,
        },
      },
      actor,
    );
    return request;
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'receivables.credit_note_approvals',
  })
  async onApproval(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const approval = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!approval) return;
    const request = await tx.creditNoteRequest.findUnique({
      where: { id: approval.subjectId },
      include: { reason: true },
    });
    if (!request || request.status !== 'pending_approval') return;
    if (event.type !== 'approval.approved') {
      await tx.creditNoteRequest.update({
        where: { id: request.id },
        data: {
          status: event.type === 'approval.withdrawn' ? 'withdrawn' : 'rejected',
          decidedAt: new Date(),
        },
      });
      return;
    }
    await this.issueApproved(tx, request, approval);
  }

  private async issueApproved(
    tx: Tx,
    request: Prisma.CreditNoteRequestGetPayload<{ include: { reason: true } }>,
    approval: ApprovalRequest,
  ) {
    await tx.$executeRaw`SAVEPOINT issue_cn`;
    try {
      const doc = await this.issue(
        tx,
        {
          orderId: request.orderId,
          cnKind: request.cnKind,
          reasonCode: request.reason.code,
          gross: D(request.amount),
          settleTo: request.settleTo,
          note: request.note,
          approvalRequestId: approval.id,
          createdById: request.requestedById,
        },
        systemActor('receivables.credit_notes'),
      );
      await tx.$executeRaw`RELEASE SAVEPOINT issue_cn`;
      await tx.creditNoteRequest.update({
        where: { id: request.id },
        data: { status: 'issued', customerDocumentId: doc.id, decidedAt: new Date() },
      });
      if (request.claimId) {
        const resolution = await tx.claimResolution.findFirst({
          where: {
            claimId: request.claimId,
            action: { in: ['credit_note', 'store_credit'] },
            customerDocumentId: null,
          },
        });
        if (resolution)
          await tx.claimResolution.update({
            where: { id: resolution.id },
            data: { customerDocumentId: doc.id },
          });
      }
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
      // The order changed since the request (e.g. a larger credit already issued): the request cannot apply.
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT issue_cn`;
      await tx.creditNoteRequest.update({
        where: { id: request.id },
        data: { status: 'rejected', decidedAt: new Date() },
      });
    }
  }

  /** Claims resolved with a credit note or store credit (B4.5 `claim.*_requested`) become requests. */
  @OnDomainEvent(['claim.credit_note_requested', 'claim.store_credit_requested'], {
    consumer: 'receivables.claim_credits',
  })
  async onClaimCredit(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const claim = await tx.claim.findUnique({
      where: { publicId: event.aggregateId },
      include: { order: true },
    });
    if (!claim || event.actor.type !== 'user' || !event.actor.userId) return;
    const user = await tx.user.findUniqueOrThrow({ where: { id: BigInt(event.actor.userId) } });
    const actor: UserActor = {
      type: 'user',
      userId: user.id,
      publicId: user.publicId,
      audience: 'staff',
      scopes: [],
    };
    await this.requestIn(
      tx,
      actor,
      claim.order.publicId,
      {
        amount: String(event.payload['amount']),
        cnKind: 'claim',
        settleTo: event.type === 'claim.store_credit_requested' ? 'store_credit' : undefined,
        note: `เคลม ${claim.claimNo}`,
      },
      claim.id,
    );
  }

  async getRequest(publicId: string) {
    const row = await this.prisma.creditNoteRequest.findUnique({
      where: { publicId },
      include: CN_REQUEST_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async listRequests(status: string | undefined, page: number, perPage: number) {
    const where: Prisma.CreditNoteRequestWhereInput = status ? { status: status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.creditNoteRequest.findMany({
        where,
        include: CN_REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.creditNoteRequest.count({ where }),
    ]);
    return { rows, total };
  }
}
