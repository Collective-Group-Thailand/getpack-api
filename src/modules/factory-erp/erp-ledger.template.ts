import { type PostingTemplate } from '@common/ledger-core/template';
import {
  type AccountType,
  type CashFlowClass,
  type ErpItemKind,
  type LedgerSide,
} from '@generated/prisma/client';

/**
 * Packio Factory ERP E6 (docs/prompts/E6-factory-general-ledger.md §4, §5; D-385 – D-388): the chart of accounts
 * template (TFRS for NPAEs, DBD statement lines) and the posting-rule template v1 (F01 – F18) every factory's
 * ledger starts from. Both are data: a factory may change its chart through a maker-checker change and its
 * rules through a new approved version. ⚖ CPA review before a factory goes live (§15).
 */

export const CHART_TEMPLATE_VERSION = 1;
export const RULES_TEMPLATE_VERSION = 1;

/** The factory ledger's dimensions (payload keys → journal-line columns), D-388. */
export const ERP_GL_DIMENSIONS = ['item', 'partner', 'warehouse', 'productionOrder', 'machine', 'bankAccount'] as const;
export type ErpGlDimensionKey = (typeof ERP_GL_DIMENSIONS)[number];

/** DBD / NPAEs statement lines (D-391): balance-sheet lines first, then profit-and-loss lines. */
export const STATEMENT_LINES = [
  'cash',
  'trade_receivables',
  'other_receivables',
  'inventory',
  'tax_assets',
  'other_current_assets',
  'ppe',
  'accumulated_depreciation',
  'trade_payables',
  'tax_liabilities',
  'accrued_expenses',
  'customer_advances',
  'other_current_liabilities',
  'long_term_loans',
  'capital',
  'retained_earnings',
  'current_year_profit',
  'revenue',
  'other_income',
  'cost_of_sales',
  'manufacturing_overhead',
  'selling_admin',
  'finance_cost',
  'income_tax',
] as const;
export type StatementLine = (typeof STATEMENT_LINES)[number];

export interface ChartAccount {
  code: string;
  nameTh: string;
  nameEn: string;
  type: AccountType;
  side: LedgerSide;
  parent?: string;
  control?: boolean;
  postable?: boolean;
  cashFlow: CashFlowClass;
  line: StatementLine;
}

const A = (
  code: string,
  nameTh: string,
  nameEn: string,
  type: AccountType,
  cashFlow: CashFlowClass,
  line: StatementLine,
  extra: Partial<ChartAccount> = {},
): ChartAccount => ({
  code,
  nameTh,
  nameEn,
  type,
  side: type === 'asset' || type === 'cost_of_sales' || type === 'expense' ? 'debit' : 'credit',
  cashFlow,
  line,
  ...extra,
});

/** §4 — the printing / packaging factory chart. Headings (`postable: false`) carry the DBD grouping. */
export const CHART_TEMPLATE: readonly ChartAccount[] = [
  // --- current assets
  A('1100', 'สินทรัพย์หมุนเวียน', 'Current assets', 'asset', 'non_cash', 'other_current_assets', { postable: false }),
  A('1110', 'เงินสด', 'Cash on hand', 'asset', 'cash', 'cash', { parent: '1100' }),
  A('1120', 'เงินฝากธนาคาร', 'Bank deposits', 'asset', 'cash', 'cash', { parent: '1100', postable: false }),
  A('1131', 'ลูกหนี้การค้า', 'Trade receivables', 'asset', 'operating', 'trade_receivables', { parent: '1100', control: true }),
  A('1132', 'ลูกหนี้ Packio', 'Receivable from Packio', 'asset', 'operating', 'trade_receivables', { parent: '1100', control: true }),
  A('1135', 'ค่าเผื่อหนี้สงสัยจะสูญ', 'Allowance for doubtful accounts', 'asset', 'non_cash', 'trade_receivables', { parent: '1100', side: 'credit' }),
  A('1141', 'วัตถุดิบ', 'Raw materials', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1142', 'งานระหว่างทำ', 'Work in process', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1143', 'สินค้าสำเร็จรูป', 'Finished goods', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1144', 'วัสดุสิ้นเปลือง', 'Consumables', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1145', 'อะไหล่', 'Spare parts', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1146', 'วัสดุบรรจุภัณฑ์', 'Packing materials', 'asset', 'operating', 'inventory', { parent: '1100' }),
  A('1151', 'ภาษีซื้อ', 'Input VAT', 'asset', 'operating', 'tax_assets', { parent: '1100' }),
  A('1152', 'ภาษีซื้อยังไม่ถึงกำหนด', 'Undue input VAT', 'asset', 'operating', 'tax_assets', { parent: '1100' }),
  A('1153', 'ภาษีถูกหัก ณ ที่จ่าย', 'Withholding tax receivable', 'asset', 'operating', 'tax_assets', { parent: '1100' }),
  A('1160', 'เงินมัดจำ / จ่ายล่วงหน้า', 'Deposits and prepayments', 'asset', 'operating', 'other_current_assets', { parent: '1100' }),
  // --- non-current assets
  A('1200', 'สินทรัพย์ไม่หมุนเวียน', 'Non-current assets', 'asset', 'non_cash', 'ppe', { postable: false }),
  A('1210', 'ที่ดิน', 'Land', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1220', 'อาคาร', 'Buildings', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1229', 'ค่าเสื่อมราคาสะสม - อาคาร', 'Accumulated depreciation - buildings', 'asset', 'non_cash', 'accumulated_depreciation', { parent: '1200', side: 'credit' }),
  A('1230', 'เครื่องจักร', 'Machinery', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1239', 'ค่าเสื่อมราคาสะสม - เครื่องจักร', 'Accumulated depreciation - machinery', 'asset', 'non_cash', 'accumulated_depreciation', { parent: '1200', side: 'credit' }),
  A('1240', 'เครื่องมือ / แม่พิมพ์', 'Tools and dies', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1249', 'ค่าเสื่อมราคาสะสม - เครื่องมือ', 'Accumulated depreciation - tools', 'asset', 'non_cash', 'accumulated_depreciation', { parent: '1200', side: 'credit' }),
  A('1250', 'ยานพาหนะ', 'Vehicles', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1259', 'ค่าเสื่อมราคาสะสม - ยานพาหนะ', 'Accumulated depreciation - vehicles', 'asset', 'non_cash', 'accumulated_depreciation', { parent: '1200', side: 'credit' }),
  A('1260', 'อุปกรณ์สำนักงาน', 'Office equipment', 'asset', 'investing', 'ppe', { parent: '1200' }),
  A('1269', 'ค่าเสื่อมราคาสะสม - อุปกรณ์สำนักงาน', 'Accumulated depreciation - office equipment', 'asset', 'non_cash', 'accumulated_depreciation', { parent: '1200', side: 'credit' }),
  // --- current liabilities
  A('2100', 'หนี้สินหมุนเวียน', 'Current liabilities', 'liability', 'non_cash', 'other_current_liabilities', { postable: false }),
  A('2111', 'เจ้าหนี้การค้า', 'Trade payables', 'liability', 'operating', 'trade_payables', { parent: '2100', control: true }),
  A('2115', 'สินค้ารับแล้วยังไม่ได้รับใบแจ้งหนี้', 'Goods received not invoiced', 'liability', 'operating', 'trade_payables', { parent: '2100' }),
  A('2121', 'ภาษีขาย', 'Output VAT', 'liability', 'operating', 'tax_liabilities', { parent: '2100' }),
  A('2122', 'ภาษีขายยังไม่ถึงกำหนด', 'Undue output VAT', 'liability', 'operating', 'tax_liabilities', { parent: '2100' }),
  A('2131', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.3', 'WHT payable (PND 3)', 'liability', 'operating', 'tax_liabilities', { parent: '2100' }),
  A('2132', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.53', 'WHT payable (PND 53)', 'liability', 'operating', 'tax_liabilities', { parent: '2100' }),
  A('2133', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.1', 'WHT payable (PND 1)', 'liability', 'operating', 'tax_liabilities', { parent: '2100' }),
  A('2140', 'ค่าใช้จ่ายค้างจ่าย', 'Accrued expenses', 'liability', 'operating', 'accrued_expenses', { parent: '2100' }),
  A('2150', 'เงินรับล่วงหน้า / มัดจำลูกค้า', 'Customer advances and deposits', 'liability', 'operating', 'customer_advances', { parent: '2100' }),
  A('2160', 'ประกันสังคมค้างจ่าย', 'Social security payable', 'liability', 'operating', 'accrued_expenses', { parent: '2100' }),
  // --- non-current liabilities
  A('2200', 'หนี้สินไม่หมุนเวียน', 'Non-current liabilities', 'liability', 'non_cash', 'long_term_loans', { postable: false }),
  A('2210', 'เงินกู้ยืมระยะยาว', 'Long-term loans', 'liability', 'financing', 'long_term_loans', { parent: '2200' }),
  A('2220', 'หนี้สินตามสัญญาเช่า', 'Lease liabilities', 'liability', 'financing', 'long_term_loans', { parent: '2200' }),
  // --- equity
  A('3000', 'ส่วนของเจ้าของ', 'Equity', 'equity', 'non_cash', 'capital', { postable: false }),
  A('3100', 'ทุนที่ชำระแล้ว', 'Paid-up capital', 'equity', 'financing', 'capital', { parent: '3000' }),
  A('3200', 'กำไรสะสม', 'Retained earnings', 'equity', 'equity', 'retained_earnings', { parent: '3000' }),
  A('3300', 'กำไรขาดทุนปีปัจจุบัน', 'Current-year profit (system)', 'equity', 'equity', 'current_year_profit', { parent: '3000', postable: false }),
  // --- revenue
  A('4100', 'รายได้จากการขาย', 'Sales revenue', 'revenue', 'non_cash', 'revenue', { postable: false }),
  A('4110', 'รายได้ขาย', 'Sales', 'revenue', 'operating', 'revenue', { parent: '4100' }),
  A('4120', 'รายได้รับจ้างผลิต Packio', 'Packio job revenue', 'revenue', 'operating', 'revenue', { parent: '4100' }),
  A('4190', 'รับคืน / ส่วนลดจ่าย', 'Returns and discounts', 'revenue', 'operating', 'revenue', { parent: '4100', side: 'debit' }),
  A('4900', 'รายได้อื่น', 'Other income', 'revenue', 'non_cash', 'other_income', { postable: false }),
  A('4910', 'ดอกเบี้ยรับ', 'Interest income', 'revenue', 'operating', 'other_income', { parent: '4900' }),
  A('4920', 'กำไร (ขาดทุน) จากการขายทรัพย์สิน', 'Gain (loss) on disposal of assets', 'revenue', 'investing', 'other_income', { parent: '4900' }),
  A('4990', 'รายได้อื่น ๆ', 'Miscellaneous income', 'revenue', 'operating', 'other_income', { parent: '4900' }),
  // --- cost of sales
  A('5100', 'ต้นทุนขาย', 'Cost of sales', 'cost_of_sales', 'non_cash', 'cost_of_sales', { postable: false }),
  A('5110', 'ต้นทุนขาย', 'Cost of goods sold', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100' }),
  A('5120', 'วัตถุดิบใช้ไป', 'Materials consumed', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100' }),
  A('5130', 'ผลต่างสต็อก', 'Stock variance', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100' }),
  A('5140', 'ผลต่างราคาซื้อ', 'Purchase price variance', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100' }),
  A('5150', 'ผลต่างการผลิต', 'Production variance', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100' }),
  A('5160', 'ค่าแรงทางตรง (คิดเข้างาน)', 'Direct labour applied', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100', side: 'credit' }),
  A('5170', 'ค่าโสหุ้ยการผลิต (คิดเข้างาน)', 'Manufacturing overhead applied', 'cost_of_sales', 'operating', 'cost_of_sales', { parent: '5100', side: 'credit' }),
  A('5200', 'ค่าโสหุ้ยการผลิต (จริง)', 'Manufacturing overhead (actual)', 'cost_of_sales', 'non_cash', 'manufacturing_overhead', { postable: false }),
  A('5210', 'ค่าไฟฟ้าโรงงาน', 'Factory electricity', 'cost_of_sales', 'operating', 'manufacturing_overhead', { parent: '5200' }),
  A('5220', 'ค่าซ่อมบำรุง', 'Repairs and maintenance', 'cost_of_sales', 'operating', 'manufacturing_overhead', { parent: '5200' }),
  A('5230', 'วัสดุสิ้นเปลืองโรงงาน', 'Factory supplies', 'cost_of_sales', 'operating', 'manufacturing_overhead', { parent: '5200' }),
  A('5240', 'ค่าเสื่อมราคาเครื่องจักร', 'Depreciation - machinery', 'cost_of_sales', 'non_cash', 'manufacturing_overhead', { parent: '5200' }),
  A('5250', 'ค่าแรงโรงงาน', 'Factory wages', 'cost_of_sales', 'operating', 'manufacturing_overhead', { parent: '5200' }),
  // --- selling and administrative
  A('6000', 'ค่าใช้จ่ายในการขายและบริหาร', 'Selling and administrative expenses', 'expense', 'non_cash', 'selling_admin', { postable: false }),
  A('6110', 'เงินเดือน', 'Salaries', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  A('6120', 'ค่าขนส่ง', 'Freight and delivery', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  A('6130', 'ค่าธรรมเนียมธนาคาร', 'Bank charges', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  A('6140', 'ค่าเสื่อมราคา', 'Depreciation', 'expense', 'non_cash', 'selling_admin', { parent: '6000' }),
  A('6150', 'ค่าเช่า', 'Rent', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  A('6160', 'ค่าสาธารณูปโภค', 'Utilities', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  A('6900', 'ค่าใช้จ่ายอื่น', 'Other expenses', 'expense', 'operating', 'selling_admin', { parent: '6000' }),
  // --- finance cost and tax
  A('7000', 'ต้นทุนทางการเงินและภาษี', 'Finance cost and income tax', 'expense', 'non_cash', 'finance_cost', { postable: false }),
  A('7110', 'ดอกเบี้ยจ่าย', 'Interest expense', 'expense', 'operating', 'finance_cost', { parent: '7000' }),
  A('7210', 'ภาษีเงินได้นิติบุคคล', 'Corporate income tax', 'expense', 'operating', 'income_tax', { parent: '7000' }),
];

/** Item kinds (D-320) → inventory accounts, overridable in the ledger settings (D-387). */
export const ITEM_KIND_ACCOUNTS: Record<ErpItemKind, string> = {
  raw_material: '1141',
  consumable: '1144',
  spare_part: '1145',
  semi_finished: '1142',
  finished_good: '1143',
  packing: '1146',
};

/** Accounts the rules read by purpose; overridable in the ledger settings (`methodAccounts`, D-387). */
export const METHOD_ACCOUNTS = {
  cash: '1110',
  bank: '1120',
  receivables: '1131',
  receivablesPackio: '1132',
  wip: '1142',
  finishedGoods: '1143',
  inputVat: '1151',
  inputVatUndue: '1152',
  whtReceivable: '1153',
  payables: '2111',
  grir: '2115',
  outputVat: '2121',
  whtPnd3: '2131',
  whtPnd53: '2132',
  accruedExpenses: '2140',
  retainedEarnings: '3200',
  sales: '4110',
  salesPackio: '4120',
  salesReturns: '4190',
  interestIncome: '4910',
  disposalGainLoss: '4920',
  cogs: '5110',
  stockVariance: '5130',
  priceVariance: '5140',
  productionVariance: '5150',
  labourApplied: '5160',
  overheadApplied: '5170',
  maintenance: '5220',
  factorySupplies: '5230',
  bankCharges: '6130',
  otherExpenses: '6900',
} as const;
export type MethodAccountKey = keyof typeof METHOD_ACCOUNTS;

export interface RuleTemplate {
  key: string;
  eventType: string;
  name: string;
  description: string;
  template: PostingTemplate;
}

/**
 * §5 rule templates. Payloads are built by `ErpLedgerPostingService` from the document the event names
 * (events carry ids only, D-345): every amount is excl. VAT unless named, `movements` are the document's stock
 * movements with the inventory account of each item's kind, and `accounts.*` are the factory's method accounts.
 */
export const RULES_TEMPLATE: readonly RuleTemplate[] = [
  {
    key: 'F01',
    eventType: 'erp_goods_receipt.posted',
    name: 'รับสินค้าเข้าคลัง',
    description: 'Goods receipt: inventory at cost excl. VAT against GR/IR clearing; landed charges at receipt against accrued expenses (D-321, D-350).',
    template: {
      description: 'รับสินค้า {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_goods_receipt', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId', warehouse: 'warehouseId' },
      lines: [
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.grir' }, side: 'credit', amount: 'goodsValue' },
        { account: { path: 'accounts.accruedExpenses' }, side: 'credit', amount: 'chargesValue' },
      ],
    },
  },
  {
    key: 'F01B',
    eventType: 'erp_goods_receipt.charge_added',
    name: 'ค่าใช้จ่ายนำเข้า (landed cost)',
    description: 'A landed charge added after receipt: inventory (the absorbed value) against accrued expenses (D-350).',
    template: {
      description: 'ค่าใช้จ่ายนำเข้า {documentNo} — {chargeDescription}',
      documentDate: 'documentDate',
      source: { type: 'erp_goods_receipt', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.accruedExpenses' }, side: 'credit', amount: 'chargesValue' },
      ],
    },
  },
  {
    key: 'F02',
    eventType: 'erp_supplier_invoice.recorded',
    name: 'ใบแจ้งหนี้ซัพพลายเออร์',
    description: 'Supplier invoice (matched, or approved after a variance): clears GR/IR at the received value, price variance, unordered lines to expense, input VAT (undue until the tax invoice arrives), against trade payables for the total (D-328).',
    template: {
      description: 'ใบแจ้งหนี้ {documentNo} — {partnerName} ({invoiceNo})',
      documentDate: 'documentDate',
      source: { type: 'erp_supplier_invoice', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { account: { path: 'accounts.grir' }, side: 'debit', amount: 'grirValue' },
        { account: { path: 'accounts.priceVariance' }, side: 'debit', amount: 'varianceValue' },
        { account: { path: 'accounts.otherExpenses' }, side: 'debit', amount: 'expenseValue' },
        { account: { path: 'accounts.inputVat' }, side: 'debit', amount: 'vatAmount', when: { field: 'payload.taxInvoice', op: 'eq', value: true }, taxCode: 'input_vat', taxBase: 'subtotal' },
        { account: { path: 'accounts.inputVatUndue' }, side: 'debit', amount: 'vatAmount', when: { field: 'payload.taxInvoice', op: 'eq', value: false }, taxCode: 'input_vat_pending', taxBase: 'subtotal' },
        { account: { path: 'accounts.payables' }, side: 'credit', amount: 'total' },
      ],
    },
  },
  {
    key: 'F02A',
    eventType: 'erp_supplier_invoice.approved',
    name: 'ใบแจ้งหนี้ซัพพลายเออร์ (อนุมัติผลต่าง)',
    description: 'The same posting as F02 for an invoice recorded with a variance and approved later (posted once per invoice).',
    template: {
      description: 'ใบแจ้งหนี้ {documentNo} — {partnerName} ({invoiceNo})',
      documentDate: 'documentDate',
      source: { type: 'erp_supplier_invoice', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { account: { path: 'accounts.grir' }, side: 'debit', amount: 'grirValue' },
        { account: { path: 'accounts.priceVariance' }, side: 'debit', amount: 'varianceValue' },
        { account: { path: 'accounts.otherExpenses' }, side: 'debit', amount: 'expenseValue' },
        { account: { path: 'accounts.inputVat' }, side: 'debit', amount: 'vatAmount', when: { field: 'payload.taxInvoice', op: 'eq', value: true }, taxCode: 'input_vat', taxBase: 'subtotal' },
        { account: { path: 'accounts.inputVatUndue' }, side: 'debit', amount: 'vatAmount', when: { field: 'payload.taxInvoice', op: 'eq', value: false }, taxCode: 'input_vat_pending', taxBase: 'subtotal' },
        { account: { path: 'accounts.payables' }, side: 'credit', amount: 'total' },
      ],
    },
  },
  {
    key: 'F03',
    eventType: 'erp_supplier_payment.recorded',
    name: 'จ่ายชำระซัพพลายเออร์',
    description: 'Supplier payment: trade payables for the allocated amount plus the WHT withheld, against the bank / cash account and WHT payable (PND 3 / 53) — Thai WHT arises at payment (D-329, D-367). A reversal payment carries negative amounts and mirrors the entry (F04).',
    template: {
      description: 'จ่ายชำระ {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_supplier_payment', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId', bankAccount: 'bankAccountId' },
      lines: [
        { account: { path: 'accounts.payables' }, side: 'debit', amount: 'amount + wht3 + wht53' },
        { account: { path: 'cashAccount' }, side: 'credit', amount: 'amount' },
        { account: { path: 'accounts.whtPnd3' }, side: 'credit', amount: 'wht3', taxCode: 'wht_pnd3', taxBase: 'whtBase3' },
        { account: { path: 'accounts.whtPnd53' }, side: 'credit', amount: 'wht53', taxCode: 'wht_pnd53', taxBase: 'whtBase53' },
      ],
    },
  },
  {
    key: 'F05',
    eventType: 'erp_stock.adjusted',
    name: 'ปรับปรุงสต็อก / ตรวจนับ',
    description: 'Stock adjustment or count: inventory against stock variance, sign by direction; opening balances entered after the ledger start go to retained earnings (D-324).',
    template: {
      description: 'ปรับปรุงสต็อก {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_stock_document', id: 'documentId', number: 'documentNo' },
      lines: [
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'offsetAccount' }, side: 'credit', amount: 'movementsValue' },
      ],
    },
  },
  {
    key: 'F06',
    eventType: 'erp_stock.issued',
    name: 'เบิกใช้ (ไม่ใช่การผลิต)',
    description: 'Non-production issue: factory supplies (or the item kind’s expense account) against inventory; returns mirror (D-324).',
    template: {
      description: 'เบิกใช้ {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_stock_document', id: 'documentId', number: 'documentNo' },
      lines: [
        { forEach: 'movements', account: { path: 'item.expenseAccount' }, side: 'debit', amount: '0 - item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'credit', amount: '0 - item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
      ],
    },
  },
  {
    key: 'F06M',
    eventType: 'erp_maintenance.parts_issued',
    name: 'เบิกอะไหล่ซ่อมบำรุง',
    description: 'Spare parts issued to a maintenance order: repairs and maintenance against inventory (D-357).',
    template: {
      description: 'เบิกอะไหล่ {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_maintenance_order', id: 'documentId', number: 'documentNo' },
      dimensions: { machine: 'machineId' },
      lines: [
        { account: { path: 'accounts.maintenance' }, side: 'debit', amount: '0 - movementsValue' },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'credit', amount: '0 - item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
      ],
    },
  },
  {
    key: 'F05N',
    eventType: 'erp_ncr.disposed',
    name: 'ตัดจ่ายของเสีย (NCR)',
    description: 'An NCR disposed as scrap: stock variance against inventory for the scrapped quantity (D-374).',
    template: {
      description: 'ตัดของเสีย {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_ncr', id: 'documentId', number: 'documentNo' },
      lines: [
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.stockVariance' }, side: 'credit', amount: 'movementsValue' },
      ],
    },
  },
  {
    key: 'F07',
    eventType: 'erp_production_order.materials_issued',
    name: 'เบิกวัตถุดิบเข้าผลิต',
    description: 'Materials issued to a production order: work in process against inventory at the movement value (D-341).',
    template: {
      description: 'เบิกวัตถุดิบ {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_production_order', id: 'documentId', number: 'documentNo' },
      dimensions: { productionOrder: 'documentId' },
      lines: [
        { account: { path: 'accounts.wip' }, side: 'debit', amount: '0 - movementsValue' },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'credit', amount: '0 - item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
      ],
    },
  },
  {
    key: 'F07R',
    eventType: 'erp_production_order.materials_returned',
    name: 'คืนวัตถุดิบจากการผลิต',
    description: 'Materials returned from a production order: inventory against work in process (D-341).',
    template: {
      description: 'คืนวัตถุดิบ {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_production_order', id: 'documentId', number: 'documentNo' },
      dimensions: { productionOrder: 'documentId' },
      lines: [
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.wip' }, side: 'credit', amount: 'movementsValue' },
      ],
    },
  },
  {
    key: 'F08',
    eventType: 'erp_production_order.completed',
    name: 'ปิดใบสั่งผลิต',
    description: 'Production completed: finished goods at full cost (materials, labour, overhead — D-376) against work in process, labour applied and overhead applied; the residual is production variance.',
    template: {
      description: 'ปิดใบสั่งผลิต {documentNo}',
      documentDate: 'documentDate',
      source: { type: 'erp_production_order', id: 'documentId', number: 'documentNo' },
      dimensions: { productionOrder: 'documentId', item: 'itemId', warehouse: 'warehouseId' },
      lines: [
        { account: { path: 'accounts.finishedGoods' }, side: 'debit', amount: 'receivedValue' },
        { account: { path: 'accounts.wip' }, side: 'credit', amount: 'materialsValue' },
        { account: { path: 'accounts.labourApplied' }, side: 'credit', amount: 'labourValue' },
        { account: { path: 'accounts.overheadApplied' }, side: 'credit', amount: 'overheadValue' },
        { account: { path: 'accounts.productionVariance' }, side: 'credit', amount: 'receivedValue - materialsValue - labourValue - overheadValue' },
      ],
    },
  },
  {
    key: 'F10',
    eventType: 'erp_sales_invoice.issued',
    name: 'ใบแจ้งหนี้ขาย',
    description: 'Sales invoice issued: trade receivables for the total against sales and output VAT (D-362).',
    template: {
      description: 'ใบแจ้งหนี้ {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_sales_invoice', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { account: { path: 'accounts.receivables' }, side: 'debit', amount: 'total' },
        { account: { path: 'accounts.sales' }, side: 'credit', amount: 'subtotal' },
        { account: { path: 'accounts.outputVat' }, side: 'credit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'subtotal' },
      ],
    },
  },
  {
    key: 'F11',
    eventType: 'erp_delivery_note.issued',
    name: 'ส่งสินค้า (ต้นทุนขาย)',
    description: 'Delivery note issued: cost of goods sold against finished goods at the movement value (D-361).',
    template: {
      description: 'ส่งสินค้า {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_delivery_note', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId', warehouse: 'warehouseId' },
      lines: [
        { account: { path: 'accounts.cogs' }, side: 'debit', amount: '0 - movementsValue' },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'credit', amount: '0 - item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
      ],
    },
  },
  {
    key: 'F12',
    eventType: 'erp_receipt.issued',
    name: 'รับชำระจากลูกค้า',
    description: 'Customer receipt: bank / cash and WHT withheld by the customer against trade receivables; a refund mirrors (D-364).',
    template: {
      description: 'รับชำระ {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_customer_receipt', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId', bankAccount: 'bankAccountId' },
      lines: [
        { account: { path: 'cashAccount' }, side: 'debit', amount: 'amount' },
        { account: { path: 'accounts.whtReceivable' }, side: 'debit', amount: 'whtAmount', taxCode: 'wht_receivable', taxBase: 'whtBase' },
        { account: { path: 'accounts.receivables' }, side: 'credit', amount: 'amount + whtAmount' },
      ],
    },
  },
  {
    key: 'F12R',
    eventType: 'erp_refund.issued',
    name: 'คืนเงินลูกค้า',
    description: 'Customer refund: the mirror of F12 (negative amounts), D-364.',
    template: {
      description: 'คืนเงิน {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_customer_receipt', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId', bankAccount: 'bankAccountId' },
      lines: [
        { account: { path: 'cashAccount' }, side: 'debit', amount: 'amount' },
        { account: { path: 'accounts.whtReceivable' }, side: 'debit', amount: 'whtAmount', taxCode: 'wht_receivable', taxBase: 'whtBase' },
        { account: { path: 'accounts.receivables' }, side: 'credit', amount: 'amount + whtAmount' },
      ],
    },
  },
  {
    key: 'F13',
    eventType: 'erp_credit_note.issued',
    name: 'ใบลดหนี้ / ใบเพิ่มหนี้',
    description: 'Credit note: returns and discounts plus output VAT against trade receivables; a debit note mirrors (negative amounts). Goods returned to stock post finished goods against cost of goods sold (D-363).',
    template: {
      description: '{noteKindLabel} {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_sales_note', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { account: { path: 'accounts.salesReturns' }, side: 'debit', amount: 'difference' },
        { account: { path: 'accounts.outputVat' }, side: 'debit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'difference' },
        { account: { path: 'accounts.receivables' }, side: 'credit', amount: 'total' },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.cogs' }, side: 'credit', amount: 'movementsValue' },
      ],
    },
  },
  {
    key: 'F13D',
    eventType: 'erp_debit_note.issued',
    name: 'ใบเพิ่มหนี้',
    description: 'Debit note: the mirror of F13 (negative amounts), D-363.',
    template: {
      description: '{noteKindLabel} {documentNo} — {partnerName}',
      documentDate: 'documentDate',
      source: { type: 'erp_sales_note', id: 'documentId', number: 'documentNo' },
      dimensions: { partner: 'partnerId' },
      lines: [
        { account: { path: 'accounts.salesReturns' }, side: 'debit', amount: 'difference' },
        { account: { path: 'accounts.outputVat' }, side: 'debit', amount: 'vatAmount', taxCode: 'output_vat', taxBase: 'difference' },
        { account: { path: 'accounts.receivables' }, side: 'credit', amount: 'total' },
        { forEach: 'movements', account: { path: 'item.inventoryAccount' }, side: 'debit', amount: 'item.value', dimensions: { item: 'item.itemId', warehouse: 'item.warehouseId' } },
        { account: { path: 'accounts.cogs' }, side: 'credit', amount: 'movementsValue' },
      ],
    },
  },
  {
    key: 'F16',
    eventType: 'erp_fixed_asset.depreciated',
    name: 'ค่าเสื่อมราคาประจำเดือน',
    description: 'Monthly straight-line depreciation: the category’s expense account against its accumulated depreciation (D-393).',
    template: {
      description: 'ค่าเสื่อมราคา {month}',
      documentDate: 'documentDate',
      source: { type: 'erp_gl_depreciation_run', id: 'documentId', number: 'documentNo' },
      lines: [
        { forEach: 'lines', account: { path: 'item.expenseAccount' }, side: 'debit', amount: 'item.amount', dimensions: { machine: 'item.machineId' } },
        { forEach: 'lines', account: { path: 'item.accumulatedAccount' }, side: 'credit', amount: 'item.amount', dimensions: { machine: 'item.machineId' } },
      ],
    },
  },
  {
    key: 'F16D',
    eventType: 'erp_fixed_asset.disposed',
    name: 'จำหน่าย / ตัดจำหน่ายทรัพย์สิน',
    description: 'Asset disposal or write-off: accumulated depreciation and the proceeds (bank / cash) against the asset at cost; the difference is the gain or loss on disposal (D-393).',
    template: {
      description: 'จำหน่ายทรัพย์สิน {documentNo} — {assetName}',
      documentDate: 'documentDate',
      source: { type: 'erp_gl_fixed_asset', id: 'documentId', number: 'documentNo' },
      dimensions: { machine: 'machineId', bankAccount: 'bankAccountId' },
      lines: [
        { account: { path: 'accumulatedAccount' }, side: 'debit', amount: 'accumulated' },
        { account: { path: 'cashAccount' }, side: 'debit', amount: 'proceeds' },
        { account: { path: 'gainLossAccount' }, side: 'debit', amount: 'cost - accumulated - proceeds' },
        { account: { path: 'assetAccount' }, side: 'credit', amount: 'cost' },
      ],
    },
  },
  {
    key: 'F18',
    eventType: 'erp_bank_line.matched',
    name: 'ค่าธรรมเนียม / ดอกเบี้ยธนาคาร',
    description: 'A statement line matched as a bank fee or interest: bank charges (or interest income) against the bank account (D-394).',
    template: {
      description: '{targetLabel} — {bankName} {txnDate}',
      documentDate: 'documentDate',
      source: { type: 'erp_gl_bank_statement_line', id: 'documentId', number: 'reference' },
      dimensions: { bankAccount: 'bankAccountId' },
      lines: [
        { account: { path: 'bankGlAccount' }, side: 'debit', amount: 'amount' },
        { account: { path: 'contraAccount' }, side: 'credit', amount: 'amount' },
      ],
    },
  },
];

/** Events that reverse a document's postings instead of posting new ones (source reversals, §5 F02/F04/F11–F13). */
export const REVERSING_EVENTS: Record<string, string> = {
  'erp_supplier_invoice.cancelled': 'erp_supplier_invoice',
  'erp_sales_invoice.voided': 'erp_sales_invoice',
  'erp_delivery_note.cancelled': 'erp_delivery_note',
  'erp_receipt.cancelled': 'erp_customer_receipt',
  'erp_credit_note.voided': 'erp_sales_note',
  'erp_debit_note.voided': 'erp_sales_note',
  'erp_production_order.cancelled': 'erp_production_order',
};

/** Ledger-own events (depreciation, disposal, bank fees) post in the same transaction, never through the worker. */
export const SYNC_EVENT_TYPES: ReadonlySet<string> = new Set(['erp_fixed_asset.depreciated', 'erp_fixed_asset.disposed', 'erp_bank_line.matched']);

export const POSTING_EVENT_TYPES: readonly string[] = [
  ...new Set([...RULES_TEMPLATE.map((r) => r.eventType), ...Object.keys(REVERSING_EVENTS)]),
].filter((t) => !SYNC_EVENT_TYPES.has(t));

/** The close checklist (§6, D-390), in order; `blocking` checks must pass before a period closes. */
export const CLOSE_CHECKS = [
  { key: 'stock_valuation', blocking: true },
  { key: 'payables', blocking: true },
  { key: 'receivables', blocking: true },
  { key: 'vat', blocking: true },
  { key: 'wht', blocking: true },
  { key: 'bank', blocking: true },
  { key: 'depreciation', blocking: true },
  { key: 'open_wip', blocking: false },
] as const;
export type CloseCheckKey = (typeof CLOSE_CHECKS)[number]['key'];
