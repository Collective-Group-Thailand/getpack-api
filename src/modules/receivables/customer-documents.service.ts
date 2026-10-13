import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type CreditNoteKind,
  type CreditSettlement,
  type CustomerDocument,
  type CustomerDocumentKind,
  type DocumentLinkKind,
  type Prisma,
  type ReceiptVia,
  type RevenueCategory,
  type TaxNature,
} from '@generated/prisma/client';
import { dateOnly, dayOf } from '@common/ledger-core/dates';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);

export const DOCUMENT_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  customer: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, companyCode: true } },
  orderGroup: { select: { publicId: true, groupCode: true } },
  order: { select: { publicId: true, orderCode: true } },
  payment: { select: { publicId: true, referenceCode: true } },
  originalDocument: { select: { publicId: true, docNumber: true, docType: true } },
  creditNoteReason: { select: { code: true, nameTh: true, nameEn: true, statutoryCategory: true } },
  receivableItem: true,
  pdfFile: { select: { publicId: true } },
  links: { include: { linkedDocument: { select: { publicId: true, docNumber: true, docType: true } } } },
} as const satisfies Prisma.CustomerDocumentInclude;
export type DocumentRow = Prisma.CustomerDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

export interface DocumentLineDraft {
  description: string;
  orderId?: bigint | null;
  orderLineId?: bigint | null;
  quantity?: string;
  unitPrice?: string;
  net: MoneyValue;
  discount?: MoneyValue;
  vatRatePct: string;
  vat: MoneyValue;
  wht?: MoneyValue;
  revenueCategory?: RevenueCategory | null;
  taxNature?: TaxNature | null;
}

/** Buyer as printed on the document (a snapshot: it never changes after issue, PDPA §1.6). */
export interface BuyerSnapshot {
  name: string;
  taxId: string | null;
  branchCode: string | null;
  branchType: string | null;
  address: string | null;
  taxType: string;
  withholdsTax: boolean;
  documentEmail: string | null;
}

export interface SellerSnapshot {
  legalNameTh: string | null;
  legalNameEn: string | null;
  taxId: string | null;
  branchCode: string | null;
  addressTh: string | null;
  phone: string | null;
  settingVersionIds: Record<string, string>;
}

/** Extra fields the posting rules read (ADR-0007 event catalogue, `customer_document.issued`). */
export interface PostingFields {
  appliedAdvanceNet?: string;
  remainingNet?: string;
  remainingVat?: string;
  remainingGross?: string;
  vatDue?: boolean;
  revenue?: { category: string; net: string; productTypeId: string | null; orderId: string | null }[];
  discounts?: {
    source: string;
    category: string;
    amount: string;
    campaignId: string | null;
    promotionId: string | null;
    productTypeId: string | null;
    orderId: string | null;
  }[];
  vatNotDueAmount?: string;
  vatNotDueBase?: string;
  revenueStage?: 'advance' | 'recognised';
  vatStage?: 'due' | 'not_due';
  settleTo?: CreditSettlement;
}

export interface DocumentDraft {
  entityId: bigint;
  docType: 'iv' | 'tr' | 'rc' | 'cn' | 'dn';
  docKind: CustomerDocumentKind;
  documentDate: string;
  isTaxInvoice: boolean;
  customerUserId: bigint;
  companyId?: bigint | null;
  companyBranchId?: bigint | null;
  buyer: BuyerSnapshot;
  isFullForm: boolean;
  orderGroupId?: bigint | null;
  orderId?: bigint | null;
  paymentId?: bigint | null;
  originalDocumentId?: bigint | null;
  creditNoteReasonId?: bigint | null;
  cnKind?: CreditNoteKind | null;
  receiptVia?: ReceiptVia | null;
  taxNature?: TaxNature | null;
  lines: DocumentLineDraft[];
  /** Receipts: the customer paid gross − WHT in cash. */
  isReceipt?: boolean;
  deductedPrior?: MoneyValue;
  amountDue?: MoneyValue;
  dueDate?: string | null;
  /** Receivable item for `amountDue` (VAT not yet due on it for a hire-of-work invoice). */
  receivable?: { vatNotDueAmount: MoneyValue; vatNotDueBase: MoneyValue } | null;
  links?: { documentId: bigint; kind: DocumentLinkKind; amount?: MoneyValue | null }[];
  posting?: PostingFields;
  approvalRequestId?: bigint | null;
  createdById?: bigint | null;
}

const ENTITY_KEYS = {
  legalNameTh: 'entity.legal_name_th',
  legalNameEn: 'entity.legal_name_en',
  taxId: 'entity.tax_id',
  branchCode: 'entity.branch_code',
  addressTh: 'entity.address_th',
  phone: 'entity.phone',
} as const;

/**
 * The customer document engine (accounting-design §4, B5.2): every IV, TR, RC, CN and DN is issued here — a
 * gapless number from the entity's series in the issuing transaction, the seller data from the entity's
 * settings (D-092, never code) and the buyer snapshot, lines with the §2.9 amounts, links to the documents it
 * deducts / credits / collects, the AR item of what is still owed, the 50 ทวิ to collect when the customer
 * withheld, and one `customer_document.issued` event carrying everything the posting rules need (ADR-0007).
 */
@Injectable()
export class CustomerDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
  ) {}

  async issue(tx: Tx, draft: DocumentDraft, actor: Actor): Promise<CustomerDocument> {
    if (draft.lines.length === 0) throw new Error('a document needs at least one line');
    const totals = draft.lines.reduce(
      (a, l) => ({
        net: a.net.add(l.net),
        discount: a.discount.add(l.discount ?? 0),
        vat: a.vat.add(l.vat),
        wht: a.wht.add(l.wht ?? 0),
      }),
      { net: ZERO(), discount: ZERO(), vat: ZERO(), wht: ZERO() },
    );
    const gross = totals.net.sub(totals.discount).add(totals.vat);
    const cash = draft.isReceipt ? gross.sub(totals.wht) : ZERO();
    const at = dateOnly(draft.documentDate);
    const docNumber = await this.numbering.next(tx, draft.docType, at, draft.entityId);
    const seller = await this.seller(tx, draft.entityId, new Date());
    const doc = await tx.customerDocument.create({
      data: {
        entityId: draft.entityId,
        docType: draft.docType,
        docKind: draft.docKind,
        docNumber,
        documentDate: at,
        taxPointDate: draft.isTaxInvoice ? at : null,
        isTaxInvoice: draft.isTaxInvoice,
        isFullForm: draft.isFullForm,
        customerUserId: draft.customerUserId,
        companyId: draft.companyId ?? null,
        companyBranchId: draft.companyBranchId ?? null,
        buyerSnapshot: draft.buyer as unknown as Prisma.InputJsonValue,
        sellerSnapshot: seller as unknown as Prisma.InputJsonValue,
        orderGroupId: draft.orderGroupId ?? null,
        orderId: draft.orderId ?? null,
        paymentId: draft.paymentId ?? null,
        originalDocumentId: draft.originalDocumentId ?? null,
        creditNoteReasonId: draft.creditNoteReasonId ?? null,
        cnKind: draft.cnKind ?? null,
        receiptVia: draft.receiptVia ?? null,
        taxNature: draft.taxNature ?? null,
        netAmount: formatMoney(totals.net),
        discountAmount: formatMoney(totals.discount),
        vatRatePct: draft.lines[0]!.vatRatePct,
        vatAmount: formatMoney(totals.vat),
        grossAmount: formatMoney(gross),
        whtAmount: formatMoney(totals.wht),
        cashAmount: formatMoney(cash),
        deductedPriorAmount: formatMoney(draft.deductedPrior ?? 0),
        amountDue: formatMoney(draft.amountDue ?? 0),
        dueDate: draft.dueDate ? dateOnly(draft.dueDate) : null,
        eTaxStatus: 'not_applicable',
        approvalRequestId: draft.approvalRequestId ?? null,
        createdById: draft.createdById ?? null,
        lines: {
          create: draft.lines.map((l, i) => {
            const discount = l.discount ?? ZERO();
            return {
              lineNo: i + 1,
              orderId: l.orderId ?? null,
              orderLineId: l.orderLineId ?? null,
              description: l.description.slice(0, 500),
              quantity: l.quantity ?? '1',
              unitPrice: l.unitPrice ?? l.net.toFixed(6),
              netAmount: formatMoney(l.net),
              discountAmount: formatMoney(discount),
              vatRatePct: l.vatRatePct,
              vatAmount: formatMoney(l.vat),
              grossAmount: formatMoney(l.net.sub(discount).add(l.vat)),
              whtAmount: formatMoney(l.wht ?? 0),
              revenueCategory: l.revenueCategory ?? null,
              taxNature: l.taxNature ?? null,
            };
          }),
        },
      },
    });
    for (const link of draft.links ?? []) {
      await tx.customerDocumentLink.create({
        data: {
          documentId: doc.id,
          linkedDocumentId: link.documentId,
          kind: link.kind,
          amount: link.amount ? formatMoney(link.amount) : null,
        },
      });
    }
    if (draft.amountDue && draft.amountDue.gt(0)) {
      await tx.receivableItem.create({
        data: {
          entityId: draft.entityId,
          customerUserId: draft.customerUserId,
          companyId: draft.companyId ?? null,
          customerDocumentId: doc.id,
          orderId: draft.orderId ?? null,
          dueDate: dateOnly(draft.dueDate ?? draft.documentDate),
          amount: formatMoney(draft.amountDue),
          openAmount: formatMoney(draft.amountDue),
          vatNotDueAmount: formatMoney(draft.receivable?.vatNotDueAmount ?? 0),
          vatNotDueBase: formatMoney(draft.receivable?.vatNotDueBase ?? 0),
        },
      });
    }
    if (draft.isReceipt && totals.wht.gt(0)) {
      const whtBase = draft.lines
        .filter((l) => (l.wht ?? ZERO()).gt(0))
        .reduce((a, l) => a.add(l.net).sub(l.discount ?? 0), ZERO());
      await tx.customerWhtCertificate.create({
        data: {
          entityId: draft.entityId,
          customerDocumentId: doc.id,
          paymentId: draft.paymentId ?? null,
          customerUserId: draft.customerUserId,
          companyId: draft.companyId ?? null,
          whtBase: formatMoney(MoneyDecimal.max(whtBase, totals.wht)),
          whtAmount: formatMoney(totals.wht),
        },
      });
    }
    await this.publish(tx, doc, draft, totals, actor);
    return doc;
  }

  /** The entity's registered data in force now, with the setting versions used (D-092). */
  async seller(tx: Tx, entityId: bigint, at: Date): Promise<SellerSnapshot> {
    const out: SellerSnapshot = {
      legalNameTh: null,
      legalNameEn: null,
      taxId: null,
      branchCode: null,
      addressTh: null,
      phone: null,
      settingVersionIds: {},
    };
    for (const [field, key] of Object.entries(ENTITY_KEYS) as [keyof typeof ENTITY_KEYS, string][]) {
      try {
        const resolved = await this.settings.at(key as never, {
          at,
          scope: { type: 'entity', id: entityId },
          tx,
        });
        out[field] = String(resolved.value);
        out.settingVersionIds[key] = resolved.versionId.toString();
      } catch (error) {
        if (!(error instanceof SettingNotFoundError)) throw error;
      }
    }
    return out;
  }

  /** Buyer of an order group: its tax profile snapshot (full form) or the customer and billing address. */
  async buyerOfGroup(tx: Tx, groupId: bigint): Promise<{ buyer: BuyerSnapshot; fullForm: boolean }> {
    const group = await tx.orderGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: { customer: { select: { displayName: true, email: true } } },
    });
    const tax = group.taxProfileSnapshot as {
      name: string;
      taxId: string;
      branchCode: string;
      branchType: string;
      address: string;
      taxType: string;
      withholdsTax: boolean;
      documentEmail: string | null;
    } | null;
    if (tax) {
      return {
        buyer: {
          name: tax.name,
          taxId: tax.taxId,
          branchCode: tax.branchCode,
          branchType: tax.branchType,
          address: tax.address,
          taxType: tax.taxType,
          withholdsTax: tax.withholdsTax,
          documentEmail: tax.documentEmail,
        },
        fullForm: true,
      };
    }
    const billing = group.billingAddressSnapshot as {
      address?: string;
      line1?: string;
      recipientName?: string;
    } | null;
    return {
      buyer: {
        name: group.customer.displayName,
        taxId: null,
        branchCode: null,
        branchType: null,
        address: billing?.address ?? billing?.line1 ?? null,
        taxType: 'individual',
        withholdsTax: false,
        documentEmail: null,
      },
      fullForm: false,
    };
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<DocumentRow> {
    const doc = await db.customerDocument.findUnique({ where: { publicId }, include: DOCUMENT_INCLUDE });
    if (!doc) throw new DomainException('http.not_found');
    return doc;
  }

  async list(where: Prisma.CustomerDocumentWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.customerDocument.findMany({
        where,
        include: DOCUMENT_INCLUDE,
        orderBy: [{ documentDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.customerDocument.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Sends an issued document to its customer again (U-B0.3, D-143): `customer_document.sent` is routed by the
   * notification matrix (e-mail, LINE when linked); the PDF is downloaded from the customer's account. Audited.
   */
  async send(actor: UserActor, publicId: string): Promise<{ eventId: string; at: Date }> {
    return this.prisma.withTx(async (tx) => {
      const doc = await tx.customerDocument.findUnique({
        where: { publicId },
        include: { customer: { select: { publicId: true } } },
      });
      if (!doc) throw new DomainException('http.not_found');
      if (doc.status === 'void')
        throw new DomainException('receivables.document_not_voidable', { params: { reason: 'it is void' } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_document.sent',
        actor,
        resourceType: 'customer_document',
        resourcePublicId: doc.publicId,
        entityId: doc.entityId,
        data: { docNumber: doc.docNumber },
      });
      const event = await this.events.record(
        tx,
        {
          type: 'customer_document.sent',
          aggregateType: 'customer_document',
          aggregateId: doc.publicId,
          entityId: doc.entityId,
          payload: {
            documentId: doc.publicId,
            docType: doc.docType,
            docNumber: doc.docNumber,
            customerId: doc.customer.publicId,
            kind: 'resent',
          },
        },
        actor,
      );
      return { eventId: event.id, at: new Date(event.occurredAt) };
    });
  }

  /** Where a document went: the notifications of its `customer_document.sent` events, newest first. */
  async deliveries(publicId: string) {
    const doc = await this.prisma.customerDocument.findUnique({ where: { publicId }, select: { id: true } });
    if (!doc) throw new DomainException('http.not_found');
    return this.prisma.notification.findMany({
      where: {
        event: { aggregateType: 'customer_document', aggregateId: publicId, type: 'customer_document.sent' },
      },
      include: { event: { select: { payload: true, occurredAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The D-122 reminders sent for receivables, with the notifications each fanned out to (U-B0.3). */
  async dunningLog(where: Prisma.DunningNoticeWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.dunningNotice.findMany({
        where,
        include: {
          receivableItem: {
            select: {
              customerDocument: { select: { publicId: true, docNumber: true } },
              customer: { select: { publicId: true, displayName: true } },
              company: { select: { publicId: true } },
            },
          },
        },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.dunningNotice.count({ where }),
    ]);
    const eventIds = rows.flatMap((r) => (r.domainEventId ? [r.domainEventId] : []));
    const notifications = eventIds.length
      ? await this.prisma.notification.findMany({
          where: { eventId: { in: eventIds }, channel: { not: 'in_app' } },
          orderBy: { id: 'asc' },
        })
      : [];
    return { rows, notifications, total };
  }

  /**
   * Voids an invoice or debit note nothing has been collected on: the number stays with its reason and the
   * ledger reverses the document's journals. Tax invoices and receipts are corrected by credit notes (§2).
   */
  async void(actor: UserActor, publicId: string, reason: string): Promise<DocumentRow> {
    await this.prisma.withTx(async (tx) => {
      const doc = await tx.customerDocument.findUnique({
        where: { publicId },
        include: { receivableItem: true },
      });
      if (!doc) throw new DomainException('http.not_found');
      if (doc.status === 'void' || !['iv', 'dn'].includes(doc.docType))
        throw new DomainException('receivables.document_not_voidable', {
          params: {
            reason:
              doc.status === 'void'
                ? 'already void'
                : 'tax invoices and receipts are corrected by credit notes',
          },
        });
      const item = doc.receivableItem;
      if (item && (item.status !== 'open' || !D(item.openAmount).eq(item.amount.toString())))
        throw new DomainException('receivables.document_not_voidable', {
          params: { reason: 'money was applied to it' },
        });
      await tx.customerDocument.update({
        where: { id: doc.id },
        data: { status: 'void', voidReason: reason, voidedAt: new Date(), voidedById: actor.userId },
      });
      if (item)
        await tx.receivableItem.update({
          where: { id: item.id },
          data: { status: 'cancelled', openAmount: '0.00', rowVersion: { increment: 1 } },
        });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_document.voided',
        actor,
        resourceType: 'customer_document',
        resourcePublicId: doc.publicId,
        entityId: doc.entityId,
        data: { docNumber: doc.docNumber, reason },
      });
      const event = await this.events.record(
        tx,
        {
          type: 'customer_document.voided',
          aggregateType: 'customer_document',
          aggregateId: doc.publicId,
          entityId: doc.entityId,
          payload: {
            documentId: doc.publicId,
            docType: doc.docType,
            docNumber: doc.docNumber,
            reason,
            sourceType: 'customer_document',
            sourceId: doc.publicId,
          },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'customer_document',
        aggregatePublicId: doc.publicId,
        action: 'customer_document.voided',
        messageKey: 'activity.customer_document.voided',
        messageParams: { docNumber: doc.docNumber, reason },
        visibility: ['internal', 'customer'],
        entityId: doc.entityId,
        domainEventId: event.id,
        actor,
      });
    });
    return this.get(publicId);
  }

  private async publish(
    tx: Tx,
    doc: CustomerDocument,
    draft: DocumentDraft,
    totals: { net: MoneyValue; discount: MoneyValue; vat: MoneyValue; wht: MoneyValue },
    actor: Actor,
  ) {
    const pub = async <T extends { publicId: string }>(find: () => Promise<T | null>) =>
      (await find())?.publicId ?? null;
    const [customer, company, group, order] = await Promise.all([
      pub(() => tx.user.findUnique({ where: { id: draft.customerUserId }, select: { publicId: true } })),
      draft.companyId
        ? pub(() => tx.company.findUnique({ where: { id: draft.companyId! }, select: { publicId: true } }))
        : null,
      draft.orderGroupId
        ? tx.orderGroup.findUnique({
            where: { id: draft.orderGroupId },
            select: { publicId: true, channel: true },
          })
        : null,
      draft.orderId
        ? pub(() => tx.order.findUnique({ where: { id: draft.orderId! }, select: { publicId: true } }))
        : null,
    ]);
    const taxable = totals.net.sub(totals.discount);
    const whtBase = draft.lines
      .filter((l) => (l.wht ?? ZERO()).gt(0))
      .reduce((a, l) => a.add(l.net).sub(l.discount ?? 0), ZERO());
    const event = await this.events.record(
      tx,
      {
        type: 'customer_document.issued',
        aggregateType: 'customer_document',
        aggregateId: doc.publicId,
        entityId: doc.entityId,
        payload: {
          documentId: doc.publicId,
          docType: doc.docType,
          docKind: doc.docKind,
          docNumber: doc.docNumber,
          documentDate: dayOf(doc.documentDate),
          isTaxInvoice: doc.isTaxInvoice,
          taxNature: doc.taxNature,
          cnKind: doc.cnKind,
          receiptVia: doc.receiptVia,
          customerId: customer,
          companyId: company,
          orderGroupId: group?.publicId ?? null,
          orderId: order,
          channel: group?.channel ?? null,
          netAmount: formatMoney(taxable),
          vatAmount: formatMoney(totals.vat),
          grossAmount: doc.grossAmount.toFixed(2),
          whtAmount: formatMoney(totals.wht),
          whtBase: formatMoney(whtBase),
          cashAmount: doc.cashAmount.toFixed(2),
          amountDue: doc.amountDue.toFixed(2),
          ...draft.posting,
          discountTotal: formatMoney(
            (draft.posting?.discounts ?? []).reduce((a, d) => a.add(d.amount), ZERO()),
          ),
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: group ? 'order_group' : 'customer_document',
      aggregatePublicId: group?.publicId ?? doc.publicId,
      action: 'customer_document.issued',
      messageKey: 'activity.customer_document.issued',
      messageParams: {
        docType: doc.docType,
        docNumber: doc.docNumber,
        grossAmount: doc.grossAmount.toFixed(2),
      },
      visibility: ['internal', 'customer'],
      entityId: doc.entityId,
      domainEventId: event.id,
      actor,
    });
  }

  static system = systemActor('receivables');
}
