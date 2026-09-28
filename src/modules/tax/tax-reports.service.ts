import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type FiscalPeriod,
  type Prisma,
  type TaxCode,
  type TaxReport,
  type TaxReportKind,
} from '@generated/prisma/client';
import { CompanyBankAccountsService } from '@modules/banking/company-bank-accounts.service';
import { dateOnly, dayOf, isDay } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import { type BuyerSnapshot } from '@modules/receivables/customer-documents.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

import { TaxCalendarService } from './tax-calendar.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const TAX_REPORT_SOURCE = 'tax_report';
/** Postings of the tax reports themselves (P27, P27P, P28) are not report lines and not GL movement to reconcile. */
const NOT_TAX_REPORT: Prisma.JournalEntryWhereInput = {
  status: 'posted',
  OR: [{ sourceDocumentType: null }, { sourceDocumentType: { not: TAX_REPORT_SOURCE } }],
};

export type ReportLine = Record<string, string | number | boolean | null>;
interface Built {
  lines: ReportLine[];
  totals: Record<string, string>;
  report: MoneyValue;
  gl: MoneyValue;
}

export const REPORT_INCLUDE = {
  fiscalPeriod: { select: { publicId: true, startDate: true, endDate: true, status: true } },
  companyBankAccount: { select: { publicId: true, accountNoLast4: true } },
} as const satisfies Prisma.TaxReportInclude;
export type ReportRow = Prisma.TaxReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

const label = (p: { startDate: Date }) => dayOf(p.startDate).slice(0, 7);
const csvField = (v: string | number | boolean | null | undefined) => {
  const s = v === null || v === undefined ? '' : `${v}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/**
 * Tax reports and working papers (accounting-design §2, §6, §7 step 7, D-033): the sales and purchase tax
 * reports from the journal lines the posting rules tagged (output / input VAT with their bases, by source
 * document), the ภ.พ.30 working paper (P27 on finalising, P27P on payment), ภ.ง.ด.3 / ภ.ง.ด.53 from the 50 ทวิ
 * issued with the attachment export (P28 on remittance), and the WHT registers (issued / received). Each report
 * reconciles to its GL control accounts (setting `tax.gl_accounts`); it is final only at a difference of 0.
 * Late documents are reported in the period they were posted to, with their own date and a `late` flag.
 */
@Injectable()
export class TaxReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly periods: PeriodsService,
    private readonly settings: SettingsService,
    private readonly accounts: CompanyBankAccountsService,
    private readonly files: FilesService,
    private readonly calendar: TaxCalendarService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async period(month: string): Promise<FiscalPeriod> {
    if (!/^\d{4}-\d{2}$/.test(month) || !isDay(`${month}-01`))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'period', code: 'pattern', message: 'YYYY-MM' }],
      });
    return this.periods.periodOf(await this.entities.defaultEntityId(), `${month}-01`);
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<ReportRow> {
    const row = await db.taxReport.findUnique({ where: { publicId }, include: REPORT_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.TaxReportWhereInput) {
    return this.prisma.taxReport.findMany({
      where,
      include: REPORT_INCLUDE,
      orderBy: [{ fiscalPeriod: { startDate: 'desc' } }, { kind: 'asc' }],
      take: 200,
    });
  }

  /** Builds (or rebuilds while draft) the report of a month. */
  async generate(actor: UserActor, kind: TaxReportKind, month: string): Promise<ReportRow> {
    const period = await this.period(month);
    const id = await this.prisma.withTx(async (tx) => {
      const existing = await tx.taxReport.findUnique({
        where: {
          entityId_kind_fiscalPeriodId: { entityId: period.entityId, kind, fiscalPeriodId: period.id },
        },
      });
      if (existing && existing.status !== 'draft')
        throw new DomainException('tax.report_not_draft', { params: { status: existing.status } });
      const built = await this.build(tx, kind, period);
      const data = {
        totals: built.totals,
        lines: built.lines as Prisma.InputJsonValue,
        lineCount: built.lines.length,
        reportAmount: formatMoney(built.report),
        glAmount: formatMoney(built.gl),
        glDifference: formatMoney(built.gl.sub(built.report)),
        generatedAt: new Date(),
        generatedById: actor.userId,
      };
      const row = existing
        ? await tx.taxReport.update({
            where: { id: existing.id },
            data: { ...data, rowVersion: { increment: 1 } },
          })
        : await tx.taxReport.create({
            data: { entityId: period.entityId, kind, fiscalPeriodId: period.id, ...data },
          });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'tax_report.generated',
        actor,
        resourceType: 'tax_report',
        resourcePublicId: row.publicId,
        entityId: row.entityId,
        data: { kind, period: month, report: data.reportAmount, difference: data.glDifference },
      });
      return row.publicId;
    });
    return this.get(id);
  }

  /**
   * Final: rebuilt in the transaction, refused unless it agrees with the GL (§7 step 7), its CSV (for ภ.ง.ด.3 /
   * 53 the attachment) stored as a financial record; the ภ.พ.30 working paper closes the month's VAT (P27).
   */
  async finalise(actor: UserActor, publicId: string): Promise<ReportRow> {
    await this.prisma.withTx(async (tx) => {
      const report = await this.lock(tx, publicId);
      if (report.status !== 'draft')
        throw new DomainException('tax.report_not_draft', { params: { status: report.status } });
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: report.fiscalPeriodId } });
      const built = await this.build(tx, report.kind, period);
      const difference = built.gl.sub(built.report);
      if (!difference.isZero())
        throw new DomainException('tax.gl_difference', {
          params: {
            difference: formatMoney(difference),
            report: formatMoney(built.report),
            gl: formatMoney(built.gl),
          },
        });
      const file = await this.files.storeSystem({
        body: this.csv(report.kind, built.lines),
        fileName: `${report.kind}-${label(period)}.csv`,
        mimeType: 'text/csv',
        retentionClass: 'financial_record',
        ownerUserId: actor.userId,
      });
      await tx.taxReport.update({
        where: { id: report.id },
        data: {
          totals: built.totals,
          lines: built.lines,
          lineCount: built.lines.length,
          reportAmount: formatMoney(built.report),
          glAmount: formatMoney(built.gl),
          glDifference: '0.00',
          generatedAt: new Date(),
          generatedById: actor.userId,
          fileObjectIds: [file.id],
          rowVersion: { increment: 1 },
        },
      });
      await tx.taxReport.update({
        where: { id: report.id },
        data: {
          status: 'final',
          finalisedAt: new Date(),
          finalisedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'tax_report.finalised',
        actor,
        resourceType: 'tax_report',
        resourcePublicId: report.publicId,
        entityId: report.entityId,
        data: { kind: report.kind, period: label(period), report: formatMoney(built.report) },
      });
      await this.events.record(
        tx,
        {
          type: 'tax_report.finalised',
          aggregateType: 'tax_report',
          aggregateId: report.publicId,
          entityId: report.entityId,
          payload: {
            taxReportId: report.publicId,
            kind: report.kind,
            periodLabel: label(period),
            reportAmount: formatMoney(built.report),
          },
        },
        actor,
      );
      if (report.kind === 'pp30')
        await this.events.record(
          tx,
          {
            type: 'vat_return.closed',
            aggregateType: 'tax_report',
            aggregateId: report.publicId,
            entityId: report.entityId,
            payload: {
              taxReportId: report.publicId,
              periodLabel: label(period),
              closedOn: dayOf(period.endDate),
              outputVat: built.totals['outputVat']!,
              outputBase: built.totals['outputBase']!,
              inputVat: built.totals['inputVat']!,
              inputBase: built.totals['inputBase']!,
            },
          },
          actor,
        );
    });
    return this.get(publicId);
  }

  /** The return was filed with the Revenue Department (its reference); the calendar item is done. */
  async file(
    actor: UserActor,
    publicId: string,
    input: { filingRef: string; filedAt?: Date },
  ): Promise<ReportRow> {
    await this.prisma.withTx(async (tx) => {
      const report = await this.lock(tx, publicId);
      if (report.status !== 'final')
        throw new DomainException('tax.report_not_final', { params: { status: report.status } });
      await tx.taxReport.update({
        where: { id: report.id },
        data: {
          status: 'filed',
          filedAt: input.filedAt ?? new Date(),
          filingRef: input.filingRef,
          rowVersion: { increment: 1 },
        },
      });
      await this.calendar.markDone(tx, report);
      await this.audit.record(tx, {
        category: 'finance',
        action: 'tax_report.filed',
        actor,
        resourceType: 'tax_report',
        resourcePublicId: report.publicId,
        entityId: report.entityId,
        data: { filingRef: input.filingRef },
      });
      await this.events.record(
        tx,
        {
          type: 'tax_report.filed',
          aggregateType: 'tax_report',
          aggregateId: report.publicId,
          entityId: report.entityId,
          payload: { taxReportId: report.publicId, kind: report.kind, filingRef: input.filingRef },
        },
        actor,
      );
    });
    return this.get(publicId);
  }

  /** The VAT (P27P) or the withholding tax (P28) paid to the Revenue Department from a company bank account. */
  async pay(
    actor: UserActor,
    publicId: string,
    input: { paidOn: string; companyBankAccountId: string },
  ): Promise<ReportRow> {
    if (!isDay(input.paidOn))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'paidOn', code: 'date', message: 'YYYY-MM-DD' }],
      });
    await this.prisma.withTx(async (tx) => {
      const report = await this.lock(tx, publicId);
      if (!['pp30', 'pnd3', 'pnd53'].includes(report.kind) || report.status === 'draft' || report.paidOn)
        throw new DomainException('tax.report_not_payable', {
          params: { kind: report.kind, status: report.status },
        });
      const bank = await this.accounts.active(input.companyBankAccountId, tx);
      const bankRow = await tx.companyBankAccount.findUniqueOrThrow({ where: { publicId: bank.publicId } });
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: report.fiscalPeriodId } });
      const totals = report.totals as Record<string, string>;
      const amount =
        report.kind === 'pp30' ? MoneyDecimal.max(D(report.reportAmount), 0) : D(report.reportAmount);
      await tx.taxReport.update({
        where: { id: report.id },
        data: {
          paidOn: dateOnly(input.paidOn),
          paidAmount: formatMoney(amount),
          companyBankAccountId: bankRow.id,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'tax_report.paid',
        actor,
        resourceType: 'tax_report',
        resourcePublicId: report.publicId,
        entityId: report.entityId,
        data: { amount: formatMoney(amount), paidOn: input.paidOn, account: bank.accountNoLast4 },
      });
      if (amount.isZero()) return;
      const common: Record<string, string> = {
        taxReportId: report.publicId,
        periodLabel: label(period),
        paidOn: input.paidOn,
        amount: formatMoney(amount),
        bankAccountCode: bank.glAccount.code,
      };
      await this.events.record(
        tx,
        report.kind === 'pp30'
          ? {
              type: 'vat_return.paid',
              aggregateType: 'tax_report',
              aggregateId: report.publicId,
              entityId: report.entityId,
              payload: common,
            }
          : {
              type: 'wht_remittance.paid',
              aggregateType: 'tax_report',
              aggregateId: report.publicId,
              entityId: report.entityId,
              payload: { ...common, whtForm: report.kind, base: totals['whtBase'] ?? '0.00' },
            },
        actor,
      );
    });
    return this.get(publicId);
  }

  async fileId(publicId: string): Promise<bigint | null> {
    return (await this.get(publicId)).fileObjectIds[0] ?? null;
  }

  private async lock(tx: Tx, publicId: string): Promise<TaxReport> {
    const found = await tx.taxReport.findUnique({ where: { publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM tax_reports WHERE id = ${found.id} FOR UPDATE`;
    return tx.taxReport.findUniqueOrThrow({ where: { id: found.id } });
  }

  // --- building ------------------------------------------------------------------------------------------

  async build(tx: Tx, kind: TaxReportKind, period: FiscalPeriod): Promise<Built> {
    const gl = (await this.settings.at('tax.gl_accounts', { at: period.endDate, tx })).value;
    switch (kind) {
      case 'sales_tax':
        return this.vatReport(tx, period, 'output_vat', gl.output_vat);
      case 'purchase_tax':
        return this.vatReport(tx, period, 'input_vat', gl.input_vat);
      case 'pp30': {
        const sales = await this.vatReport(tx, period, 'output_vat', gl.output_vat);
        const purchases = await this.vatReport(tx, period, 'input_vat', gl.input_vat);
        const net = sales.report.sub(purchases.report);
        const lateOut = sales.lines
          .filter((l) => l['late'] === true)
          .reduce((a, l) => a.add(String(l['vat'])), ZERO());
        return {
          lines: [
            {
              key: 'output_vat',
              label: 'ภาษีขาย',
              base: sales.totals['base']!,
              vat: sales.totals['vat']!,
              gl: formatMoney(sales.gl),
              documents: sales.lines.length,
            },
            {
              key: 'input_vat',
              label: 'ภาษีซื้อ',
              base: purchases.totals['base']!,
              vat: purchases.totals['vat']!,
              gl: formatMoney(purchases.gl),
              documents: purchases.lines.length,
            },
            {
              key: 'late_output_vat',
              label: 'ภาษีขายของเดือนก่อน (ยื่นเพิ่มเติม)',
              base: null,
              vat: formatMoney(lateOut),
              gl: null,
              documents: sales.lines.filter((l) => l['late'] === true).length,
            },
          ],
          totals: {
            outputVat: sales.totals['vat']!,
            outputBase: sales.totals['base']!,
            inputVat: purchases.totals['vat']!,
            inputBase: purchases.totals['base']!,
            netPayable: formatMoney(MoneyDecimal.max(net, 0)),
            creditCarriedForward: formatMoney(MoneyDecimal.max(net.neg(), 0)),
          },
          report: net,
          gl: sales.gl.sub(purchases.gl),
        };
      }
      case 'pnd3':
      case 'pnd53':
        return this.whtIssued(tx, period, kind, kind === 'pnd3' ? gl.wht_pnd3 : gl.wht_pnd53);
      case 'wht_issued_register':
        return this.whtIssued(tx, period, null, [...gl.wht_pnd3, ...gl.wht_pnd53]);
      case 'wht_received_register':
        return this.whtReceived(tx, period, gl.wht_receivable);
    }
  }

  /** Σ of GL movement on `codes` in the period, credit-positive or debit-positive. */
  private async glMovement(
    tx: Tx,
    period: FiscalPeriod,
    codes: string[],
    side: 'credit' | 'debit',
  ): Promise<MoneyValue> {
    const sum = await tx.journalLine.aggregate({
      where: { fiscalPeriodId: period.id, account: { code: { in: codes } }, journalEntry: NOT_TAX_REPORT },
      _sum: { debit: true, credit: true },
    });
    const dr = D(sum._sum.debit ?? 0);
    const cr = D(sum._sum.credit ?? 0);
    return side === 'credit' ? cr.sub(dr) : dr.sub(cr);
  }

  private async vatReport(
    tx: Tx,
    period: FiscalPeriod,
    code: Extract<TaxCode, 'output_vat' | 'input_vat'>,
    accounts: string[],
  ): Promise<Built> {
    const credit = code === 'output_vat';
    const rows = await tx.journalLine.findMany({
      where: { fiscalPeriodId: period.id, taxCode: code, journalEntry: NOT_TAX_REPORT },
      include: {
        journalEntry: {
          select: {
            publicId: true,
            entryNo: true,
            documentDate: true,
            sourceDocumentType: true,
            sourceDocumentPublicId: true,
            sourceDocumentNo: true,
          },
        },
        vendor: { select: { legalName: true, taxId: true, branchCode: true } },
        customer: { select: { displayName: true } },
      },
      orderBy: { id: 'asc' },
    });
    const byEntry = new Map<bigint, { row: (typeof rows)[number]; vat: MoneyValue; base: MoneyValue }>();
    for (const r of rows) {
      // VAT in the report's direction (output: credit, input: debit); a reversal or credit note is negative and
      // so is its base.
      const amount = credit ? D(r.credit).sub(D(r.debit)) : D(r.debit).sub(D(r.credit));
      const magnitude = D(r.taxBaseAmount ?? 0).abs();
      const base = amount.isNegative() ? magnitude.neg() : magnitude;
      const acc = byEntry.get(r.journalEntryId) ?? { row: r, vat: ZERO(), base: ZERO() };
      acc.vat = acc.vat.add(amount);
      acc.base = acc.base.add(base);
      byEntry.set(r.journalEntryId, acc);
    }
    const docIds = [...byEntry.values()]
      .filter((e) => e.row.journalEntry.sourceDocumentType === 'customer_document')
      .map((e) => e.row.journalEntry.sourceDocumentPublicId!);
    const docs = new Map(
      (
        await tx.customerDocument.findMany({
          where: { publicId: { in: docIds } },
          select: { publicId: true, buyerSnapshot: true, docType: true },
        })
      ).map((d) => [d.publicId, d]),
    );
    const invoiceNos = await this.supplierInvoiceNumbers(
      tx,
      [...byEntry.values()].map((e) => e.row.journalEntry),
    );
    const lines: ReportLine[] = [];
    let vat = ZERO();
    let base = ZERO();
    for (const { row, vat: v, base: b } of byEntry.values()) {
      const e = row.journalEntry;
      const doc = e.sourceDocumentPublicId ? docs.get(e.sourceDocumentPublicId) : undefined;
      const buyer = doc?.buyerSnapshot as BuyerSnapshot | undefined;
      vat = vat.add(v);
      base = base.add(b);
      lines.push({
        seq: lines.length + 1,
        documentDate: dayOf(e.documentDate),
        documentNo:
          (credit ? e.sourceDocumentNo : (invoiceNos.get(e.publicId) ?? e.sourceDocumentNo)) ?? e.entryNo,
        sourceType: e.sourceDocumentType,
        sourceId: e.sourceDocumentPublicId,
        journalEntryId: e.publicId,
        partyName: credit
          ? (buyer?.name ?? row.customer?.displayName ?? null)
          : (row.vendor?.legalName ?? null),
        partyTaxId: credit ? (buyer?.taxId ?? null) : (row.vendor?.taxId ?? null),
        partyBranch: credit ? (buyer?.branchCode ?? null) : (row.vendor?.branchCode ?? null),
        base: formatMoney(b),
        vat: formatMoney(v),
        late: e.documentDate < period.startDate,
      });
    }
    lines.sort(
      (a, b) =>
        String(a['documentDate']).localeCompare(String(b['documentDate'])) ||
        String(a['documentNo']).localeCompare(String(b['documentNo'])),
    );
    lines.forEach((l, i) => (l['seq'] = i + 1));
    return {
      lines,
      totals: { vat: formatMoney(vat), base: formatMoney(base) },
      report: vat,
      gl: await this.glMovement(tx, period, accounts, credit ? 'credit' : 'debit'),
    };
  }

  /** The supplier's own tax invoice numbers behind a payout (input VAT claimed at payment, P14 / P17). */
  private async supplierInvoiceNumbers(
    tx: Tx,
    entries: { publicId: string; sourceDocumentType: string | null; sourceDocumentPublicId: string | null }[],
  ) {
    const out = new Map<string, string>();
    for (const e of entries) {
      if (e.sourceDocumentType !== 'payout_item' || !e.sourceDocumentPublicId) continue;
      const invoices = await tx.vendorInvoice.findMany({
        where: {
          status: 'validated',
          billingStatement: {
            lines: {
              some: {
                goodsReceipt: {
                  po: {
                    payableItems: {
                      some: { allocations: { some: { payoutItem: { publicId: e.sourceDocumentPublicId } } } },
                    },
                  },
                },
              },
            },
          },
        },
        select: { vendorInvoiceNo: true },
      });
      if (invoices.length) out.set(e.publicId, invoices.map((i) => i.vendorInvoiceNo).join(', '));
    }
    return out;
  }

  private async whtIssued(
    tx: Tx,
    period: FiscalPeriod,
    form: 'pnd3' | 'pnd53' | null,
    accounts: string[],
  ): Promise<Built> {
    const certs = await tx.whtCertificate.findMany({
      where: {
        entityId: period.entityId,
        paidOn: { gte: period.startDate, lte: period.endDate },
        ...(form && { form, status: 'issued' }),
      },
      include: {
        vendor: {
          select: {
            legalName: true,
            taxId: true,
            branchCode: true,
            addressLine1: true,
            addressLine2: true,
            postcode: true,
          },
        },
      },
      orderBy: [{ paidOn: 'asc' }, { wtNumber: 'asc' }],
    });
    let wht = ZERO();
    let base = ZERO();
    const lines = certs.map((c, i): ReportLine => {
      if (c.status === 'issued') {
        wht = wht.add(D(c.whtAmount));
        base = base.add(D(c.paidAmount));
      }
      return {
        seq: i + 1,
        wtNumber: c.wtNumber,
        form: c.form,
        taxId: c.vendor.taxId,
        branch: c.vendor.branchCode,
        name: c.vendor.legalName,
        address:
          [c.vendor.addressLine1, c.vendor.addressLine2, c.vendor.postcode].filter(Boolean).join(' ') || null,
        paidOn: dayOf(c.paidOn),
        incomeType: c.incomeTypeCode,
        ratePct: c.whtRatePct.toFixed(2),
        paidAmount: formatMoney(D(c.paidAmount)),
        whtAmount: formatMoney(D(c.whtAmount)),
        // 1 = withheld at source (the Revenue Department's condition code on the attachment).
        condition: 1,
        status: c.status,
      };
    });
    return {
      lines,
      totals: { whtAmount: formatMoney(wht), whtBase: formatMoney(base), certificates: String(lines.length) },
      report: wht,
      gl: await this.glMovement(tx, period, accounts, 'credit'),
    };
  }

  private async whtReceived(tx: Tx, period: FiscalPeriod, accounts: string[]): Promise<Built> {
    const certs = await tx.customerWhtCertificate.findMany({
      where: {
        entityId: period.entityId,
        customerDocument: { documentDate: { gte: period.startDate, lte: period.endDate } },
      },
      include: { customerDocument: { select: { docNumber: true, documentDate: true, buyerSnapshot: true } } },
      orderBy: { id: 'asc' },
    });
    let wht = ZERO();
    let base = ZERO();
    const lines = certs.map((c, i): ReportLine => {
      wht = wht.add(D(c.whtAmount));
      base = base.add(D(c.whtBase));
      const buyer = c.customerDocument.buyerSnapshot as unknown as BuyerSnapshot;
      return {
        seq: i + 1,
        documentNo: c.customerDocument.docNumber,
        documentDate: dayOf(c.customerDocument.documentDate),
        name: buyer.name,
        taxId: buyer.taxId,
        base: formatMoney(D(c.whtBase)),
        whtAmount: formatMoney(D(c.whtAmount)),
        status: c.status,
        certificateNo: c.certificateNo,
      };
    });
    const pending = certs
      .filter((c) => c.status === 'pending')
      .reduce((a, c) => a.add(D(c.whtAmount)), ZERO());
    return {
      lines,
      totals: {
        whtAmount: formatMoney(wht),
        whtBase: formatMoney(base),
        pendingAmount: formatMoney(pending),
      },
      report: wht,
      gl: await this.glMovement(tx, period, accounts, 'debit'),
    };
  }

  /** The report as CSV (UTF-8 with BOM for spreadsheet tools); for ภ.ง.ด.3 / 53 the attachment layout. */
  csv(kind: TaxReportKind, lines: ReportLine[]): Buffer {
    const columns = lines.length ? Object.keys(lines[0]!) : ['seq'];
    const body = [columns.join(','), ...lines.map((l) => columns.map((c) => csvField(l[c])).join(','))].join(
      '\r\n',
    );
    return Buffer.from(`\uFEFF${body}\r\n`, 'utf8');
  }
}
