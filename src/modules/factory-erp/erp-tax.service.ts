import { DomainException } from '@common/errors/domain.exception';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type ErpWhtIncomeType, type Prisma } from '@generated/prisma/client';
import { type ReportColumn } from '@modules/reports/report-types';
import { writeReport } from '@modules/reports/report-writer';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { dec, fmtMoney, money2 } from './erp.math';
import {
  type ErpCreateWhtCertificateDto,
  type ErpSalesPerformanceDto,
  type ErpSalesReportDto,
  type ErpSaveSalesTargetDto,
  type ErpTaxExportDto,
  type ErpTaxExportResultDto,
  type ErpVat30Dto,
  type ErpVatReportDto,
  type ErpVatReportRowDto,
  type ErpWhtCertificateDto,
  type ErpWhtCertificateListQuery,
  type ErpWhtLineDto,
  type ErpWhtReportDto,
  type ErpWhtSuggestionDto,
} from './erp-e4.dto';
import { ErpFilesService } from './erp-files.service';
import { day, factoryUser, iso, isoTs, partnerRef, party, sellerOf, userRef } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/** The usual rate of each income type (D-366); the factory may change it on the certificate. */
export const WHT_RATE: Record<ErpWhtIncomeType, string> = {
  fees_commission: '3',
  rent: '5',
  hire_of_work: '3',
  transport: '1',
  advertising: '2',
  service: '3',
  prize: '5',
  other: '3',
};
const TYPE_BY_RATE: Record<string, ErpWhtIncomeType> = {
  '1.0000': 'transport',
  '2.0000': 'advertising',
  '3.0000': 'service',
  '5.0000': 'rent',
};

const CERT_INCLUDE = {
  payment: true,
  supplier: true,
  lines: { orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.ErpWhtCertificateInclude;
type CertRow = Prisma.ErpWhtCertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

export const WHT_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_wht.void', permissions: ['factory_ap.manage'], irreversible: true, when: (c) => c.status === 'issued' },
  { key: 'erp_wht.pdf', permissions: ['factory_ap.read'], when: () => true },
];

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: day(from), to: day(next), next };
};
/** Day `d` of the month after `month` (returns are due the following month). */
const dueIn = (month: string, d: number) => `${monthRange(month).next.slice(0, 8)}${String(d).padStart(2, '0')}`;

/**
 * The factory's own tax paperwork (D-366, D-367, D-369): 50 ทวิ certificates for supplier payments, the sales
 * and purchase VAT reports, the ภ.พ.30 summary, ภ.ง.ด.3 / ภ.ง.ด.53 lines, CSV / XLSX exports and the sales
 * performance by salesperson against targets.
 */
@Injectable()
export class ErpTaxService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly files: ErpFilesService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------------------- 50 ทวิ certificates

  /** What a certificate for this payment would carry: its share of each paid invoice's WHT, one line per rate. */
  async suggest(scope: ErpScope, paymentPublicId: string): Promise<ErpWhtSuggestionDto> {
    return this.workspace.tx(async (tx) => {
      const { payment, lines, form } = await this.suggestion(tx, scope, paymentPublicId);
      const current = await tx.erpWhtCertificate.findFirst({ where: { paymentId: payment.id, status: 'issued' } });
      return {
        payment: { id: payment.publicId, code: payment.paymentNo, name: payment.paymentNo },
        supplier: partnerRef(payment.supplier),
        entityType: payment.supplier.entityType,
        form,
        paidOn: iso(payment.paidOn)!,
        lines,
        certificate: current ? { id: current.publicId, code: current.certNo, name: current.certNo } : null,
      };
    });
  }

  private async suggestion(tx: Tx, scope: ErpScope, paymentPublicId: string) {
    const payment = await tx.erpSupplierPayment.findFirst({
      where: { publicId: paymentPublicId, factoryId: scope.factory.id },
      include: { supplier: true, allocations: { include: { supplierInvoice: true } } },
    });
    if (!payment) throw new DomainException('http.not_found');
    if (dec(payment.amount).lte(0) || payment.reversesId)
      throw new DomainException('erp.no_withholding', { params: { paymentNo: payment.paymentNo } });
    const byRate = new Map<string, { base: Prisma.Decimal; wht: Prisma.Decimal }>();
    for (const a of payment.allocations) {
      const inv = a.supplierInvoice;
      if (!dec(inv.whtAmount).gt(0) || !dec(inv.payableAmount).gt(0)) continue;
      const share = dec(a.amount).div(dec(inv.payableAmount));
      const rate = dec(inv.whtRatePct).toFixed(4);
      const e = byRate.get(rate) ?? { base: dec(0), wht: dec(0) };
      e.base = e.base.plus(dec(inv.subtotal).times(share));
      e.wht = e.wht.plus(dec(inv.whtAmount).times(share));
      byRate.set(rate, e);
    }
    const lines: ErpWhtLineDto[] = [...byRate.entries()].map(([rate, e], i) => {
      const incomeType = TYPE_BY_RATE[rate] ?? 'other';
      return {
        lineNo: i + 1,
        incomeType,
        description: null,
        ratePct: rate,
        baseAmount: fmtMoney(money2(e.base)),
        whtAmount: fmtMoney(money2(e.wht)),
      };
    });
    const form = payment.supplier.entityType === 'individual' ? 'pnd3' : 'pnd53';
    return { payment, lines, form } as const;
  }

  async listCertificates(scope: ErpScope, q: ErpWhtCertificateListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpWhtCertificateWhereInput = { factoryId: scope.factory.id };
    if (q.month) {
      const r = monthRange(q.month);
      where.paidOn = { gte: r.from, lt: r.to };
    }
    if (q.form) where.form = q.form as never;
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpWhtCertificate.findMany({
        where,
        include: CERT_INCLUDE,
        orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpWhtCertificate.count({ where }),
    ]);
    return paginated(
      rows.map((r) => certDto(r, perms)),
      total,
      q,
    );
  }

  async getCertificate(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpWhtCertificateDto> {
    const row = await this.workspace.db.erpWhtCertificate.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: CERT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return certDto(row, perms);
  }

  /** Issues the 50 ทวิ for a supplier payment (D-366); one in force per payment. */
  async createCertificate(scope: ErpScope, body: ErpCreateWhtCertificateDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const { payment, lines: suggested, form } = await this.suggestion(tx, scope, body.paymentId);
      await tx.$queryRaw`SELECT id FROM erp_supplier_payments WHERE id = ${payment.id} FOR UPDATE`;
      const current = await tx.erpWhtCertificate.findFirst({ where: { paymentId: payment.id, status: 'issued' } });
      if (current) throw new DomainException('erp.invalid_status', { params: { status: `issued ${current.certNo}` } });
      const lines = (body.lines?.length ? body.lines : suggested).map((l, i) => ({
        lineNo: i + 1,
        incomeType: l.incomeType as ErpWhtIncomeType,
        description: l.description ?? null,
        ratePct: dec(l.ratePct).toFixed(4),
        baseAmount: fmtMoney(dec(l.baseAmount)),
        whtAmount: fmtMoney(dec(l.whtAmount)),
      }));
      const wht = lines.reduce((a, l) => a.plus(dec(l.whtAmount)), dec(0));
      const base = lines.reduce((a, l) => a.plus(dec(l.baseAmount)), dec(0));
      if (!wht.gt(0) || !base.gt(0))
        throw new DomainException('erp.no_withholding', { params: { paymentNo: payment.paymentNo } });
      for (const [i, l] of lines.entries())
        if (dec(l.whtAmount).gt(dec(l.baseAmount)))
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.whtAmount`, code: 'max', message: 'At most the amount paid' }],
          });
      const paidOn = iso(payment.paidOn)!;
      const certNo = await this.workspace.nextNumber(tx, scope.factory.id, 'wht', new Date(`${paidOn}T12:00:00+07:00`));
      const s = payment.supplier;
      const cert = await tx.erpWhtCertificate.create({
        data: {
          factoryId: scope.factory.id,
          certNo,
          form,
          paymentId: payment.id,
          supplierId: s.id,
          paidOn: payment.paidOn,
          baseAmount: fmtMoney(base),
          whtAmount: fmtMoney(wht),
          payerSnapshot: (await sellerOf(tx, scope.factory)) as unknown as Prisma.InputJsonValue,
          payeeSnapshot: {
            name: s.name,
            address: s.address,
            taxId: s.taxId,
            branchCode: s.taxId ? (s.branchCode ?? '00000') : null,
            phone: s.phone,
          },
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(tx, scope, 'erp_wht_certificate.issued', 'erp_wht_certificate', cert.publicId, { certNo });
      return cert.publicId;
    });
    return this.getCertificate(scope, id, perms);
  }

  async voidCertificate(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const c = await tx.erpWhtCertificate.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!c) throw new DomainException('http.not_found');
      if (c.status !== 'issued') throw new DomainException('erp.invalid_status', { params: { status: c.status } });
      await tx.erpWhtCertificate.update({
        where: { id: c.id },
        data: { status: 'voided', voidedAt: new Date(), voidReason: reason },
      });
      await this.workspace.record(tx, scope, 'erp_wht_certificate.voided', 'erp_wht_certificate', c.publicId, {
        certNo: c.certNo,
      });
    });
    return this.getCertificate(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------------- reports

  async salesVat(scope: ErpScope, month: string): Promise<ErpVatReportDto> {
    const r = monthRange(month);
    const invoices = await this.workspace.db.erpSalesInvoice.findMany({
      where: { factoryId: scope.factory.id, isTaxInvoice: true, invoiceNo: { not: null }, issueDate: { gte: r.from, lt: r.to } },
      orderBy: [{ issueDate: 'asc' }, { invoiceNo: 'asc' }],
    });
    const notes = await this.workspace.db.erpSalesNote.findMany({
      where: { factoryId: scope.factory.id, isTaxDocument: true, noteNo: { not: null }, issueDate: { gte: r.from, lt: r.to } },
      orderBy: [{ issueDate: 'asc' }, { noteNo: 'asc' }],
    });
    const rows: ErpVatReportRowDto[] = [
      ...invoices.map((i) => {
        const b = party(i.buyerSnapshot);
        const voided = i.status === 'voided';
        return {
          date: iso(i.issueDate)!,
          docNo: i.invoiceNo!,
          kind: 'tax_invoice',
          partyName: b?.name ?? '',
          partyTaxId: b?.taxId ?? null,
          partyBranch: b?.branchCode ?? null,
          net: voided ? '0.00' : fmtMoney(i.subtotal),
          vat: voided ? '0.00' : fmtMoney(i.vatAmount),
          voided,
          sourceId: i.publicId,
        };
      }),
      ...notes.map((n) => {
        const b = party(n.buyerSnapshot);
        const voided = n.status === 'voided';
        const sign = n.kind === 'credit' ? -1 : 1;
        return {
          date: iso(n.issueDate)!,
          docNo: n.noteNo!,
          kind: n.kind === 'credit' ? 'credit_note' : 'debit_note',
          partyName: b?.name ?? '',
          partyTaxId: b?.taxId ?? null,
          partyBranch: b?.branchCode ?? null,
          net: voided ? '0.00' : fmtMoney(dec(n.difference).times(sign)),
          vat: voided ? '0.00' : fmtMoney(dec(n.vatAmount).times(sign)),
          voided,
          sourceId: n.publicId,
        };
      }),
      ...(await this.packioStatements(scope, month)),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo));
    return {
      month,
      kind: 'sales',
      rows,
      net: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.net)), dec(0))),
      vat: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.vat)), dec(0))),
    };
  }

  /**
   * Packio statements the factory confirmed in the month (D-401): the factory's own sale to Packio, on its books by
   * F14 on the confirmation day (D-397) — numbered by the tax invoice the factory gave Packio when it is recorded, by
   * the statement otherwise; the buyer is the Packio entity from its registered settings.
   */
  private async packioStatements(scope: ErpScope, month: string): Promise<ErpVatReportRowDto[]> {
    const r = monthRange(month);
    const statements = await this.workspace.db.billingStatement.findMany({
      where: {
        factoryId: scope.factory.id,
        confirmedAt: { gte: new Date(`${month}-01T00:00:00+07:00`), lt: new Date(`${r.next}T00:00:00+07:00`) },
        vatAmount: { gt: 0 },
      },
      include: {
        vendorInvoices: {
          where: { isTaxInvoice: true, status: { in: ['recorded', 'validated'] } },
          orderBy: { invoiceDate: 'desc' },
          take: 1,
          select: { vendorInvoiceNo: true },
        },
      },
      orderBy: { confirmedAt: 'asc' },
    });
    if (!statements.length) return [];
    const buyers = new Map<bigint, { name: string; taxId: string | null; branch: string | null }>();
    for (const entityId of new Set(statements.map((s) => s.entityId))) {
      const read = async (key: string): Promise<string | null> => {
        try {
          return String((await this.settings.at(key as never, { at: new Date(), scope: { type: 'entity', id: entityId } })).value);
        } catch (error) {
          if (error instanceof SettingNotFoundError) return null;
          throw error;
        }
      };
      buyers.set(entityId, {
        name: (await read('entity.legal_name_th')) ?? 'Packio',
        taxId: await read('entity.tax_id'),
        branch: await read('entity.branch_code'),
      });
    }
    return statements.map((s) => {
      const buyer = buyers.get(s.entityId)!;
      return {
        date: bangkokDate(s.confirmedAt!),
        docNo: s.vendorInvoices[0]?.vendorInvoiceNo ?? s.bsNumber,
        kind: 'packio_statement',
        partyName: buyer.name,
        partyTaxId: buyer.taxId,
        partyBranch: buyer.branch,
        net: fmtMoney(s.netAmount),
        vat: fmtMoney(s.vatAmount),
        voided: false,
        sourceId: s.publicId,
      };
    });
  }

  async purchaseVat(scope: ErpScope, month: string): Promise<ErpVatReportDto> {
    const r = monthRange(month);
    const invoices = await this.workspace.db.erpSupplierInvoice.findMany({
      where: {
        factoryId: scope.factory.id,
        taxInvoiceNo: { not: null },
        status: { not: 'cancelled' },
        invoiceDate: { gte: r.from, lt: r.to },
        vatAmount: { gt: 0 },
      },
      include: { supplier: true },
      orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
    });
    const rows: ErpVatReportRowDto[] = invoices.map((i) => ({
      date: iso(i.invoiceDate)!,
      docNo: i.taxInvoiceNo!,
      kind: 'supplier_tax_invoice',
      partyName: i.supplier.name,
      partyTaxId: i.supplier.taxId,
      partyBranch: i.supplier.taxId ? (i.supplier.branchCode ?? '00000') : null,
      net: fmtMoney(i.subtotal),
      vat: fmtMoney(i.vatAmount),
      voided: false,
      sourceId: i.publicId,
    }));
    return {
      month,
      kind: 'purchase',
      rows,
      net: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.net)), dec(0))),
      vat: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.vat)), dec(0))),
    };
  }

  async vat30(scope: ErpScope, month: string): Promise<ErpVat30Dto> {
    const [sales, purchase] = await Promise.all([this.salesVat(scope, month), this.purchaseVat(scope, month)]);
    return {
      month,
      vatRegistered: scope.factory.isVatRegistered,
      salesNet: sales.net,
      outputVat: sales.vat,
      purchaseNet: purchase.net,
      inputVat: purchase.vat,
      vatPayable: fmtMoney(dec(sales.vat).minus(dec(purchase.vat))),
      dueOn: dueIn(month, 15),
    };
  }

  async wht(scope: ErpScope, month: string, form: 'pnd3' | 'pnd53'): Promise<ErpWhtReportDto> {
    const r = monthRange(month);
    const certs = await this.workspace.db.erpWhtCertificate.findMany({
      where: { factoryId: scope.factory.id, status: 'issued', form, paidOn: { gte: r.from, lt: r.to } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ paidOn: 'asc' }, { certNo: 'asc' }],
    });
    const rows = certs.flatMap((c) => {
      const p = party(c.payeeSnapshot)!;
      return c.lines.map((l) => ({
        certNo: c.certNo,
        paidOn: iso(c.paidOn)!,
        payeeName: p.name,
        payeeTaxId: p.taxId,
        payeeBranch: p.branchCode,
        payeeAddress: p.address,
        incomeType: l.incomeType,
        ratePct: dec(l.ratePct).toFixed(4),
        baseAmount: fmtMoney(l.baseAmount),
        whtAmount: fmtMoney(l.whtAmount),
      }));
    });
    return {
      month,
      form,
      rows,
      baseAmount: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.baseAmount)), dec(0))),
      whtAmount: fmtMoney(rows.reduce((a, x) => a.plus(dec(x.whtAmount)), dec(0))),
      dueOn: dueIn(month, 7),
    };
  }

  /** A report as a CSV (UTF-8 with BOM) or XLSX file owned by the factory, behind a short-lived link (D-367). */
  async export(scope: ErpScope, body: ErpTaxExportDto): Promise<ErpTaxExportResultDto> {
    const format = (body.format ?? 'csv') as 'csv' | 'xlsx';
    const { columns, rows, name } = await this.exportRows(scope, body.report, body.month);
    async function* iterate() {
      yield* await Promise.resolve(rows);
    }
    const written = await writeReport({ key: body.report, nameTh: name, nameEn: name, columns }, iterate(), format, {
      filters: { month: body.month },
      generatedAt: new Date(),
    });
    const fileName = `${body.report}-${body.month}.${written.extension}`;
    const { url, fileName: stored, expiresAt } = await this.files.store(scope, written.body, fileName, written.mimeType);
    return { url, fileName: stored, expiresAt, rows: written.rowCount };
  }

  private async exportRows(
    scope: ErpScope,
    report: string,
    month: string,
  ): Promise<{ columns: ReportColumn[]; rows: Record<string, string | number | null>[]; name: string }> {
    const col = (key: string, labelTh: string, labelEn: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({
      key,
      labelTh,
      labelEn,
      type,
    });
    if (report === 'sales_vat' || report === 'purchase_vat') {
      const data = report === 'sales_vat' ? await this.salesVat(scope, month) : await this.purchaseVat(scope, month);
      return {
        name: report === 'sales_vat' ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ',
        columns: [
          col('date', 'วันที่', 'Date', 'date'),
          col('docNo', 'เลขที่', 'Number'),
          col('kind', 'ประเภท', 'Kind'),
          col('partyName', report === 'sales_vat' ? 'ผู้ซื้อ' : 'ผู้ขาย', 'Party'),
          col('partyTaxId', 'เลขประจำตัวผู้เสียภาษี', 'Tax id'),
          col('partyBranch', 'สาขา', 'Branch'),
          col('net', 'มูลค่าสินค้า/บริการ', 'Net', 'money'),
          col('vat', 'ภาษีมูลค่าเพิ่ม', 'VAT', 'money'),
          col('voided', 'ยกเลิก', 'Voided'),
        ],
        rows: data.rows.map((x) => ({ ...x, voided: x.voided ? 'ยกเลิก' : '' })),
      };
    }
    if (report === 'pnd3' || report === 'pnd53') {
      const data = await this.wht(scope, month, report);
      return {
        name: report === 'pnd3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53',
        columns: [
          col('certNo', 'เลขที่หนังสือรับรอง', 'Certificate'),
          col('paidOn', 'วันที่จ่าย', 'Paid on', 'date'),
          col('payeeName', 'ผู้มีเงินได้', 'Payee'),
          col('payeeTaxId', 'เลขประจำตัวผู้เสียภาษี', 'Tax id'),
          col('payeeBranch', 'สาขา', 'Branch'),
          col('payeeAddress', 'ที่อยู่', 'Address'),
          col('incomeType', 'ประเภทเงินได้', 'Income type'),
          col('ratePct', 'อัตรา %', 'Rate %', 'percent'),
          col('baseAmount', 'จำนวนเงินที่จ่าย', 'Paid', 'money'),
          col('whtAmount', 'ภาษีที่หัก', 'Tax withheld', 'money'),
        ],
        rows: data.rows.map((x) => ({ ...x })),
      };
    }
    return this.accountingRows(scope, month, col);
  }

  /** Journal-style rows of the month for the factory's accounting software (D-367). */
  private async accountingRows(
    scope: ErpScope,
    month: string,
    col: (key: string, th: string, en: string, type?: ReportColumn['type']) => ReportColumn,
  ) {
    const r = monthRange(month);
    const f = scope.factory.id;
    const db = this.workspace.db;
    const [invoices, notes, receipts, bills, payments] = await Promise.all([
      db.erpSalesInvoice.findMany({ where: { factoryId: f, invoiceNo: { not: null }, issueDate: { gte: r.from, lt: r.to } }, include: { customer: true } }),
      db.erpSalesNote.findMany({ where: { factoryId: f, noteNo: { not: null }, issueDate: { gte: r.from, lt: r.to } }, include: { customer: true, invoice: true } }),
      db.erpCustomerReceipt.findMany({ where: { factoryId: f, receivedOn: { gte: r.from, lt: r.to } }, include: { customer: true, allocations: { include: { invoice: true } } } }),
      db.erpSupplierInvoice.findMany({ where: { factoryId: f, status: { not: 'cancelled' }, invoiceDate: { gte: r.from, lt: r.to } }, include: { supplier: true } }),
      db.erpSupplierPayment.findMany({ where: { factoryId: f, paidOn: { gte: r.from, lt: r.to } }, include: { supplier: true } }),
    ]);
    const rows: Record<string, string | number | null>[] = [
      ...invoices.map((i) => ({
        date: iso(i.issueDate),
        journal: 'sales',
        docType: i.isTaxInvoice ? 'ใบกำกับภาษี' : 'ใบแจ้งหนี้',
        docNo: i.invoiceNo,
        reference: null,
        partyCode: i.customer.code,
        partyName: i.customer.name,
        partyTaxId: i.customer.taxId,
        net: i.status === 'voided' ? '0.00' : fmtMoney(i.subtotal),
        vat: i.status === 'voided' ? '0.00' : fmtMoney(i.vatAmount),
        total: i.status === 'voided' ? '0.00' : fmtMoney(i.total),
        wht: '0.00',
        method: null,
        status: i.status,
      })),
      ...notes.map((n) => {
        const sign = n.kind === 'credit' ? -1 : 1;
        const v = n.status === 'voided';
        return {
          date: iso(n.issueDate),
          journal: 'sales',
          docType: n.kind === 'credit' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้',
          docNo: n.noteNo,
          reference: n.invoice.invoiceNo,
          partyCode: n.customer.code,
          partyName: n.customer.name,
          partyTaxId: n.customer.taxId,
          net: v ? '0.00' : fmtMoney(dec(n.difference).times(sign)),
          vat: v ? '0.00' : fmtMoney(dec(n.vatAmount).times(sign)),
          total: v ? '0.00' : fmtMoney(dec(n.total).times(sign)),
          wht: '0.00',
          method: null,
          status: n.status,
        };
      }),
      ...receipts.map((c) => ({
        date: iso(c.receivedOn),
        journal: 'receipts',
        docType: c.kind === 'refund' ? 'คืนเงิน' : 'ใบเสร็จรับเงิน',
        docNo: c.receiptNo,
        reference: c.allocations.map((a) => a.invoice.invoiceNo).join(' '),
        partyCode: c.customer.code,
        partyName: c.customer.name,
        partyTaxId: c.customer.taxId,
        net: null,
        vat: null,
        total: c.status === 'cancelled' ? '0.00' : fmtMoney(c.amount),
        wht: c.status === 'cancelled' ? '0.00' : fmtMoney(c.whtAmount),
        method: c.method,
        status: c.status,
      })),
      ...bills.map((b) => ({
        date: iso(b.invoiceDate),
        journal: 'purchases',
        docType: b.taxInvoiceNo ? 'ใบกำกับภาษีซื้อ' : 'ใบแจ้งหนี้ผู้ขาย',
        docNo: b.docNo,
        reference: b.taxInvoiceNo ?? b.invoiceNo,
        partyCode: b.supplier.code,
        partyName: b.supplier.name,
        partyTaxId: b.supplier.taxId,
        net: fmtMoney(b.subtotal),
        vat: fmtMoney(b.vatAmount),
        total: fmtMoney(b.total),
        wht: fmtMoney(b.whtAmount),
        method: null,
        status: b.status,
      })),
      ...payments.map((p) => ({
        date: iso(p.paidOn),
        journal: 'payments',
        docType: 'ใบสำคัญจ่าย',
        docNo: p.paymentNo,
        reference: p.reference,
        partyCode: p.supplier.code,
        partyName: p.supplier.name,
        partyTaxId: p.supplier.taxId,
        net: null,
        vat: null,
        total: fmtMoney(p.amount),
        wht: null,
        method: p.method,
        status: p.reversesId ? 'reversal' : 'paid',
      })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.docNo).localeCompare(String(b.docNo)));
    return {
      name: 'สมุดรายวัน (ส่งออกบัญชี)',
      columns: [
        col('date', 'วันที่', 'Date', 'date'),
        col('journal', 'สมุด', 'Journal'),
        col('docType', 'เอกสาร', 'Document'),
        col('docNo', 'เลขที่', 'Number'),
        col('reference', 'อ้างอิง', 'Reference'),
        col('partyCode', 'รหัสคู่ค้า', 'Party code'),
        col('partyName', 'คู่ค้า', 'Party'),
        col('partyTaxId', 'เลขประจำตัวผู้เสียภาษี', 'Tax id'),
        col('net', 'มูลค่าก่อนภาษี', 'Net', 'money'),
        col('vat', 'ภาษีมูลค่าเพิ่ม', 'VAT', 'money'),
        col('total', 'รวม', 'Total', 'money'),
        col('wht', 'ภาษีหัก ณ ที่จ่าย', 'WHT', 'money'),
        col('method', 'ช่องทาง', 'Method'),
        col('status', 'สถานะ', 'Status'),
      ],
      rows,
    };
  }

  // ------------------------------------------------------------------------- targets, performance

  async saveTarget(scope: ErpScope, body: ErpSaveSalesTargetDto): Promise<ErpSalesReportDto> {
    await this.workspace.tx(async (tx) => {
      const user = await factoryUser(tx, scope.factory.id, body.salespersonId);
      const month = day(`${body.month}-01`);
      await tx.erpSalesTarget.upsert({
        where: { factoryId_salespersonId_month: { factoryId: scope.factory.id, salespersonId: user.id, month } },
        create: {
          factoryId: scope.factory.id,
          salespersonId: user.id,
          month,
          targetNet: fmtMoney(dec(body.targetNet)),
          commissionPct: dec(body.commissionPct ?? '0').toFixed(4),
          createdById: scope.actor.userId,
        },
        update: {
          targetNet: fmtMoney(dec(body.targetNet)),
          ...(body.commissionPct !== undefined && { commissionPct: dec(body.commissionPct).toFixed(4) }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
    });
    return this.salesReport(scope, body.month);
  }

  /**
   * Sales by salesperson for a month (D-369): invoices issued less credit plus debit notes (net), money collected
   * on their invoices, target, achievement and commission; gross margin over the stock cost delivered.
   */
  async salesReport(scope: ErpScope, month: string): Promise<ErpSalesReportDto> {
    const r = monthRange(month);
    const f = scope.factory.id;
    const db = this.workspace.db;
    const [invoices, notes, allocations, targets] = await Promise.all([
      db.erpSalesInvoice.findMany({
        where: { factoryId: f, invoiceNo: { not: null }, status: { not: 'voided' }, issueDate: { gte: r.from, lt: r.to } },
        include: { salesperson: true, lines: { include: { deliveryNoteLine: true } } },
      }),
      db.erpSalesNote.findMany({
        where: { factoryId: f, status: 'issued', issueDate: { gte: r.from, lt: r.to } },
        include: { invoice: { include: { salesperson: true } } },
      }),
      db.erpReceiptAllocation.findMany({
        where: { receipt: { factoryId: f, status: 'issued', receivedOn: { gte: r.from, lt: r.to } } },
        include: { invoice: { include: { salesperson: true } } },
      }),
      db.erpSalesTarget.findMany({ where: { factoryId: f, month: r.from }, include: { salesperson: true } }),
    ]);
    type Acc = {
      sp: { publicId: string; displayName: string } | null;
      net: Prisma.Decimal;
      collected: Prisma.Decimal;
      cost: Prisma.Decimal;
      n: number;
    };
    const acc = new Map<string, Acc>();
    const of = (sp: { publicId: string; displayName: string } | null) => {
      const k = sp?.publicId ?? '-';
      const e = acc.get(k) ?? { sp, net: dec(0), collected: dec(0), cost: dec(0), n: 0 };
      acc.set(k, e);
      return e;
    };
    for (const i of invoices) {
      const e = of(i.salesperson);
      e.net = e.net.plus(dec(i.subtotal));
      e.n += 1;
      for (const l of i.lines)
        if (l.deliveryNoteLine?.unitCost) e.cost = e.cost.plus(dec(l.deliveryNoteLine.unitCost).times(dec(l.quantity)));
    }
    for (const n of notes) {
      const e = of(n.invoice.salesperson);
      e.net = n.kind === 'credit' ? e.net.minus(dec(n.difference)) : e.net.plus(dec(n.difference));
    }
    for (const a of allocations) of(a.invoice.salesperson).collected = of(a.invoice.salesperson).collected.plus(dec(a.amount));
    for (const t of targets) of(t.salesperson);
    const rows: ErpSalesPerformanceDto[] = [...acc.values()].map((e) => {
      const t = targets.find((x) => x.salesperson.publicId === e.sp?.publicId);
      const rate = t ? dec(t.commissionPct) : dec(0);
      return {
        salesperson: e.sp ? userRef(e.sp) : null,
        month,
        targetNet: t ? fmtMoney(t.targetNet) : null,
        invoicedNet: fmtMoney(e.net),
        collected: fmtMoney(e.collected),
        achievementPct: t && dec(t.targetNet).gt(0) ? e.net.times(100).div(dec(t.targetNet)).toFixed(1) : null,
        commissionPct: rate.toFixed(4),
        commission: fmtMoney(money2(e.net.times(rate).div(100))),
        invoices: e.n,
        targetId: t?.publicId ?? null,
      };
    });
    rows.sort((a, b) => dec(b.invoicedNet).comparedTo(dec(a.invoicedNet)));
    const sum = (k: 'invoicedNet' | 'commission') => fmtMoney(rows.reduce((a, x) => a.plus(dec(x[k])), dec(0)));
    const cost = [...acc.values()].reduce((a, e) => a.plus(e.cost), dec(0));
    return {
      month,
      rows,
      invoicedNet: sum('invoicedNet'),
      targetNet: fmtMoney(targets.reduce((a, t) => a.plus(dec(t.targetNet)), dec(0))),
      commission: sum('commission'),
      grossProfit: fmtMoney(money2(dec(sum('invoicedNet')).minus(cost))),
    };
  }
}

function certDto(r: CertRow, perms: ReadonlySet<string>): ErpWhtCertificateDto {
  return {
    id: r.publicId,
    certNo: r.certNo,
    status: r.status,
    form: r.form,
    payment: { id: r.payment.publicId, code: r.payment.paymentNo, name: r.payment.paymentNo },
    supplier: partnerRef(r.supplier),
    paidOn: iso(r.paidOn)!,
    baseAmount: fmtMoney(r.baseAmount),
    whtAmount: fmtMoney(r.whtAmount),
    payer: party(r.payerSnapshot)!,
    payee: party(r.payeeSnapshot)!,
    lines: r.lines.map((l) => ({
      lineNo: l.lineNo,
      incomeType: l.incomeType,
      description: l.description,
      ratePct: dec(l.ratePct).toFixed(4),
      baseAmount: fmtMoney(l.baseAmount),
      whtAmount: fmtMoney(l.whtAmount),
    })),
    voidReason: r.voidReason,
    createdAt: isoTs(r.createdAt)!,
    nextActions: nextActions({ status: r.status }, WHT_ACTIONS, perms),
  };
}
