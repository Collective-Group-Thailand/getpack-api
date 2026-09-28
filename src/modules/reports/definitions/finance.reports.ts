import { MoneyDecimal } from '@common/money/money';
import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { PeriodsService } from '@modules/ledger/periods.service';
import { AGING_BUCKETS, ReceivablesService } from '@modules/receivables/receivables.service';
import { TaxReportsService } from '@modules/tax/tax-reports.service';
import { EntitiesService } from '@platform/entities/entities.service';

import { paged, type ReportDefinition } from '../report-types';
import { bangkokRange, col, day, iso, money } from './helpers';

const D = (v: { toString(): string } | null | undefined) => new MoneyDecimal((v ?? 0).toString());
const PROVIDERS = ['scb', 'twoc2p', 'slip', 'bank', 'internal'] as const;

/** Sales tax report (ภาษีขาย) of a month, from the posted journal lines tagged output VAT (B5.4). */
export const SALES_TAX_REPORT: ReportDefinition = {
  key: 'sales_tax',
  nameTh: 'รายงานภาษีขาย',
  nameEn: 'Sales tax report',
  description:
    'One line per document with output VAT posted in the month (buyer, tax id, branch, base, VAT; late documents flagged) — the same lines as the B5.4 working paper, available before it is finalised.',
  decisions: ['D-033', 'D-092'],
  permission: 'tax.read',
  filters: [{ key: 'period', kind: 'month', required: true }],
  columns: [
    col('seq', 'ลำดับ', 'No.', 'integer'),
    col('documentDate', 'วันที่', 'Date', 'date'),
    col('documentNo', 'เลขที่เอกสาร', 'Document no.'),
    col('partyName', 'ชื่อผู้ซื้อ', 'Buyer'),
    col('partyTaxId', 'เลขประจำตัวผู้เสียภาษี', 'Tax id'),
    col('partyBranch', 'สาขา', 'Branch'),
    col('base', 'มูลค่าสินค้าหรือบริการ', 'Base', 'money'),
    col('vat', 'ภาษีมูลค่าเพิ่ม', 'VAT', 'money'),
    col('late', 'เอกสารล่าช้า', 'Late', 'boolean'),
  ],
  async *rows({ prisma, filters, get }) {
    const entityId = await get(EntitiesService).defaultEntityId();
    const period = await get(PeriodsService).periodOf(entityId, `${filters.month}-01`);
    const built = await get(TaxReportsService).build(prisma, 'sales_tax', period);
    for (const l of built.lines)
      yield {
        seq: l['seq'] ?? null,
        documentDate: l['documentDate'] ?? null,
        documentNo: l['documentNo'] ?? null,
        partyName: l['partyName'] ?? null,
        partyTaxId: l['partyTaxId'] ?? null,
        partyBranch: l['partyBranch'] ?? null,
        base: l['base'] ?? null,
        vat: l['vat'] ?? null,
        late: l['late'] ?? null,
      };
  },
};

/**
 * Payments per channel with fees, VAT on fees, withholding, net and settlement date. A gateway reports VAT on its
 * fees per settlement; a payment's share is pro-rata to its fee (rounded to the satang, so shares may differ from
 * the settlement's VAT by a rounding satang — the settlement total is what the ledger posts, P04).
 */
export const PAYMENTS_REPORT: ReportDefinition = {
  key: 'payments_by_channel',
  nameTh: 'รายงานรับชำระตามช่องทาง',
  nameEn: 'Payments by channel',
  description:
    'Successful payments of the period with method, provider, channel, amount, withholding, cash, gateway fee and its VAT, net received and the settlement date (D-061, D-176).',
  decisions: ['D-061', 'D-176'],
  permission: 'payments.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'provider', kind: 'enum', required: false, values: PROVIDERS },
  ],
  columns: [
    col('paidAt', 'วันที่ชำระ', 'Paid at', 'datetime'),
    col('referenceCode', 'เลขอ้างอิง', 'Reference'),
    col('groupCode', 'เลขที่กลุ่มคำสั่งซื้อ', 'Order group'),
    col('channel', 'ช่องทางขาย', 'Sales channel'),
    col('method', 'วิธีชำระ', 'Method'),
    col('provider', 'ผู้ให้บริการ', 'Provider'),
    col('status', 'สถานะ', 'Status'),
    col('amount', 'ยอดชำระ', 'Amount', 'money'),
    col('wht', 'ภาษีหัก ณ ที่จ่าย', 'WHT', 'money'),
    col('cash', 'เงินที่ได้รับ', 'Cash', 'money'),
    col('fee', 'ค่าธรรมเนียม', 'Fee', 'money'),
    col('vatOnFee', 'VAT ค่าธรรมเนียม', 'VAT on fee', 'money'),
    col('net', 'สุทธิ', 'Net', 'money'),
    col('refunded', 'คืนเงินแล้ว', 'Refunded', 'money'),
    col('settlementDate', 'วันที่เงินเข้าบัญชี', 'Settlement date', 'date'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.PaymentWhereInput = {
      paidAt: bangkokRange(filters),
      status: { in: ['succeeded', 'refunded', 'partially_refunded'] },
      ...(filters.provider && { provider: filters.provider as (typeof PROVIDERS)[number] }),
    };
    for await (const p of paged((after, take) =>
      prisma.payment.findMany({
        where: { ...where, id: { gt: after } },
        include: {
          orderGroup: { select: { groupCode: true, channel: true } },
          gatewaySettlementLines: {
            include: { settlement: { select: { settlementDate: true, feeAmount: true, vatOnFee: true } } },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    )) {
      const line = p.gatewaySettlementLines[0];
      const fee = line ? D(line.feeAmount) : D(p.feeAmount);
      const vatOnFee =
        line && !D(line.settlement.feeAmount).isZero()
          ? D(line.settlement.vatOnFee)
              .times(line.feeAmount.toString())
              .dividedBy(line.settlement.feeAmount.toString())
              .toDecimalPlaces(2)
          : new MoneyDecimal(0);
      yield {
        paidAt: iso(p.paidAt),
        referenceCode: p.referenceCode,
        groupCode: p.orderGroup?.groupCode ?? null,
        channel: p.orderGroup?.channel ?? null,
        method: p.method,
        provider: p.provider,
        status: p.status,
        amount: money(p.amount),
        wht: money(p.whtAmount),
        cash: money(p.cashAmount),
        fee: fee.toFixed(2),
        vatOnFee: vatOnFee.toFixed(2),
        net: D(p.cashAmount).minus(fee).minus(vatOnFee).toFixed(2),
        refunded: money(p.refundedAmount),
        settlementDate: line ? day(line.settlement.settlementDate) : null,
      };
    }
  },
};

/** AR aging (accounting-design §6) from the receivables sub-ledger. */
export const AR_AGING_REPORT: ReportDefinition = {
  key: 'ar_aging',
  nameTh: 'รายงานอายุลูกหนี้',
  nameEn: 'AR aging',
  description:
    'Open receivables at a date per customer or company, by days past due (current, 1–30, 31–60, 61–90, over 90).',
  decisions: ['D-032', 'D-122'],
  permission: 'receivables.read',
  filters: [{ key: 'period', kind: 'as_of', required: true }],
  columns: [
    col('party', 'ประเภท', 'Party'),
    col('code', 'รหัส', 'Code'),
    col('name', 'ชื่อ', 'Name'),
    col('current', 'ยังไม่ถึงกำหนด', 'Current', 'money'),
    col('d1_30', '1–30 วัน', '1–30 days', 'money'),
    col('d31_60', '31–60 วัน', '31–60 days', 'money'),
    col('d61_90', '61–90 วัน', '61–90 days', 'money'),
    col('over_90', 'เกิน 90 วัน', 'Over 90 days', 'money'),
    col('total', 'รวม', 'Total', 'money'),
  ],
  async *rows({ filters, get }) {
    const report = await get(ReceivablesService).aging(filters.asOf!);
    for (const p of report.parties) {
      const total = AGING_BUCKETS.reduce((a, b) => a.plus(p.buckets[b].toString()), new MoneyDecimal(0));
      yield {
        party: p.company ? 'company' : 'customer',
        code: p.company?.companyCode ?? null,
        name: p.company?.legalName ?? p.customer.displayName,
        ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, p.buckets[b].toFixed(2)])),
        total: total.toFixed(2),
      };
    }
  },
};

/** AP aging from the payables sub-ledger (B5.3): open amounts by days since they became payable. */
export const AP_AGING_REPORT: ReportDefinition = {
  key: 'ap_aging',
  nameTh: 'รายงานอายุเจ้าหนี้',
  nameEn: 'AP aging',
  description:
    'Open payables (net + VAT) at a date per vendor: not yet payable (before the payout policy makes them eligible, D-022) and by days since they became payable.',
  decisions: ['D-022', 'D-032'],
  permission: 'payables.read',
  filters: [{ key: 'period', kind: 'as_of', required: true }],
  columns: [
    col('vendor', 'ผู้ขาย', 'Vendor'),
    col('factoryCode', 'รหัสโรงงาน', 'Factory'),
    col('notYetPayable', 'ยังไม่ถึงกำหนดจ่าย', 'Not yet payable', 'money'),
    col('d0_30', '0–30 วัน', '0–30 days', 'money'),
    col('d31_60', '31–60 วัน', '31–60 days', 'money'),
    col('d61_90', '61–90 วัน', '61–90 days', 'money'),
    col('over_90', 'เกิน 90 วัน', 'Over 90 days', 'money'),
    col('total', 'รวม', 'Total', 'money'),
  ],
  async *rows({ prisma, filters }) {
    const end = startOfBangkokDay(addCalendarDays(filters.asOf!, 1));
    const rows = await prisma.$queryRaw<Record<string, string | null>[]>`
      WITH items AS (
        SELECT p.vendor_id, p.open_net_amount + p.open_vat_amount AS open,
               CASE WHEN p.eligible_at IS NULL OR p.eligible_at >= ${end} THEN NULL
                    ELSE (${end}::timestamptz - p.eligible_at) END AS age
        FROM payable_items p
        WHERE p.status IN ('open', 'eligible', 'in_run') AND p.created_at < ${end} AND p.open_net_amount + p.open_vat_amount <> 0
      )
      SELECT v.legal_name AS vendor, (SELECT f.code FROM factories f WHERE f.vendor_id = v.id LIMIT 1) AS factory_code,
             sum(open) FILTER (WHERE age IS NULL)::text AS not_yet,
             sum(open) FILTER (WHERE age < interval '31 days')::text AS d0_30,
             sum(open) FILTER (WHERE age >= interval '31 days' AND age < interval '61 days')::text AS d31_60,
             sum(open) FILTER (WHERE age >= interval '61 days' AND age < interval '91 days')::text AS d61_90,
             sum(open) FILTER (WHERE age >= interval '91 days')::text AS over_90,
             sum(open)::text AS total
      FROM items i JOIN vendors v ON v.id = i.vendor_id
      GROUP BY v.id ORDER BY v.legal_name`;
    for (const r of rows)
      yield {
        vendor: r['vendor'] ?? null,
        factoryCode: r['factory_code'] ?? null,
        notYetPayable: D(r['not_yet']).toFixed(2),
        d0_30: D(r['d0_30']).toFixed(2),
        d31_60: D(r['d31_60']).toFixed(2),
        d61_90: D(r['d61_90']).toFixed(2),
        over_90: D(r['over_90']).toFixed(2),
        total: D(r['total']).toFixed(2),
      };
  },
};

/** Payout history: every item of the payout runs paid (or planned) in the period (D-022, D-166). */
export const PAYOUT_HISTORY_REPORT: ReportDefinition = {
  key: 'payout_history',
  nameTh: 'ประวัติการจ่ายเงินโรงงานและผู้ขาย',
  nameEn: 'Payout history',
  description:
    'Items of the payout runs with a pay date in the period: vendor, kind (advance, balance, retention release, vendor bill), net, VAT, WHT, retention, cash, status and payment date.',
  decisions: ['D-022', 'D-093', 'D-164', 'D-166'],
  permission: 'payables.read',
  filters: [{ key: 'period', kind: 'range', required: true }],
  columns: [
    col('runNo', 'เลขที่รอบจ่าย', 'Run'),
    col('payOn', 'วันที่จ่าย', 'Pay date', 'date'),
    col('runStatus', 'สถานะรอบ', 'Run status'),
    col('vendor', 'ผู้รับเงิน', 'Vendor'),
    col('factoryCode', 'รหัสโรงงาน', 'Factory'),
    col('kind', 'ประเภท', 'Kind'),
    col('apNet', 'ยอดตั้งหนี้', 'AP net', 'money'),
    col('vat', 'ภาษีมูลค่าเพิ่ม', 'VAT', 'money'),
    col('wht', 'ภาษีหัก ณ ที่จ่าย', 'WHT', 'money'),
    col('retention', 'เงินประกันผลงาน', 'Retention', 'money'),
    col('cash', 'ยอดโอน', 'Cash', 'money'),
    col('status', 'สถานะ', 'Status'),
    col('paidOn', 'จ่ายแล้วเมื่อ', 'Paid on', 'date'),
    col('pvNumber', 'เลขที่ใบสำคัญจ่าย', 'Payment voucher'),
  ],
  async *rows({ prisma, filters }) {
    const range = { gte: new Date(`${filters.from}T00:00:00Z`), lte: new Date(`${filters.to}T00:00:00Z`) };
    for await (const i of paged((after, take) =>
      prisma.payoutItem.findMany({
        where: { run: { payOn: range }, id: { gt: after } },
        include: {
          run: { select: { runNo: true, payOn: true, status: true } },
          vendor: { select: { legalName: true, factory: { select: { code: true } } } },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        runNo: i.run.runNo,
        payOn: day(i.run.payOn),
        runStatus: i.run.status,
        vendor: i.vendor.legalName,
        factoryCode: i.vendor.factory?.code ?? null,
        kind: i.kind,
        apNet: money(i.apNetAmount),
        vat: money(i.vatAmount),
        wht: money(i.whtAmount),
        retention: money(i.retentionAmount),
        cash: money(i.cashAmount),
        status: i.status,
        paidOn: day(i.paidOn),
        pvNumber: i.pvNumber,
      };
  },
};
