import { DomainException } from '@common/errors/domain.exception';
import { type Prisma } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { bahtText, thaiDate } from '@modules/receivables/thai-text';
import { Inject, Injectable } from '@nestjs/common';

import { dec, fmtMoney } from './erp.math';
import { renderSalesDocHtml, renderWhtCertificateHtml, type SalesDocView } from './erp-documents.render';
import { type ErpPdfLinkDto } from './erp-e4.dto';
import { ErpFilesService } from './erp-files.service';
import { buyerOf, iso, party, sellerOf } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

export type ErpPdfKind =
  | 'quotation'
  | 'sales_order'
  | 'delivery_note'
  | 'invoice'
  | 'note'
  | 'receipt'
  | 'billing_note'
  | 'wht_certificate';

const METHOD_TH: Record<string, string> = { transfer: 'โอนเงิน', cash: 'เงินสด', cheque: 'เช็ค', other: 'อื่น ๆ' };
const REASON_TH: Record<string, string> = {
  price_reduced: 'ลดราคาสินค้า',
  goods_returned: 'รับคืนสินค้า',
  defective: 'สินค้าชำรุดเสียหาย',
  discount_after_sale: 'ส่วนลดภายหลังการขาย',
  overcharged: 'คำนวณราคาสินค้าผิดพลาดสูงกว่าที่เป็นจริง',
  price_increased: 'เพิ่มราคาสินค้า',
  undercharged: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง',
  extra_goods: 'สินค้าเกินกว่าจำนวนที่ตกลงกัน',
  other: 'อื่น ๆ',
};

/**
 * PDFs of the factory's documents (D-368): an issued document's PDF is rendered once and kept (financial
 * record, owned by the factory); a draft quotation is rendered each time it changes. Served by a short-lived link.
 */
@Injectable()
export class ErpPdfService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly files: ErpFilesService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  async pdf(scope: ErpScope, kind: ErpPdfKind, publicId: string): Promise<ErpPdfLinkDto> {
    const f = scope.factory.id;
    const db = this.workspace.db;
    const settings = await this.workspace.settings(db, f);
    const logo = await this.files.logoDataUri(settings.documentLogoFileId);
    const seller = await this.workspace.tx((tx) => sellerOf(tx, scope.factory));
    const base = {
      seller,
      logo,
      footer: settings.documentFooter,
      bankDetails: null as string | null,
      draft: false,
      stamp: null as string | null,
    };
    const unitLines = (lines: { description: string; quantity: Prisma.Decimal; unit: string; unitPrice: Prisma.Decimal; discountPct: Prisma.Decimal; amount: Prisma.Decimal }[]) =>
      lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toString(),
        discountPct: l.discountPct.toString(),
        amount: fmtMoney(l.amount),
      }));
    const vatTotals = (r: { subtotal: Prisma.Decimal; vatAmount: Prisma.Decimal; total: Prisma.Decimal; vatMode: string; vatRatePct: Prisma.Decimal }) =>
      r.vatMode === 'none'
        ? [{ label: 'รวมทั้งสิ้น', value: fmtMoney(r.total), strong: true }]
        : [
            { label: 'มูลค่าก่อนภาษี', value: fmtMoney(r.subtotal) },
            { label: `ภาษีมูลค่าเพิ่ม ${Number(r.vatRatePct)}%`, value: fmtMoney(r.vatAmount) },
            { label: 'รวมทั้งสิ้น', value: fmtMoney(r.total), strong: true },
          ];

    let view: SalesDocView | null = null;
    let wht: Parameters<typeof renderWhtCertificateHtml>[0] | null = null;
    let cache: { current: bigint | null; version: number; issued: boolean; save: (fileId: bigint) => Promise<unknown> };

    switch (kind) {
      case 'quotation': {
        const q = await db.erpQuotation.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!q) throw new DomainException('http.not_found');
        view = {
          ...base,
          titleTh: 'ใบเสนอราคา',
          titleEn: 'Quotation',
          copies: false,
          docNo: q.revision > 1 ? `${q.quoteNo} R${q.revision}` : q.quoteNo,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(q.quoteDate)!) },
            { label: 'ยืนราคาถึง', value: thaiDate(iso(q.validUntil)!) },
            { label: 'เครดิต', value: q.paymentTermDays ? `${q.paymentTermDays} วัน` : 'เงินสด' },
            ...(q.leadTimeDays !== null ? [{ label: 'กำหนดส่ง', value: `${q.leadTimeDays} วัน` }] : []),
          ],
          buyer: party(q.buyerSnapshot) ?? buyerOf(q.customer),
          fullForm: true,
          lines: unitLines(q.lines),
          totals: vatTotals(q),
          words: bahtText(fmtMoney(q.total)),
          notes: q.terms ? [{ label: 'เงื่อนไข', value: q.terms }] : [],
          signatures: ['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ (ลูกค้า)'],
          draft: q.status === 'draft',
          stamp: q.status === 'cancelled' ? 'ยกเลิก' : q.status === 'superseded' ? 'มีฉบับแก้ไขแล้ว' : null,
        };
        cache = {
          current: q.pdfFileId,
          version: q.pdfVersion === q.rowVersion ? q.rowVersion : -1,
          issued: false,
          save: (fileId) => db.erpQuotation.update({ where: { id: q.id }, data: { pdfFileId: fileId, pdfVersion: q.rowVersion } }),
        };
        break;
      }
      case 'sales_order': {
        const so = await db.erpSalesOrder.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!so) throw new DomainException('http.not_found');
        view = {
          ...base,
          titleTh: 'ใบยืนยันคำสั่งซื้อ',
          titleEn: 'Sales order confirmation',
          copies: false,
          docNo: so.soNo,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(so.orderDate)!) },
            ...(so.customerPoNo ? [{ label: 'อ้างอิงใบสั่งซื้อ', value: so.customerPoNo }] : []),
            ...(so.deliveryDate ? [{ label: 'กำหนดส่ง', value: thaiDate(iso(so.deliveryDate)!) }] : []),
          ],
          buyer: buyerOf(so.customer),
          fullForm: true,
          lines: unitLines(so.lines),
          totals: vatTotals(so),
          words: bahtText(fmtMoney(so.total)),
          notes: so.shipToAddress ? [{ label: 'สถานที่ส่ง', value: so.shipToAddress }] : [],
          signatures: ['ผู้รับคำสั่งซื้อ', 'ลูกค้า'],
          stamp: so.status === 'cancelled' ? 'ยกเลิก' : null,
        };
        cache = { current: null, version: -1, issued: false, save: () => Promise.resolve() };
        break;
      }
      case 'delivery_note': {
        const dn = await db.erpDeliveryNote.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, salesOrder: true, lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!dn) throw new DomainException('http.not_found');
        if (dn.status === 'draft') throw new DomainException('erp.invalid_status', { params: { status: dn.status } });
        view = {
          ...base,
          titleTh: 'ใบส่งของ',
          titleEn: 'Delivery note',
          copies: true,
          docNo: dn.doNo,
          rows: [
            { label: 'วันที่ส่ง', value: thaiDate(iso(dn.deliverOn)!) },
            { label: 'ใบสั่งขาย', value: dn.salesOrder.soNo },
            ...(dn.salesOrder.customerPoNo ? [{ label: 'ใบสั่งซื้อลูกค้า', value: dn.salesOrder.customerPoNo }] : []),
            ...(dn.vehicle ? [{ label: 'รถ / ผู้ส่ง', value: dn.vehicle }] : []),
          ],
          buyer: { ...buyerOf(dn.customer), address: dn.shipToAddress ?? dn.customer.address },
          buyerLabel: 'ส่งถึง',
          fullForm: false,
          quantitiesOnly: true,
          lines: dn.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unit: l.unit, amount: '0' })),
          totals: [],
          words: null,
          notes: [
            ...(dn.note ? [{ label: 'หมายเหตุ', value: dn.note }] : []),
            ...(dn.receivedBy ? [{ label: 'ผู้รับสินค้า', value: dn.receivedBy }] : []),
          ],
          signatures: ['ผู้ส่งสินค้า', 'ผู้รับสินค้า', 'ผู้ตรวจสอบ'],
          stamp: dn.status === 'cancelled' ? 'ยกเลิก' : null,
        };
        cache = {
          current: dn.pdfFileId,
          version: dn.pdfVersion === dn.rowVersion ? dn.rowVersion : -1,
          issued: true,
          save: (fileId) => db.erpDeliveryNote.update({ where: { id: dn.id }, data: { pdfFileId: fileId, pdfVersion: dn.rowVersion } }),
        };
        break;
      }
      case 'invoice': {
        const iv = await db.erpSalesInvoice.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, salesOrder: true, lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!iv) throw new DomainException('http.not_found');
        if (iv.status === 'draft') throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
        const cash = iv.form === 'invoice_receipt';
        view = {
          ...base,
          seller: party(iv.sellerSnapshot) ?? seller,
          titleTh: iv.isTaxInvoice ? (cash ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้ / ใบกำกับภาษี') : cash ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้',
          titleEn: iv.isTaxInvoice ? (cash ? 'Tax invoice / Receipt' : 'Invoice / Tax invoice') : cash ? 'Receipt' : 'Invoice',
          copies: true,
          docNo: iv.invoiceNo!,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(iv.issueDate)!) },
            ...(cash ? [] : [{ label: 'ครบกำหนด', value: thaiDate(iso(iv.dueDate)!) }]),
            ...(iv.salesOrder ? [{ label: 'ใบสั่งขาย', value: iv.salesOrder.soNo }] : []),
            ...(iv.customerPoNo ? [{ label: 'ใบสั่งซื้อลูกค้า', value: iv.customerPoNo }] : []),
          ],
          buyer: party(iv.buyerSnapshot) ?? buyerOf(iv.customer),
          fullForm: iv.isTaxInvoice,
          lines: unitLines(iv.lines),
          totals: vatTotals(iv),
          words: bahtText(fmtMoney(iv.total)),
          notes: iv.note ? [{ label: 'หมายเหตุ', value: iv.note }] : [],
          bankDetails: cash ? null : settings.bankDetails,
          signatures: cash ? ['ผู้รับเงิน'] : ['ผู้รับวางบิล / ผู้รับสินค้า', 'ผู้มีอำนาจลงนาม'],
          stamp: iv.status === 'voided' ? 'ยกเลิก' : null,
        };
        cache = {
          current: iv.pdfFileId,
          version: iv.pdfVersion === statusVersion(iv.status) ? statusVersion(iv.status) : -1,
          issued: true,
          save: (fileId) => db.erpSalesInvoice.update({ where: { id: iv.id }, data: { pdfFileId: fileId, pdfVersion: statusVersion(iv.status) } }),
        };
        break;
      }
      case 'note': {
        const n = await db.erpSalesNote.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, invoice: true, lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!n) throw new DomainException('http.not_found');
        if (n.status === 'draft') throw new DomainException('erp.invalid_status', { params: { status: n.status } });
        const credit = n.kind === 'credit';
        view = {
          ...base,
          seller: party(n.sellerSnapshot) ?? seller,
          titleTh: credit ? (n.isTaxDocument ? 'ใบลดหนี้ / ใบกำกับภาษี' : 'ใบลดหนี้') : n.isTaxDocument ? 'ใบเพิ่มหนี้ / ใบกำกับภาษี' : 'ใบเพิ่มหนี้',
          titleEn: credit ? 'Credit note' : 'Debit note',
          copies: true,
          docNo: n.noteNo!,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(n.issueDate)!) },
            { label: 'อ้างอิงใบกำกับภาษี', value: n.invoice.invoiceNo ?? '' },
            { label: 'ลงวันที่', value: thaiDate(iso(n.invoice.issueDate)!) },
          ],
          buyer: party(n.buyerSnapshot) ?? buyerOf(n.customer),
          fullForm: n.isTaxDocument,
          lines: n.lines.map((l) => ({
            description: l.description,
            quantity: l.returnQty?.toString() ?? null,
            unit: null,
            amount: fmtMoney(l.amount),
          })),
          totals: [
            { label: 'มูลค่าตามใบกำกับภาษีเดิม', value: fmtMoney(n.originalValue) },
            { label: 'มูลค่าที่ถูกต้อง', value: fmtMoney(n.correctValue) },
            { label: credit ? 'ผลต่าง (ลดลง)' : 'ผลต่าง (เพิ่มขึ้น)', value: fmtMoney(n.difference) },
            ...(dec(n.vatAmount).gt(0) ? [{ label: `ภาษีมูลค่าเพิ่ม ${Number(n.vatRatePct)}%`, value: fmtMoney(n.vatAmount) }] : []),
            { label: 'รวมทั้งสิ้น', value: fmtMoney(n.total), strong: true },
          ],
          words: bahtText(fmtMoney(n.total)),
          notes: [{ label: 'เหตุผล', value: `${REASON_TH[n.reason] ?? n.reason}${n.reasonText ? ` — ${n.reasonText}` : ''}` }],
          signatures: ['ผู้มีอำนาจลงนาม', 'ผู้รับเอกสาร'],
          stamp: n.status === 'voided' ? 'ยกเลิก' : null,
        };
        cache = {
          current: n.pdfFileId,
          version: n.pdfVersion === statusVersion(n.status) ? statusVersion(n.status) : -1,
          issued: true,
          save: (fileId) => db.erpSalesNote.update({ where: { id: n.id }, data: { pdfFileId: fileId, pdfVersion: statusVersion(n.status) } }),
        };
        break;
      }
      case 'receipt': {
        const r = await db.erpCustomerReceipt.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, allocations: { include: { invoice: true }, orderBy: { id: 'asc' } } },
        });
        if (!r) throw new DomainException('http.not_found');
        const refund = r.kind === 'refund';
        view = {
          ...base,
          seller: party(r.sellerSnapshot) ?? seller,
          titleTh: refund ? 'ใบสำคัญคืนเงิน' : 'ใบเสร็จรับเงิน',
          titleEn: refund ? 'Refund voucher' : 'Receipt',
          copies: true,
          docNo: r.receiptNo,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(r.receivedOn)!) },
            { label: 'ชำระโดย', value: `${METHOD_TH[r.method] ?? r.method}${r.chequeNo ? ` เลขที่ ${r.chequeNo}` : ''}${r.chequeBank ? ` ${r.chequeBank}` : ''}` },
          ],
          buyer: party(r.buyerSnapshot) ?? buyerOf(r.customer),
          fullForm: true,
          lines: r.allocations.map((a) => ({
            description: `${refund ? 'คืนเงินตาม' : 'ชำระ'} ${a.invoice.invoiceNo ?? ''} ลงวันที่ ${thaiDate(iso(a.invoice.issueDate)!)}`,
            amount: fmtMoney(dec(a.amount).abs()),
          })),
          totals: [
            { label: 'รวม', value: fmtMoney(dec(r.amount).abs().plus(dec(r.whtAmount))) },
            ...(dec(r.whtAmount).gt(0) ? [{ label: 'หัก ภาษีหัก ณ ที่จ่าย', value: fmtMoney(r.whtAmount) }] : []),
            { label: refund ? 'จ่ายคืนสุทธิ' : 'รับชำระสุทธิ', value: fmtMoney(dec(r.amount).abs()), strong: true },
          ],
          words: bahtText(fmtMoney(dec(r.amount).abs())),
          notes: [
            ...(r.whtCertNo ? [{ label: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย', value: `${r.whtCertNo}${r.whtCertDate ? ` ลงวันที่ ${thaiDate(iso(r.whtCertDate)!)}` : ''}` }] : []),
            ...(r.note ? [{ label: 'หมายเหตุ', value: r.note }] : []),
          ],
          signatures: [refund ? 'ผู้จ่ายเงิน' : 'ผู้รับเงิน'],
          stamp: r.status === 'cancelled' ? 'ยกเลิก' : null,
        };
        cache = {
          current: r.pdfFileId,
          version: r.pdfVersion === statusVersion(r.status) ? statusVersion(r.status) : -1,
          issued: true,
          save: (fileId) => db.erpCustomerReceipt.update({ where: { id: r.id }, data: { pdfFileId: fileId, pdfVersion: statusVersion(r.status) } }),
        };
        break;
      }
      case 'billing_note': {
        const b = await db.erpBillingNote.findFirst({
          where: { publicId, factoryId: f },
          include: { customer: true, lines: { include: { invoice: true }, orderBy: { id: 'asc' } } },
        });
        if (!b) throw new DomainException('http.not_found');
        view = {
          ...base,
          seller: party(b.sellerSnapshot) ?? seller,
          titleTh: 'ใบวางบิล',
          titleEn: 'Billing note',
          copies: true,
          docNo: b.billingNo,
          rows: [
            { label: 'วันที่', value: thaiDate(iso(b.billingDate)!) },
            ...(b.collectOn ? [{ label: 'นัดชำระ', value: thaiDate(iso(b.collectOn)!) }] : []),
          ],
          buyer: party(b.buyerSnapshot) ?? buyerOf(b.customer),
          fullForm: true,
          lines: b.lines.map((l) => ({
            description: `${l.invoice.invoiceNo ?? ''} ลงวันที่ ${thaiDate(iso(l.invoice.issueDate)!)} ครบกำหนด ${thaiDate(iso(l.invoice.dueDate)!)}`,
            amount: fmtMoney(l.amount),
          })),
          totals: [{ label: 'รวมทั้งสิ้น', value: fmtMoney(b.total), strong: true }],
          words: bahtText(fmtMoney(b.total)),
          notes: b.note ? [{ label: 'หมายเหตุ', value: b.note }] : [],
          bankDetails: settings.bankDetails,
          signatures: ['ผู้วางบิล', 'ผู้รับวางบิล'],
          stamp: b.status === 'cancelled' ? 'ยกเลิก' : null,
        };
        cache = {
          current: b.pdfFileId,
          version: b.pdfVersion === statusVersion(b.status) ? statusVersion(b.status) : -1,
          issued: true,
          save: (fileId) => db.erpBillingNote.update({ where: { id: b.id }, data: { pdfFileId: fileId, pdfVersion: statusVersion(b.status) } }),
        };
        break;
      }
      case 'wht_certificate': {
        const c = await db.erpWhtCertificate.findFirst({
          where: { publicId, factoryId: f },
          include: { lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!c) throw new DomainException('http.not_found');
        wht = {
          certNo: c.certNo,
          bookNo: iso(c.paidOn)!.slice(0, 4),
          form: c.form,
          payer: party(c.payerSnapshot)!,
          payee: party(c.payeeSnapshot)!,
          paidOn: iso(c.paidOn)!,
          lines: c.lines.map((l) => ({
            incomeType: l.incomeType,
            description: l.description,
            ratePct: l.ratePct.toString(),
            baseAmount: fmtMoney(l.baseAmount),
            whtAmount: fmtMoney(l.whtAmount),
          })),
          baseAmount: fmtMoney(c.baseAmount),
          whtAmount: fmtMoney(c.whtAmount),
          voided: c.status === 'voided',
          signatory: settings.signatoryName,
        };
        cache = {
          current: c.pdfFileId,
          version: c.pdfVersion === statusVersion(c.status) ? statusVersion(c.status) : -1,
          issued: true,
          save: (fileId) => db.erpWhtCertificate.update({ where: { id: c.id }, data: { pdfFileId: fileId, pdfVersion: statusVersion(c.status) } }),
        };
        break;
      }
    }

    if (cache.current && cache.version >= 0) return this.files.link(cache.current);
    const html = wht ? renderWhtCertificateHtml(wht) : renderSalesDocHtml(view!);
    const pdf = await this.renderer.render(html);
    const name = wht ? wht.certNo : view!.docNo;
    const stored = await this.files.store(scope, pdf, `${name}.pdf`, 'application/pdf', cache.issued ? 'financial_record' : 'transient');
    await cache.save(stored.fileId);
    const { fileId: _ignored, ...link } = stored;
    return link;
  }
}

/** Issued documents keep one PDF per state: issued, then the voided / cancelled copy with its stamp. */
function statusVersion(status: string): number {
  return status === 'voided' || status === 'cancelled' ? 2 : 1;
}
