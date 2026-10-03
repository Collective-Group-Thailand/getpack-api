/**
 * Reason codes for declined / expired RFQs and unmet demand (D-102, schema-design §3.5). Codes are
 * structural (analytics group by them); admins may add more.
 */
export const UNMET_DEMAND_REASONS = [
  { code: 'capability_missing', nameTh: 'ไม่มีโรงงานที่ผลิตได้', nameEn: 'No factory can make it' },
  { code: 'capacity_full', nameTh: 'กำลังการผลิตเต็ม', nameEn: 'Capacity full' },
  { code: 'price_not_competitive', nameTh: 'ราคาไม่สามารถแข่งขันได้', nameEn: 'Price not competitive' },
  { code: 'spec_not_feasible', nameTh: 'สเปกผลิตไม่ได้', nameEn: 'Specification not feasible' },
  { code: 'customer_no_response', nameTh: 'ลูกค้าไม่ตอบกลับ', nameEn: 'Customer did not respond' },
  { code: 'customer_declined', nameTh: 'ลูกค้าไม่รับใบเสนอราคา', nameEn: 'Customer declined the quotation' },
  { code: 'expired', nameTh: 'หมดอายุ', nameEn: 'Expired' },
] as const;

/** D-250 why a customer declined a quotation (optional for the customer, U2.3). */
export const QUOTE_LOSS_REASONS = [
  { code: 'price', nameTh: 'ราคาสูงกว่างบประมาณ', nameEn: 'Price above budget' },
  { code: 'lead_time', nameTh: 'ระยะเวลาผลิตนานเกินไป', nameEn: 'Lead time too long' },
  { code: 'specification', nameTh: 'สเปกไม่ตรงความต้องการ', nameEn: 'Specification does not fit' },
  { code: 'bought_elsewhere', nameTh: 'สั่งซื้อจากที่อื่นแล้ว', nameEn: 'Bought elsewhere' },
  { code: 'no_longer_needed', nameTh: 'ไม่ต้องการแล้ว', nameEn: 'No longer needed' },
  { code: 'other', nameTh: 'อื่น ๆ', nameEn: 'Other' },
] as const;

/**
 * Pricing feature flags (U-B6 tail, U2.2): a ported engine or the Structure Advisor stays off until its validation
 * document is signed (A-16, D-100, D-189).
 */
export const PRICING_FEATURE_FLAGS = [
  {
    key: 'pricing.folding_engine_b',
    description:
      'Folding engine B (type-B factories, D-233) in customer and CS quotes — off until docs/pricing-validation-folding-b.md is signed; factory breakdowns price B meanwhile',
  },
  {
    key: 'advisory.structure_advisor',
    description:
      'Structure Advisor for customers (store.advisory.recommend / choose, D-237) — off until the golden cases of docs/advisory-validation.md are signed by the Partner Manager and Prepress (D-189); staff evaluate meanwhile',
  },
] as const;
