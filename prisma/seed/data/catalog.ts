import { type CalculatorKey } from '../../../src/generated/prisma/client';

export interface ProductTypeSeed {
  code: string;
  nameTh: string;
  nameEn: string;
  /** Calculator that prices the type once it ships (B2.3); null for RFQ categories. */
  calculatorKey: CalculatorKey | null;
  isFoodContactDefault?: boolean;
}

/**
 * The launch catalogue of D-100 (confirmed 2026-09-22): 7 instant types (legacy calculators) and the
 * RFQ categories. Every type starts with `quote_mode = rfq`; each B2.3 session switches its type to
 * `instant` when the calculator ships with golden tests ("a type moves from RFQ to Instant when its
 * calculator ships", schema-design §7 A-16). One reporting category per type (D-030 replaces PH1–PH6);
 * admins may regroup them. These are definitions, not catalogue data (D-005): products, materials and
 * prices are created by admins and factories.
 */
export const PRODUCT_TYPES: readonly ProductTypeSeed[] = [
  { code: 'folding_carton', nameTh: 'กล่องกระดาษแข็ง', nameEn: 'Folding carton', calculatorKey: 'folding' },
  { code: 'corrugated', nameTh: 'กล่องกระดาษลูกฟูก', nameEn: 'Corrugated box', calculatorKey: 'corrugate' },
  { code: 'label_sticker', nameTh: 'สติ๊กเกอร์และฉลาก', nameEn: 'Labels & stickers', calculatorKey: 'label' },
  { code: 'tag_sleeve', nameTh: 'ป้ายแท็กและปลอก', nameEn: 'Tags & sleeves', calculatorKey: 'tag_sleeve' },
  { code: 'flexible_pouch', nameTh: 'ซองบรรจุภัณฑ์', nameEn: 'Flexible pouch', calculatorKey: 'pouch' },
  {
    code: 'standard_product',
    nameTh: 'สินค้ามาตรฐาน',
    nameEn: 'Standard products',
    calculatorKey: 'standard_product',
  },
  { code: 'service', nameTh: 'บริการ', nameEn: 'Services', calculatorKey: 'service' },
  {
    code: 'rigid_box',
    nameTh: 'กล่องแข็งและกล่องของขวัญ',
    nameEn: 'Rigid & gift boxes',
    calculatorKey: null,
  },
  { code: 'paper_bag', nameTh: 'ถุงกระดาษ', nameEn: 'Paper bags', calculatorKey: null },
  {
    code: 'food_packaging',
    nameTh: 'บรรจุภัณฑ์อาหาร',
    nameEn: 'Food packaging',
    calculatorKey: null,
    // D-076: food-contact packaging raises the inspection rate.
    isFoodContactDefault: true,
  },
  { code: 'tube', nameTh: 'บรรจุภัณฑ์ทรงกระบอก', nameEn: 'Tubes', calculatorKey: null },
  { code: 'custom_tape', nameTh: 'เทปพิมพ์ลาย', nameEn: 'Custom tape', calculatorKey: null },
  { code: 'pop_display', nameTh: 'ชั้นวางสินค้า POP', nameEn: 'POP displays', calculatorKey: null },
  { code: 'other', nameTh: 'บรรจุภัณฑ์อื่น ๆ', nameEn: 'Other packaging', calculatorKey: null },
];
