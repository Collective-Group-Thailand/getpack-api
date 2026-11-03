/**
 * D-472 (PLAN A-14, PNL-LINES.md): the management P&L line catalogue. The structure — keys, groups, units, which
 * lines come from the system and which are formulas, which can be edited — is code; the labels, tooltips and the GL
 * account mapping are the effective-dated setting `pnl.line_catalogue` (owner Finance Manager), seeded from
 * PNL-LINES.md (Thai only there: `en` null until Finance writes it) and the chart of accounts as seeded.
 */

export const PNL_LINE_GROUPS = [
  'revenue',
  'cost_of_sales',
  'gross_margin',
  'selling_expenses',
  'admin_expenses',
  'operating_profit',
  'finance_and_tax',
  'net_profit',
  'memo',
] as const;
export type PnlLineGroup = (typeof PNL_LINE_GROUPS)[number];

export const PNL_LINE_UNITS = ['money', 'percent', 'days'] as const;
export type PnlLineUnit = (typeof PNL_LINE_UNITS)[number];

/** `source`: from the system (GL, pipeline, fixed assets, balances) or entered; `formula`: over other lines. */
export const PNL_LINE_CALCS = ['source', 'formula'] as const;
export type PnlLineCalc = (typeof PNL_LINE_CALCS)[number];

export const PNL_LINE_KEYS = [
  'revenue_goods',
  'revenue_shipping',
  'discounts',
  'net_revenue',
  'factory_cost',
  'shipping_cost',
  'payment_fees',
  'gross_margin',
  'agent_commission',
  'employee_commission',
  'marketing',
  'salaries',
  'rent_utilities',
  'software_cloud',
  'professional_fees',
  'depreciation',
  'other_opex',
  'ebit',
  'finance_cost',
  'cit_estimate',
  'net_profit',
  'memo_credit_cost',
  'memo_bad_debt',
  'memo_ebitda',
  'memo_commission_ratio',
  'memo_dso',
  'memo_dpo',
  'memo_ccc',
  'memo_break_even',
] as const;
export type PnlLineKey = (typeof PNL_LINE_KEYS)[number];

export interface PnlLineDef {
  key: PnlLineKey;
  group: PnlLineGroup;
  unit: PnlLineUnit;
  calc: PnlLineCalc;
  /** Part of the P&L (memo lines are not). */
  inTotal: boolean;
  /** A person may enter (manual) or override (auto) the value; formula and memo lines are read-only. */
  editable: boolean;
}

const line = (
  key: PnlLineKey,
  group: PnlLineGroup,
  calc: PnlLineCalc,
  options: { unit?: PnlLineUnit; editable?: boolean } = {},
): PnlLineDef => ({
  key,
  group,
  unit: options.unit ?? 'money',
  calc,
  inTotal: group !== 'memo',
  editable: options.editable ?? (calc === 'source' && group !== 'memo'),
});

/** In display order. */
export const PNL_LINES: readonly PnlLineDef[] = [
  line('revenue_goods', 'revenue', 'source'),
  line('revenue_shipping', 'revenue', 'source'),
  line('discounts', 'revenue', 'source'),
  line('net_revenue', 'revenue', 'formula'),
  line('factory_cost', 'cost_of_sales', 'source'),
  line('shipping_cost', 'cost_of_sales', 'source'),
  line('payment_fees', 'cost_of_sales', 'source'),
  line('gross_margin', 'gross_margin', 'formula'),
  line('agent_commission', 'selling_expenses', 'source'),
  line('employee_commission', 'selling_expenses', 'source'),
  line('marketing', 'selling_expenses', 'source'),
  line('salaries', 'admin_expenses', 'source'),
  line('rent_utilities', 'admin_expenses', 'source'),
  line('software_cloud', 'admin_expenses', 'source'),
  line('professional_fees', 'admin_expenses', 'source'),
  line('depreciation', 'admin_expenses', 'source'),
  line('other_opex', 'admin_expenses', 'source'),
  line('ebit', 'operating_profit', 'formula'),
  line('finance_cost', 'finance_and_tax', 'source'),
  line('cit_estimate', 'finance_and_tax', 'formula'),
  line('net_profit', 'net_profit', 'formula'),
  line('memo_credit_cost', 'memo', 'formula'),
  line('memo_bad_debt', 'memo', 'source'),
  line('memo_ebitda', 'memo', 'formula'),
  line('memo_commission_ratio', 'memo', 'formula', { unit: 'percent' }),
  line('memo_dso', 'memo', 'source', { unit: 'days' }),
  line('memo_dpo', 'memo', 'source', { unit: 'days' }),
  line('memo_ccc', 'memo', 'formula', { unit: 'days' }),
  line('memo_break_even', 'memo', 'formula'),
];

export const PNL_LINE_BY_KEY: ReadonlyMap<PnlLineKey, PnlLineDef> = new Map(PNL_LINES.map((l) => [l.key, l]));

export function isPnlLineKey(value: string): value is PnlLineKey {
  return (PNL_LINE_KEYS as readonly string[]).includes(value);
}

/** Revenue lines are credit-normal (credit − debit); every other mapped line is debit − credit. */
export const CREDIT_NORMAL_LINES: ReadonlySet<PnlLineKey> = new Set(['revenue_goods', 'revenue_shipping']);

/** Fixed costs for the break-even revenue (operating costs that do not move with sales; commissions excluded). */
export const FIXED_COST_LINES: readonly PnlLineKey[] = [
  'marketing',
  'salaries',
  'rent_utilities',
  'software_cloud',
  'professional_fees',
  'depreciation',
  'other_opex',
];

/** Lines whose forecast is the trailing-window average of their actuals (unless a manual value exists). */
export const TRAILING_AVERAGE_LINES: readonly PnlLineKey[] = [
  'marketing',
  'salaries',
  'rent_utilities',
  'software_cloud',
  'professional_fees',
  'other_opex',
  'finance_cost',
];

// --- the setting `pnl.line_catalogue` --------------------------------------------------------------------------------

export interface PnlText {
  th: string;
  en: string | null;
}

/** A GL account of a line; `onlyRules` / `excludeRules` filter its journal lines by posting-rule key. */
export interface PnlGlMapping {
  code: string;
  onlyRules?: string[];
  excludeRules?: string[];
}

export interface PnlLineCatalogueEntry {
  labelTh: string;
  labelEn: string;
  definition: PnlText;
  formula: PnlText;
  source: PnlText;
  /** How to fill it by hand (lines a person may enter); null for formula / system-only lines. */
  howToFill: PnlText | null;
  glAccounts: PnlGlMapping[];
}

export interface PnlLineCatalogue {
  lines: Record<PnlLineKey, PnlLineCatalogueEntry>;
}

const LABEL_EN: Record<PnlLineKey, string> = {
  revenue_goods: 'Revenue — goods',
  revenue_shipping: 'Revenue — shipping',
  discounts: 'Discounts',
  net_revenue: 'Net revenue',
  factory_cost: 'Factory cost',
  shipping_cost: 'Shipping cost',
  payment_fees: 'Payment fees',
  gross_margin: 'Gross margin',
  agent_commission: 'Agent commission',
  employee_commission: 'Employee sales commission',
  marketing: 'Marketing',
  salaries: 'Salaries & benefits',
  rent_utilities: 'Rent & utilities',
  software_cloud: 'Software & cloud',
  professional_fees: 'Professional fees',
  depreciation: 'Depreciation',
  other_opex: 'Other operating expenses',
  ebit: 'Operating profit (EBIT)',
  finance_cost: 'Finance cost',
  cit_estimate: 'Corporate income tax (estimate)',
  net_profit: 'Net profit',
  memo_credit_cost: 'Credit cost (estimate)',
  memo_bad_debt: 'Bad-debt provision (estimate)',
  memo_ebitda: 'EBITDA',
  memo_commission_ratio: 'Commission ÷ gross margin',
  memo_dso: 'Days sales outstanding',
  memo_dpo: 'Days payables outstanding',
  memo_ccc: 'Cash conversion cycle',
  memo_break_even: 'Break-even revenue',
};

/**
 * The seed of `pnl.line_catalogue` (D-472): texts copied from PNL-LINES.md (a unit test keeps them in step — the one
 * documented difference is the credit cost's source, which says how the planner aggregates it); GL mapping from the
 * seeded chart of accounts. Unmapped (no account in the chart): salaries, rent & utilities, software & cloud,
 * professional fees, finance cost — they stay manual until Finance maps an account.
 */
export const PNL_LINE_CATALOGUE_SEED: PnlLineCatalogue = {
  lines: {
    revenue_goods: {
      labelTh: 'รายได้จากการขายสินค้า',
      labelEn: LABEL_EN.revenue_goods,
      definition: { th: 'มูลค่าสินค้าที่ออกใบกำกับภาษีแล้วในเดือนนั้น ก่อนหักส่วนลด', en: null },
      formula: { th: 'Σ ยอดสินค้าก่อน VAT ตามใบกำกับ', en: null },
      source: {
        th: 'GL รายได้ขายสินค้า; forecast = pipeline × ความน่าจะเป็นตามขั้น + ยอดสั่งซ้ำเฉลี่ย 3 เดือน',
        en: null,
      },
      howToFill: { th: 'ใส่ยอดขายที่คาดไว้ ระบุว่ามาจากเป้าหรือดีลไหน', en: null },
      glAccounts: [{ code: '4110' }, { code: '4120' }, { code: '4130' }, { code: '4140' }, { code: '4160' }],
    },
    revenue_shipping: {
      labelTh: 'รายได้ค่าขนส่ง',
      labelEn: LABEL_EN.revenue_shipping,
      definition: { th: 'ค่าขนส่งที่เรียกเก็บจากลูกค้า', en: null },
      formula: { th: 'Σ ค่าส่งตามใบกำกับ', en: null },
      source: { th: 'GL รายได้ค่าขนส่ง; forecast = % ค่าส่งเฉลี่ยต่อยอดขาย 3 เดือน', en: null },
      howToFill: { th: '% ของยอดขายที่คาดว่าจะเก็บค่าส่ง', en: null },
      glAccounts: [{ code: '4150' }],
    },
    discounts: {
      labelTh: 'ส่วนลดจ่าย',
      labelEn: LABEL_EN.discounts,
      definition: { th: 'ส่วนลดที่ให้ลูกค้า รวมส่วนลดเงินสดและคูปอง', en: null },
      formula: { th: 'Σ ส่วนลดตามเอกสารขาย', en: null },
      source: { th: 'GL ส่วนลดจ่าย; forecast = % ส่วนลดเฉลี่ย 3 เดือน', en: null },
      howToFill: { th: '% ส่วนลดเฉลี่ยที่คาดไว้', en: null },
      glAccounts: [{ code: '4910' }, { code: '4920' }, { code: '4930' }],
    },
    net_revenue: {
      labelTh: 'รายได้สุทธิ',
      labelEn: LABEL_EN.net_revenue,
      definition: { th: 'รายได้หลังหักส่วนลด', en: null },
      formula: { th: 'revenue_goods + revenue_shipping − discounts', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    factory_cost: {
      labelTh: 'ต้นทุนสินค้าจากผู้ผลิต',
      labelEn: LABEL_EN.factory_cost,
      definition: { th: 'ราคาที่ getpack จ่ายผู้ผลิตสำหรับงานที่รับรู้รายได้ในเดือนนั้น', en: null },
      formula: { th: 'Σ ราคาซื้อของออเดอร์ที่ส่งมอบ', en: null },
      source: { th: 'GL ต้นทุนขาย; forecast = (1 − %กำไรขั้นต้นตามกลุ่มสินค้า) × รายได้', en: null },
      howToFill: { th: '% ต้นทุนต่อยอดขาย', en: null },
      glAccounts: [{ code: '5110' }, { code: '5140' }, { code: '5150' }, { code: '5190' }],
    },
    shipping_cost: {
      labelTh: 'ต้นทุนขนส่ง',
      labelEn: LABEL_EN.shipping_cost,
      definition: { th: 'ค่าขนส่งที่จ่ายผู้ผลิตหรือขนส่ง', en: null },
      formula: { th: 'Σ ค่าส่งที่จ่าย', en: null },
      source: { th: 'GL ค่าขนส่ง', en: null },
      howToFill: { th: '% ของรายได้ค่าขนส่ง', en: null },
      glAccounts: [{ code: '5120' }, { code: '5130' }],
    },
    payment_fees: {
      labelTh: 'ค่าธรรมเนียมรับชำระ',
      labelEn: LABEL_EN.payment_fees,
      definition: { th: 'ค่าธรรมเนียมบัตร, QR และ payment gateway', en: null },
      formula: { th: 'Σ ค่าธรรมเนียมตามรายการรับเงิน', en: null },
      source: { th: 'GL ค่าธรรมเนียม; forecast = % เฉลี่ย', en: null },
      howToFill: { th: '% ของรายได้ที่รับผ่านช่องทางมีค่าธรรมเนียม', en: null },
      glAccounts: [{ code: '6110' }],
    },
    gross_margin: {
      labelTh: 'กำไรขั้นต้น',
      labelEn: LABEL_EN.gross_margin,
      definition: { th: 'รายได้สุทธิหลังหักต้นทุนตรง', en: null },
      formula: { th: 'net_revenue − factory_cost − shipping_cost − payment_fees', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    agent_commission: {
      labelTh: 'ค่าคอมตัวแทน',
      labelEn: LABEL_EN.agent_commission,
      definition: { th: 'ค่าคอมของตัวแทน freelance ที่รับรู้ในเดือนนั้น', en: null },
      formula: { th: 'Σ ค่าคอมที่ earned', en: null },
      source: {
        th: 'ledger ค่าคอม / GL 6160; forecast = อัตราที่มีผล × รายได้ forecast ที่มาจากตัวแทน',
        en: null,
      },
      howToFill: { th: '% ของรายได้ผ่านตัวแทน', en: null },
      glAccounts: [{ code: '6160', excludeRules: ['AG01'] }],
    },
    employee_commission: {
      labelTh: 'ค่าคอมพนักงานขาย',
      labelEn: LABEL_EN.employee_commission,
      definition: { th: 'ค่าคอมของเซลส์บริษัท', en: null },
      formula: { th: 'Σ ค่าคอม employee', en: null },
      source: { th: 'GL 6160 (employee)', en: null },
      howToFill: { th: 'จำนวนเงินที่คาดไว้', en: null },
      glAccounts: [{ code: '6160', onlyRules: ['AG01'] }],
    },
    marketing: {
      labelTh: 'ค่าการตลาด',
      labelEn: LABEL_EN.marketing,
      definition: { th: 'โฆษณา, โปรโมชั่น, สื่อ, งานแสดงสินค้า', en: null },
      formula: { th: 'Σ ค่าใช้จ่ายหมวดการตลาด', en: null },
      source: { th: 'GL / AP หมวดการตลาด; forecast = เฉลี่ย 3 เดือน', en: null },
      howToFill: { th: 'งบการตลาดรายเดือน', en: null },
      glAccounts: [{ code: '6120' }],
    },
    salaries: {
      labelTh: 'เงินเดือนและสวัสดิการ',
      labelEn: LABEL_EN.salaries,
      definition: { th: 'เงินเดือน, ประกันสังคมส่วนนายจ้าง, สวัสดิการ', en: null },
      formula: { th: 'Σ ตาม payroll', en: null },
      source: { th: 'payroll export / GL', en: null },
      howToFill: { th: 'จำนวนพนักงาน × ค่าจ้างเฉลี่ย (ระบุใน note)', en: null },
      glAccounts: [],
    },
    rent_utilities: {
      labelTh: 'ค่าเช่าและสาธารณูปโภค',
      labelEn: LABEL_EN.rent_utilities,
      definition: { th: 'ค่าเช่าสำนักงาน, ไฟ, น้ำ, อินเทอร์เน็ต', en: null },
      formula: { th: 'Σ หมวด', en: null },
      source: { th: 'GL / AP', en: null },
      howToFill: { th: 'ค่าใช้จ่ายประจำเดือน', en: null },
      glAccounts: [],
    },
    software_cloud: {
      labelTh: 'ซอฟต์แวร์และคลาวด์',
      labelEn: LABEL_EN.software_cloud,
      definition: { th: 'ค่าบริการ cloud, SaaS, โดเมน', en: null },
      formula: { th: 'Σ หมวด', en: null },
      source: { th: 'GL / AP', en: null },
      howToFill: { th: 'ค่าบริการรายเดือน', en: null },
      glAccounts: [],
    },
    professional_fees: {
      labelTh: 'ค่าวิชาชีพ',
      labelEn: LABEL_EN.professional_fees,
      definition: { th: 'ค่าสอบบัญชี, ทนาย, ที่ปรึกษา', en: null },
      formula: { th: 'Σ หมวด', en: null },
      source: { th: 'GL / AP', en: null },
      howToFill: { th: 'ค่าธรรมเนียมตามสัญญา', en: null },
      glAccounts: [],
    },
    depreciation: {
      labelTh: 'ค่าเสื่อมราคา',
      labelEn: LABEL_EN.depreciation,
      definition: { th: 'ค่าเสื่อมของสินทรัพย์ถาวร', en: null },
      formula: { th: 'ตามตารางค่าเสื่อม', en: null },
      source: { th: 'fixed-assets schedule', en: null },
      howToFill: null,
      glAccounts: [{ code: '6150' }],
    },
    other_opex: {
      labelTh: 'ค่าใช้จ่ายอื่น',
      labelEn: LABEL_EN.other_opex,
      definition: { th: 'ค่าใช้จ่ายดำเนินงานที่ไม่อยู่ในหมวดข้างบน', en: null },
      formula: { th: 'Σ หมวดอื่น', en: null },
      source: { th: 'GL', en: null },
      howToFill: { th: 'ระบุรายการใน note', en: null },
      glAccounts: [{ code: '6130' }, { code: '6140' }, { code: '6900' }, { code: '6910' }],
    },
    ebit: {
      labelTh: 'กำไรจากการดำเนินงาน',
      labelEn: LABEL_EN.ebit,
      definition: { th: 'กำไรก่อนดอกเบี้ยและภาษี', en: null },
      formula: { th: 'gross_margin − ค่าคอมทั้งหมด − ค่าใช้จ่ายดำเนินงานทั้งหมด', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    finance_cost: {
      labelTh: 'ต้นทุนทางการเงิน',
      labelEn: LABEL_EN.finance_cost,
      definition: { th: 'ดอกเบี้ยจ่ายจริงของเงินกู้', en: null },
      formula: { th: 'Σ ดอกเบี้ยจ่าย', en: null },
      source: { th: 'GL ดอกเบี้ยจ่าย', en: null },
      howToFill: { th: 'ดอกเบี้ยตามสัญญาเงินกู้', en: null },
      glAccounts: [],
    },
    cit_estimate: {
      labelTh: 'ภาษีเงินได้นิติบุคคล (ประมาณการ)',
      labelEn: LABEL_EN.cit_estimate,
      definition: { th: 'ภาษีที่คาดว่าจะต้องเสียจากกำไรก่อนภาษี', en: null },
      formula: { th: 'อัตราตาม setting (SME หรือ 20%) × กำไรก่อนภาษีสะสม', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    net_profit: {
      labelTh: 'กำไรสุทธิ',
      labelEn: LABEL_EN.net_profit,
      definition: { th: 'กำไรหลังหักทุกอย่างรวมภาษี', en: null },
      formula: { th: 'ebit − finance_cost − cit_estimate', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    memo_credit_cost: {
      labelTh: 'ต้นทุนเงินจากเครดิตเทอม (ประมาณการ)',
      labelEn: LABEL_EN.memo_credit_cost,
      definition: {
        th: 'ต้นทุนค่าเสียโอกาสของเงินที่จมระหว่างจ่ายผู้ผลิตจนลูกค้าจ่าย ไม่ได้ลงบัญชี',
        en: null,
      },
      formula: { th: 'Σ เงินจ่ายผู้ผลิต × อัตราต้นทุนเงิน × วันที่เงินจม ÷ 365', en: null },
      source: {
        th: 'ต้นทุนผู้ผลิตและค่าขนส่งของเดือน × อัตราต้นทุนเงิน (finance.cost_of_capital_annual_pct) × วงจรเงินสด (DSO − DPO) ÷ 365 — ประมาณการระดับบริษัท ไม่ลงบัญชี',
        en: null,
      },
      howToFill: null,
      glAccounts: [],
    },
    memo_bad_debt: {
      labelTh: 'สำรองหนี้สูญ (ประมาณการ)',
      labelEn: LABEL_EN.memo_bad_debt,
      definition: { th: 'ความเสี่ยงเก็บเงินไม่ได้ตามระดับเครดิตลูกค้า', en: null },
      formula: { th: 'ลูกหนี้คงค้าง × % ตามระดับเครดิต', en: null },
      source: { th: 'ลูกหนี้ + setting', en: null },
      howToFill: null,
      glAccounts: [{ code: '1210' }],
    },
    memo_ebitda: {
      labelTh: 'EBITDA',
      labelEn: LABEL_EN.memo_ebitda,
      definition: { th: 'กำไรก่อนดอกเบี้ย ภาษี ค่าเสื่อม', en: null },
      formula: { th: 'ebit + depreciation', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    memo_commission_ratio: {
      labelTh: 'ค่าคอม ÷ กำไรขั้นต้น',
      labelEn: LABEL_EN.memo_commission_ratio,
      definition: { th: 'สัดส่วนค่าคอมทั้งหมดต่อกำไรขั้นต้น ใช้เฝ้าระวังแผนค่าตอบแทน', en: null },
      formula: { th: '(agent + employee commission) ÷ gross_margin', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    memo_dso: {
      labelTh: 'ระยะเวลาเก็บหนี้ (วัน)',
      labelEn: LABEL_EN.memo_dso,
      definition: { th: 'ลูกหนี้เฉลี่ยคิดเป็นกี่วันของยอดขาย', en: null },
      formula: { th: 'ลูกหนี้เฉลี่ย ÷ รายได้ × วันในงวด', en: null },
      source: { th: 'ลูกหนี้', en: null },
      howToFill: null,
      glAccounts: [{ code: '1210' }],
    },
    memo_dpo: {
      labelTh: 'ระยะเวลาจ่ายหนี้ (วัน)',
      labelEn: LABEL_EN.memo_dpo,
      definition: { th: 'เจ้าหนี้ผู้ผลิตเฉลี่ยคิดเป็นกี่วันของต้นทุน', en: null },
      formula: { th: 'เจ้าหนี้เฉลี่ย ÷ ต้นทุน × วันในงวด', en: null },
      source: { th: 'เจ้าหนี้', en: null },
      howToFill: null,
      glAccounts: [{ code: '2110' }],
    },
    memo_ccc: {
      labelTh: 'วงจรเงินสด (วัน)',
      labelEn: LABEL_EN.memo_ccc,
      definition: { th: 'ระยะเวลาที่เงินจม', en: null },
      formula: { th: 'DSO − DPO (ไม่มีสต็อก)', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
    memo_break_even: {
      labelTh: 'ยอดขายจุดคุ้มทุน',
      labelEn: LABEL_EN.memo_break_even,
      definition: { th: 'ยอดขายที่ทำให้กำไรจากการดำเนินงานเป็นศูนย์', en: null },
      formula: { th: 'ค่าใช้จ่ายคงที่ ÷ (%กำไรขั้นต้น − %ค่าคอม)', en: null },
      source: { th: 'คำนวณ', en: null },
      howToFill: null,
      glAccounts: [],
    },
  },
};

const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['th', 'en'],
  properties: {
    th: { type: 'string', minLength: 1, maxLength: 500 },
    en: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
  },
} as const;

const RULE_KEYS = {
  type: 'array',
  maxItems: 20,
  items: { type: 'string', pattern: '^[A-Z0-9]{2,12}$' },
} as const;

/** JSON schema of `pnl.line_catalogue`: exactly the code's line keys, each with every tooltip field. */
export const PNL_LINE_CATALOGUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'object',
      additionalProperties: false,
      required: [...PNL_LINE_KEYS],
      properties: Object.fromEntries(
        PNL_LINE_KEYS.map((key) => [
          key,
          {
            type: 'object',
            additionalProperties: false,
            required: ['labelTh', 'labelEn', 'definition', 'formula', 'source', 'howToFill', 'glAccounts'],
            properties: {
              labelTh: { type: 'string', minLength: 1, maxLength: 120 },
              labelEn: { type: 'string', minLength: 1, maxLength: 120 },
              definition: TEXT_SCHEMA,
              formula: TEXT_SCHEMA,
              source: TEXT_SCHEMA,
              howToFill: { anyOf: [TEXT_SCHEMA, { type: 'null' }] },
              glAccounts: {
                type: 'array',
                maxItems: 50,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['code'],
                  properties: {
                    code: { type: 'string', pattern: '^[0-9]{4,6}$' },
                    onlyRules: RULE_KEYS,
                    excludeRules: RULE_KEYS,
                  },
                },
              },
            },
          },
        ]),
      ),
    },
  },
} as const;

// --- the setting `pnl.forecast_rules` --------------------------------------------------------------------------------

/** D-472 how forecast months are filled (owner Finance Manager, proposed). Percentages are decimal strings. */
export interface PnlForecastRules {
  /** Probability of an open lead by pipeline stage (D-468 stages; won / lost are not open). */
  stageProbabilityPct: Record<'new' | 'contacted' | 'quoted' | 'negotiating', string>;
  /** The weighted pipeline is spread evenly over this many forecast months (leads carry no expected close date). */
  pipelineHorizonMonths: number;
  /** Complete months before the current one used for ratios, averages and the run rate. */
  trailingMonths: number;
  /** A customer is a repeat customer with revenue in at least this many months of the trailing window. */
  repeatMinMonths: number;
}

export const PNL_FORECAST_RULES_SEED: PnlForecastRules = {
  stageProbabilityPct: { new: '10.00', contacted: '20.00', quoted: '40.00', negotiating: '60.00' },
  pipelineHorizonMonths: 3,
  trailingMonths: 3,
  repeatMinMonths: 2,
};

const PCT = { type: 'string', pattern: '^(100(\\.0{1,2})?|\\d{1,2}(\\.\\d{1,2})?)$' } as const;

export const PNL_FORECAST_RULES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stageProbabilityPct', 'pipelineHorizonMonths', 'trailingMonths', 'repeatMinMonths'],
  properties: {
    stageProbabilityPct: {
      type: 'object',
      additionalProperties: false,
      required: ['new', 'contacted', 'quoted', 'negotiating'],
      properties: { new: PCT, contacted: PCT, quoted: PCT, negotiating: PCT },
    },
    pipelineHorizonMonths: { type: 'integer', minimum: 1, maximum: 12 },
    trailingMonths: { type: 'integer', minimum: 1, maximum: 12 },
    repeatMinMonths: { type: 'integer', minimum: 1, maximum: 12 },
  },
} as const;

// --- the setting `tax.cit_rates` -------------------------------------------------------------------------------------

const MONEY = { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,2})?$' } as const;

/**
 * D-472 corporate income tax table (Revenue Code; ⚖ the CPA confirms): 20 %, or for an SME (paid-up capital ≤ ฿5M at
 * year end and revenue ≤ ฿30M) 0 % to ฿300,000, 15 % to ฿3,000,000, 20 % above. The company's paid-up capital is
 * not known to the system: null until the accountant enters it, and the standard rate applies meanwhile.
 */
export const CIT_RATES_SEED = {
  standardRatePct: '20.00',
  sme: {
    bands: [
      { upTo: '300000.00', ratePct: '0.00' },
      { upTo: '3000000.00', ratePct: '15.00' },
      { upTo: null, ratePct: '20.00' },
    ],
    paidUpCapitalMax: '5000000.00',
    revenueMax: '30000000.00',
  },
  paidUpCapital: null,
} as const;

export const CIT_RATES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['standardRatePct', 'sme', 'paidUpCapital'],
  properties: {
    standardRatePct: PCT,
    sme: {
      type: 'object',
      additionalProperties: false,
      required: ['bands', 'paidUpCapitalMax', 'revenueMax'],
      properties: {
        bands: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['upTo', 'ratePct'],
            properties: { upTo: { anyOf: [MONEY, { type: 'null' }] }, ratePct: PCT },
          },
        },
        paidUpCapitalMax: MONEY,
        revenueMax: MONEY,
      },
    },
    paidUpCapital: { anyOf: [MONEY, { type: 'null' }] },
  },
} as const;
