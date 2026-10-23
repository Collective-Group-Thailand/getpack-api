import { createHash } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addMonths, dateOnly, dayOf } from '@common/ledger-core/dates';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { startOfBangkokMonth, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { toPdfA3 } from '@integrations/pdf/pdfa3';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import {
  DocumentBrandingService,
  signingKindOfCustomerDocument,
} from '@modules/documents/branding/document-branding.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { FilesService } from '@platform/files/files.service';

import {
  type BuyerSnapshot,
  CustomerDocumentsService,
  type SellerSnapshot,
} from './customer-documents.service';
import {
  eTaxTypeCode,
  type RenderableDocument,
  renderDocumentHtml,
  renderETaxXml,
  renderStatementHtml,
  REPLACEMENT_REASON_TH,
} from './document-render';
import { ETaxEmailService } from './etax-email.service';

const PDF = 'application/pdf';
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

type DocWithLines = Prisma.CustomerDocumentGetPayload<{
  include: { lines: true; originalDocument: true; creditNoteReason: true; replaces: true };
}>;

const RENDER_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  originalDocument: true,
  creditNoteReason: true,
  replaces: true,
} as const satisfies Prisma.CustomerDocumentInclude;

/** The name the ETDA XML carries inside the PDF/A-3 (e-Tax by Email). */
const ETDA_XML_NAME = 'ETDA-invoice.xml';

/**
 * Files of customer documents (B5.2): the PDF of every issued document — Thai, Buddhist-era dates, amount in
 * words, the seller from the entity snapshot — and, for tax invoices, the e-Tax XML (D-091: generated now and
 * embedded in the PDF as an attachment, sent from R2 behind the `e_tax.sending` flag). Company statements
 * (D-125) are rendered monthly from the receivables.
 */
@Injectable()
export class DocumentFilesService {
  private readonly logger = new Logger(DocumentFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly flags: FeatureFlagsService,
    private readonly events: DomainEvents,
    private readonly documents: CustomerDocumentsService,
    private readonly branding: DocumentBrandingService,
    private readonly eTax: ETaxEmailService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  static renderable(doc: DocWithLines): RenderableDocument {
    const seller = doc.sellerSnapshot as unknown as SellerSnapshot;
    const buyer = doc.buyerSnapshot as unknown as BuyerSnapshot;
    return {
      docType: doc.docType,
      docKind: doc.docKind,
      docNumber: doc.docNumber,
      documentDate: dayOf(doc.documentDate),
      dueDate: doc.dueDate ? dayOf(doc.dueDate) : null,
      isTaxInvoice: doc.isTaxInvoice,
      isFullForm: doc.isFullForm,
      status: doc.status,
      voidReason: doc.voidReason,
      seller,
      buyer,
      reference: doc.originalDocument
        ? {
            docNumber: doc.originalDocument.docNumber,
            reason: doc.creditNoteReason?.nameTh ?? null,
            documentDate: dayOf(doc.originalDocument.documentDate),
            docType: doc.originalDocument.docType,
          }
        : null,
      replaces: doc.replaces
        ? {
            docNumber: doc.replaces.docNumber,
            documentDate: dayOf(doc.replaces.documentDate),
            reason: `${REPLACEMENT_REASON_TH[doc.replacementReason ?? 'other'] ?? ''}${doc.replacementNote ? ` (${doc.replacementNote})` : ''}`,
          }
        : null,
      lines: doc.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: D(l.unitPrice).toFixed(2),
        net: l.netAmount.toFixed(2),
        discount: l.discountAmount.toFixed(2),
        vat: l.vatAmount.toFixed(2),
        gross: l.grossAmount.toFixed(2),
      })),
      net: doc.netAmount.toFixed(2),
      discount: doc.discountAmount.toFixed(2),
      vat: doc.vatAmount.toFixed(2),
      vatRatePct: doc.vatRatePct.toString(),
      gross: doc.grossAmount.toFixed(2),
      deductedPrior: doc.deductedPriorAmount.toFixed(2),
      amountDue: doc.amountDue.toFixed(2),
      wht: doc.whtAmount.toFixed(2),
      cash: doc.cashAmount.toFixed(2),
      receiptVia: doc.receiptVia,
    };
  }

  /** Scheduled (and after issue in tests): renders the documents that have no PDF yet. */
  async renderPending(limit = 50): Promise<number> {
    const pending = await this.prisma.customerDocument.findMany({
      where: { pdfFileId: null },
      include: RENDER_INCLUDE,
      orderBy: { id: 'asc' },
      take: limit,
    });
    let done = 0;
    for (const doc of pending) {
      try {
        await this.render(doc);
        done++;
      } catch (error) {
        this.logger.error(`PDF of ${doc.docNumber} failed: ${(error as Error).message}`);
      }
    }
    return done;
  }

  /**
   * The document's PDF: rendered with the branding in force at its issue (D-428/D-429); a tax document is a
   * PDF/A-3 carrying its ETDA XML (D-430) and, while e-Tax sending is on, queued for e-Tax by Email.
   */
  private async render(doc: DocWithLines) {
    const { pdf, xml } = await this.produce(doc);
    let xmlFileId: bigint | null = null;
    if (xml) {
      const stored = await this.files.storeSystem({
        body: xml,
        fileName: `${doc.docNumber}.xml`,
        mimeType: 'application/xml',
        retentionClass: 'financial_record',
        ownerUserId: doc.customerUserId,
      });
      xmlFileId = stored.id;
    }
    const file = await this.files.storeSystem({
      body: pdf,
      fileName: `${doc.docNumber}.pdf`,
      mimeType: PDF,
      retentionClass: 'financial_record',
      ownerUserId: doc.customerUserId,
    });
    const sending = xmlFileId !== null && (await this.flags.isEnabled('e_tax.sending'));
    await this.prisma.withTx(async (tx) => {
      await tx.customerDocument.update({
        where: { id: doc.id },
        data: {
          pdfFileId: file.id,
          pdfSha256: new Uint8Array(createHash('sha256').update(pdf).digest()),
          eTaxXmlFileId: xmlFileId,
          eTaxStatus: 'not_applicable',
        },
      });
      if (sending) await this.eTax.queue(tx, doc, file.id, { referenceNumber: this.eTaxReference(doc) });
      await this.events.record(
        tx,
        {
          type: 'customer_document.rendered',
          aggregateType: 'customer_document',
          aggregateId: doc.publicId,
          entityId: doc.entityId,
          payload: { documentId: doc.publicId, docNumber: doc.docNumber, docType: doc.docType },
        },
        systemActor('receivables.pdf'),
      );
    });
  }

  /** Scheduled: cancelled copies of replaced documents not made yet (a failure after the replacement). */
  async renderCancelledPending(limit = 20): Promise<number> {
    const rows = await this.prisma.customerDocument.findMany({
      where: { status: 'void', cancelledPdfFileId: null, replacedBy: { isNot: null } },
      select: { id: true },
      take: limit,
    });
    for (const r of rows) await this.renderCancelledCopy(r.id);
    return rows.length;
  }

  /**
   * D-431: the cancelled copy of a replaced document — the same document stamped "ยกเลิก" with the reason —
   * kept beside the original PDF and, when the original went out by e-Tax e-mail, sent as its cancellation (CIV).
   */
  async renderCancelledCopy(documentId: bigint): Promise<void> {
    const doc = await this.prisma.customerDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { ...RENDER_INCLUDE, eTaxSubmissions: true, replacedBy: true },
    });
    if (doc.cancelledPdfFileId || doc.status !== 'void') return;
    const { pdf } = await this.produce(doc);
    const file = await this.files.storeSystem({
      body: pdf,
      fileName: `${doc.docNumber}-cancelled.pdf`,
      mimeType: PDF,
      retentionClass: 'financial_record',
      ownerUserId: doc.customerUserId,
    });
    const wentOut = doc.eTaxSubmissions.some((s) => s.kind !== 'civ' && s.status === 'sent');
    await this.prisma.withTx(async (tx) => {
      await tx.customerDocument.update({ where: { id: doc.id }, data: { cancelledPdfFileId: file.id } });
      if (wentOut) await this.eTax.queue(tx, doc, file.id, { kind: 'civ' });
    });
  }

  /** HTML → PDF with branding; a tax document becomes PDF/A-3 with its ETDA XML inside. */
  private async produce(doc: DocWithLines): Promise<{ pdf: Buffer; xml: Buffer | null }> {
    const view = DocumentFilesService.renderable(doc);
    view.branding = await this.branding.resolve(
      { kind: 'entity', id: doc.entityId },
      signingKindOfCustomerDocument(doc.docType, doc.isTaxInvoice),
      doc.issuedAt,
    );
    const html = renderDocumentHtml(view);
    const pdf = await this.renderer.render(html);
    if (!doc.isTaxInvoice) return { pdf, xml: null };
    const xml = Buffer.from(
      renderETaxXml({
        ...view,
        typeCode: eTaxTypeCode(view),
        issuedAt: toBangkokIso(doc.issuedAt),
        replacesCode: doc.replacementReason,
      }),
      'utf8',
    );
    return { pdf: await this.pdfA3(pdf, xml, doc, view), xml };
  }

  /** PDF/A-3b with the XML as an associated file (skipped when the renderer is not a real PDF, as in tests). */
  private async pdfA3(
    pdf: Buffer,
    xml: Buffer,
    doc: DocWithLines,
    view: RenderableDocument,
  ): Promise<Buffer> {
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return pdf;
    try {
      return await toPdfA3(pdf, {
        title: `${doc.docNumber}`,
        author: view.seller.legalNameTh ?? view.seller.legalNameEn ?? 'getpack',
        subject: `${doc.docType.toUpperCase()} ${doc.docNumber}`,
        createdAt: doc.issuedAt,
        attachments: [
          {
            name: ETDA_XML_NAME,
            mimeType: 'text/xml',
            body: xml,
            description: 'e-Tax invoice XML (ETDA ขมธอ. 3-2560)',
          },
        ],
      });
    } catch (error) {
      this.logger.error(`PDF/A-3 of ${doc.docNumber} failed: ${(error as Error).message}`);
      return pdf;
    }
  }

  /** The number an e-Tax subject cites after the document's own: the replaced invoice, or a note's invoice. */
  private eTaxReference(doc: DocWithLines): string | null {
    if (doc.replaces) return doc.replaces.docNumber;
    if (doc.docType === 'cn' || doc.docType === 'dn') return doc.originalDocument?.docNumber ?? null;
    return null;
  }

  async downloadUrl(fileId: bigint | null): Promise<{ url: string; expiresAt: Date }> {
    if (!fileId) throw new DomainException('file.not_ready');
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.purgedAt) throw new DomainException('http.not_found');
    const url = await this.storage.presignGet(file.storageKey, {
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      fileName: file.originalName,
      contentType: file.mimeType,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000) };
  }

  // --- company statements (D-125) ------------------------------------------------------------------------

  @OnDomainEvent('company.statement_ready', { consumer: 'receivables.company_statements' })
  async onStatementReady(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const company = await tx.company.findUnique({ where: { publicId: event.aggregateId } });
    const month = typeof event.payload['month'] === 'string' ? event.payload['month'] : '';
    if (!company || !/^\d{4}-\d{2}$/.test(month)) return;
    await this.statement(tx, company.id, month);
  }

  /** The month's statement of a company from its receivables: opening, invoiced, paid, credited, closing. */
  async statement(tx: Tx, companyId: bigint, month: string) {
    const first = `${month}-01`;
    const existing = await tx.companyStatement.findUnique({
      where: { companyId_periodMonth: { companyId, periodMonth: dateOnly(first) } },
    });
    if (existing) return existing;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const from = startOfBangkokMonth(new Date(`${first}T12:00:00+07:00`));
    const to = startOfBangkokMonth(new Date(`${addMonths(first, 1)}T12:00:00+07:00`));
    const items = await tx.receivableItem.findMany({
      where: { companyId },
      include: { customerDocument: true, applications: { include: { document: true } } },
    });
    let opening = D(0);
    let invoiced = D(0);
    let paid = D(0);
    let credited = D(0);
    const lines: { date: string; docNumber: string; description: string; debit: string; credit: string }[] =
      [];
    for (const item of items) {
      const created = item.createdAt;
      if (created < from) opening = opening.add(item.amount.toString());
      else if (created < to) {
        invoiced = invoiced.add(item.amount.toString());
        lines.push({
          date: dayOf(item.customerDocument.documentDate),
          docNumber: item.customerDocument.docNumber,
          description: 'ใบแจ้งหนี้',
          debit: item.amount.toFixed(2),
          credit: '0.00',
        });
      }
      for (const a of item.applications) {
        const isCredit = a.document?.docType === 'cn';
        if (a.appliedAt < from) opening = opening.sub(a.amount.toString());
        else if (a.appliedAt < to) {
          if (isCredit) credited = credited.add(a.amount.toString());
          else paid = paid.add(a.amount.toString());
          lines.push({
            date: a.document ? dayOf(a.document.documentDate) : dayOf(a.appliedAt),
            docNumber: a.document?.docNumber ?? '-',
            description: isCredit ? 'ลดหนี้' : 'รับชำระ',
            debit: '0.00',
            credit: a.amount.toFixed(2),
          });
        }
      }
      if (item.status === 'written_off' && item.writtenOffAt) {
        const open = D(item.amount).sub(item.applications.reduce((s, a) => s.add(a.amount.toString()), D(0)));
        if (item.writtenOffAt < from) opening = opening.sub(open);
        else if (item.writtenOffAt < to) {
          credited = credited.add(open);
          lines.push({
            date: dayOf(item.writtenOffAt),
            docNumber: item.customerDocument.docNumber,
            description: 'ตัดหนี้สูญ',
            debit: '0.00',
            credit: formatMoney(open),
          });
        }
      }
    }
    lines.sort((a, b) => a.date.localeCompare(b.date));
    const closing = opening.add(invoiced).sub(paid).sub(credited);
    const seller = await this.documents.seller(tx, company.entityId, new Date());
    const branding = await this.branding.resolve(
      { kind: 'entity', id: company.entityId },
      'statement',
      new Date(),
      tx,
    );
    const body = await this.renderer.render(
      renderStatementHtml({
        branding,
        companyName: company.legalName,
        companyCode: company.companyCode,
        month,
        seller,
        opening: formatMoney(opening),
        invoiced: formatMoney(invoiced),
        paid: formatMoney(paid),
        credited: formatMoney(credited),
        closing: formatMoney(closing),
        lines,
      }),
    );
    const file = await this.files.storeSystem({
      body,
      fileName: `statement-${company.companyCode ?? company.publicId}-${month}.pdf`,
      mimeType: PDF,
      retentionClass: 'financial_record',
      ownerUserId: null,
    });
    return tx.companyStatement.create({
      data: {
        entityId: company.entityId,
        companyId,
        periodMonth: dateOnly(first),
        opening: formatMoney(opening),
        invoiced: formatMoney(invoiced),
        paid: formatMoney(paid),
        credited: formatMoney(credited),
        closing: formatMoney(closing),
        lines: lines,
        fileObjectId: file.id,
      },
    });
  }
}
