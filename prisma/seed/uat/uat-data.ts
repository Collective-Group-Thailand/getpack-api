/**
 * Data of the UAT rehearsal seed (`pnpm db:seed:uat`, docs/launch/UAT-DATA.md).
 *
 * Products, materials and sizes are modelled on packaging commonly sold in the Thai market (cosmetic and supplement
 * cartons, postal boxes in the usual Thai sizes, doypacks, labels, stock bottles and cups) so the UAT team walks
 * realistic journeys. They are **rehearsal data, not Packio's catalogue** (D-005: admins create the real one):
 * every code starts with `uat`, and the launch factory's own price lists replace the rehearsal prices in UAT-01.
 * Nothing here is a price — prices are cloned from the dev seed's fake price lines (`uat-prices.ts`).
 * Geography uses real province / district / postcode names so addresses look right; production geography is
 * keyed in by admins (D-161, D-170).
 */

export interface GeoSeed {
  province: { code: string; nameTh: string; nameEn: string; region: string };
  district: { code: string; nameTh: string; nameEn: string };
  subdistrict: { code: string; nameTh: string; nameEn: string; postcode: string };
  zone: UatZoneCode;
}

export type UatZoneCode = 'uat_bkk_metro' | 'uat_central_east' | 'uat_north_northeast' | 'uat_south';

export const UAT_ZONES: readonly {
  code: UatZoneCode;
  nameTh: string;
  nameEn: string;
  extraLeadDays: number;
}[] = [
  { code: 'uat_bkk_metro', nameTh: 'กรุงเทพฯ และปริมณฑล', nameEn: 'Bangkok metropolitan', extraLeadDays: 0 },
  { code: 'uat_central_east', nameTh: 'ภาคกลางและภาคตะวันออก', nameEn: 'Central and east', extraLeadDays: 1 },
  {
    code: 'uat_north_northeast',
    nameTh: 'ภาคเหนือและภาคอีสาน',
    nameEn: 'North and northeast',
    extraLeadDays: 2,
  },
  { code: 'uat_south', nameTh: 'ภาคใต้', nameEn: 'South', extraLeadDays: 2 },
];

/**
 * Rehearsal shipping by zone and weight band (THB, fake — Logistics and C-Level approve the real cards, D-013,
 * LAUNCH-CHECKLIST 8.3). Customer price first, factory payout second.
 */
export const UAT_SHIPPING_BANDS: readonly {
  weightMinG: number;
  prices: Record<UatZoneCode, [string, string]>;
}[] = [
  {
    weightMinG: 0,
    prices: {
      uat_bkk_metro: ['80.00', '60.00'],
      uat_central_east: ['120.00', '95.00'],
      uat_north_northeast: ['160.00', '125.00'],
      uat_south: ['180.00', '140.00'],
    },
  },
  {
    weightMinG: 5_000,
    prices: {
      uat_bkk_metro: ['150.00', '115.00'],
      uat_central_east: ['220.00', '170.00'],
      uat_north_northeast: ['290.00', '225.00'],
      uat_south: ['320.00', '250.00'],
    },
  },
  {
    weightMinG: 20_000,
    prices: {
      uat_bkk_metro: ['350.00', '270.00'],
      uat_central_east: ['500.00', '390.00'],
      uat_north_northeast: ['650.00', '500.00'],
      uat_south: ['750.00', '580.00'],
    },
  },
];

const geo = (
  p: [string, string, string, string],
  d: [string, string, string],
  s: [string, string, string, string],
  zone: UatZoneCode,
): GeoSeed => ({
  province: { code: p[0], nameTh: p[1], nameEn: p[2], region: p[3] },
  district: { code: d[0], nameTh: d[1], nameEn: d[2] },
  subdistrict: { code: s[0], nameTh: s[1], nameEn: s[2], postcode: s[3] },
  zone,
});

const BKK: [string, string, string, string] = ['UAT-10', 'กรุงเทพมหานคร', 'Bangkok', 'central'];

/** One subdistrict per delivery area the UAT customers use (several provinces have more than one). */
export const UAT_GEOGRAPHY: readonly GeoSeed[] = [
  geo(BKK, ['UAT-1004', 'เขตบางรัก', 'Bang Rak'], ['UAT-100401', 'สีลม', 'Si Lom', '10500'], 'uat_bkk_metro'),
  geo(
    BKK,
    ['UAT-1030', 'เขตจตุจักร', 'Chatuchak'],
    ['UAT-103001', 'จตุจักร', 'Chatuchak', '10900'],
    'uat_bkk_metro',
  ),
  geo(
    BKK,
    ['UAT-1007', 'เขตปทุมวัน', 'Pathum Wan'],
    ['UAT-100701', 'ลุมพินี', 'Lumphini', '10330'],
    'uat_bkk_metro',
  ),
  geo(
    BKK,
    ['UAT-1047', 'เขตบางนา', 'Bang Na'],
    ['UAT-104701', 'บางนาเหนือ', 'Bang Na Nuea', '10260'],
    'uat_bkk_metro',
  ),
  geo(
    BKK,
    ['UAT-1011', 'เขตลาดกระบัง', 'Lat Krabang'],
    ['UAT-101101', 'ลาดกระบัง', 'Lat Krabang', '10520'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-12', 'นนทบุรี', 'Nonthaburi', 'central'],
    ['UAT-1201', 'เมืองนนทบุรี', 'Mueang Nonthaburi'],
    ['UAT-120101', 'บางกระสอ', 'Bang Kraso', '11000'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-12', 'นนทบุรี', 'Nonthaburi', 'central'],
    ['UAT-1206', 'ปากเกร็ด', 'Pak Kret'],
    ['UAT-120601', 'ปากเกร็ด', 'Pak Kret', '11120'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-13', 'ปทุมธานี', 'Pathum Thani', 'central'],
    ['UAT-1302', 'คลองหลวง', 'Khlong Luang'],
    ['UAT-130201', 'คลองหนึ่ง', 'Khlong Nueng', '12120'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-11', 'สมุทรปราการ', 'Samut Prakan', 'central'],
    ['UAT-1101', 'เมืองสมุทรปราการ', 'Mueang Samut Prakan'],
    ['UAT-110101', 'ปากน้ำ', 'Pak Nam', '10270'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-11', 'สมุทรปราการ', 'Samut Prakan', 'central'],
    ['UAT-1103', 'บางพลี', 'Bang Phli'],
    ['UAT-110301', 'บางพลีใหญ่', 'Bang Phli Yai', '10540'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-74', 'สมุทรสาคร', 'Samut Sakhon', 'central'],
    ['UAT-7401', 'เมืองสมุทรสาคร', 'Mueang Samut Sakhon'],
    ['UAT-740101', 'มหาชัย', 'Mahachai', '74000'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-73', 'นครปฐม', 'Nakhon Pathom', 'central'],
    ['UAT-7301', 'เมืองนครปฐม', 'Mueang Nakhon Pathom'],
    ['UAT-730101', 'พระปฐมเจดีย์', 'Phra Pathom Chedi', '73000'],
    'uat_bkk_metro',
  ),
  geo(
    ['UAT-20', 'ชลบุรี', 'Chon Buri', 'east'],
    ['UAT-2004', 'บางละมุง', 'Bang Lamung'],
    ['UAT-200401', 'หนองปรือ', 'Nong Prue', '20150'],
    'uat_central_east',
  ),
  geo(
    ['UAT-20', 'ชลบุรี', 'Chon Buri', 'east'],
    ['UAT-2007', 'ศรีราชา', 'Si Racha'],
    ['UAT-200701', 'ศรีราชา', 'Si Racha', '20110'],
    'uat_central_east',
  ),
  geo(
    ['UAT-50', 'เชียงใหม่', 'Chiang Mai', 'north'],
    ['UAT-5001', 'เมืองเชียงใหม่', 'Mueang Chiang Mai'],
    ['UAT-500101', 'ศรีภูมิ', 'Si Phum', '50200'],
    'uat_north_northeast',
  ),
  geo(
    ['UAT-65', 'พิษณุโลก', 'Phitsanulok', 'north'],
    ['UAT-6501', 'เมืองพิษณุโลก', 'Mueang Phitsanulok'],
    ['UAT-650101', 'ในเมือง', 'Nai Mueang', '65000'],
    'uat_north_northeast',
  ),
  geo(
    ['UAT-40', 'ขอนแก่น', 'Khon Kaen', 'northeast'],
    ['UAT-4001', 'เมืองขอนแก่น', 'Mueang Khon Kaen'],
    ['UAT-400101', 'ในเมือง', 'Nai Mueang', '40000'],
    'uat_north_northeast',
  ),
  geo(
    ['UAT-30', 'นครราชสีมา', 'Nakhon Ratchasima', 'northeast'],
    ['UAT-3001', 'เมืองนครราชสีมา', 'Mueang Nakhon Ratchasima'],
    ['UAT-300101', 'ในเมือง', 'Nai Mueang', '30000'],
    'uat_north_northeast',
  ),
  geo(
    ['UAT-41', 'อุดรธานี', 'Udon Thani', 'northeast'],
    ['UAT-4101', 'เมืองอุดรธานี', 'Mueang Udon Thani'],
    ['UAT-410101', 'หมากแข้ง', 'Mak Khaeng', '41000'],
    'uat_north_northeast',
  ),
  geo(
    ['UAT-83', 'ภูเก็ต', 'Phuket', 'south'],
    ['UAT-8301', 'เมืองภูเก็ต', 'Mueang Phuket'],
    ['UAT-830101', 'ตลาดใหญ่', 'Talat Yai', '83000'],
    'uat_south',
  ),
  geo(
    ['UAT-90', 'สงขลา', 'Songkhla', 'south'],
    ['UAT-9011', 'หาดใหญ่', 'Hat Yai'],
    ['UAT-901101', 'หาดใหญ่', 'Hat Yai', '90110'],
    'uat_south',
  ),
];

// --- Renamed dev master data ---------------------------------------------------------------------------------

/**
 * The dev seed's master data that the rehearsal catalogue reuses as-is (its fake price lines stay valid), renamed
 * so the store and the partner zone do not show `[DEV]` labels in UAT.
 */
export const UAT_RENAMES: Record<
  string,
  Record<string, { nameTh: string; nameEn: string } | { name: string }>
> = {
  material: {
    'dev-art-350': { nameTh: 'อาร์ตการ์ด 2 หน้า 350 แกรม', nameEn: 'Art card C2S 350 gsm' },
    'dev-kraft-300': { nameTh: 'กระดาษคราฟท์ 300 แกรม', nameEn: 'Kraft board 300 gsm' },
    'dev-ka125-b': { nameTh: 'ลูกฟูก KA125 ลอน B (3 ชั้น)', nameEn: 'Corrugated KA125 B-flute (3-ply)' },
    'dev-ka185-b': { nameTh: 'ลูกฟูก KA185 ลอน B (3 ชั้น)', nameEn: 'Corrugated KA185 B-flute (3-ply)' },
    'dev-ki230-b': {
      nameTh: 'ลูกฟูก KI230 ลอน B ผิวขาว (3 ชั้น)',
      nameEn: 'Corrugated KI230 B-flute white (3-ply)',
    },
    'dev-pp-white-80': { nameTh: 'สติ๊กเกอร์ PP ขาว (กันน้ำ)', nameEn: 'White PP label (waterproof)' },
    'dev-pet-lldpe-80': { nameTh: 'ฟิล์ม PET/LLDPE ใส 80 ไมครอน', nameEn: 'Clear PET/LLDPE film 80 micron' },
  },
  finish: {
    'dev-matt': { nameTh: 'เคลือบด้าน (OPP)', nameEn: 'Matt OPP lamination' },
    'dev-foil': { nameTh: 'ปั๊มฟอยล์ทอง', nameEn: 'Gold hot-foil stamping' },
  },
  inkColour: {
    'dev-cmyk': { name: 'พิมพ์ 4 สี (CMYK)' },
    'dev-pouch-cmyk': { name: 'พิมพ์ดิจิทัล 4 สี (เงา)' },
  },
  diecutType: { 'dev-diecut': { nameTh: 'ไดคัทตามรูปทรง', nameEn: 'Custom-shape die-cut' } },
  difficultyLevel: { 'dev-normal': { nameTh: 'ปกติ', nameEn: 'Standard' } },
  assembly: {
    'dev-packing': { nameTh: 'แพ็กมัดรวมพร้อมส่ง', nameEn: 'Bundling for delivery' },
    'dev-zipper': { nameTh: 'ซิปล็อก', nameEn: 'Press-to-close zipper' },
    'dev-tear-notch': { nameTh: 'รอยฉีก', nameEn: 'Tear notch' },
    'dev-hole-3mm': { nameTh: 'เจาะรู 3 มม.', nameEn: 'Punched hole 3 mm' },
  },
  pattern: {
    'DEV-FLAT': { name: 'แผ่นเรียบ (การ์ด / แผ่นรอง)' },
    'DEV-RTE': { name: 'กล่องฝาเสียบสลับ (Reverse tuck end)' },
    'DEV-RSC': { name: 'กล่องฝาชน (RSC)' },
    'DEV-TELE': { name: 'กล่องฝาครอบ (ตัวกล่อง + ฝา)' },
    'DEV-OPEN-TOP': { name: 'ถาดลูกฟูกเปิดฝาบน' },
    'DEV-POUCH-STAND': { name: 'ซองตั้งได้ (Doypack)' },
    'DEV-POUCH-3SS': { name: 'ซองซีล 3 ด้าน' },
    'DEV-TAG': { name: 'ป้ายแท็กตัดมุม' },
  },
  catalogProduct: {
    'dev-mockup': { nameTh: 'ตัวอย่างจริง (ม็อกอัพ)', nameEn: 'Physical sample (mockup)' },
    'dev-print-plate': { nameTh: 'ค่าเพลทพิมพ์ออฟเซ็ท (ต่อชุด)', nameEn: 'Offset print plates (per set)' },
    'dev-graphic-design': { nameTh: 'ออกแบบกราฟิกบรรจุภัณฑ์', nameEn: 'Packaging graphic design' },
  },
  printType: {
    dev_folding_offset: { nameTh: 'ออฟเซ็ท', nameEn: 'Offset' },
    dev_corrugate_flexo: { nameTh: 'เฟล็กโซ', nameEn: 'Flexo' },
    dev_corrugate_digital: { nameTh: 'ดิจิทัล', nameEn: 'Digital' },
    dev_label_digital: { nameTh: 'ดิจิทัล (สติ๊กเกอร์)', nameEn: 'Digital label' },
    dev_label_offset: { nameTh: 'ออฟเซ็ท (สติ๊กเกอร์)', nameEn: 'Offset label' },
    dev_pouch_digital: { nameTh: 'ดิจิทัล (ซอง)', nameEn: 'Digital pouch' },
    dev_std_product: { nameTh: 'สินค้ามาตรฐาน', nameEn: 'Standard product' },
    dev_service: { nameTh: 'บริการ', nameEn: 'Service' },
  },
};

// --- New rehearsal master data, each priced like a dev source -------------------------------------------------

export interface MaterialSeed {
  code: string;
  /** The dev material whose fake price lines it copies (price then differs by gsm where the engine prices by kg). */
  likeCode: string;
  kind: 'paper' | 'board' | 'corrugated_board' | 'film' | 'label_stock';
  nameTh: string;
  nameEn: string;
  gsm?: number;
  micron?: number;
  caliperMm: string;
  /** Corrugated boards on the BC flute use the UAT BC flute instead of the dev B flute. */
  flute?: 'B' | 'BC';
  insideColour?: string;
  outsideColour?: string;
  isFoodGrade?: boolean;
  coatable?: boolean;
  descriptionTh: string;
}

export const UAT_MATERIALS: readonly MaterialSeed[] = [
  // Folding cartons and tags (priced per kg like dev-art-350).
  {
    code: 'uat-art-300',
    likeCode: 'dev-art-350',
    kind: 'paper',
    nameTh: 'อาร์ตการ์ด 2 หน้า 300 แกรม',
    nameEn: 'Art card C2S 300 gsm',
    gsm: 300,
    caliperMm: '0.330',
    descriptionTh: 'ผิวเรียบขาว พิมพ์สีสด เหมาะกับกล่องเครื่องสำอางและอาหารเสริมขนาดเล็ก',
  },
  {
    code: 'uat-art-400',
    likeCode: 'dev-art-350',
    kind: 'paper',
    nameTh: 'อาร์ตการ์ด 2 หน้า 400 แกรม',
    nameEn: 'Art card C2S 400 gsm',
    gsm: 400,
    caliperMm: '0.450',
    descriptionTh: 'หนาและแข็งแรง สำหรับกล่องพรีเมียมและป้ายแท็ก',
  },
  {
    code: 'uat-ivory-350',
    likeCode: 'dev-art-350',
    kind: 'board',
    nameTh: 'กระดาษไอวอรี่ (Food grade) 350 แกรม',
    nameEn: 'Ivory board FBB (food grade) 350 gsm',
    gsm: 350,
    caliperMm: '0.480',
    isFoodGrade: true,
    descriptionTh: 'ด้านในขาว สัมผัสอาหารได้ เหมาะกับกล่องเบเกอรี่และขนม',
  },
  {
    code: 'uat-duplex-350',
    likeCode: 'dev-art-350',
    kind: 'board',
    nameTh: 'กระดาษกล่องแป้งหลังเทา (Duplex) 350 แกรม',
    nameEn: 'Duplex grey-back board 350 gsm',
    gsm: 350,
    caliperMm: '0.450',
    descriptionTh: 'ประหยัด ด้านในสีเทา เหมาะกับกล่องสินค้าทั่วไป',
  },
  {
    code: 'uat-kraft-350',
    likeCode: 'dev-art-350',
    kind: 'paper',
    nameTh: 'กระดาษคราฟท์น้ำตาล 350 แกรม',
    nameEn: 'Brown kraft board 350 gsm',
    gsm: 350,
    caliperMm: '0.500',
    descriptionTh: 'โทนธรรมชาติ ดูเป็นมิตรกับสิ่งแวดล้อม',
  },
  // Corrugated boards (B flute like dev-ka125-b; BC on the UAT BC flute).
  {
    code: 'uat-kt125-b',
    likeCode: 'dev-ka125-b',
    kind: 'corrugated_board',
    nameTh: 'ลูกฟูก KT125 ลอน B (3 ชั้น)',
    nameEn: 'Corrugated KT125 B-flute (3-ply)',
    gsm: 430,
    caliperMm: '3.000',
    flute: 'B',
    insideColour: 'น้ำตาล',
    outsideColour: 'น้ำตาล',
    coatable: false,
    descriptionTh: 'กล่องพัสดุทั่วไป น้ำหนักเบา',
  },
  {
    code: 'uat-ka125-bc',
    likeCode: 'dev-ka125-b',
    kind: 'corrugated_board',
    nameTh: 'ลูกฟูก KA125 ลอน BC (5 ชั้น)',
    nameEn: 'Corrugated KA125 BC-flute (5-ply)',
    gsm: 760,
    caliperMm: '6.500',
    flute: 'BC',
    insideColour: 'น้ำตาล',
    outsideColour: 'น้ำตาล',
    coatable: false,
    descriptionTh: 'แข็งแรง รับน้ำหนักซ้อนได้มาก สำหรับลังขนย้ายและสินค้าหนัก',
  },
  {
    code: 'uat-ka185-bc',
    likeCode: 'dev-ka185-b',
    kind: 'corrugated_board',
    nameTh: 'ลูกฟูก KA185 ลอน BC (5 ชั้น)',
    nameEn: 'Corrugated KA185 BC-flute (5-ply)',
    gsm: 900,
    caliperMm: '6.800',
    flute: 'BC',
    insideColour: 'น้ำตาล',
    outsideColour: 'น้ำตาล',
    coatable: false,
    descriptionTh: 'สำหรับสินค้าหนักและการส่งออก',
  },
  // Labels (like dev-pp-white-80).
  {
    code: 'uat-pp-clear',
    likeCode: 'dev-pp-white-80',
    kind: 'label_stock',
    nameTh: 'สติ๊กเกอร์ PP ใส',
    nameEn: 'Clear PP label',
    gsm: 80,
    caliperMm: '0.080',
    descriptionTh: 'โปร่งใส กันน้ำ เห็นสินค้าด้านใน เหมาะกับขวดเครื่องสำอาง',
  },
  {
    code: 'uat-art-paper-label',
    likeCode: 'dev-pp-white-80',
    kind: 'label_stock',
    nameTh: 'สติ๊กเกอร์กระดาษอาร์ตมัน',
    nameEn: 'Semi-gloss art paper label',
    gsm: 80,
    caliperMm: '0.080',
    descriptionTh: 'ราคาประหยัด พิมพ์สวย ไม่กันน้ำ',
  },
  {
    code: 'uat-kraft-label',
    likeCode: 'dev-pp-white-80',
    kind: 'label_stock',
    nameTh: 'สติ๊กเกอร์กระดาษคราฟท์',
    nameEn: 'Kraft paper label',
    gsm: 80,
    caliperMm: '0.090',
    descriptionTh: 'โทนธรรมชาติ สำหรับสินค้าออร์แกนิกและขนมโฮมเมด',
  },
  {
    code: 'uat-pp-silver',
    likeCode: 'dev-pp-white-80',
    kind: 'label_stock',
    nameTh: 'สติ๊กเกอร์ PP เงินเมทัลลิก',
    nameEn: 'Silver metallic PP label',
    gsm: 80,
    caliperMm: '0.080',
    descriptionTh: 'ผิวเงินวาว ดูพรีเมียม กันน้ำ',
  },
  // Pouch films (like dev-pet-lldpe-80).
  {
    code: 'uat-pet-al-lldpe-100',
    likeCode: 'dev-pet-lldpe-80',
    kind: 'film',
    nameTh: 'ฟิล์ม PET/AL/LLDPE ฟอยล์ทึบแสง 100 ไมครอน',
    nameEn: 'PET/AL/LLDPE foil laminate 100 micron',
    micron: 100,
    caliperMm: '0.100',
    isFoodGrade: true,
    descriptionTh: 'กันแสง กันความชื้นและออกซิเจนสูง เหมาะกับกาแฟและขนมอบกรอบ',
  },
  {
    code: 'uat-mopp-vmpet-lldpe-90',
    likeCode: 'dev-pet-lldpe-80',
    kind: 'film',
    nameTh: 'ฟิล์ม MOPP/VMPET/LLDPE ด้านเมทัลไลซ์ 90 ไมครอน',
    nameEn: 'Matt OPP/VMPET/LLDPE 90 micron',
    micron: 90,
    caliperMm: '0.090',
    isFoodGrade: true,
    descriptionTh: 'ผิวด้าน ด้านในเงิน ดูพรีเมียม สำหรับขนมและผงเครื่องดื่ม',
  },
  {
    code: 'uat-kraft-pet-lldpe-110',
    likeCode: 'dev-pet-lldpe-80',
    kind: 'film',
    nameTh: 'กระดาษคราฟท์/PET/LLDPE 110 ไมครอน',
    nameEn: 'Kraft paper/PET/LLDPE 110 micron',
    micron: 110,
    caliperMm: '0.110',
    isFoodGrade: true,
    descriptionTh: 'ผิวกระดาษคราฟท์ ด้านในกันความชื้น สำหรับชา ธัญพืช และกาแฟ',
  },
];

export interface FinishSeed {
  code: string;
  likeCode: string;
  nameTh: string;
  nameEn: string;
  finishKind: 'coating' | 'lamination' | 'foil';
  isSpecial?: boolean;
}

export const UAT_FINISHES: readonly FinishSeed[] = [
  {
    code: 'uat-gloss-opp',
    likeCode: 'dev-matt',
    nameTh: 'เคลือบเงา (OPP)',
    nameEn: 'Gloss OPP lamination',
    finishKind: 'lamination',
  },
  {
    code: 'uat-aqueous-varnish',
    likeCode: 'dev-matt',
    nameTh: 'เคลือบวานิชสูตรน้ำ',
    nameEn: 'Aqueous varnish',
    finishKind: 'coating',
  },
  {
    code: 'uat-soft-touch',
    likeCode: 'dev-matt',
    nameTh: 'เคลือบด้านกำมะหยี่ (Soft touch)',
    nameEn: 'Soft-touch lamination',
    finishKind: 'lamination',
  },
];

export const UAT_DIECUTS: readonly { code: string; nameTh: string; nameEn: string }[] = [
  { code: 'uat-diecut-circle', nameTh: 'ไดคัทวงกลม', nameEn: 'Circle die-cut' },
  { code: 'uat-diecut-rounded-rect', nameTh: 'ไดคัทสี่เหลี่ยมมุมมน', nameEn: 'Rounded-rectangle die-cut' },
  { code: 'uat-diecut-oval', nameTh: 'ไดคัทวงรี', nameEn: 'Oval die-cut' },
];

// --- Catalogue products ---------------------------------------------------------------------------------------

/** A size row: length × width × height in mm (labels, tags and sheets leave height 0). */
export type SizeSeed = [code: string, name: string, l: number, w: number, h: number];

export interface ProductSeed {
  slug: string;
  type: string;
  nameTh: string;
  nameEn: string;
  descriptionTh: string;
  /** Pattern codes (dev patterns renamed, or the UAT folding patterns). */
  patterns?: string[];
  materials?: string[];
  finishes?: string[];
  diecuts?: string[];
  assemblies?: string[];
  sizes?: SizeSeed[];
  quantities?: { min: number; presets: number[] };
  template?: 'none' | 'online_template' | 'drawing';
}

const COSMETIC_FINISHES = ['dev-matt', 'uat-gloss-opp', 'uat-aqueous-varnish', 'uat-soft-touch'];
const FOLDING_QTY = { min: 500, presets: [500, 1000, 2000, 3000, 5000, 10000] };
const CORRUGATE_QTY = { min: 100, presets: [100, 300, 500, 1000, 2000, 5000] };
const LABEL_QTY = { min: 500, presets: [500, 1000, 3000, 5000, 10000] };
const POUCH_QTY = { min: 3000, presets: [3000, 5000, 10000, 20000] };

export const UAT_PRODUCTS: readonly ProductSeed[] = [
  // Folding cartons
  {
    slug: 'uat-serum-box',
    type: 'folding_carton',
    nameTh: 'กล่องเซรั่ม / ครีมบำรุงผิว ฝาเสียบ',
    nameEn: 'Serum & skincare tuck-end box',
    descriptionTh:
      'กล่องฝาเสียบสลับสำหรับขวดดรอปเปอร์และกระปุกครีม พิมพ์ 4 สี เลือกเคลือบด้าน เงา หรือกำมะหยี่ได้',
    patterns: ['UAT-RTE', 'UAT-STE'],
    materials: ['dev-art-350', 'uat-art-300', 'uat-art-400', 'uat-ivory-350'],
    finishes: COSMETIC_FINISHES,
    sizes: [
      ['30ML', 'ขวดดรอปเปอร์ 30 มล. (4×4×11 ซม.)', 40, 40, 110],
      ['50ML', 'ขวดปั๊ม 50 มล. (4.5×4.5×12.5 ซม.)', 45, 45, 125],
      ['JAR50', 'กระปุกครีม 50 กรัม (6×6×6 ซม.)', 60, 60, 60],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-soap-box',
    type: 'folding_carton',
    nameTh: 'กล่องสบู่ก้อน',
    nameEn: 'Bar soap box',
    descriptionTh: 'กล่องฝาเสียบสำหรับสบู่ก้อน 80–120 กรัม เหมาะกับแบรนด์สบู่สมุนไพรและสบู่ทำมือ',
    patterns: ['UAT-RTE'],
    materials: ['dev-art-350', 'uat-kraft-350', 'uat-duplex-350'],
    finishes: ['dev-matt', 'uat-aqueous-varnish'],
    sizes: [
      ['S', 'สบู่ 80 กรัม (9×6×3 ซม.)', 90, 60, 30],
      ['M', 'สบู่ 120 กรัม (10×7×3.5 ซม.)', 100, 70, 35],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-supplement-box',
    type: 'folding_carton',
    nameTh: 'กล่องอาหารเสริม / แคปซูล',
    nameEn: 'Dietary supplement box',
    descriptionTh: 'กล่องสำหรับขวดแคปซูล 30–60 เม็ด หรือซองผงชงดื่ม พิมพ์ข้อมูลฉลากครบถ้วนบนกล่อง',
    patterns: ['UAT-STE', 'UAT-RTE'],
    materials: ['dev-art-350', 'uat-art-300', 'uat-duplex-350'],
    finishes: ['dev-matt', 'uat-gloss-opp'],
    sizes: [
      ['BTL30', 'ขวด 30 แคปซูล (6×6×11 ซม.)', 60, 60, 110],
      ['BTL60', 'ขวด 60 แคปซูล (7×7×13 ซม.)', 70, 70, 130],
      ['SACHET10', 'ผงชง 10 ซอง (12×6×15 ซม.)', 120, 60, 150],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-lipstick-box',
    type: 'folding_carton',
    nameTh: 'กล่องลิปสติก / ลิปบาล์ม',
    nameEn: 'Lipstick box',
    descriptionTh: 'กล่องทรงสูงขนาดเล็ก เหมาะกับลิปสติก ลิปบาล์ม และมาสคาร่า',
    patterns: ['UAT-RTE'],
    materials: ['uat-art-400', 'dev-art-350'],
    finishes: ['uat-soft-touch', 'dev-matt'],
    sizes: [['STD', 'ลิปสติกมาตรฐาน (2.5×2.5×8.5 ซม.)', 25, 25, 85]],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-drip-coffee-box',
    type: 'folding_carton',
    nameTh: 'กล่องกาแฟดริป 10 ซอง',
    nameEn: 'Drip coffee box (10 bags)',
    descriptionTh: 'กล่องฝาเสียบสำหรับกาแฟดริปแบบแขวน 10 ซอง ร้านกาแฟและโรงคั่วนิยมใช้เป็นของฝาก',
    patterns: ['UAT-STE'],
    materials: ['uat-kraft-350', 'dev-art-350'],
    finishes: ['dev-matt', 'uat-aqueous-varnish'],
    sizes: [['10BAGS', 'กาแฟดริป 10 ซอง (12.5×9.5×8 ซม.)', 125, 95, 80]],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-candle-box',
    type: 'folding_carton',
    nameTh: 'กล่องเทียนหอม ก้นล็อก',
    nameEn: 'Candle box with crash-lock bottom',
    descriptionTh: 'กล่องก้นล็อกพับขึ้นรูปเร็ว รับน้ำหนักแก้วเทียนหอมได้ดี',
    patterns: ['UAT-CLB'],
    materials: ['uat-art-400', 'uat-kraft-350'],
    finishes: ['uat-soft-touch', 'dev-matt'],
    sizes: [
      ['180G', 'แก้วเทียน 180 กรัม (8.5×8.5×9.5 ซม.)', 85, 85, 95],
      ['300G', 'แก้วเทียน 300 กรัม (10×10×11 ซม.)', 100, 100, 110],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-sauce-bottle-box',
    type: 'folding_carton',
    nameTh: 'กล่องขวดซอส / น้ำผึ้ง ก้นล็อก',
    nameEn: 'Sauce & honey bottle box',
    descriptionTh: 'กล่องทรงสูงก้นล็อกสำหรับขวดแก้ว 250–500 มล. เหมาะกับสินค้าโอทอปและของฝาก',
    patterns: ['UAT-CLB'],
    materials: ['uat-art-400', 'uat-duplex-350'],
    finishes: ['dev-matt', 'uat-gloss-opp'],
    sizes: [
      ['250ML', 'ขวด 250 มล. (6.5×6.5×18 ซม.)', 65, 65, 180],
      ['500ML', 'ขวด 500 มล. (7.5×7.5×22 ซม.)', 75, 75, 220],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-bakery-box',
    type: 'folding_carton',
    nameTh: 'กล่องเบเกอรี่ / คุกกี้ (Food grade)',
    nameEn: 'Bakery & cookie box (food grade)',
    descriptionTh: 'กล่องกระดาษไอวอรี่สัมผัสอาหารได้ สำหรับคุกกี้ บราวนี่ และขนมไหว้',
    patterns: ['UAT-RTE'],
    materials: ['uat-ivory-350'],
    finishes: ['uat-aqueous-varnish', 'dev-matt'],
    sizes: [
      ['6PCS', 'คุกกี้ 6 ชิ้น (15×15×6 ซม.)', 150, 150, 60],
      ['BROWNIE', 'บราวนี่ 4 ชิ้น (16×16×5 ซม.)', 160, 160, 50],
    ],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-tea-box',
    type: 'folding_carton',
    nameTh: 'กล่องชาซอง 20 ซอง',
    nameEn: 'Tea bag box (20 bags)',
    descriptionTh: 'กล่องฝาเสียบสำหรับชาซอง 20 ซอง หรือชาใบในถุงด้านใน',
    patterns: ['UAT-STE'],
    materials: ['dev-art-350', 'uat-kraft-350'],
    finishes: ['dev-matt', 'uat-aqueous-varnish'],
    sizes: [['20BAGS', 'ชาซอง 20 ซอง (13×7×7.5 ซม.)', 130, 70, 75]],
    quantities: FOLDING_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-thank-you-card',
    type: 'folding_carton',
    nameTh: 'การ์ดขอบคุณ / การ์ดแทรกในกล่อง',
    nameEn: 'Thank-you & insert card',
    descriptionTh: 'การ์ดแผ่นเรียบพิมพ์ 4 สี สำหรับใส่ในกล่องพัสดุออนไลน์ หรือเป็นบัตรรับประกันสินค้า',
    patterns: ['DEV-FLAT'],
    materials: ['dev-art-350', 'uat-art-300', 'uat-kraft-350'],
    finishes: ['dev-matt', 'uat-gloss-opp'],
    sizes: [
      ['NAMECARD', 'ขนาดนามบัตร (9×5.5 ซม.)', 90, 55, 0],
      ['A6', 'A6 (10.5×14.8 ซม.)', 148, 105, 0],
    ],
    quantities: { min: 500, presets: [500, 1000, 2000, 5000] },
    template: 'online_template',
  },
  // Corrugated
  {
    slug: 'uat-postal-box-b',
    type: 'corrugated',
    nameTh: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)',
    nameEn: 'Postal box RSC 3-ply (B-flute)',
    descriptionTh: 'กล่องพัสดุขนาดมาตรฐานยอดนิยมสำหรับร้านค้าออนไลน์ เลือกพิมพ์โลโก้ 1–2 สีได้',
    patterns: ['DEV-RSC'],
    materials: ['dev-ka125-b', 'uat-kt125-b', 'dev-ka185-b'],
    sizes: [
      ['00', 'เบอร์ 00 (9.75×14×6 ซม.)', 140, 97.5, 60],
      ['0', 'เบอร์ 0 (11×17×6 ซม.)', 170, 110, 60],
      ['0+4', 'เบอร์ 0+4 (11×17×10 ซม.)', 170, 110, 100],
      ['A', 'เบอร์ A (14×20×6 ซม.)', 200, 140, 60],
      ['2A', 'เบอร์ 2A (14×20×12 ซม.)', 200, 140, 120],
      ['B', 'เบอร์ B (17×25×9 ซม.)', 250, 170, 90],
      ['C', 'เบอร์ C (20×30×11 ซม.)', 300, 200, 110],
      ['C+8', 'เบอร์ C+8 (20×30×19 ซม.)', 300, 200, 190],
      ['D', 'เบอร์ D (22×35×14 ซม.)', 350, 220, 140],
      ['E', 'เบอร์ E (24×40×17 ซม.)', 400, 240, 170],
      ['F', 'เบอร์ F (30×45×22 ซม.)', 450, 300, 220],
    ],
    quantities: CORRUGATE_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-white-mailer-box',
    type: 'corrugated',
    nameTh: 'กล่องลูกฟูกผิวขาว ฝาชน พิมพ์โลโก้',
    nameEn: 'White corrugated RSC with logo print',
    descriptionTh: 'ผิวนอกสีขาว พิมพ์โลโก้ได้คมชัด เหมาะกับแบรนด์แฟชั่นและเครื่องสำอางที่ขายออนไลน์',
    patterns: ['DEV-RSC'],
    materials: ['dev-ki230-b'],
    sizes: [
      ['S', 'S (15×20×8 ซม.)', 200, 150, 80],
      ['M', 'M (20×30×11 ซม.)', 300, 200, 110],
    ],
    quantities: CORRUGATE_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-moving-carton-bc',
    type: 'corrugated',
    nameTh: 'ลังกระดาษขนย้าย 5 ชั้น (ลอน BC)',
    nameEn: 'Moving & storage carton 5-ply (BC-flute)',
    descriptionTh: 'ลังแข็งแรงสำหรับขนย้าย เก็บเอกสาร และสินค้าหนัก ซ้อนได้หลายชั้น',
    patterns: ['DEV-RSC'],
    materials: ['uat-ka125-bc', 'uat-ka185-bc'],
    sizes: [
      ['M', 'กลาง (40×45×40 ซม.)', 450, 400, 400],
      ['L', 'ใหญ่ (40×50×40 ซม.)', 500, 400, 400],
    ],
    quantities: CORRUGATE_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-fruit-box-tele',
    type: 'corrugated',
    nameTh: 'กล่องผลไม้ ฝาครอบ (ตัวกล่อง + ฝา)',
    nameEn: 'Fruit box telescope (body + lid)',
    descriptionTh: 'กล่องฝาครอบเจาะระบายอากาศได้ สำหรับมะม่วง ทุเรียน และผลไม้ของฝาก',
    patterns: ['DEV-TELE'],
    materials: ['dev-ka125-b', 'dev-ka185-b'],
    sizes: [
      ['4KG', 'ผลไม้ 4 กก. (30×40×15 ซม.)', 400, 300, 150],
      ['10KG', 'ผลไม้ 10 กก. (35×50×20 ซม.)', 500, 350, 200],
    ],
    quantities: CORRUGATE_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-produce-tray',
    type: 'corrugated',
    nameTh: 'ถาดลูกฟูกเปิดฝาบน (ถาดผัก / ถาดไข่)',
    nameEn: 'Open-top corrugated tray',
    descriptionTh: 'ถาดสำหรับจัดเรียงผักผลไม้ในซูเปอร์มาร์เก็ต หรือรองสินค้าในลัง',
    patterns: ['DEV-OPEN-TOP'],
    materials: ['dev-ka125-b'],
    sizes: [['STD', 'ถาดผัก (30×40×10 ซม.)', 400, 300, 100]],
    quantities: CORRUGATE_QTY,
    template: 'drawing',
  },
  // Labels
  {
    slug: 'uat-round-logo-sticker',
    type: 'label_sticker',
    nameTh: 'สติ๊กเกอร์โลโก้ร้าน วงกลม',
    nameEn: 'Round logo sticker',
    descriptionTh: 'สติ๊กเกอร์โลโก้สำหรับปิดกล่อง ถุง และแก้วเครื่องดื่ม',
    materials: ['dev-pp-white-80', 'uat-art-paper-label', 'uat-kraft-label', 'uat-pp-clear'],
    finishes: ['dev-matt', 'uat-gloss-opp'],
    diecuts: ['uat-diecut-circle'],
    sizes: [
      ['30', 'วงกลม 3 ซม.', 30, 30, 0],
      ['40', 'วงกลม 4 ซม.', 40, 40, 0],
      ['50', 'วงกลม 5 ซม.', 50, 50, 0],
      ['60', 'วงกลม 6 ซม.', 60, 60, 0],
    ],
    quantities: LABEL_QTY,
    template: 'online_template',
  },
  {
    slug: 'uat-product-label-rect',
    type: 'label_sticker',
    nameTh: 'ฉลากสินค้า สี่เหลี่ยมมุมมน',
    nameEn: 'Rounded-rectangle product label',
    descriptionTh: 'ฉลากแสดงข้อมูลสินค้า ส่วนผสม และวันหมดอายุ สำหรับขวด กระปุก และถุง',
    materials: ['dev-pp-white-80', 'uat-art-paper-label', 'uat-pp-silver'],
    finishes: ['dev-matt', 'uat-gloss-opp'],
    diecuts: ['uat-diecut-rounded-rect'],
    sizes: [
      ['50x30', '5×3 ซม.', 50, 30, 0],
      ['70x50', '7×5 ซม.', 70, 50, 0],
      ['90x55', '9×5.5 ซม.', 90, 55, 0],
      ['100x70', '10×7 ซม.', 100, 70, 0],
    ],
    quantities: LABEL_QTY,
    template: 'online_template',
  },
  {
    slug: 'uat-bottle-wrap-label',
    type: 'label_sticker',
    nameTh: 'ฉลากพันรอบขวด (น้ำดื่ม / ซอส)',
    nameEn: 'Wrap-around bottle label',
    descriptionTh: 'ฉลากพันรอบขวดกันน้ำ สำหรับน้ำดื่ม น้ำผลไม้ และขวดซอส',
    materials: ['dev-pp-white-80', 'uat-pp-clear'],
    finishes: ['uat-gloss-opp'],
    diecuts: ['uat-diecut-rounded-rect'],
    sizes: [
      ['350ML', 'ขวด 350 มล. (20×5 ซม.)', 200, 50, 0],
      ['600ML', 'ขวด 600 มล. (22×6 ซม.)', 220, 60, 0],
    ],
    quantities: LABEL_QTY,
  },
  {
    slug: 'uat-clear-cosmetic-label',
    type: 'label_sticker',
    nameTh: 'ฉลากเครื่องสำอาง PP ใส',
    nameEn: 'Clear cosmetic label',
    descriptionTh: 'ฉลากใสไร้ขอบ ให้ความรู้สึกพิมพ์ตรงบนขวด',
    materials: ['uat-pp-clear'],
    finishes: ['dev-matt'],
    diecuts: ['dev-diecut', 'uat-diecut-oval'],
    sizes: [
      ['40x80', '4×8 ซม.', 80, 40, 0],
      ['60x100', '6×10 ซม.', 100, 60, 0],
    ],
    quantities: LABEL_QTY,
  },
  {
    slug: 'uat-seal-sticker',
    type: 'label_sticker',
    nameTh: 'สติ๊กเกอร์ซีลกล่อง / ปิดปากถุง',
    nameEn: 'Box seal & bag closure sticker',
    descriptionTh: 'สติ๊กเกอร์วงรีสำหรับซีลกล่องและปิดปากถุงขนม แสดงว่าสินค้ายังไม่ถูกเปิด',
    materials: ['uat-art-paper-label', 'uat-kraft-label'],
    finishes: ['uat-gloss-opp'],
    diecuts: ['uat-diecut-oval'],
    sizes: [['40x60', 'วงรี 4×6 ซม.', 60, 40, 0]],
    quantities: LABEL_QTY,
  },
  // Tags & sleeves
  {
    slug: 'uat-clothing-hang-tag',
    type: 'tag_sleeve',
    nameTh: 'ป้ายห้อยเสื้อผ้า (Hang tag)',
    nameEn: 'Clothing hang tag',
    descriptionTh: 'ป้ายแท็กห้อยสินค้าแฟชั่น เจาะรูพร้อมร้อยเชือก เลือกปั๊มฟอยล์ได้',
    patterns: ['DEV-TAG'],
    materials: ['dev-art-350', 'uat-art-400', 'uat-kraft-350'],
    finishes: ['dev-matt', 'dev-foil'],
    diecuts: ['dev-diecut'],
    assemblies: ['dev-hole-3mm'],
    sizes: [
      ['40x70', '4×7 ซม.', 70, 40, 0],
      ['50x90', '5×9 ซม.', 90, 50, 0],
      ['55x85', '5.5×8.5 ซม.', 85, 55, 0],
    ],
    quantities: { min: 300, presets: [300, 1000, 3000, 5000] },
    template: 'online_template',
  },
  {
    slug: 'uat-food-tray-sleeve',
    type: 'tag_sleeve',
    nameTh: 'ปลอกกระดาษสวมกล่อง / ถาดอาหาร',
    nameEn: 'Paper sleeve for boxes & food trays',
    descriptionTh: 'ปลอกกระดาษพิมพ์แบรนด์สวมรอบกล่องข้าว ถาดขนม หรือกล่องของขวัญ',
    patterns: ['DEV-TAG'],
    materials: ['dev-art-350', 'uat-kraft-350'],
    finishes: ['dev-matt'],
    diecuts: ['dev-diecut'],
    sizes: [
      ['S', 'สำหรับกล่องข้าว 650 มล. (7×28 ซม.)', 280, 70, 0],
      ['L', 'สำหรับกล่องข้าว 1,000 มล. (8×32 ซม.)', 320, 80, 0],
    ],
    quantities: { min: 300, presets: [300, 1000, 3000, 5000] },
  },
  // Pouches
  {
    slug: 'uat-standup-zip-pouch',
    type: 'flexible_pouch',
    nameTh: 'ซองตั้งได้มีซิป (Doypack) พิมพ์ลาย',
    nameEn: 'Printed stand-up zip pouch (doypack)',
    descriptionTh: 'ซองตั้งได้พร้อมซิปล็อกและรอยฉีก สำหรับขนม ผงชง เมล็ดกาแฟ และอาหารสัตว์',
    patterns: ['DEV-POUCH-STAND'],
    materials: [
      'dev-pet-lldpe-80',
      'uat-pet-al-lldpe-100',
      'uat-mopp-vmpet-lldpe-90',
      'uat-kraft-pet-lldpe-110',
    ],
    assemblies: ['dev-zipper', 'dev-tear-notch'],
    sizes: [
      ['12x20', '12×20 ซม. ก้นขยาย 6 ซม.', 200, 120, 60],
      ['14x20', '14×20 ซม. ก้นขยาย 6 ซม.', 200, 140, 60],
      ['16x23', '16×23 ซม. ก้นขยาย 8 ซม.', 230, 160, 80],
      ['20x30', '20×30 ซม. ก้นขยาย 10 ซม.', 300, 200, 100],
    ],
    quantities: POUCH_QTY,
    template: 'drawing',
  },
  {
    slug: 'uat-coffee-foil-pouch',
    type: 'flexible_pouch',
    nameTh: 'ซองกาแฟฟอยล์ ตั้งได้ มีซิป',
    nameEn: 'Foil coffee stand-up pouch',
    descriptionTh: 'ซองฟอยล์ทึบแสงสำหรับเมล็ดกาแฟคั่ว 250 กรัม – 1 กิโลกรัม',
    patterns: ['DEV-POUCH-STAND'],
    materials: ['uat-pet-al-lldpe-100', 'uat-kraft-pet-lldpe-110'],
    assemblies: ['dev-zipper', 'dev-tear-notch'],
    sizes: [
      ['250G', 'เมล็ดกาแฟ 250 กรัม (13×21 ซม. ก้น 7 ซม.)', 210, 130, 70],
      ['500G', 'เมล็ดกาแฟ 500 กรัม (16×25 ซม. ก้น 9 ซม.)', 250, 160, 90],
    ],
    quantities: POUCH_QTY,
  },
  {
    slug: 'uat-snack-3side-pouch',
    type: 'flexible_pouch',
    nameTh: 'ซองขนม ซีล 3 ด้าน',
    nameEn: 'Three-side-seal snack pouch',
    descriptionTh: 'ซองแบนซีล 3 ด้านสำหรับขนมขบเคี้ยว เครื่องปรุง และผงชงแบบซองเดียว',
    patterns: ['DEV-POUCH-3SS'],
    materials: ['dev-pet-lldpe-80', 'uat-mopp-vmpet-lldpe-90'],
    assemblies: ['dev-tear-notch'],
    sizes: [
      ['10x15', '10×15 ซม.', 150, 100, 0],
      ['12x18', '12×18 ซม.', 180, 120, 0],
      ['15x22', '15×22 ซม.', 220, 150, 0],
    ],
    quantities: POUCH_QTY,
  },
  // Services
  {
    slug: 'uat-structure-design',
    type: 'service',
    nameTh: 'ออกแบบโครงสร้างกล่อง / ไดคัท',
    nameEn: 'Structural & dieline design',
    descriptionTh: 'ทีมออกแบบโครงสร้างทำแบบไดคัทตามขนาดสินค้าของคุณ ราคาประเมินโดยทีมบริการลูกค้า',
  },
  {
    slug: 'uat-diecut-block',
    type: 'service',
    nameTh: 'ค่าบล็อกไดคัท',
    nameEn: 'Die-cut block',
    descriptionTh: 'บล็อกไดคัทสำหรับงานรูปทรงเฉพาะ ใช้ซ้ำได้เมื่อสั่งผลิตซ้ำแบบเดิม',
  },
  // RFQ types (no calculator, D-100): quoted by CS within the SLA
  {
    slug: 'uat-rigid-lid-base-box',
    type: 'rigid_box',
    nameTh: 'กล่องแข็งฝาครอบ (Gift box)',
    nameEn: 'Rigid lid-and-base gift box',
    descriptionTh: 'กล่องจั่วปังหุ้มกระดาษพิมพ์ลาย สำหรับของขวัญ เครื่องประดับ และสินค้าพรีเมียม',
  },
  {
    slug: 'uat-rigid-magnetic-box',
    type: 'rigid_box',
    nameTh: 'กล่องแข็งฝาพับแม่เหล็ก',
    nameEn: 'Rigid magnetic-closure box',
    descriptionTh: 'กล่องฝาพับปิดด้วยแม่เหล็ก ให้ความรู้สึกหรูหราเมื่อเปิด',
  },
  {
    slug: 'uat-rigid-drawer-box',
    type: 'rigid_box',
    nameTh: 'กล่องแข็งแบบลิ้นชัก',
    nameEn: 'Rigid drawer box',
    descriptionTh: 'กล่องสไลด์ลิ้นชักพร้อมริบบิ้นดึง สำหรับช็อกโกแลตและเครื่องประดับ',
  },
  {
    slug: 'uat-rope-handle-paper-bag',
    type: 'paper_bag',
    nameTh: 'ถุงกระดาษหูเชือก พิมพ์โลโก้',
    nameEn: 'Printed paper bag with rope handles',
    descriptionTh: 'ถุงกระดาษอาร์ตการ์ดเคลือบด้าน หูเชือกคอตตอน สำหรับร้านแฟชั่นและงานอีเวนต์',
  },
  {
    slug: 'uat-kraft-twisted-handle-bag',
    type: 'paper_bag',
    nameTh: 'ถุงกระดาษคราฟท์หูเกลียว พิมพ์โลโก้',
    nameEn: 'Printed kraft bag with twisted handles',
    descriptionTh: 'ถุงคราฟท์หูเกลียวแข็งแรง เหมาะกับร้านเบเกอรี่และร้านกาแฟ',
  },
  {
    slug: 'uat-printed-paper-cup',
    type: 'food_packaging',
    nameTh: 'แก้วกระดาษพิมพ์โลโก้',
    nameEn: 'Custom printed paper cup',
    descriptionTh: 'แก้วกระดาษเครื่องดื่มร้อน / เย็น 8–16 ออนซ์ พิมพ์โลโก้ร้าน',
  },
  {
    slug: 'uat-printed-food-box',
    type: 'food_packaging',
    nameTh: 'กล่องข้าวกระดาษพิมพ์โลโก้',
    nameEn: 'Custom printed paper food box',
    descriptionTh: 'กล่องอาหารกระดาษเคลือบ PE เข้าไมโครเวฟได้ สำหรับร้านอาหารเดลิเวอรี่',
  },
  {
    slug: 'uat-paper-tube',
    type: 'tube',
    nameTh: 'กระบอกกระดาษ (ชา / ไวน์ / เครื่องสำอาง)',
    nameEn: 'Paper tube',
    descriptionTh: 'กระบอกกระดาษพร้อมฝา เหมาะกับใบชา ขวดไวน์ และของขวัญ',
  },
  {
    slug: 'uat-printed-opp-tape',
    type: 'custom_tape',
    nameTh: 'เทป OPP พิมพ์โลโก้',
    nameEn: 'Printed OPP packing tape',
    descriptionTh: 'เทปปิดกล่องพิมพ์โลโก้ร้าน เพิ่มการจดจำแบรนด์และช่วยป้องกันการแกะกล่อง',
  },
  {
    slug: 'uat-counter-display',
    type: 'pop_display',
    nameTh: 'ดิสเพลย์ตั้งโต๊ะ (กระดาษลูกฟูก)',
    nameEn: 'Corrugated counter display',
    descriptionTh: 'ชั้นวางสินค้าตั้งโต๊ะแคชเชียร์ พิมพ์ลายแบรนด์ ประกอบง่าย',
  },
  {
    slug: 'uat-floor-display-stand',
    type: 'pop_display',
    nameTh: 'ชั้นวางสินค้าตั้งพื้น (Floor stand)',
    nameEn: 'Corrugated floor display stand',
    descriptionTh: 'ชั้นวางตั้งพื้น 3–4 ชั้น สำหรับโปรโมชันในห้างและร้านสะดวกซื้อ',
  },
  {
    slug: 'uat-printed-tissue-paper',
    type: 'other',
    nameTh: 'กระดาษห่อสินค้าพิมพ์ลาย',
    nameEn: 'Printed tissue wrapping paper',
    descriptionTh: 'กระดาษสาบางพิมพ์ลายแบรนด์ สำหรับห่อเสื้อผ้าและของขวัญในกล่อง',
  },
];

// --- Standard (stock) products ---------------------------------------------------------------------------------

export interface StockSeed {
  sku: string;
  nameTh: string;
  nameEn: string;
  description: string;
  unit: 'piece' | 'pouch';
  weightG?: number;
  capacityMl?: number;
  size?: [l: number, w: number, h: number];
  minOrderQty: number;
  isFoodGrade?: boolean;
  attributes: Partial<Record<'material' | 'colour' | 'cap_type' | 'shape', string>>;
}

/**
 * Stock products. Their rehearsal buy prices copy the dev bottle's fake tiers scaled by weight (pieces with a
 * weight) or the dev stock pouch's tiers (pieces sold by the pouch) — see `uat-prices.ts`.
 */
export const UAT_STOCK_PRODUCTS: readonly StockSeed[] = [
  {
    sku: 'UAT-PET-BTL-100',
    nameTh: 'ขวด PET ใส 100 มล. ฝาเกลียว 24 มม.',
    nameEn: 'Clear PET bottle 100 ml, 24 mm screw cap',
    description: 'ขวดใสทรงกลม สำหรับเซรั่ม น้ำหอมกดสเปรย์ และของเหลวทั่วไป',
    unit: 'piece',
    weightG: 15,
    capacityMl: 100,
    minOrderQty: 100,
    attributes: { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
  },
  {
    sku: 'UAT-PET-BTL-250',
    nameTh: 'ขวด PET ใส 250 มล. ทรงกลม',
    nameEn: 'Clear PET round bottle 250 ml',
    description: 'สำหรับน้ำผลไม้ ชาไทย และเครื่องดื่มพร้อมดื่ม',
    unit: 'piece',
    weightG: 22,
    capacityMl: 250,
    minOrderQty: 100,
    isFoodGrade: true,
    attributes: { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
  },
  {
    sku: 'UAT-PET-BTL-500',
    nameTh: 'ขวด PET ใส 500 มล. ทรงกลม',
    nameEn: 'Clear PET round bottle 500 ml',
    description: 'สำหรับน้ำดื่ม น้ำผลไม้ และน้ำสมุนไพร',
    unit: 'piece',
    weightG: 28,
    capacityMl: 500,
    minOrderQty: 100,
    isFoodGrade: true,
    attributes: { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
  },
  {
    sku: 'UAT-PET-BTL-1000',
    nameTh: 'ขวด PET ใส 1 ลิตร',
    nameEn: 'Clear PET bottle 1 litre',
    description: 'สำหรับนม น้ำผลไม้ และน้ำยาทำความสะอาดแบบเติม',
    unit: 'piece',
    weightG: 38,
    capacityMl: 1000,
    minOrderQty: 100,
    isFoodGrade: true,
    attributes: { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
  },
  {
    sku: 'UAT-AMB-DROP-30',
    nameTh: 'ขวดแก้วสีชา ดรอปเปอร์ 30 มล.',
    nameEn: 'Amber glass dropper bottle 30 ml',
    description: 'กันแสง สำหรับเซรั่ม น้ำมันหอมระเหย และสารสกัด',
    unit: 'piece',
    weightG: 60,
    capacityMl: 30,
    minOrderQty: 100,
    attributes: { material: 'แก้ว', colour: 'สีชา', cap_type: 'ดรอปเปอร์', shape: 'กลม' },
  },
  {
    sku: 'UAT-GLS-JAR-200',
    nameTh: 'ขวดโหลแก้ว 200 มล. ฝาเกลียวสีทอง',
    nameEn: 'Glass jar 200 ml, gold screw lid',
    description: 'สำหรับน้ำพริก แยม น้ำผึ้ง และเทียนหอม',
    unit: 'piece',
    weightG: 180,
    capacityMl: 200,
    minOrderQty: 100,
    isFoodGrade: true,
    attributes: { material: 'แก้ว', colour: 'ใส', cap_type: 'ฝาเกลียวโลหะ', shape: 'กลม' },
  },
  {
    sku: 'UAT-PET-JAR-500',
    nameTh: 'กระปุก PET 500 มล. ฝาอลูมิเนียม',
    nameEn: 'PET jar 500 ml, aluminium lid',
    description: 'สำหรับขนมคุกกี้ ถั่ว และผงชง',
    unit: 'piece',
    weightG: 35,
    capacityMl: 500,
    minOrderQty: 100,
    isFoodGrade: true,
    attributes: { material: 'PET', colour: 'ใส', cap_type: 'ฝาอลูมิเนียม', shape: 'กลม' },
  },
  {
    sku: 'UAT-HDPE-BTL-1000',
    nameTh: 'ขวด HDPE ขาวขุ่น 1 ลิตร',
    nameEn: 'HDPE bottle 1 litre, natural white',
    description: 'สำหรับน้ำยาล้างจาน น้ำยาซักผ้า และสารเคมีในบ้าน',
    unit: 'piece',
    weightG: 50,
    capacityMl: 1000,
    minOrderQty: 100,
    attributes: { material: 'HDPE', colour: 'ขาวขุ่น', cap_type: 'ฝาเกลียว', shape: 'เหลี่ยม' },
  },
  {
    sku: 'UAT-CUP-8OZ',
    nameTh: 'แก้วกระดาษ 8 ออนซ์ (เครื่องดื่มร้อน)',
    nameEn: 'Paper cup 8 oz (hot drinks)',
    description: 'แก้วกระดาษเคลือบ PE สีขาว ใช้กับฝายกดื่ม 80 มม.',
    unit: 'piece',
    weightG: 8,
    capacityMl: 240,
    minOrderQty: 1000,
    isFoodGrade: true,
    attributes: { material: 'กระดาษเคลือบ PE', colour: 'ขาว' },
  },
  {
    sku: 'UAT-CUP-16OZ',
    nameTh: 'แก้วกระดาษ 16 ออนซ์ (เครื่องดื่มเย็น)',
    nameEn: 'Paper cup 16 oz (cold drinks)',
    description: 'แก้วกระดาษเคลือบ PE 2 ด้าน สำหรับเครื่องดื่มเย็น',
    unit: 'piece',
    weightG: 13,
    capacityMl: 480,
    minOrderQty: 1000,
    isFoodGrade: true,
    attributes: { material: 'กระดาษเคลือบ PE', colour: 'ขาว' },
  },
  {
    sku: 'UAT-KRAFT-BOX-650',
    nameTh: 'กล่องอาหารกระดาษคราฟท์ 650 มล.',
    nameEn: 'Kraft food box 650 ml',
    description: 'กล่องข้าวคราฟท์เคลือบ PE เข้าไมโครเวฟได้ สำหรับร้านอาหารเดลิเวอรี่',
    unit: 'piece',
    weightG: 18,
    capacityMl: 650,
    size: [170, 120, 50],
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'กระดาษคราฟท์เคลือบ PE', colour: 'น้ำตาล' },
  },
  {
    sku: 'UAT-KRAFT-BOX-1000',
    nameTh: 'กล่องอาหารกระดาษคราฟท์ 1,000 มล.',
    nameEn: 'Kraft food box 1,000 ml',
    description: 'กล่องข้าวคราฟท์ขนาดใหญ่ สำหรับข้าวกล่องและสลัด',
    unit: 'piece',
    weightG: 24,
    capacityMl: 1000,
    size: [200, 140, 60],
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'กระดาษคราฟท์เคลือบ PE', colour: 'น้ำตาล' },
  },
  {
    sku: 'UAT-PP-BOX-750',
    nameTh: 'กล่องข้าว PP ไมโครเวฟ 750 มล. พร้อมฝา',
    nameEn: 'PP microwavable container 750 ml with lid',
    description: 'กล่องพลาสติก PP สีดำ ฝาใส ทนความร้อน',
    unit: 'piece',
    weightG: 22,
    capacityMl: 750,
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'PP', colour: 'ดำ / ฝาใส' },
  },
  {
    sku: 'UAT-KRAFT-BAG-S',
    nameTh: 'ถุงกระดาษคราฟท์ก้นแบน S (15×8×21 ซม.)',
    nameEn: 'Flat-bottom kraft bag S (15×8×21 cm)',
    description: 'ถุงคราฟท์ไม่มีหู สำหรับขนมปังและเบเกอรี่',
    unit: 'piece',
    weightG: 25,
    size: [150, 80, 210],
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'กระดาษคราฟท์', colour: 'น้ำตาล' },
  },
  {
    sku: 'UAT-KRAFT-BAG-M',
    nameTh: 'ถุงกระดาษคราฟท์หูเกลียว M (25×12×32 ซม.)',
    nameEn: 'Kraft bag with twisted handles M (25×12×32 cm)',
    description: 'ถุงคราฟท์หูเกลียว สำหรับร้านค้าปลีกและร้านกาแฟ',
    unit: 'piece',
    weightG: 70,
    size: [250, 120, 320],
    minOrderQty: 300,
    attributes: { material: 'กระดาษคราฟท์', colour: 'น้ำตาล' },
  },
  {
    sku: 'UAT-MAIL-BAG-25X35',
    nameTh: 'ซองไปรษณีย์พลาสติก 25×35 ซม. (สีขาว)',
    nameEn: 'Plastic mailing bag 25×35 cm (white)',
    description: 'ซองพลาสติกกันน้ำ แถบกาวในตัว สำหรับส่งเสื้อผ้าและสินค้าไม่แตก',
    unit: 'pouch',
    size: [350, 250, 0],
    minOrderQty: 500,
    attributes: { material: 'LDPE', colour: 'ขาว' },
  },
  {
    sku: 'UAT-MAIL-BAG-32X45',
    nameTh: 'ซองไปรษณีย์พลาสติก 32×45 ซม. (สีขาว)',
    nameEn: 'Plastic mailing bag 32×45 cm (white)',
    description: 'ขนาดใหญ่สำหรับเสื้อแจ็กเก็ตและสินค้าหลายชิ้น',
    unit: 'pouch',
    size: [450, 320, 0],
    minOrderQty: 500,
    attributes: { material: 'LDPE', colour: 'ขาว' },
  },
  {
    sku: 'UAT-BUBBLE-MAILER-18X23',
    nameTh: 'ซองบับเบิ้ลกันกระแทก 18×23 ซม.',
    nameEn: 'Bubble mailer 18×23 cm',
    description: 'ด้านในบุบับเบิ้ล สำหรับเครื่องสำอาง อุปกรณ์มือถือ และสินค้าเปราะบางขนาดเล็ก',
    unit: 'pouch',
    size: [230, 180, 0],
    minOrderQty: 500,
    attributes: { material: 'กระดาษคราฟท์ + บับเบิ้ล PE', colour: 'น้ำตาล' },
  },
  {
    sku: 'UAT-ZIP-CLEAR-10X15',
    nameTh: 'ซองซิปใส 10×15 ซม.',
    nameEn: 'Clear zip bag 10×15 cm',
    description: 'ซองซิปล็อกใสสำหรับเครื่องประดับ อะไหล่ และขนมชิ้นเล็ก',
    unit: 'pouch',
    size: [150, 100, 0],
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'LDPE', colour: 'ใส' },
  },
  {
    sku: 'UAT-ZIP-FOIL-13X20',
    nameTh: 'ซองฟอยล์ซิปล็อก ตั้งได้ 13×20 ซม. (ไม่พิมพ์)',
    nameEn: 'Plain foil stand-up zip pouch 13×20 cm',
    description: 'ซองตั้งได้ไม่พิมพ์ลาย พร้อมใช้ ติดสติ๊กเกอร์โลโก้ได้ทันที',
    unit: 'pouch',
    size: [200, 130, 0],
    minOrderQty: 500,
    isFoodGrade: true,
    attributes: { material: 'PET/AL/LLDPE', colour: 'เงิน' },
  },
];

// --- Content -----------------------------------------------------------------------------------------------------

/**
 * FAQ drafts for the UAT storefront. Every answer states an accepted decision (cited) and nothing else; the CS Lead
 * reviews the wording before the production content is written (D-221).
 */
export const UAT_FAQS: readonly {
  category: { code: string; nameTh: string; nameEn: string };
  items: { q: string; a: string }[];
}[] = [
  {
    category: { code: 'uat_ordering', nameTh: 'การสั่งซื้อและใบเสนอราคา', nameEn: 'Ordering & quotations' },
    items: [
      {
        q: 'ใบเสนอราคามีอายุกี่วัน',
        a: 'ใบเสนอราคามีอายุ 15 วัน และล็อกราคาตลอดช่วงนั้น เมื่อหมดอายุระบบจะคำนวณราคาใหม่ให้ (D-051)',
      },
      {
        q: 'สินค้าที่ไม่มีราคาทันทีสั่งได้อย่างไร',
        a: 'กดขอใบเสนอราคา (RFQ) พร้อมแนบขนาด จำนวน และไฟล์อ้างอิง ทีมงานจะเสนอราคาภายในเวลาที่แจ้งบนหน้าสินค้า (D-100)',
      },
      {
        q: 'จำนวนที่ได้รับอาจคลาดเคลื่อนได้เท่าไร',
        a: 'งานผลิตตามสั่งมีค่าคลาดเคลื่อนจำนวน ±5% หากได้รับน้อยกว่าที่สั่งภายในเกณฑ์จะคืนเงินตามสัดส่วน ส่วนที่เกินไม่มีค่าใช้จ่ายเพิ่ม (D-080, D-163)',
      },
    ],
  },
  {
    category: { code: 'uat_artwork', nameTh: 'ไฟล์งานและการตรวจปรู๊ฟ', nameEn: 'Artwork & proofs' },
    items: [
      {
        q: 'ไฟล์งานต้องเตรียมอย่างไร',
        a: 'ส่งไฟล์ PDF ตามแบบไดคัทพร้อมระยะตัดตก ระบบจะไม่รับไฟล์ที่ขนาดไม่ตรงหรือไม่มีระยะตัดตก และจะเตือนเมื่อความละเอียดต่ำหรือเป็นโหมดสี RGB (D-070)',
      },
      {
        q: 'เริ่มผลิตเมื่อไร',
        a: 'ระบบเริ่มผลิตอัตโนมัติเมื่อคุณอนุมัติปรู๊ฟ และชำระงวดที่ต้องชำระก่อนผลิตครบแล้ว (D-073)',
      },
      {
        q: 'จ้างออกแบบแก้ไขได้กี่ครั้ง',
        a: 'แก้ไขฟรี 3 ครั้ง ตั้งแต่ครั้งที่ 4 มีค่าบริการครั้งละ 500 บาท หรือ 20% ของค่าออกแบบแล้วแต่จำนวนใดสูงกว่า (D-071)',
      },
    ],
  },
  {
    category: { code: 'uat_payment', nameTh: 'การชำระเงิน', nameEn: 'Payment' },
    items: [
      {
        q: 'ชำระเงินได้ช่องทางใดบ้าง',
        a: 'สแกน QR พร้อมเพย์ บัตรเครดิต / เดบิต หรือโอนเงินแล้วแนบสลิป ระบบตรวจสลิปให้อัตโนมัติ (D-061, D-176)',
      },
      {
        q: 'ต้องชำระเต็มจำนวนหรือไม่',
        a: 'คำสั่งซื้อต่ำกว่า 20,000 บาทชำระเต็มจำนวน ตั้งแต่ 20,000 บาทขึ้นไปชำระมัดจำ 50% และส่วนที่เหลือก่อนจัดส่ง (D-020)',
      },
    ],
  },
  {
    category: { code: 'uat_delivery', nameTh: 'การจัดส่งและการเคลม', nameEn: 'Delivery & claims' },
    items: [
      {
        q: 'ติดตามสถานะงานได้อย่างไร',
        a: 'ดูสถานะทุกขั้นตอนได้ในหน้าคำสั่งซื้อ และแชร์ลิงก์ติดตามการจัดส่งให้ผู้รับได้',
      },
      {
        q: 'ได้รับสินค้าไม่ถูกต้องต้องทำอย่างไร',
        a: 'แจ้งเคลมได้ภายใน 7 วันหลังได้รับสินค้า พร้อมรูปสินค้าและรูปกล่องขนส่ง (D-082) ทีมงานตอบกลับภายใน 1 วันทำการ (D-199)',
      },
      {
        q: 'ถ้าไม่กดยืนยันรับสินค้าจะเป็นอย่างไร',
        a: 'ระบบยืนยันรับสินค้าให้อัตโนมัติ 7 วันหลังจัดส่งถึง (D-081)',
      },
    ],
  },
];
