/**
 * Chart of accounts seed (B5.1, accounting-design.md §3 — codes are defaults ⚖). Finance changes it
 * through maker-checker (`coa_change`, D-169); the seed never overwrites what exists.
 */

export type LedgerDimensionSeed =
  | 'order'
  | 'order_group'
  | 'customer'
  | 'company'
  | 'factory'
  | 'vendor'
  | 'product_type'
  | 'channel'
  | 'campaign'
  | 'promotion'
  | 'cost_centre';

export const ALL_DIMENSIONS: readonly LedgerDimensionSeed[] = [
  'order',
  'order_group',
  'customer',
  'company',
  'factory',
  'vendor',
  'product_type',
  'channel',
  'campaign',
  'promotion',
  'cost_centre',
];

export interface AccountSeed {
  code: string;
  nameTh: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cost_of_sales' | 'expense';
  side: 'debit' | 'credit';
  cashFlow: 'cash' | 'operating' | 'investing' | 'financing' | 'equity' | 'non_cash';
  parent?: string;
  control?: boolean;
  postable?: boolean;
  required?: LedgerDimensionSeed[];
}

const a = (
  code: string,
  nameTh: string,
  nameEn: string,
  type: AccountSeed['type'],
  side: AccountSeed['side'],
  cashFlow: AccountSeed['cashFlow'],
  extra: Partial<AccountSeed> = {},
): AccountSeed => ({ code, nameTh, nameEn, type, side, cashFlow, ...extra });

/**
 * accounting-design §3 plus the fixed-asset accounts B5.5 needs (D-150). Every account allows every
 * dimension; control accounts and per-party balances require the party their sub-ledger reconciles on.
 */
export const CHART_OF_ACCOUNTS: readonly AccountSeed[] = [
  a('1000', 'สินทรัพย์', 'Assets', 'asset', 'debit', 'operating', { postable: false }),
  a('1110', 'เงินสดในมือ', 'Cash on hand', 'asset', 'debit', 'cash', { parent: '1000' }),
  a('1120', 'เงินฝากธนาคาร', 'Bank accounts', 'asset', 'debit', 'cash', { parent: '1000', postable: false }),
  a('1121', 'เงินฝากธนาคาร บัญชีที่ 1', 'Bank account 1', 'asset', 'debit', 'cash', { parent: '1120' }),
  a('1122', 'เงินฝากธนาคาร บัญชีที่ 2', 'Bank account 2', 'asset', 'debit', 'cash', { parent: '1120' }),
  a('1123', 'เงินฝากธนาคาร บัญชีที่ 3', 'Bank account 3', 'asset', 'debit', 'cash', { parent: '1120' }),
  a('1131', 'บัญชีพัก — 2C2P', 'Clearing — 2C2P', 'asset', 'debit', 'cash', { parent: '1000' }),
  a('1132', 'บัญชีพัก — SCB', 'Clearing — SCB', 'asset', 'debit', 'cash', { parent: '1000' }),
  a(
    '1133',
    'บัญชีพัก — เงินโอนรอจับคู่ธนาคาร',
    'Clearing — slip transfers pending bank match',
    'asset',
    'debit',
    'cash',
    { parent: '1000' },
  ),
  a('1140', 'เงินรับที่ยังไม่ระบุผู้โอน', 'Undeposited / unidentified receipts', 'asset', 'debit', 'cash', {
    parent: '1000',
  }),
  a('1210', 'ลูกหนี้การค้า', 'Trade receivables', 'asset', 'debit', 'operating', {
    parent: '1000',
    control: true,
    required: ['customer'],
  }),
  a('1219', 'ค่าเผื่อหนี้สงสัยจะสูญ', 'Allowance for doubtful accounts', 'asset', 'credit', 'operating', {
    parent: '1000',
  }),
  a('1230', 'ภาษีถูกหัก ณ ที่จ่าย', 'WHT receivable', 'asset', 'debit', 'operating', { parent: '1000' }),
  a('1241', 'ภาษีซื้อ', 'Input VAT', 'asset', 'debit', 'operating', { parent: '1000' }),
  a(
    '1242',
    'ภาษีซื้อยังไม่ถึงกำหนด / รอเอกสาร',
    'Input VAT not yet due / pending document',
    'asset',
    'debit',
    'operating',
    { parent: '1000' },
  ),
  a('1250', 'เงินจ่ายล่วงหน้าโรงงาน', 'Advances to factories', 'asset', 'debit', 'operating', {
    parent: '1000',
    control: true,
    required: ['vendor'],
  }),
  a('1260', 'ลูกหนี้ค่าเคลมจากโรงงาน', 'Claims receivable from factories', 'asset', 'debit', 'operating', {
    parent: '1000',
  }),
  a('1270', 'ลูกหนี้อื่น', 'Other receivables', 'asset', 'debit', 'operating', { parent: '1000' }),
  a('1500', 'ที่ดิน อาคารและอุปกรณ์', 'Fixed assets', 'asset', 'debit', 'investing', {
    parent: '1000',
    postable: false,
  }),
  a('1510', 'อุปกรณ์สำนักงาน', 'Office equipment', 'asset', 'debit', 'investing', { parent: '1500' }),
  a(
    '1511',
    'ค่าเสื่อมราคาสะสม — อุปกรณ์สำนักงาน',
    'Accumulated depreciation — office equipment',
    'asset',
    'credit',
    'non_cash',
    { parent: '1500' },
  ),
  a('1520', 'คอมพิวเตอร์และอุปกรณ์ไอที', 'Computers & IT equipment', 'asset', 'debit', 'investing', {
    parent: '1500',
  }),
  a(
    '1521',
    'ค่าเสื่อมราคาสะสม — คอมพิวเตอร์',
    'Accumulated depreciation — computers & IT',
    'asset',
    'credit',
    'non_cash',
    { parent: '1500' },
  ),
  a('1530', 'เครื่องตกแต่งและติดตั้ง', 'Furniture & fixtures', 'asset', 'debit', 'investing', {
    parent: '1500',
  }),
  a(
    '1531',
    'ค่าเสื่อมราคาสะสม — เครื่องตกแต่ง',
    'Accumulated depreciation — furniture & fixtures',
    'asset',
    'credit',
    'non_cash',
    { parent: '1500' },
  ),
  a('1540', 'ยานพาหนะ', 'Vehicles', 'asset', 'debit', 'investing', { parent: '1500' }),
  a(
    '1541',
    'ค่าเสื่อมราคาสะสม — ยานพาหนะ',
    'Accumulated depreciation — vehicles',
    'asset',
    'credit',
    'non_cash',
    { parent: '1500' },
  ),

  a('2000', 'หนี้สิน', 'Liabilities', 'liability', 'credit', 'operating', { postable: false }),
  a('2110', 'เจ้าหนี้การค้า — โรงงาน', 'Trade payables — factories', 'liability', 'credit', 'operating', {
    parent: '2000',
    control: true,
    required: ['vendor'],
  }),
  a(
    '2120',
    'เจ้าหนี้การค้า — ผู้ขายอื่น',
    'Trade payables — other vendors',
    'liability',
    'credit',
    'operating',
    { parent: '2000', control: true, required: ['vendor'] },
  ),
  a('2130', 'เงินประกันผลงานโรงงาน', 'Factory retention payable', 'liability', 'credit', 'operating', {
    parent: '2000',
    required: ['vendor'],
  }),
  a('2210', 'ภาษีขาย', 'Output VAT', 'liability', 'credit', 'operating', { parent: '2000' }),
  a('2211', 'ภาษีขายยังไม่ถึงกำหนด', 'Output VAT not yet due', 'liability', 'credit', 'operating', {
    parent: '2000',
  }),
  a(
    '2220',
    'ภาษีมูลค่าเพิ่มค้างจ่าย (ภ.พ.30)',
    'VAT payable (PP30 net)',
    'liability',
    'credit',
    'operating',
    { parent: '2000' },
  ),
  a(
    '2231',
    'ภาษีหัก ณ ที่จ่ายค้างจ่าย — ภ.ง.ด.53',
    'WHT payable — PND53',
    'liability',
    'credit',
    'operating',
    { parent: '2000' },
  ),
  a('2232', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย — ภ.ง.ด.3', 'WHT payable — PND3', 'liability', 'credit', 'operating', {
    parent: '2000',
  }),
  // D-421: commission to individuals (s.40(2)).
  a('2233', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย — ภ.ง.ด.1', 'WHT payable — PND1', 'liability', 'credit', 'operating', {
    parent: '2000',
  }),
  a(
    '2310',
    'เงินรับล่วงหน้าจากลูกค้า',
    'Customer advances / contract liabilities',
    'liability',
    'credit',
    'operating',
    { parent: '2000' },
  ),
  a('2320', 'ยอดเครดิตของลูกค้า', 'Customer credit balances', 'liability', 'credit', 'operating', {
    parent: '2000',
    required: ['customer'],
  }),
  a('2330', 'หนี้สินคะแนนสะสม', 'Loyalty points liability', 'liability', 'credit', 'operating', {
    parent: '2000',
  }),
  a('2340', 'เงินรับที่ยังไม่ได้จัดสรร', 'Unapplied receipts', 'liability', 'credit', 'operating', {
    parent: '2000',
  }),
  a('2410', 'ค่าใช้จ่ายค้างจ่าย', 'Accrued expenses', 'liability', 'credit', 'operating', { parent: '2000' }),

  a('3000', 'ส่วนของผู้ถือหุ้น', 'Equity', 'equity', 'credit', 'equity', { postable: false }),
  a('3100', 'ทุนเรือนหุ้น', 'Share capital', 'equity', 'credit', 'financing', { parent: '3000' }),
  a('3200', 'กำไรสะสม', 'Retained earnings', 'equity', 'credit', 'equity', { parent: '3000' }),
  a('3300', 'กำไรปีปัจจุบัน (ระบบ)', 'Current-year profit (system)', 'equity', 'credit', 'equity', {
    parent: '3000',
    postable: false,
  }),

  a('4000', 'รายได้', 'Revenue', 'revenue', 'credit', 'operating', { postable: false }),
  a(
    '4110',
    'รายได้ — บรรจุภัณฑ์สั่งผลิต',
    'Sales — made-to-order packaging',
    'revenue',
    'credit',
    'operating',
    { parent: '4000' },
  ),
  a('4120', 'รายได้ — สินค้ามาตรฐาน', 'Sales — standard products', 'revenue', 'credit', 'operating', {
    parent: '4000',
  }),
  a('4130', 'รายได้ — บริการออกแบบ', 'Design services', 'revenue', 'credit', 'operating', { parent: '4000' }),
  a('4140', 'รายได้ — ม็อกอัพ / ตัวอย่าง', 'Mockup / sample fees', 'revenue', 'credit', 'operating', {
    parent: '4000',
  }),
  a('4150', 'รายได้ค่าขนส่ง', 'Shipping income', 'revenue', 'credit', 'operating', { parent: '4000' }),
  a(
    '4160',
    'รายได้ค่าแก้ไขเพิ่ม / บริการอื่น',
    'Extra revision / service fees',
    'revenue',
    'credit',
    'operating',
    { parent: '4000' },
  ),
  a(
    '4910',
    'ส่วนลดจ่ายและโปรโมชัน',
    'Sales discounts & promotions (contra)',
    'revenue',
    'debit',
    'operating',
    { parent: '4000' },
  ),
  a(
    '4920',
    'รับคืนและส่วนลดหลังการขาย',
    'Sales returns & allowances (contra)',
    'revenue',
    'debit',
    'operating',
    { parent: '4000' },
  ),
  a('4930', 'การแลกคะแนน', 'Points redemption (contra)', 'revenue', 'debit', 'operating', { parent: '4000' }),
  a('4990', 'รายได้อื่น', 'Other income', 'revenue', 'credit', 'operating', { parent: '4000' }),

  a('5000', 'ต้นทุนขาย', 'Cost of sales', 'cost_of_sales', 'debit', 'operating', { postable: false }),
  a(
    '5110',
    'ต้นทุนผลิต — โรงงานพันธมิตร',
    'Production cost — partner factories',
    'cost_of_sales',
    'debit',
    'operating',
    { parent: '5000' },
  ),
  a(
    '5120',
    'ต้นทุนขนส่ง — ค่าส่งโรงงาน',
    'Shipping cost — factory delivery payout',
    'cost_of_sales',
    'debit',
    'operating',
    { parent: '5000' },
  ),
  a(
    '5130',
    'ต้นทุนขนส่ง — ขนส่งภายนอก',
    'Shipping cost — external carriers',
    'cost_of_sales',
    'debit',
    'operating',
    { parent: '5000' },
  ),
  a('5140', 'ต้นทุนงานออกแบบจ้างภายนอก', 'Design outsourcing', 'cost_of_sales', 'debit', 'operating', {
    parent: '5000',
  }),
  a('5150', 'ต้นทุนม็อกอัพ / ตัวอย่าง', 'Mockup / sample cost', 'cost_of_sales', 'debit', 'operating', {
    parent: '5000',
  }),
  a(
    '5190',
    'ต้นทุนเคลมสุทธิจากเงินเรียกคืน',
    'Claim costs net of recoveries',
    'cost_of_sales',
    'debit',
    'operating',
    { parent: '5000' },
  ),

  a('6000', 'ค่าใช้จ่ายในการดำเนินงาน', 'Operating expenses', 'expense', 'debit', 'operating', {
    postable: false,
  }),
  a('6110', 'ค่าธรรมเนียมรับชำระเงิน', 'Payment gateway fees', 'expense', 'debit', 'operating', {
    parent: '6000',
  }),
  a(
    '6120',
    'ค่าใช้จ่ายโปรโมชันและคะแนนสะสม',
    'Promotion & loyalty expense',
    'expense',
    'debit',
    'operating',
    { parent: '6000' },
  ),
  a('6130', 'หนี้สงสัยจะสูญ', 'Bad debts', 'expense', 'debit', 'operating', { parent: '6000' }),
  a('6140', 'ค่าธรรมเนียมธนาคาร', 'Bank charges', 'expense', 'debit', 'operating', { parent: '6000' }),
  a('6150', 'ค่าเสื่อมราคา', 'Depreciation', 'expense', 'debit', 'operating', { parent: '6000' }),
  // D-420: commission to sales agents (freelance through their bills, employees accrued for payroll).
  a('6160', 'ค่านายหน้าการขาย', 'Sales agent commission', 'expense', 'debit', 'operating', {
    parent: '6000',
  }),
  a('6900', 'ค่าใช้จ่ายอื่น', 'Other expenses', 'expense', 'debit', 'operating', { parent: '6000' }),
  a(
    '6910',
    'กำไร/ขาดทุนจากการจำหน่ายสินทรัพย์',
    'Gain / loss on disposal of fixed assets',
    'expense',
    'debit',
    'operating',
    { parent: '6000' },
  ),
];

/** Factory / vendor withholding rates (accounting-design §2 design defaults ⚖, pending the CPA). */
export const VENDOR_WHT_RATES = [
  {
    code: 'wht_hire_of_work',
    nameTh: 'ภาษีหัก ณ ที่จ่าย ค่าจ้างทำของ (ผู้ขาย)',
    nameEn: 'Vendor withholding tax, hire of work',
    description:
      'Withheld from factory production lines at each payment, the advance included (accounting-design §2 ⚖ default 3 %)',
    decisions: ['D-022', 'D-033'],
    ratePct: '3',
  },
  {
    code: 'wht_transport',
    nameTh: 'ภาษีหัก ณ ที่จ่าย ค่าขนส่ง (ผู้ขาย)',
    nameEn: 'Vendor withholding tax, transport',
    description:
      'Withheld from factory shipping lines and carrier bills (accounting-design §2 ⚖ default 1 %)',
    decisions: ['D-022', 'D-114', 'D-033'],
    ratePct: '1',
  },
  {
    code: 'wht_service',
    nameTh: 'ภาษีหัก ณ ที่จ่าย ค่าบริการ (ผู้ขาย)',
    nameEn: 'Vendor withholding tax, services',
    description:
      'Withheld from design freelancers (ภ.ง.ด.3) and other services (accounting-design §2 ⚖ default 3 %)',
    decisions: ['D-071', 'D-033'],
    ratePct: '3',
  },
  {
    code: 'wht_commission',
    nameTh: 'ภาษีหัก ณ ที่จ่าย ค่านายหน้า 40(2) (บุคคลธรรมดา)',
    nameEn: 'Withholding tax, commission to individuals (s.40(2))',
    description:
      'Withheld from sales agent commission paid to individuals, filed on ภ.ง.ด.1 (D-421 ⚖ flat default 3 % pending the CPA; s.50(1) asks for the progressive computation)',
    decisions: ['D-421'],
    ratePct: '3',
  },
] as const;
