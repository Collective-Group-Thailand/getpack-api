/**
 * Style library reference data (U3.B3, D-244). The process taxonomy is structural (codes the recipes and rules use);
 * the process rules are a **proposal Prepress confirms** (D-244) — editable in the admin zone, never business prices.
 */
export const PROCESS_TYPES = [
  { code: 'die_cut_flatbed', nameTh: 'ไดคัทแท่นเรียบ', nameEn: 'Die-cut (flatbed)' },
  { code: 'die_cut_rotary', nameTh: 'ไดคัทโรตารี่', nameEn: 'Die-cut (rotary)' },
  { code: 'slotter', nameTh: 'เครื่องเซาะร่อง (สล็อตเตอร์)', nameEn: 'Slotter' },
  {
    code: 'folder_gluer_straight_line',
    nameTh: 'เครื่องพับทากาว (แนวตรง)',
    nameEn: 'Folder-gluer (straight line)',
  },
  {
    code: 'folder_gluer_crash_lock',
    nameTh: 'เครื่องพับทากาว (ก้นล็อก)',
    nameEn: 'Folder-gluer (crash-lock)',
  },
  {
    code: 'folder_gluer_4_6_corner',
    nameTh: 'เครื่องพับทากาว (4/6 มุม)',
    nameEn: 'Folder-gluer (4 / 6 corner)',
  },
  { code: 'window_patching', nameTh: 'ติดหน้าต่างฟิล์ม', nameEn: 'Window patching' },
  { code: 'rigid_box_line', nameTh: 'สายการผลิตกล่องแข็ง', nameEn: 'Rigid box line' },
  { code: 'pouch_making', nameTh: 'ขึ้นรูปซอง', nameEn: 'Pouch making' },
  { code: 'label_press', nameTh: 'เครื่องพิมพ์ฉลาก', nameEn: 'Label press' },
  { code: 'shrink_sleeve', nameTh: 'ผลิตปลอกฟิล์มหด', nameEn: 'Shrink sleeve' },
  // D-315 (proposed, Prepress confirms): processes the drawing engine's library recipes name (U3.4 waves).
  { code: 'hand_assembly', nameTh: 'ประกอบด้วยมือ', nameEn: 'Hand assembly' },
  { code: 'adhesive_strip_applicator', nameTh: 'เครื่องติดแถบกาว', nameEn: 'Adhesive strip applicator' },
  { code: 'tear_strip_applicator', nameTh: 'เครื่องติดแถบฉีก', nameEn: 'Tear strip applicator' },
] as const;

type Scope = 'source_product_type' | 'category' | 'family' | 'option';

/** Proposed process rules (D-244, Prepress confirms): a base needs every process its rules match. */
export const STYLE_PROCESS_RULES: readonly { scope: Scope; value: string; process: string }[] = [
  // Folding cartons and paperboard inserts: die-cut, then folded and glued on a straight-line folder-gluer.
  { scope: 'category', value: 'folding_carton', process: 'die_cut_flatbed' },
  { scope: 'category', value: 'folding_carton', process: 'folder_gluer_straight_line' },
  { scope: 'option', value: 'tuck_bottom:crash_lock', process: 'folder_gluer_crash_lock' },
  { scope: 'option', value: 'window:front_window', process: 'window_patching' },
  { scope: 'option', value: 'window:top_window', process: 'window_patching' },
  { scope: 'category', value: 'insert', process: 'die_cut_flatbed' },
  // Corrugated: slotted and telescope styles on a slotter; die-cut styles on a die-cutter.
  { scope: 'family', value: 'slotted', process: 'slotter' },
  { scope: 'family', value: 'telescope', process: 'slotter' },
  { scope: 'family', value: 'bulk', process: 'slotter' },
  { scope: 'family', value: 'folder', process: 'die_cut_flatbed' },
  { scope: 'family', value: 'slide', process: 'die_cut_flatbed' },
  { scope: 'family', value: 'ready_glued', process: 'die_cut_flatbed' },
  { scope: 'family', value: 'ready_glued', process: 'folder_gluer_straight_line' },
  // Other product types.
  { scope: 'source_product_type', value: 'rigid', process: 'rigid_box_line' },
  { scope: 'source_product_type', value: 'pouch', process: 'pouch_making' },
  { scope: 'source_product_type', value: 'label', process: 'label_press' },
  { scope: 'source_product_type', value: 'shrink_sleeve', process: 'shrink_sleeve' },
  { scope: 'source_product_type', value: 'tag_sleeve', process: 'die_cut_flatbed' },
];
