import { createHash } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { startOfBangkokMonth, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { addMonths, dateOnly, dayOf } from '@common/ledger-core/dates';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { FilesService } from '@platform/files/files.service';
import { PDFDocument } from 'pdf-lib';

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
} from './document-render';

const PDF = 'application/pdf';
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

type DocWithLines = Prisma.CustomerDocumentGetPayload<{
  include: { lines: true; originalDocument: true; creditNoteReason: true };
}>;

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
        ? { docNumber: doc.originalDocument.docNumber, reason: doc.creditNoteReason?.nameTh ?? null }
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
      include: { lines: { orderBy: { lineNo: 'asc' } }, originalDocument: true, creditNoteReason: true },
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

  private async render(doc: DocWithLines) {
    const view = DocumentFilesService.renderable(doc);
    let pdf = await this.renderer.render(renderDocumentHtml(view));
    let xmlFileId: bigint | null = null;
    if (doc.isTaxInvoice) {
      const xml = Buffer.from(
        renderETaxXml({ ...view, typeCode: eTaxTypeCode(view), issuedAt: toBangkokIso(doc.issuedAt) }),
        'utf8',
      );
      const stored = await this.files.storeSystem({
        body: xml,
        fileName: `${doc.docNumber}.xml`,
        mimeType: 'application/xml',
        retentionClass: 'financial_record',
        ownerUserId: doc.customerUserId,
      });
      xmlFileId = stored.id;
      pdf = await this.embed(pdf, xml, doc.docNumber);
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
          eTaxStatus: sending ? 'pending' : 'not_applicable',
        },
      });
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

  /** PDF/A-3 style: the e-Tax XML travels inside the PDF (skipped when the renderer is not a real PDF). */
  private async embed(pdf: Buffer, xml: Buffer, name: string): Promise<Buffer> {
    try {
      const doc = await PDFDocument.load(pdf);
      await doc.attach(xml, `${name}.xml`, {
        mimeType: 'application/xml',
        description: 'e-Tax invoice XML (ETDA)',
        afRelationship: 'Alternative' as never,
      });
      return Buffer.from(await doc.save());
    } catch {
      return pdf;
    }
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
    const body = await this.renderer.render(
      renderStatementHtml({
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
