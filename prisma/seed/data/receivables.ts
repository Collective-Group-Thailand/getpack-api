/**
 * Receivables reference data (B5.2, accounting-design §2): the controlled list of credit / debit note reasons
 * mapped to the statutory categories (Revenue Code §86/9, §86/10), and the e-Tax sending flag (D-091, R2).
 */
export const CREDIT_NOTE_REASONS = [
  { code: 'cancellation_before_production', statutoryCategory: 'cancellation', nameTh: 'ยกเลิกคำสั่งซื้อก่อนผลิต', nameEn: 'Order cancelled before production', appliesTo: 'both' },
  { code: 'shortage_within_tolerance', statutoryCategory: 'defective_or_short', nameTh: 'สินค้าขาดจำนวนภายในเกณฑ์ที่ตกลง', nameEn: 'Shortage within the agreed tolerance', appliesTo: 'item' },
  { code: 'defective_goods', statutoryCategory: 'defective_or_short', nameTh: 'สินค้าชำรุดบกพร่องหรือไม่ตรงตามที่ตกลง', nameEn: 'Defective or non-conforming goods', appliesTo: 'item' },
  { code: 'short_delivery', statutoryCategory: 'defective_or_short', nameTh: 'สินค้าขาดจำนวน', nameEn: 'Short delivery', appliesTo: 'item' },
  { code: 'returned_goods', statutoryCategory: 'returns', nameTh: 'รับคืนสินค้า', nameEn: 'Goods returned', appliesTo: 'item' },
  { code: 'price_reduction', statutoryCategory: 'price_reduction', nameTh: 'ลดราคาสินค้า/บริการ', nameEn: 'Price reduction', appliesTo: 'both' },
  { code: 'service_shortfall', statutoryCategory: 'price_reduction', nameTh: 'บริการไม่ครบตามข้อตกลง', nameEn: 'Service below the agreement', appliesTo: 'service' },
  { code: 'post_sale_discount', statutoryCategory: 'post_sale_discount', nameTh: 'ส่วนลดหลังการขาย', nameEn: 'Discount after sale', appliesTo: 'both' },
  { code: 'additional_charge', statutoryCategory: 'other', nameTh: 'เพิ่มราคาสินค้า/บริการ', nameEn: 'Additional charge (debit note)', appliesTo: 'both' },
  { code: 'price_increase', statutoryCategory: 'other', nameTh: 'ราคาเพิ่มตามข้อตกลง', nameEn: 'Agreed price increase (debit note)', appliesTo: 'both' },
] as const;

export const FINANCE_FEATURE_FLAGS = [
  {
    key: 'e_tax.sending',
    description:
      'Send e-Tax invoices / e-Receipts to the Revenue Department (D-091): XML and PDF are generated in R1; sending is enabled in R2 after registration',
  },
] as const;
