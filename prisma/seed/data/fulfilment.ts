/**
 * Fulfilment reference data (B4): feature flags of the fulfilment integrations. Milestone routes, the
 * notification matrix and templates are added by their deliverables.
 */
export const FULFILMENT_FEATURE_FLAGS = [
  {
    key: 'drawing.engine',
    description:
      'Dieline drawing engine @packio/dieline (B4.1) — off until the package is published; drawings answer 501',
  },
  {
    key: 'assistant.enabled',
    description:
      'Customer assistant (U5.B5, D-218 / D-306) — off at launch; outside local it switches on only after ADR-0012 and a passing evaluation',
  },
] as const;

export interface RouteStepSeed {
  key: string;
  nameTh: string;
  nameEn: string;
  customerLabelTh?: string;
  customerLabelEn?: string;
  evidence?: 'none' | 'photo' | 'qc_form' | 'photo_and_qc_form';
  tracksQuantity?: boolean;
}

const step = (
  key: string,
  nameTh: string,
  nameEn: string,
  opts: Omit<RouteStepSeed, 'key' | 'nameTh' | 'nameEn'> = {},
): RouteStepSeed => ({ key, nameTh, nameEn, ...opts });

const RECEIVED = step('job_received', 'รับงาน', 'Job received', {
  customerLabelTh: 'โรงงานรับงานแล้ว',
  customerLabelEn: 'Production scheduled',
});
const PREPRESS = step('prepress_ready', 'เตรียมพิมพ์พร้อม', 'Prepress ready');
const MATERIALS = step('materials_ready', 'วัตถุดิบพร้อม', 'Materials ready');
const PRINTING = step('printing', 'พิมพ์', 'Printing', {
  customerLabelTh: 'กำลังพิมพ์',
  customerLabelEn: 'Printing',
  evidence: 'photo',
  tracksQuantity: true,
});
const FINISHING = step('finishing', 'เคลือบ / ตกแต่ง', 'Finishing', { tracksQuantity: true });
const DIE_CUT = step('die_cut', 'ไดคัท', 'Die-cutting', { tracksQuantity: true });
const GLUING = step('gluing', 'ปะกาว / ขึ้นรูป', 'Gluing / assembly', {
  customerLabelTh: 'กำลังขึ้นรูป',
  customerLabelEn: 'Assembling',
  tracksQuantity: true,
});
const QC = step('qc', 'ตรวจคุณภาพ', 'Quality check', {
  customerLabelTh: 'ตรวจคุณภาพ',
  customerLabelEn: 'Quality check',
  evidence: 'photo_and_qc_form',
  tracksQuantity: true,
});
const PACKING = step('packing', 'แพ็กสินค้า', 'Packing', { evidence: 'photo', tracksQuantity: true });
const READY = step('ready_to_ship', 'พร้อมส่ง', 'Ready to ship', {
  customerLabelTh: 'พร้อมจัดส่ง',
  customerLabelEn: 'Ready to ship',
});

/**
 * Default milestone routes (D-075 "stage lists per product type remain editable data"), from the example in
 * the B4.2 prompt; one approved v1 each, edited later as new versions (`admin.milestoneRoutes`). Every
 * product type that is produced gets a `standard` route and a `mockup` route (D-072); services have none.
 */
export const MILESTONE_ROUTE_FAMILIES: Record<string, RouteStepSeed[]> = {
  carton: [RECEIVED, PREPRESS, MATERIALS, PRINTING, FINISHING, DIE_CUT, GLUING, QC, PACKING, READY],
  label: [RECEIVED, PREPRESS, MATERIALS, PRINTING, FINISHING, DIE_CUT, QC, PACKING, READY],
  pouch: [
    RECEIVED,
    PREPRESS,
    MATERIALS,
    PRINTING,
    step('lamination', 'ลามิเนต', 'Lamination', { tracksQuantity: true }),
    step('pouch_making', 'ขึ้นรูปซอง', 'Pouch making', { tracksQuantity: true }),
    QC,
    PACKING,
    READY,
  ],
  stock: [RECEIVED, step('picking', 'หยิบสินค้า', 'Picking', { tracksQuantity: true }), QC, PACKING, READY],
  mockup: [
    RECEIVED,
    step('mockup_making', 'ทำม็อกอัพ', 'Making the mockup', {
      customerLabelTh: 'กำลังทำม็อกอัพ',
      customerLabelEn: 'Making your mockup',
      evidence: 'photo',
    }),
    QC,
    READY,
  ],
};

export const MILESTONE_ROUTE_FAMILY_BY_TYPE: Record<string, keyof typeof MILESTONE_ROUTE_FAMILIES> = {
  folding_carton: 'carton',
  corrugated: 'carton',
  rigid_box: 'carton',
  paper_bag: 'carton',
  food_packaging: 'carton',
  pop_display: 'carton',
  tube: 'carton',
  other: 'carton',
  label_sticker: 'label',
  tag_sleeve: 'label',
  custom_tape: 'label',
  flexible_pouch: 'pouch',
  standard_product: 'stock',
};
