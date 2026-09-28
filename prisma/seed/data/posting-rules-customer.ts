/**
 * Customer-side default posting rules (accounting-design §5): receipts, delivery, discounts, points,
 * credit notes, refunds (ADR-0007).
 */
import { type PostingTemplate } from '../../../src/modules/ledger/posting/template';
import {
  all,
  any,
  CUSTOMER_DIMS,
  DOC_SOURCE,
  eq,
  gt0,
  ne,
  POINTS_LIABILITY_AMOUNT,
  POINTS_SOURCE,
  type PostingRuleSeed,
  RECEIPT_ACCOUNT,
  REVENUE_ACCOUNT,
} from './posting-rules-shared';

/** P01 / P02: the instalment's tax invoice/receipt at the tax point (payment, accounting-design §2). */
const INSTALMENT_RECEIPT: PostingTemplate = {
  description: 'ใบกำกับภาษี/ใบเสร็จรับเงิน {docNumber} (งวด)',
  documentDate: 'documentDate',
  source: DOC_SOURCE,
  dimensions: CUSTOMER_DIMS,
  lines: [
    { account: RECEIPT_ACCOUNT, side: 'debit', amount: 'grossAmount', description: 'รับชำระ ({receiptVia})' },
    { account: '2310', side: 'credit', amount: 'netAmount', description: 'เงินรับล่วงหน้า' },
    { account: '2210', side: 'credit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'netAmount' },
  ],
};

const DELIVERY_REVENUE = {
  forEach: 'revenue',
  account: REVENUE_ACCOUNT,
  side: 'credit' as const,
  amount: 'item.net',
  dimensions: { productType: 'item.productTypeId', order: 'item.orderId' },
};

const pointsRule = (
  key: string,
  eventType: string,
  name: string,
  description: string,
  decisions: string[],
  debit: string,
  credit: string,
  amount: string,
  extra: { conditions?: unknown; label: string; dims?: Record<string, string> },
): PostingRuleSeed => ({
  key,
  eventType,
  name,
  description,
  decisions,
  conditions: extra.conditions ?? null,
  template: {
    description: `${extra.label} {points} คะแนน`,
    source: POINTS_SOURCE,
    dimensions: { customer: 'userId', ...extra.dims },
    lines: [
      { account: debit, side: 'debit', amount },
      { account: credit, side: 'credit', amount },
    ],
  },
});

export const CUSTOMER_POSTING_RULES: readonly PostingRuleSeed[] = [
  {
    key: 'P01',
    eventType: 'customer_document.issued',
    name: 'Instalment paid by gateway — TR',
    description:
      'Instalment / deposit paid by 2C2P or SCB before delivery; tax invoice/receipt issued (§5 P01)',
    decisions: ['D-020', 'D-033'],
    conditions: all(
      eq('docType', 'tr'),
      eq('docKind', 'instalment'),
      any(eq('receiptVia', 'twoc2p'), eq('receiptVia', 'scb')),
    ),
    template: INSTALMENT_RECEIPT,
  },
  {
    key: 'P02',
    eventType: 'customer_document.issued',
    name: 'Instalment paid by transfer — TR',
    description:
      'Instalment paid by a verified slip or bank transfer; an identified unidentified receipt comes out of 1140 (P29 match), store credit out of 2320 (§5 P02)',
    decisions: ['D-020', 'D-061', 'D-033'],
    conditions: all(
      eq('docType', 'tr'),
      eq('docKind', 'instalment'),
      any(
        eq('receiptVia', 'slip'),
        eq('receiptVia', 'bank'),
        eq('receiptVia', 'unidentified'),
        eq('receiptVia', 'store_credit'),
      ),
    ),
    template: INSTALMENT_RECEIPT,
  },
  {
    key: 'P03',
    eventType: 'customer_document.issued',
    name: 'Customer withholding tax',
    description:
      'The customer withholds tax: WHT receivable instead of cash on the receipts (instalment TR, RC); a final TR only restates what earlier receipts withheld (§5 P03)',
    decisions: ['D-033', 'D-174'],
    conditions: all(
      any(all(eq('docType', 'tr'), eq('docKind', 'instalment')), eq('docType', 'rc')),
      gt0('whtAmount'),
    ),
    template: {
      description: 'ภาษีถูกหัก ณ ที่จ่าย {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        {
          account: '1230',
          side: 'debit',
          amount: 'whtAmount',
          taxCode: 'wht_receivable',
          taxBase: 'whtBase',
        },
        { account: RECEIPT_ACCOUNT, side: 'credit', amount: 'whtAmount', description: 'ลดยอดรับชำระ' },
      ],
    },
  },
  {
    key: 'P06',
    eventType: 'customer_document.issued',
    name: 'Delivery — revenue and final TR',
    description:
      'Delivery confirmed (POD): revenue by line type at the discounted net, instalments applied from 2310, the remainder receivable, VAT on the remainder (§5 P06)',
    decisions: ['D-010', 'D-020', 'D-033'],
    conditions: all(eq('docType', 'tr'), eq('docKind', 'final')),
    template: {
      description: 'ใบกำกับภาษีฉบับสุดท้าย {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: '2310', side: 'debit', amount: 'appliedAdvanceNet', description: 'ตัดเงินรับล่วงหน้า' },
        { account: '1210', side: 'debit', amount: 'remainingGross' },
        DELIVERY_REVENUE,
        {
          account: '2210',
          side: 'credit',
          amount: 'remainingVat',
          taxCode: 'output_vat',
          taxBase: 'remainingNet',
        },
      ],
    },
  },
  {
    key: 'P07',
    eventType: 'customer_document.issued',
    name: 'Delivery on credit — invoice',
    description:
      'Credit-term (or unpaid on delivery) invoice at delivery: receivable and revenue; VAT not yet due under hire of work, due when the invoice is a tax invoice (sale of goods) (§5 P07)',
    decisions: ['D-020', 'D-121', 'D-033'],
    conditions: all(eq('docType', 'iv'), eq('docKind', 'delivery')),
    template: {
      description: 'ใบแจ้งหนี้ {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: '2310', side: 'debit', amount: 'appliedAdvanceNet', description: 'ตัดเงินรับล่วงหน้า' },
        { account: '1210', side: 'debit', amount: 'remainingGross' },
        DELIVERY_REVENUE,
        {
          account: { switch: 'vatDue', cases: { true: '2210', false: '2211' } },
          side: 'credit',
          amount: 'remainingVat',
          taxCode: { switch: 'vatDue', cases: { true: 'output_vat', false: 'output_vat_not_due' } },
          taxBase: 'remainingNet',
        },
      ],
    },
  },
  {
    key: 'P07D',
    eventType: 'customer_document.issued',
    name: 'Debit note',
    description:
      'Debit note (ใบเพิ่มหนี้) against a tax invoice: receivable, other revenue and output VAT (§2, §4)',
    decisions: ['D-033'],
    conditions: eq('docType', 'dn'),
    template: {
      description: 'ใบเพิ่มหนี้ {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: '1210', side: 'debit', amount: 'grossAmount' },
        { account: '4160', side: 'credit', amount: 'netAmount' },
        { account: '2210', side: 'credit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'netAmount' },
      ],
    },
  },
  {
    key: 'P08',
    eventType: 'customer_document.issued',
    name: 'Collection of an invoice — RC',
    description:
      'Receipt for an invoice: cash at gross (P03 takes the WHT part), receivable cleared, VAT not yet due becomes due (§5 P08)',
    decisions: ['D-020', 'D-121', 'D-033'],
    conditions: eq('docType', 'rc'),
    template: {
      description: 'ใบเสร็จรับเงิน {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: RECEIPT_ACCOUNT, side: 'debit', amount: 'grossAmount' },
        { account: '1210', side: 'credit', amount: 'grossAmount' },
        {
          account: '2211',
          side: 'debit',
          amount: 'vatNotDueAmount',
          taxCode: 'output_vat_not_due',
          taxBase: 'vatNotDueBase',
        },
        {
          account: '2210',
          side: 'credit',
          amount: 'vatNotDueAmount',
          taxCode: 'output_vat',
          taxBase: 'vatNotDueBase',
        },
      ],
    },
  },
  {
    key: 'P09',
    eventType: 'customer_document.issued',
    name: 'Promotion, coupon and points discounts',
    description:
      'Revenue shown gross: each discount on the delivery document moves to 4910 (per campaign / promotion) or 4930 (points); VAT stays on the discounted amount (§5 P09)',
    decisions: ['D-053', 'D-133', 'D-033'],
    conditions: all(any(eq('docKind', 'final'), eq('docKind', 'delivery')), gt0('discountTotal')),
    template: {
      description: 'ส่วนลด {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        {
          forEach: 'discounts',
          account: { switch: 'item.source', cases: { points_redemption: '4930' }, default: '4910' },
          side: 'debit',
          amount: 'item.amount',
          dimensions: {
            campaign: 'item.campaignId',
            promotion: 'item.promotionId',
            productType: 'item.productTypeId',
            order: 'item.orderId',
          },
        },
        {
          forEach: 'discounts',
          account: REVENUE_ACCOUNT,
          side: 'credit',
          amount: 'item.amount',
          dimensions: { productType: 'item.productTypeId', order: 'item.orderId' },
        },
      ],
    },
  },
  pointsRule(
    'P10',
    'points.issued',
    'Points issued',
    'Points credited on a paid order or a reward: expense and liability at the point value × points × expected redemption rate (§5 P10, D-131)',
    ['D-130', 'D-131'],
    '6120',
    '2330',
    POINTS_LIABILITY_AMOUNT,
    { label: 'ออกคะแนนสะสม' },
  ),
  pointsRule(
    'P10A',
    'points.adjusted',
    'Points adjusted by staff',
    'A staff adjustment moves the liability like P10; a negative adjustment reverses it (ADR-0007)',
    ['D-130', 'D-131'],
    '6120',
    '2330',
    'signedBahtValue * expectedRedemptionRatePct / 100',
    { label: 'ปรับคะแนนสะสม' },
  ),
  pointsRule(
    'P10R',
    'points.reversed',
    'Points reversed',
    'Credited points taken back for a refund or claim reverse P10; pending points never had a liability (D-132, ADR-0007)',
    ['D-132'],
    '2330',
    '6120',
    POINTS_LIABILITY_AMOUNT,
    { label: 'ยกเลิกคะแนนสะสม', conditions: eq('earningStatus', 'available') },
  ),
  pointsRule(
    'P11',
    'points.redeemed',
    'Points redeemed',
    'Points redeemed at checkout use the liability; the reduction shows as points redemption (§5 P11)',
    ['D-133', 'D-131'],
    '2330',
    '4930',
    'bahtValue',
    { label: 'แลกคะแนน', dims: { orderGroup: 'groupId' } },
  ),
  pointsRule(
    'P11R',
    'points.redemption_reversed',
    'Points redemption returned',
    'A cancelled order gives the redeemed points back: P11 reversed (ADR-0007)',
    ['D-133'],
    '4930',
    '2330',
    'bahtValue',
    { label: 'คืนคะแนนที่แลก', dims: { order: 'orderId' } },
  ),
  pointsRule(
    'P12',
    'points.expired',
    'Points expired',
    'Expired points release the liability to other income (§5 P12)',
    ['D-132'],
    '2330',
    '4990',
    POINTS_LIABILITY_AMOUNT,
    { label: 'คะแนนหมดอายุ' },
  ),
  {
    key: 'P19',
    eventType: 'customer_document.issued',
    name: 'Credit note — shortage, claim, price reduction',
    description:
      'Credit note for a shortage within tolerance (D-021), a claim, a price reduction, a return or a post-sale discount: returns & allowances (the advance before delivery), output VAT reversed, customer credit balance or receivable (§5 P19, P20 customer side)',
    decisions: ['D-021', 'D-080', 'D-033'],
    conditions: all(eq('docType', 'cn'), ne('cnKind', 'cancellation')),
    template: {
      description: 'ใบลดหนี้ {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        {
          account: { switch: 'revenueStage', cases: { advance: '2310' }, default: '4920' },
          side: 'debit',
          amount: 'netAmount',
        },
        {
          account: { switch: 'vatStage', cases: { not_due: '2211' }, default: '2210' },
          side: 'debit',
          amount: 'vatAmount',
          taxCode: { switch: 'vatStage', cases: { not_due: 'output_vat_not_due' }, default: 'output_vat' },
          taxBase: 'netAmount',
        },
        {
          account: { switch: 'settleTo', cases: { receivable: '1210' }, default: '2320' },
          side: 'credit',
          amount: 'grossAmount',
        },
      ],
    },
  },
  {
    key: 'P22',
    eventType: 'customer_refund.paid',
    name: 'Refund paid',
    description:
      'A refund leaves through the gateway or a bank transfer out of the customer credit balance (credit note issued), unapplied receipts or unidentified receipts (§5 P22)',
    decisions: ['D-169', 'D-033'],
    conditions: null,
    template: {
      description: 'คืนเงินลูกค้า {reference}',
      documentDate: 'paidOn',
      source: { type: 'refund', id: 'refundId' },
      dimensions: CUSTOMER_DIMS,
      lines: [
        {
          account: {
            switch: 'refundFrom',
            cases: { unapplied: '2340', unidentified: '1140' },
            default: '2320',
          },
          side: 'debit',
          amount: 'amount',
        },
        {
          account: {
            switch: 'paidVia',
            cases: { twoc2p: '1131', scb: '1132' },
            default: { path: 'bankAccountCode' },
          },
          side: 'credit',
          amount: 'amount',
        },
      ],
    },
  },
  {
    key: 'P23',
    eventType: 'customer_document.issued',
    name: 'Cancellation after deposit — credit note',
    description:
      'Order cancelled after a deposit, before production: credit note against the instalment TR, advance and output VAT reversed into the customer credit balance (§5 P23)',
    decisions: ['D-020', 'D-033'],
    conditions: all(eq('docType', 'cn'), eq('cnKind', 'cancellation')),
    template: {
      description: 'ใบลดหนี้ (ยกเลิก) {docNumber}',
      documentDate: 'documentDate',
      source: DOC_SOURCE,
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: '2310', side: 'debit', amount: 'netAmount' },
        { account: '2210', side: 'debit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'netAmount' },
        {
          account: { switch: 'settleTo', cases: { receivable: '1210' }, default: '2320' },
          side: 'credit',
          amount: 'grossAmount',
        },
      ],
    },
  },
  {
    key: 'P23F',
    eventType: 'customer_deposit.forfeited',
    name: 'Forfeited deposit',
    description:
      'A deposit kept under the forfeited-deposit policy becomes other income; its VAT stays declared (§5 P23)',
    decisions: ['D-020', 'D-033'],
    conditions: null,
    template: {
      description: 'ริบเงินมัดจำ {orderCode}',
      documentDate: 'documentDate',
      source: { type: 'order', id: 'orderId', number: 'orderCode' },
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: '2310', side: 'debit', amount: 'netAmount' },
        { account: '4990', side: 'credit', amount: 'netAmount' },
      ],
    },
  },
  {
    key: 'P01X',
    eventType: 'customer_receipt.unapplied',
    name: 'Unapplied receipt',
    description:
      'Cash received beyond what the schedule needs (an overpayment, a payment on a closed group) waits in unapplied receipts for a refund (ADR-0007)',
    decisions: ['D-061', 'D-020'],
    conditions: null,
    template: {
      description: 'เงินรับเกิน {reference}',
      documentDate: 'receivedOn',
      source: { type: 'payment', id: 'paymentId', number: 'reference' },
      dimensions: CUSTOMER_DIMS,
      lines: [
        { account: RECEIPT_ACCOUNT, side: 'debit', amount: 'amount' },
        { account: '2340', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P30',
    eventType: 'bad_debt.provisioned',
    name: 'Bad-debt allowance',
    description: 'Allowance for doubtful accounts updated; a negative change releases it (§5 P30)',
    decisions: ['D-033'],
    conditions: null,
    template: {
      description: 'ตั้งค่าเผื่อหนี้สงสัยจะสูญ งวด {periodLabel}',
      documentDate: 'provisionedOn',
      source: { type: 'bad_debt_provision', id: 'provisionId' },
      lines: [
        { account: '6130', side: 'debit', amount: 'amount' },
        { account: '1219', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P30W',
    eventType: 'receivable.written_off',
    name: 'Bad-debt write-off',
    description: 'An approved write-off uses the allowance and clears the receivable (§5 P30)',
    decisions: ['D-033', 'D-169'],
    conditions: null,
    template: {
      description: 'ตัดหนี้สูญ {docNumber}',
      documentDate: 'writtenOffOn',
      source: { type: 'receivable_item', id: 'receivableItemId', number: 'docNumber' },
      dimensions: { customer: 'customerId', company: 'companyId', order: 'orderId' },
      lines: [
        { account: '1219', side: 'debit', amount: 'amount' },
        { account: '1210', side: 'credit', amount: 'amount' },
      ],
    },
  },
];
