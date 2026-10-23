import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type DocumentSigningKind } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { renderSalesDocHtml } from '@modules/factory-erp/erp-documents.render';
import { sellerOf } from '@modules/factory-erp/erp-sales.shared';
import { CustomerDocumentsService } from '@modules/receivables/customer-documents.service';
import { type RenderableDocument, renderDocumentHtml } from '@modules/receivables/document-render';
import { Inject, Injectable } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { DocumentBrandingService, type DocumentOwner } from './document-branding.service';

const SAMPLE_BUYER = {
  name: 'บริษัท ลูกค้าตัวอย่าง จำกัด',
  taxId: '0000500000000',
  branchCode: '00000',
  address: '123 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10110',
  phone: null,
};

const DOC_TYPE: Partial<Record<DocumentSigningKind, { docType: string; tax: boolean }>> = {
  tax_invoice: { docType: 'tr', tax: true },
  receipt: { docType: 'rc', tax: false },
  invoice: { docType: 'iv', tax: false },
  credit_note: { docType: 'cn', tax: true },
  debit_note: { docType: 'dn', tax: true },
};

const ERP_TITLE: Record<DocumentSigningKind, [string, string]> = {
  tax_invoice: ['ใบกำกับภาษี / ใบเสร็จรับเงิน', 'Tax invoice / Receipt'],
  receipt: ['ใบเสร็จรับเงิน', 'Receipt'],
  invoice: ['ใบแจ้งหนี้', 'Invoice'],
  credit_note: ['ใบลดหนี้ / ใบกำกับภาษี', 'Credit note'],
  debit_note: ['ใบเพิ่มหนี้ / ใบกำกับภาษี', 'Debit note'],
  quotation: ['ใบเสนอราคา', 'Quotation'],
  sales_order: ['ใบยืนยันคำสั่งซื้อ', 'Sales order confirmation'],
  delivery_note: ['ใบส่งของ', 'Delivery note'],
  billing_note: ['ใบวางบิล', 'Billing note'],
  wht_certificate: ['หนังสือรับรองการหักภาษี ณ ที่จ่าย', 'Withholding tax certificate'],
  statement: ['ใบแจ้งยอด', 'Statement of account'],
};

/**
 * A sample document with the owner's branding as it is now (D-428/D-429), so the administrator sees the logo,
 * the seal and the signature in place before a real document carries them. Marked "ตัวอย่าง"; a transient file.
 */
@Injectable()
export class DocumentPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: DocumentBrandingService,
    private readonly documents: CustomerDocumentsService,
    private readonly files: FilesService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  async preview(owner: DocumentOwner, docKind: DocumentSigningKind, ownerUserId: bigint) {
    const now = new Date();
    const b = await this.branding.resolve(owner, docKind, now);
    const today = toBangkokIso(now).slice(0, 10);
    let html: string;
    if (owner.kind === 'entity') {
      const seller = await this.prisma.withTx((tx) => this.documents.seller(tx, owner.id, now));
      const t = DOC_TYPE[docKind] ?? { docType: 'tr', tax: true };
      const view: RenderableDocument = {
        docType: t.docType,
        docKind: 'final',
        docNumber: 'ตัวอย่าง-0001',
        documentDate: today,
        dueDate: null,
        isTaxInvoice: t.tax,
        isFullForm: true,
        status: 'issued',
        voidReason: null,
        seller,
        buyer: SAMPLE_BUYER,
        reference: null,
        lines: [
          {
            description: 'กล่องกระดาษพิมพ์ 4 สี ขนาด 10×10×10 ซม. (ตัวอย่าง)',
            quantity: '1000',
            unitPrice: '12.50',
            net: '12500.00',
            discount: '0.00',
            vat: '875.00',
            gross: '13375.00',
          },
        ],
        net: '12500.00',
        discount: '0.00',
        vat: '875.00',
        vatRatePct: '7',
        gross: '13375.00',
        deductedPrior: '0.00',
        amountDue: '0.00',
        wht: '0.00',
        cash: '13375.00',
        receiptVia: null,
        branding: b,
        watermark: 'ตัวอย่าง',
      };
      html = renderDocumentHtml(view);
    } else {
      const factory = await this.prisma.factory.findUniqueOrThrow({ where: { id: owner.id } });
      const seller = await this.prisma.withTx((tx) => sellerOf(tx, factory));
      const [th, en] = ERP_TITLE[docKind];
      html = renderSalesDocHtml({
        titleTh: th,
        titleEn: en,
        copies: false,
        docNo: 'ตัวอย่าง-0001',
        rows: [{ label: 'วันที่', value: today }],
        seller,
        logo: b.logo,
        branding: b,
        signedOn: today,
        buyer: SAMPLE_BUYER,
        fullForm: true,
        lines: [
          {
            description: 'กล่องกระดาษพิมพ์ 4 สี (ตัวอย่าง)',
            quantity: '1000',
            unit: 'pcs',
            unitPrice: '12.50',
            discountPct: '0',
            amount: '12500.00',
          },
        ],
        totals: [
          { label: 'มูลค่าก่อนภาษี', value: '12500.00' },
          { label: 'ภาษีมูลค่าเพิ่ม 7%', value: '875.00' },
          { label: 'รวมทั้งสิ้น', value: '13375.00', strong: true },
        ],
        words: 'หนึ่งหมื่นสามพันสามร้อยเจ็ดสิบห้าบาทถ้วน',
        notes: [],
        stamp: null,
        draft: true,
        footer: null,
        bankDetails: null,
        signatures: ['ผู้มีอำนาจลงนาม', 'ผู้รับเอกสาร'],
      });
    }
    const pdf = await this.renderer.render(html);
    const file = await this.files.storeSystem({
      body: pdf,
      fileName: `preview-${docKind}.pdf`,
      mimeType: 'application/pdf',
      retentionClass: 'transient',
      ownerUserId,
      ownerFactoryId: owner.kind === 'factory' ? owner.id : null,
    });
    const link = await this.files.signedUrl(file);
    return { url: link!.url, fileName: file.originalName, expiresAt: toBangkokIso(link!.expiresAt) };
  }
}
