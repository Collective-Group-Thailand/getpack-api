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
