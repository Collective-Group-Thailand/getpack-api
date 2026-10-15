/**
 * Supplier, banking, tax and fixed-asset default posting rules (accounting-design §5, D-150; ADR-0007).
 */
import {
  all,
  BANK,
  CLEARING_BY_PROVIDER,
  eq,
  gt0,
  ne,
  type PostingRuleSeed,
  VAT_INPUT,
  VAT_INPUT_CODE,
  VENDOR_DIMS,
  WHT_PAYABLE,
  WHT_PAYABLE_CODE,
} from './posting-rules-shared';

const PAYOUT_SOURCE = { type: 'payout_item', id: 'payoutItemId', number: 'pvNumber' };
const VENDOR_INVOICE_SOURCE = { type: 'vendor_invoice', id: 'vendorInvoiceId', number: 'vendorInvoiceNo' };
const TAX_REPORT_SOURCE = { type: 'tax_report', id: 'taxReportId' };

export const VENDOR_POSTING_RULES: readonly PostingRuleSeed[] = [
  {
    key: 'P04',
    eventType: 'gateway_settlement.posted',
    name: 'Gateway settlement in bank',
    description:
      'Gateway settlement arrives in the bank: net to bank, fee, VAT on the fee as input VAT when its tax invoice is recorded (§5 P04)',
    decisions: ['D-061', 'D-093'],
    conditions: null,
    template: {
      description: 'รับเงินจาก {provider} วันที่ {settlementDate}',
      documentDate: 'settlementDate',
      source: { type: 'gateway_settlement', id: 'settlementId' },
      lines: [
        { account: BANK, side: 'debit', amount: 'netAmount' },
        { account: '6110', side: 'debit', amount: 'feeAmount' },
        {
          account: { switch: 'feeVatClaimable', cases: { true: '1241' }, default: '6110' },
          side: 'debit',
          amount: 'vatOnFee',
          taxCode: { switch: 'feeVatClaimable', cases: { true: 'input_vat' } },
          taxBase: 'feeAmount',
        },
        { account: CLEARING_BY_PROVIDER, side: 'credit', amount: 'grossAmount' },
      ],
    },
  },
  {
    key: 'P05',
    eventType: 'bank_match.recorded',
    name: 'Slip transfer matched to the bank statement',
    description:
      'A slip / transfer receipt found on the bank statement moves from clearing to the bank (§5 P05)',
    decisions: ['D-061'],
    conditions: eq('matchKind', 'slip'),
    template: {
      description: 'จับคู่รายการเงินโอน {reference}',
      documentDate: 'txnDate',
      source: { type: 'bank_statement_line', id: 'statementLineId' },
      lines: [
        { account: BANK, side: 'debit', amount: 'amount' },
        { account: '1133', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P13',
    eventType: 'purchase_order.issued',
    name: 'Factory PO committed (memo)',
    description: 'Factory job released / PO issued: a commitment, no GL entry (§5 P13)',
    decisions: ['D-022', 'D-090'],
    conditions: ne('poKind', 'reproduction'),
    template: { description: 'ใบสั่งผลิต {poNumber} (บันทึกความจำ)', lines: [] },
  },
  {
    key: 'P14',
    eventType: 'payout_item.paid',
    name: 'Advance payout to a factory',
    description:
      'Advance (30 % default) paid: advance at net, input VAT per the factory tax invoice (pending without one), cash, WHT at payment (§5 P14, D-022)',
    decisions: ['D-022', 'D-090'],
    conditions: eq('kind', 'advance'),
    template: {
      description: 'จ่ายเงินล่วงหน้าโรงงาน {pvNumber}',
      documentDate: 'paidOn',
      source: PAYOUT_SOURCE,
      dimensions: VENDOR_DIMS,
      lines: [
        { account: '1250', side: 'debit', amount: 'apNet' },
        { account: VAT_INPUT, side: 'debit', amount: 'vatAmount', taxCode: VAT_INPUT_CODE, taxBase: 'apNet' },
        { account: BANK, side: 'credit', amount: 'cashAmount' },
        {
          account: WHT_PAYABLE,
          side: 'credit',
          amount: 'whtAmount',
          taxCode: WHT_PAYABLE_CODE,
          taxBase: 'whtBase',
        },
      ],
    },
  },
  {
    key: 'P15',
    eventType: 'goods_receipt.recorded',
    name: 'Goods receipt from POD',
    description:
      'Delivery confirmed (GR from POD + reported quantity): production cost at min(delivered, ordered) × unit cost (D-165), the shipping payout, payable at net (§5 P15)',
    decisions: ['D-021', 'D-165', 'D-090'],
    conditions: null,
    template: {
      description: 'ใบรับมอบงาน {grNumber}',
      documentDate: 'receivedOn',
      source: { type: 'goods_receipt', id: 'goodsReceiptId', number: 'grNumber' },
      dimensions: VENDOR_DIMS,
      lines: [
        { account: '5110', side: 'debit', amount: 'productionNet' },
        { account: '5120', side: 'debit', amount: 'shippingNet' },
        { account: '5150', side: 'debit', amount: 'otherNet' },
        { account: '2110', side: 'credit', amount: 'productionNet + shippingNet + otherNet' },
      ],
    },
  },
  {
    key: 'P16',
    eventType: 'advance.applied',
    name: 'Advance applied to the payable',
    description: 'The advance paid is applied to the factory payable (§5 P16)',
    decisions: ['D-022'],
    conditions: null,
    template: {
      description: 'ตัดเงินล่วงหน้ากับเจ้าหนี้ {poNumber}',
      documentDate: 'appliedOn',
      source: { type: 'purchase_order', id: 'purchaseOrderId', number: 'poNumber' },
      dimensions: VENDOR_DIMS,
      lines: [
        { account: '2110', side: 'debit', amount: 'amount' },
        { account: '1250', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P17',
    eventType: 'payout_item.paid',
    name: 'Final payout after the claim window',
    description:
      'Balance paid: payable at net, input VAT, cash, WHT at payment, retention held (5 % default) (§5 P17, D-022)',
    decisions: ['D-022', 'D-164'],
    conditions: eq('kind', 'balance'),
    template: {
      description: 'จ่ายชำระโรงงาน {pvNumber}',
      documentDate: 'paidOn',
      source: PAYOUT_SOURCE,
      dimensions: VENDOR_DIMS,
      lines: [
        { account: '2110', side: 'debit', amount: 'apNet' },
        { account: VAT_INPUT, side: 'debit', amount: 'vatAmount', taxCode: VAT_INPUT_CODE, taxBase: 'apNet' },
        { account: BANK, side: 'credit', amount: 'cashAmount' },
        {
          account: WHT_PAYABLE,
          side: 'credit',
          amount: 'whtAmount',
          taxCode: WHT_PAYABLE_CODE,
          taxBase: 'whtBase',
        },
        { account: '2130', side: 'credit', amount: 'retentionAmount' },
      ],
    },
  },
  {
    key: 'P17V',
    eventType: 'vendor_invoice.validated',
    name: 'Input VAT document received',
    description:
      'A valid factory tax invoice recorded after payment moves the VAT parked as pending document into input VAT (§2 input VAT)',
    decisions: ['D-090', 'D-033'],
    conditions: gt0('pendingVatToClaim'),
    template: {
      description: 'ได้รับใบกำกับภาษี {vendorInvoiceNo}',
      documentDate: 'invoiceDate',
      source: VENDOR_INVOICE_SOURCE,
      dimensions: { vendor: 'vendorId', factory: 'factoryId' },
      lines: [
        {
          account: '1241',
          side: 'debit',
          amount: 'pendingVatToClaim',
          taxCode: 'input_vat',
          taxBase: 'pendingVatBase',
        },
        {
          account: '1242',
          side: 'credit',
          amount: 'pendingVatToClaim',
          taxCode: 'input_vat_pending',
          taxBase: 'pendingVatBase',
        },
      ],
    },
  },
  {
    key: 'P18',
    eventType: 'payout_item.paid',
    name: 'Retention released',
    description: 'Retention paid after its release period (§5 P18, D-164)',
    decisions: ['D-022', 'D-164'],
    conditions: eq('kind', 'retention_release'),
    template: {
      description: 'คืนเงินประกันผลงาน {pvNumber}',
      documentDate: 'paidOn',
      source: PAYOUT_SOURCE,
      dimensions: VENDOR_DIMS,
      lines: [
        { account: '2130', side: 'debit', amount: 'retentionAmount' },
        { account: BANK, side: 'credit', amount: 'cashAmount' },
      ],
    },
  },
  {
    key: 'P20',
    eventType: 'vendor_deduction.recorded',
    name: 'Claim — factory liable',
    description:
      'The factory bears the claim: deducted from its payable (or a claim receivable) against claim costs (§5 P20)',
    decisions: ['D-083', 'D-022'],
    conditions: null,
    template: {
      description: 'หักค่าเคลมโรงงาน {claimNo}',
      documentDate: 'recordedOn',
      source: { type: 'vendor_deduction', id: 'deductionId' },
      dimensions: VENDOR_DIMS,
      lines: [
        {
          account: { switch: 'offsetAgainst', cases: { receivable: '1260' }, default: '2110' },
          side: 'debit',
          amount: 'amount',
        },
        { account: '5190', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P21',
    eventType: 'carrier_recovery.recorded',
    name: 'Claim — carrier liable',
    description: 'A fallback carrier bears the claim: other receivable against claim costs (§5 P21)',
    decisions: ['D-083', 'D-114'],
    conditions: null,
    template: {
      description: 'เรียกเก็บค่าเสียหายจากขนส่ง {claimNo}',
      documentDate: 'recordedOn',
      source: { type: 'claim', id: 'claimId', number: 'claimNo' },
      dimensions: { order: 'orderId', customer: 'customerId' },
      lines: [
        { account: '1270', side: 'debit', amount: 'amount' },
        { account: '5190', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P24',
    eventType: 'purchase_order.issued',
    name: 'Re-production PO (memo)',
    description:
      'Re-production caused by the factory: a new PO at zero or an agreed price, no customer revenue (§5 P24)',
    decisions: ['D-083'],
    conditions: eq('poKind', 'reproduction'),
    template: { description: 'ใบสั่งผลิตซ้ำ {poNumber} (บันทึกความจำ)', lines: [] },
  },
  {
    key: 'P25',
    eventType: 'vendor_invoice.recorded',
    name: 'Vendor bill — carrier or service',
    description:
      'Fallback carrier or other service bill: cost / expense per line, input VAT when claimable (pending otherwise), payable at gross (§5 P25)',
    decisions: ['D-114', 'D-090'],
    conditions: all(ne('vendorKind', 'factory'), ne('vendorKind', 'freelancer')),
    template: {
      description: 'บันทึกบิล {vendorInvoiceNo}',
      documentDate: 'invoiceDate',
      source: VENDOR_INVOICE_SOURCE,
      dimensions: { vendor: 'vendorId', order: 'orderId' },
      lines: [
        { forEach: 'lines', account: { path: 'item.accountCode' }, side: 'debit', amount: 'item.net' },
        {
          account: VAT_INPUT,
          side: 'debit',
          amount: 'vatAmount',
          taxCode: VAT_INPUT_CODE,
          taxBase: 'netAmount',
        },
        { account: '2120', side: 'credit', amount: 'grossAmount' },
      ],
    },
  },
  {
    key: 'P25P',
    eventType: 'payout_item.paid',
    name: 'Vendor bill paid',
    description:
      'Payment of a carrier / freelancer / service bill: payable cleared, cash, WHT at payment (1 % transport, ภ.ง.ด.3 for individuals) (§5 P25, P26)',
    decisions: ['D-114', 'D-033'],
    conditions: eq('kind', 'vendor_bill'),
    template: {
      description: 'จ่ายชำระบิล {pvNumber}',
      documentDate: 'paidOn',
      source: PAYOUT_SOURCE,
      dimensions: { vendor: 'vendorId' },
      lines: [
        { account: '2120', side: 'debit', amount: 'apNet + vatAmount' },
        { account: BANK, side: 'credit', amount: 'cashAmount' },
        {
          account: WHT_PAYABLE,
          side: 'credit',
          amount: 'whtAmount',
          taxCode: WHT_PAYABLE_CODE,
          taxBase: 'whtBase',
        },
      ],
    },
  },
  {
    key: 'P26',
    eventType: 'vendor_invoice.recorded',
    name: 'Freelance designer bill',
    description:
      'Individual freelance designer: design outsourcing against the payable; WHT (ภ.ง.ด.3) at payment (§5 P26)',
    decisions: ['D-071', 'D-033'],
    conditions: eq('vendorKind', 'freelancer'),
    template: {
      description: 'บันทึกค่าออกแบบ {vendorInvoiceNo}',
      documentDate: 'invoiceDate',
      source: VENDOR_INVOICE_SOURCE,
      dimensions: { vendor: 'vendorId', order: 'orderId' },
      lines: [
        { forEach: 'lines', account: { path: 'item.accountCode' }, side: 'debit', amount: 'item.net' },
        {
          account: VAT_INPUT,
          side: 'debit',
          amount: 'vatAmount',
          taxCode: VAT_INPUT_CODE,
          taxBase: 'netAmount',
        },
        { account: '2120', side: 'credit', amount: 'grossAmount' },
      ],
    },
  },
  {
    key: 'AG01',
    eventType: 'sales_agent_statement.approved',
    name: 'Employee agent commission accrued',
    description:
      'An employee sales agent’s approved monthly statement: sales commission accrued for payroll to pay (D-420; a freelance statement posts through its vendor bill, P25 / P25P)',
    decisions: ['D-420'],
    conditions: eq('agentKind', 'employee'),
    template: {
      description: 'ค่านายหน้าพนักงานขาย {statementNo}',
      documentDate: 'approvedOn',
      source: { type: 'sales_agent_statement', id: 'statementId', number: 'statementNo' },
      lines: [
        { account: '6160', side: 'debit', amount: 'totalAmount' },
        { account: '2410', side: 'credit', amount: 'totalAmount' },
      ],
    },
  },
  {
    key: 'P27',
    eventType: 'vat_return.closed',
    name: 'Month-end VAT close (ภ.พ.30)',
    description:
      'Output VAT against input VAT; the net is payable (a negative net stays in 2220 as a VAT credit) (§5 P27)',
    decisions: ['D-033'],
    conditions: null,
    template: {
      description: 'ภ.พ.30 งวด {periodLabel}',
      documentDate: 'closedOn',
      source: TAX_REPORT_SOURCE,
      lines: [
        { account: '2210', side: 'debit', amount: 'outputVat', taxCode: 'output_vat', taxBase: 'outputBase' },
        { account: '1241', side: 'credit', amount: 'inputVat', taxCode: 'input_vat', taxBase: 'inputBase' },
        { account: '2220', side: 'credit', amount: 'outputVat - inputVat' },
      ],
    },
  },
  {
    key: 'P27P',
    eventType: 'vat_return.paid',
    name: 'VAT paid',
    description: 'The ภ.พ.30 net VAT paid to the Revenue Department (§5 P27)',
    decisions: ['D-033'],
    conditions: null,
    template: {
      description: 'ชำระภาษีมูลค่าเพิ่ม งวด {periodLabel}',
      documentDate: 'paidOn',
      source: TAX_REPORT_SOURCE,
      lines: [
        { account: '2220', side: 'debit', amount: 'amount' },
        { account: BANK, side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P28',
    eventType: 'wht_remittance.paid',
    name: 'WHT remittance (ภ.ง.ด.3 / 53)',
    description: 'Withholding tax remitted to the Revenue Department (§5 P28)',
    decisions: ['D-033'],
    conditions: null,
    template: {
      description: 'นำส่งภาษีหัก ณ ที่จ่าย {whtForm} งวด {periodLabel}',
      documentDate: 'paidOn',
      source: TAX_REPORT_SOURCE,
      lines: [
        { account: WHT_PAYABLE, side: 'debit', amount: 'amount', taxCode: WHT_PAYABLE_CODE, taxBase: 'base' },
        { account: BANK, side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'P29',
    eventType: 'unidentified_receipt.recorded',
    name: 'Unidentified receipt',
    description:
      'Money received that no order claims yet (a bank line, or a callback without a known reference): parked in 1140 until identified — the match posts through P02 (§5 P29)',
    decisions: ['D-061'],
    conditions: null,
    template: {
      description: 'เงินรับไม่ทราบผู้โอน {reference}',
      documentDate: 'receivedOn',
      source: { type: 'unidentified_receipt', id: 'receiptId' },
      lines: [
        {
          account: {
            switch: 'receivedVia',
            cases: { scb: '1132', twoc2p: '1131', slip: '1133', bank: '1133' },
            default: { path: 'receivedIntoAccountCode' },
          },
          side: 'debit',
          amount: 'amount',
        },
        { account: '1140', side: 'credit', amount: 'amount' },
      ],
    },
  },
  {
    key: 'FA01',
    eventType: 'fixed_asset.acquired',
    name: 'Fixed asset acquired (manual)',
    description: 'An asset registered without a vendor bill: cost against the account Finance names (D-150)',
    decisions: ['D-150'],
    conditions: eq('source', 'manual'),
    template: {
      description: 'บันทึกสินทรัพย์ {assetNo}',
      documentDate: 'acquiredOn',
      source: { type: 'fixed_asset', id: 'assetId', number: 'assetNo' },
      dimensions: { costCentre: 'costCentreCode' },
      lines: [
        { account: { path: 'assetAccountCode' }, side: 'debit', amount: 'cost' },
        { account: { path: 'creditAccountCode' }, side: 'credit', amount: 'cost' },
      ],
    },
  },
  {
    key: 'FA02',
    eventType: 'depreciation_run.posted',
    name: 'Monthly depreciation',
    description: 'Straight-line depreciation of the month per asset (D-150)',
    decisions: ['D-150'],
    conditions: null,
    template: {
      description: 'ค่าเสื่อมราคา งวด {periodLabel}',
      documentDate: 'runOn',
      source: { type: 'depreciation_run', id: 'runId' },
      lines: [
        {
          forEach: 'lines',
          account: { path: 'item.expenseAccountCode' },
          side: 'debit',
          amount: 'item.amount',
          dimensions: { costCentre: 'item.costCentreCode' },
        },
        {
          forEach: 'lines',
          account: { path: 'item.accumulatedAccountCode' },
          side: 'credit',
          amount: 'item.amount',
        },
      ],
    },
  },
  {
    key: 'FA03',
    eventType: 'fixed_asset.disposed',
    name: 'Fixed asset disposed / written off',
    description:
      'Disposal or write-off: cost and accumulated depreciation removed, proceeds recorded, the difference to gain / loss (D-150)',
    decisions: ['D-150'],
    conditions: null,
    template: {
      description: 'จำหน่ายสินทรัพย์ {assetNo}',
      documentDate: 'disposedOn',
      source: { type: 'fixed_asset', id: 'assetId', number: 'assetNo' },
      lines: [
        { account: { path: 'accumulatedAccountCode' }, side: 'debit', amount: 'accumulated' },
        { account: { path: 'proceedsAccountCode' }, side: 'debit', amount: 'proceeds' },
        { account: { path: 'gainLossAccountCode' }, side: 'debit', amount: 'cost - accumulated - proceeds' },
        { account: { path: 'assetAccountCode' }, side: 'credit', amount: 'cost' },
      ],
    },
  },
];
