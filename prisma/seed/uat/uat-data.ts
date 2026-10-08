import { HERO_PRESETS, type HeroPresetsSeed } from '../data/hero-presets';

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
  flute?: 'B' | 'BC' | 'E';
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
  // E flute: the homepage hero's mailer board (D-310). Priced like dev-ka125-b in this rehearsal.
  {
    code: 'uat-ka125-e',
    likeCode: 'dev-ka125-b',
    kind: 'corrugated_board',
    nameTh: 'ลูกฟูก KA125 ลอน E (3 ชั้น)',
    nameEn: 'Corrugated KA125 E-flute (3-ply)',
    gsm: 400,
    caliperMm: '1.600',
    flute: 'E',
    insideColour: 'น้ำตาล',
    outsideColour: 'น้ำตาล',
    coatable: false,
    descriptionTh: 'ลอนเล็ก ผิวเรียบ พิมพ์สวย สำหรับกล่องไปรษณีย์และกล่องสินค้า',
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
  /** Front-ink options offered (ink colour codes); none means the configurator offers no print. */
  inks?: string[];
  finishes?: string[];
  diecuts?: string[];
  assemblies?: string[];
  sizes?: SizeSeed[];
  quantities?: { min: number; presets: number[] };
  template?: 'none' | 'online_template' | 'drawing';
}

const COSMETIC_FINISHES = ['dev-matt', 'uat-gloss-opp', 'uat-aqueous-varnish', 'uat-soft-touch'];
/** The homepage hero's products offer one spot colour and full colour (D-310). */
const HERO_INKS = ['uat-black', 'dev-cmyk'];

/**
 * `catalog.hero_presets` for the rehearsal (D-310): the product owner's values (`HERO_PRESETS`) with this
 * catalogue's mapping — in production the Admin maps their own products and options. Ported from
 * `feat/ux-r2-p4-hero-presets` (b44a6cb).
 */
export const UAT_HERO_PRESETS: HeroPresetsSeed = {
  ...HERO_PRESETS,
  shapes: HERO_PRESETS.shapes.map((s) => ({
    ...s,
    productSlug: { mailer: 'uat-postal-box-b', lid: 'uat-fruit-box-tele', tuck: 'uat-soap-box' }[s.id],
  })),
  materials: HERO_PRESETS.materials.map((m) => ({
    ...m,
    optionCodes: { kraft350: ['uat-kraft-350'], art350: ['dev-art-350'], corrE: ['uat-ka125-e'] }[m.id],
  })),
  prints: HERO_PRESETS.prints.map((p) => ({
    ...p,
    optionCodes: { none: [], one: ['uat-black'], full: ['dev-cmyk'] }[p.id],
  })),
};

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
    inks: HERO_INKS,
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
    materials: ['dev-ka125-b', 'uat-kt125-b', 'dev-ka185-b', 'uat-ka125-e'],
    inks: HERO_INKS,
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
    materials: ['dev-ka125-b', 'dev-ka185-b', 'uat-ka125-e'],
    inks: HERO_INKS,
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
  unit: 'piece' | 'pouch' | 'tube';
  weightG?: number;
  capacityMl?: number;
  size?: [l: number, w: number, h: number];
  minOrderQty: number;
  isFoodGrade?: boolean;
  attributes: Partial<Record<StockSeedAttribute, string>>;
  /** Units on hand at the launch factory (default 200 × the minimum order); 0 shows the SKU as out of stock. */
  onHand?: number;
}

export type StockSeedAttribute = 'type' | 'material' | 'colour' | 'cap_type' | 'shape' | 'size_text';

/** Store category of each SKU (stock attribute `type`), from its SKU prefix. */
export const UAT_STOCK_TYPES: readonly [prefix: string, type: string][] = [
  ['UAT-POSTBOX-', 'กล่องไปรษณีย์พร้อมส่ง'],
  ['UAT-PET-BTL-', 'ขวดพลาสติก'],
  ['UAT-PET-SQ-', 'ขวดพลาสติก'],
  ['UAT-HDPE-', 'ขวดพลาสติก'],
  ['UAT-PET-SPRAY-', 'ขวดสเปรย์และขวดปั๊ม'],
  ['UAT-PET-PUMP-', 'ขวดสเปรย์และขวดปั๊ม'],
  ['UAT-FOAM-', 'ขวดสเปรย์และขวดปั๊ม'],
  ['UAT-AIRLESS-', 'ขวดสเปรย์และขวดปั๊ม'],
  ['UAT-AMB-', 'ขวดและโหลแก้ว'],
  ['UAT-GLS-', 'ขวดและโหลแก้ว'],
  ['UAT-PP-JAR-', 'กระปุกครีมและโหล'],
  ['UAT-ACR-JAR-', 'กระปุกครีมและโหล'],
  ['UAT-PET-JAR-', 'กระปุกครีมและโหล'],
  ['UAT-LIPBALM-', 'หลอดเครื่องสำอาง'],
  ['UAT-TUBE-', 'หลอดเครื่องสำอาง'],
  ['UAT-CUP-', 'แก้วเครื่องดื่มและฝา'],
  ['UAT-PET-CUP-', 'แก้วเครื่องดื่มและฝา'],
  ['UAT-PET-UCUP-', 'แก้วเครื่องดื่มและฝา'],
  ['UAT-LID-', 'แก้วเครื่องดื่มและฝา'],
  ['UAT-STRAW-', 'แก้วเครื่องดื่มและฝา'],
  ['UAT-KRAFT-BOX-', 'กล่องและภาชนะอาหาร'],
  ['UAT-PAPER-BOWL-', 'กล่องและภาชนะอาหาร'],
  ['UAT-BAGASSE-', 'กล่องและภาชนะอาหาร'],
  ['UAT-PP-', 'กล่องและภาชนะอาหาร'],
  ['UAT-PET-BAKERY-', 'กล่องและภาชนะอาหาร'],
  ['UAT-CAKE-', 'กล่องและภาชนะอาหาร'],
  ['UAT-SNACK-', 'กล่องและภาชนะอาหาร'],
  ['UAT-KRAFT-BAG-', 'ถุงกระดาษ'],
  ['UAT-WHITE-BAG-', 'ถุงกระดาษ'],
  ['UAT-KRAFT-FLAT-', 'ถุงกระดาษ'],
  ['UAT-TSHIRT-', 'ถุงพลาสติกและซองซิป'],
  ['UAT-ZIP-', 'ถุงพลาสติกและซองซิป'],
  ['UAT-OPP-ADH-', 'ถุงพลาสติกและซองซิป'],
  ['UAT-VACUUM-', 'ถุงพลาสติกและซองซิป'],
  ['UAT-MAIL-', 'ซองไปรษณีย์'],
  ['UAT-BUBBLE-MAILER-', 'ซองไปรษณีย์'],
  ['UAT-KRAFT-MAILER-', 'ซองไปรษณีย์'],
  ['UAT-OPP-TAPE-', 'อุปกรณ์แพ็กสินค้า'],
  ['UAT-FRAGILE-', 'อุปกรณ์แพ็กสินค้า'],
  ['UAT-BUBBLE-ROLL-', 'อุปกรณ์แพ็กสินค้า'],
  ['UAT-STRETCH-', 'อุปกรณ์แพ็กสินค้า'],
  ['UAT-PAPER-SHRED-', 'อุปกรณ์แพ็กสินค้า'],
  ['UAT-AIR-', 'อุปกรณ์แพ็กสินค้า'],
];

/** The first rehearsal SKUs (U-B5). */
const FIRST_STOCK_PRODUCTS: readonly StockSeed[] = [
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

/** A ready-to-ship SKU in one line: sold by the piece with a weight (g), or by the pouch / tube. */
const sku = (
  code: string,
  nameTh: string,
  nameEn: string,
  description: string,
  unit: StockSeed['unit'],
  weightG: number | null,
  minOrderQty: number,
  attributes: StockSeed['attributes'],
  extra: Partial<StockSeed> = {},
): StockSeed => ({
  sku: `UAT-${code}`,
  nameTh,
  nameEn,
  description,
  unit,
  ...(weightG !== null && { weightG }),
  minOrderQty,
  attributes,
  ...extra,
});
const food = { isFoodGrade: true };

/**
 * More ready-to-ship SKUs (สินค้าพร้อมส่ง) across what Thai online sellers buy off the shelf: unprinted postal boxes,
 * bottles, pumps and sprays, glass, jars, tubes, cups and lids, food containers, paper and plastic bags, mailers and
 * packing supplies. Weights are typical for the item so the weight-scaled rehearsal prices stay in proportion.
 */
const READY_STOCK_PRODUCTS: readonly StockSeed[] = [
  // Unprinted postal boxes (Thai standard sizes), sold in multiples of the pack.
  ...(
    [
      ['00', '9.75×14×6', [140, 97.5, 60], 45],
      ['0', '11×17×6', [170, 110, 60], 55],
      ['A', '14×20×6', [200, 140, 60], 75],
      ['2A', '14×20×12', [200, 140, 120], 95],
      ['B', '17×25×9', [250, 170, 90], 115],
      ['C', '20×30×11', [300, 200, 110], 165],
      ['D', '22×35×14', [350, 220, 140], 225],
      ['E', '24×40×17', [400, 240, 170], 295],
      ['F', '30×45×22', [450, 300, 220], 420],
    ] as const
  ).map(([size, cm, dims, g]) =>
    sku(
      `POSTBOX-${size}`,
      `กล่องไปรษณีย์ ฝาชน เบอร์ ${size} (${cm} ซม.) ไม่พิมพ์`,
      `Plain postal box no. ${size} (${cm} cm)`,
      'กล่องลูกฟูก 3 ชั้น ลอน B สีน้ำตาล พร้อมส่ง ขายเป็นแพ็ก 20 ใบ',
      'piece',
      g,
      20,
      { material: 'ลูกฟูก KA125 ลอน B', colour: 'น้ำตาล', size_text: `เบอร์ ${size}` },
      { size: [...dims] as [number, number, number], ...(size === 'F' && { onHand: 0 }) },
    ),
  ),
  // Plastic bottles
  sku(
    'PET-BTL-60',
    'ขวด PET กลม 60 มล. ฝาฟลิปท็อป',
    'PET round bottle 60 ml, flip-top cap',
    'สำหรับเจลล้างมือ โลชั่น และสินค้าไซซ์ทดลอง',
    'piece',
    10,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาฟลิปท็อป', shape: 'กลม' },
    { capacityMl: 60 },
  ),
  sku(
    'PET-SQ-150',
    'ขวด PET ทรงเหลี่ยม 150 มล.',
    'PET square bottle 150 ml',
    'ทรงเหลี่ยมติดฉลากง่าย สำหรับน้ำมันนวดและน้ำหอมปรับอากาศ',
    'piece',
    18,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'เหลี่ยม' },
    { capacityMl: 150 },
  ),
  sku(
    'PET-BTL-350',
    'ขวด PET 350 มล. (ชา / น้ำผลไม้)',
    'PET bottle 350 ml (tea / juice)',
    'ขวดใสยอดนิยมสำหรับชาไทย ชาไข่มุก และน้ำผลไม้คั้นสด',
    'piece',
    24,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 350, ...food },
  ),
  sku(
    'PET-BTL-1500',
    'ขวด PET 1.5 ลิตร',
    'PET bottle 1.5 litres',
    'สำหรับน้ำดื่ม น้ำสมุนไพร และน้ำยาแบบเติม',
    'piece',
    45,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 1500, ...food },
  ),
  sku(
    'HDPE-GAL-3800',
    'แกลลอน HDPE 3.8 ลิตร มีหูจับ',
    'HDPE gallon 3.8 litres with handle',
    'สำหรับน้ำยาทำความสะอาด น้ำยาซักผ้า และปุ๋ยน้ำ',
    'piece',
    150,
    50,
    { material: 'HDPE', colour: 'ขาวขุ่น', cap_type: 'ฝาเกลียว', shape: 'เหลี่ยม' },
    { capacityMl: 3800 },
  ),
  // Sprays and pumps
  sku(
    'PET-SPRAY-30',
    'ขวดสเปรย์ PET 30 มล. หัวพ่นละอองฝอย',
    'PET mist spray bottle 30 ml',
    'ขนาดพกพาสำหรับแอลกอฮอล์ สเปรย์น้ำแร่ และน้ำหอม',
    'piece',
    8,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'หัวสเปรย์', shape: 'กลม' },
    { capacityMl: 30 },
  ),
  sku(
    'PET-SPRAY-100',
    'ขวดสเปรย์ PET 100 มล. หัวพ่นละอองฝอย',
    'PET mist spray bottle 100 ml',
    'สำหรับสเปรย์ฉีดผ้า สเปรย์ปรับอากาศ และโทนเนอร์',
    'piece',
    16,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'หัวสเปรย์', shape: 'กลม' },
    { capacityMl: 100 },
  ),
  sku(
    'PET-PUMP-250',
    'ขวดปั๊ม PET 250 มล. หัวปั๊มสีขาว',
    'PET pump bottle 250 ml, white pump',
    'สำหรับเจลอาบน้ำ แชมพู และโลชั่น',
    'piece',
    30,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'หัวปั๊ม', shape: 'กลม' },
    { capacityMl: 250 },
  ),
  sku(
    'PET-PUMP-500',
    'ขวดปั๊ม PET 500 มล. สีชา',
    'Amber PET pump bottle 500 ml',
    'สีชากันแสง สำหรับสบู่เหลวและแชมพูออร์แกนิก',
    'piece',
    45,
    100,
    { material: 'PET', colour: 'สีชา', cap_type: 'หัวปั๊ม', shape: 'กลม' },
    { capacityMl: 500 },
  ),
  sku(
    'FOAM-PUMP-150',
    'ขวดโฟมปั๊ม 150 มล.',
    'Foam pump bottle 150 ml',
    'กดแล้วเป็นโฟม สำหรับโฟมล้างหน้าและสบู่ล้างมือ',
    'piece',
    35,
    100,
    { material: 'PET', colour: 'ขาว', cap_type: 'หัวปั๊มโฟม', shape: 'กลม' },
    { capacityMl: 150 },
  ),
  sku(
    'AIRLESS-30',
    'ขวดแอร์เลส 30 มล. สีขาว',
    'Airless pump bottle 30 ml, white',
    'ไม่ให้อากาศเข้า ถนอมเนื้อครีมและเซรั่ม',
    'piece',
    25,
    100,
    { material: 'PP', colour: 'ขาว', cap_type: 'หัวปั๊มแอร์เลส', shape: 'กลม' },
    { capacityMl: 30, onHand: 150 },
  ),
  // Glass
  sku(
    'AMB-DROP-10',
    'ขวดแก้วสีชา ดรอปเปอร์ 10 มล.',
    'Amber glass dropper bottle 10 ml',
    'สำหรับน้ำมันหอมระเหยและเซรั่มไซซ์ทดลอง',
    'piece',
    30,
    100,
    { material: 'แก้ว', colour: 'สีชา', cap_type: 'ดรอปเปอร์', shape: 'กลม' },
    { capacityMl: 10 },
  ),
  sku(
    'AMB-DROP-50',
    'ขวดแก้วสีชา ดรอปเปอร์ 50 มล.',
    'Amber glass dropper bottle 50 ml',
    'สำหรับเซรั่ม น้ำมันบำรุงผม และสารสกัด',
    'piece',
    90,
    100,
    { material: 'แก้ว', colour: 'สีชา', cap_type: 'ดรอปเปอร์', shape: 'กลม' },
    { capacityMl: 50 },
  ),
  sku(
    'AMB-DROP-100',
    'ขวดแก้วสีชา ดรอปเปอร์ 100 มล.',
    'Amber glass dropper bottle 100 ml',
    'ขนาดใหญ่สำหรับน้ำมันนวดและสารสกัดสมุนไพร',
    'piece',
    140,
    100,
    { material: 'แก้ว', colour: 'สีชา', cap_type: 'ดรอปเปอร์', shape: 'กลม' },
    { capacityMl: 100 },
  ),
  sku(
    'GLS-JUICE-250',
    'ขวดแก้วน้ำผลไม้ 250 มล. ฝาเกลียวล็อก',
    'Glass juice bottle 250 ml, lug cap',
    'สำหรับน้ำผลไม้สกัดเย็น คอมบูชะ และนม',
    'piece',
    200,
    100,
    { material: 'แก้ว', colour: 'ใส', cap_type: 'ฝาเกลียวล็อก', shape: 'กลม' },
    { capacityMl: 250, ...food },
  ),
  sku(
    'GLS-JAR-100',
    'ขวดโหลแก้ว 100 มล. ฝาเกลียวสีทอง',
    'Glass jar 100 ml, gold screw lid',
    'สำหรับแยม น้ำพริก และครีมขัดผิว',
    'piece',
    110,
    100,
    { material: 'แก้ว', colour: 'ใส', cap_type: 'ฝาเกลียวโลหะ', shape: 'กลม' },
    { capacityMl: 100, ...food },
  ),
  sku(
    'GLS-JAR-500',
    'ขวดโหลแก้ว 500 มล. ฝาเกลียว',
    'Glass jar 500 ml, screw lid',
    'สำหรับผักดอง น้ำผึ้ง และขนมคุกกี้',
    'piece',
    300,
    50,
    { material: 'แก้ว', colour: 'ใส', cap_type: 'ฝาเกลียวโลหะ', shape: 'กลม' },
    { capacityMl: 500, ...food },
  ),
  sku(
    'GLS-CANDLE-180',
    'แก้วเทียนหอม 180 มล. ทรงกระบอก',
    'Candle glass 180 ml, tumbler',
    'แก้วหนาทนความร้อน สำหรับเทียนหอมและเทียนถั่วเหลือง',
    'piece',
    220,
    50,
    { material: 'แก้ว', colour: 'ใส', shape: 'กระบอก' },
    { capacityMl: 180, onHand: 0 },
  ),
  sku(
    'GLS-BIRDNEST-45',
    'ขวดแก้วรังนก 45 มล. ฝาเกลียว',
    'Glass bird’s-nest bottle 45 ml',
    'ขวดแก้วเล็กสำหรับเครื่องดื่มรังนกและซุปไก่สกัด',
    'piece',
    70,
    100,
    { material: 'แก้ว', colour: 'ใส', cap_type: 'ฝาเกลียวโลหะ', shape: 'กลม' },
    { capacityMl: 45, ...food },
  ),
  // Jars
  sku(
    'PP-JAR-30G',
    'กระปุกครีม PP 30 กรัม สีขาว',
    'PP cream jar 30 g, white',
    'กระปุกครีมผนังหนา สำหรับครีมบำรุงผิวและบาล์ม',
    'piece',
    12,
    100,
    { material: 'PP', colour: 'ขาว', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 30 },
  ),
  sku(
    'PP-JAR-50G',
    'กระปุกครีม PP 50 กรัม สีขาว',
    'PP cream jar 50 g, white',
    'สำหรับครีมทาผิว สครับ และขี้ผึ้งสมุนไพร',
    'piece',
    16,
    100,
    { material: 'PP', colour: 'ขาว', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 50 },
  ),
  sku(
    'ACR-JAR-50G',
    'กระปุกอะคริลิค 2 ชั้น 50 กรัม ฝาทอง',
    'Double-wall acrylic jar 50 g, gold lid',
    'ดูหรูหราสำหรับครีมพรีเมียม',
    'piece',
    60,
    100,
    { material: 'อะคริลิค', colour: 'ใส / ทอง', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 50 },
  ),
  sku(
    'PET-JAR-250',
    'กระปุก PET 250 มล. ฝาอลูมิเนียม',
    'PET jar 250 ml, aluminium lid',
    'สำหรับขนมปังกรอบ ถั่ว และน้ำพริกแห้ง',
    'piece',
    20,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาอลูมิเนียม', shape: 'กลม' },
    { capacityMl: 250, ...food },
  ),
  sku(
    'PET-JAR-1000',
    'โหลคุกกี้ PET 1 ลิตร ฝาเกลียว',
    'PET cookie jar 1 litre',
    'โหลขนมทรงสูงสำหรับคุกกี้และขนมไหว้',
    'piece',
    55,
    100,
    { material: 'PET', colour: 'ใส', cap_type: 'ฝาเกลียว', shape: 'กลม' },
    { capacityMl: 1000, ...food },
  ),
  // Tubes
  sku(
    'LIPBALM-5G',
    'หลอดลิปบาล์ม 5 กรัม สีขาว',
    'Lip-balm tube 5 g, white',
    'หลอดหมุนสำหรับลิปบาล์มและยาหม่องแท่ง',
    'tube',
    null,
    500,
    { material: 'PP', colour: 'ขาว' },
  ),
  sku(
    'TUBE-50',
    'หลอดบีบ PE 50 มล. ฝาเกลียว',
    'PE squeeze tube 50 ml, screw cap',
    'สำหรับโฟมล้างหน้า ครีมกันแดด และเจล',
    'tube',
    null,
    500,
    { material: 'PE', colour: 'ขาว', cap_type: 'ฝาเกลียว' },
    { capacityMl: 50 },
  ),
  sku(
    'TUBE-100',
    'หลอดบีบ PE 100 มล. ฝาฟลิปท็อป',
    'PE squeeze tube 100 ml, flip-top cap',
    'สำหรับครีมอาบน้ำ ครีมนวดผม และเจลว่านหางจระเข้',
    'tube',
    null,
    500,
    { material: 'PE', colour: 'ขาว', cap_type: 'ฝาฟลิปท็อป' },
    { capacityMl: 100 },
  ),
  // Cups, lids, straws
  sku(
    'CUP-4OZ',
    'แก้วกระดาษ 4 ออนซ์ (แก้วชิม)',
    'Paper cup 4 oz (sample cup)',
    'แก้วเล็กสำหรับชิมเครื่องดื่มและใส่ซอส',
    'piece',
    4,
    1000,
    { material: 'กระดาษเคลือบ PE', colour: 'ขาว', size_text: '4 ออนซ์' },
    { capacityMl: 120, ...food },
  ),
  sku(
    'CUP-12OZ',
    'แก้วกระดาษ 12 ออนซ์ (เครื่องดื่มร้อน)',
    'Paper cup 12 oz (hot drinks)',
    'ใช้กับฝายกดื่มปาก 90 มม.',
    'piece',
    11,
    1000,
    { material: 'กระดาษเคลือบ PE', colour: 'ขาว', size_text: '12 ออนซ์' },
    { capacityMl: 360, ...food },
  ),
  sku(
    'CUP-22OZ',
    'แก้วกระดาษ 22 ออนซ์ (เครื่องดื่มเย็น)',
    'Paper cup 22 oz (cold drinks)',
    'เคลือบ PE สองด้าน ไม่เปียกเหงื่อ',
    'piece',
    17,
    1000,
    { material: 'กระดาษเคลือบ PE', colour: 'ขาว', size_text: '22 ออนซ์' },
    { capacityMl: 650, ...food },
  ),
  sku(
    'PET-CUP-16OZ',
    'แก้ว PET 16 ออนซ์ ปาก 95 มม.',
    'PET cup 16 oz, 95 mm rim',
    'แก้วใสสำหรับกาแฟเย็นและชานม',
    'piece',
    12,
    1000,
    { material: 'PET', colour: 'ใส', size_text: '16 ออนซ์' },
    { capacityMl: 480, ...food },
  ),
  sku(
    'PET-CUP-22OZ',
    'แก้ว PET 22 ออนซ์ ปาก 95 มม.',
    'PET cup 22 oz, 95 mm rim',
    'แก้วใสขนาดใหญ่สำหรับชาไข่มุกและสมูทตี้',
    'piece',
    16,
    1000,
    { material: 'PET', colour: 'ใส', size_text: '22 ออนซ์' },
    { capacityMl: 650, ...food },
  ),
  sku(
    'PET-UCUP-16OZ',
    'แก้วทรงยู PET 16 ออนซ์',
    'U-shape PET cup 16 oz',
    'ทรงยูโชว์เลเยอร์เครื่องดื่ม',
    'piece',
    13,
    1000,
    { material: 'PET', colour: 'ใส', shape: 'ทรงยู', size_text: '16 ออนซ์' },
    { capacityMl: 480, ...food },
  ),
  sku(
    'LID-DOME-95',
    'ฝาโดม PET ปาก 95 มม. (มีรู)',
    'PET dome lid 95 mm with hole',
    'ใช้กับแก้ว PET 16 / 22 ออนซ์ สำหรับเมนูท็อปปิ้งวิปครีม',
    'piece',
    4,
    1000,
    { material: 'PET', colour: 'ใส' },
    food,
  ),
  sku(
    'LID-FLAT-95',
    'ฝาเรียบ PET ปาก 95 มม.',
    'PET flat lid 95 mm',
    'ใช้กับแก้ว PET 16 / 22 ออนซ์',
    'piece',
    3,
    1000,
    { material: 'PET', colour: 'ใส' },
    food,
  ),
  sku(
    'LID-SIP-90',
    'ฝายกดื่ม PS ปาก 90 มม. สีดำ',
    'PS sip lid 90 mm, black',
    'สำหรับแก้วกระดาษเครื่องดื่มร้อน 12 ออนซ์',
    'piece',
    3,
    1000,
    { material: 'PS', colour: 'ดำ' },
    food,
  ),
  sku(
    'STRAW-PAPER-6',
    'หลอดกระดาษ 6 มม. ห่อซองกระดาษ',
    'Paper straw 6 mm, paper-wrapped',
    'หลอดกระดาษย่อยสลายได้ สำหรับเครื่องดื่มทั่วไป',
    'piece',
    1,
    2000,
    { material: 'กระดาษ', colour: 'ขาว' },
    food,
  ),
  // Food containers
  sku(
    'KRAFT-BOX-500',
    'กล่องอาหารกระดาษคราฟท์ 500 มล.',
    'Kraft food box 500 ml',
    'กล่องข้าวขนาดเล็กสำหรับของทานเล่นและสลัด',
    'piece',
    15,
    500,
    { material: 'กระดาษคราฟท์เคลือบ PE', colour: 'น้ำตาล' },
    { capacityMl: 500, ...food },
  ),
  sku(
    'KRAFT-BOX-1400',
    'กล่องอาหารกระดาษคราฟท์ 1,400 มล.',
    'Kraft food box 1,400 ml',
    'สำหรับข้าวกล่องจัมโบ้และอาหารชุด',
    'piece',
    30,
    500,
    { material: 'กระดาษคราฟท์เคลือบ PE', colour: 'น้ำตาล' },
    { capacityMl: 1400, ...food },
  ),
  sku(
    'PAPER-BOWL-520',
    'ชามกระดาษ 520 มล. พร้อมฝา',
    'Paper bowl 520 ml with lid',
    'สำหรับก๋วยเตี๋ยว ซุป และข้าวต้ม',
    'piece',
    14,
    500,
    { material: 'กระดาษเคลือบ PE', colour: 'ขาว' },
    { capacityMl: 520, ...food },
  ),
  sku(
    'PAPER-BOWL-750',
    'ชามกระดาษ 750 มล. พร้อมฝา',
    'Paper bowl 750 ml with lid',
    'ชามใหญ่สำหรับสลัดและราเมง',
    'piece',
    18,
    500,
    { material: 'กระดาษเคลือบ PE', colour: 'ขาว' },
    { capacityMl: 750, ...food },
  ),
  sku(
    'BAGASSE-BOX-600',
    'กล่องชานอ้อย 600 มล. ฝาพับ',
    'Bagasse clamshell box 600 ml',
    'วัสดุธรรมชาติย่อยสลายได้ เข้าไมโครเวฟได้',
    'piece',
    20,
    500,
    { material: 'ชานอ้อย', colour: 'ขาวธรรมชาติ' },
    { capacityMl: 600, ...food },
  ),
  sku(
    'BAGASSE-PLATE-9',
    'จานชานอ้อย 9 นิ้ว',
    'Bagasse plate 9 inch',
    'จานกลมสำหรับงานเลี้ยงและร้านอาหาร',
    'piece',
    15,
    500,
    { material: 'ชานอ้อย', colour: 'ขาวธรรมชาติ', shape: 'กลม' },
    food,
  ),
  sku(
    'PP-BENTO-2',
    'กล่องข้าว PP 2 ช่อง พร้อมฝา',
    'PP bento box 2 compartments with lid',
    'สีดำฝาใส เข้าไมโครเวฟได้',
    'piece',
    30,
    500,
    { material: 'PP', colour: 'ดำ / ฝาใส' },
    { capacityMl: 800, ...food },
  ),
  sku(
    'PET-BAKERY-S',
    'กล่องเบเกอรี่ PET ใส ฝาล็อก (ครัวซองต์)',
    'Clear PET bakery box, snap lid',
    'กล่องใสฝาล็อกสำหรับครัวซองต์ เค้กชิ้น และขนมไทย',
    'piece',
    14,
    500,
    { material: 'PET', colour: 'ใส' },
    food,
  ),
  sku(
    'CAKE-BOX-1LB',
    'กล่องเค้ก 1 ปอนด์ พร้อมฐาน',
    'Cake box 1 lb with base',
    'กล่องกระดาษสีขาวพร้อมฐานรองเค้ก',
    'piece',
    80,
    100,
    { material: 'กระดาษไอวอรี่', colour: 'ขาว' },
    food,
  ),
  sku(
    'SNACK-BOX-WIN',
    'กล่องขนมมีหน้าต่าง 10×10×5 ซม.',
    'Snack box with window 10×10×5 cm',
    'กล่องคราฟท์หน้าต่างใสสำหรับคุกกี้และมาการอง',
    'piece',
    12,
    500,
    { material: 'กระดาษคราฟท์', colour: 'น้ำตาล' },
    { size: [100, 100, 50], ...food },
  ),
  // Paper bags
  sku(
    'KRAFT-BAG-L',
    'ถุงกระดาษคราฟท์หูเกลียว L (32×17×44 ซม.)',
    'Kraft bag with twisted handles L (32×17×44 cm)',
    'ถุงใหญ่สำหรับเสื้อผ้าและของขวัญ',
    'piece',
    110,
    300,
    { material: 'กระดาษคราฟท์', colour: 'น้ำตาล', size_text: 'L' },
    { size: [320, 170, 440] },
  ),
  sku(
    'WHITE-BAG-M',
    'ถุงกระดาษขาวหูเกลียว M (25×12×32 ซม.)',
    'White paper bag with twisted handles M',
    'ถุงสีขาวสำหรับร้านเครื่องสำอางและเบเกอรี่',
    'piece',
    75,
    300,
    { material: 'กระดาษคราฟท์ขาว', colour: 'ขาว', size_text: 'M' },
    { size: [250, 120, 320] },
  ),
  sku(
    'KRAFT-FLAT-M',
    'ถุงกระดาษคราฟท์ก้นแบน M (20×12×30 ซม.)',
    'Flat-bottom kraft bag M (20×12×30 cm)',
    'ถุงไม่มีหูสำหรับขนมปังและผลไม้',
    'piece',
    40,
    500,
    { material: 'กระดาษคราฟท์', colour: 'น้ำตาล', size_text: 'M' },
    { size: [200, 120, 300], ...food },
  ),
  // Plastic bags and zip pouches
  sku(
    'TSHIRT-9X18',
    'ถุงหิ้ว HDPE 9×18 นิ้ว (ถุงก๊อบแก๊บ)',
    'HDPE T-shirt bag 9×18 inch',
    'ถุงหิ้วสีขาวขุ่นสำหรับร้านค้าปลีก',
    'piece',
    4,
    1000,
    { material: 'HDPE', colour: 'ขาวขุ่น', size_text: '9×18 นิ้ว' },
  ),
  sku(
    'ZIP-CLEAR-5X7',
    'ซองซิปใส 5×7 ซม.',
    'Clear zip bag 5×7 cm',
    'สำหรับเครื่องประดับ กระดุม และอะไหล่ชิ้นเล็ก',
    'pouch',
    null,
    1000,
    { material: 'LDPE', colour: 'ใส', size_text: '5×7 ซม.' },
    { size: [70, 50, 0] },
  ),
  sku(
    'ZIP-CLEAR-15X22',
    'ซองซิปใส 15×22 ซม.',
    'Clear zip bag 15×22 cm',
    'สำหรับเอกสาร เสื้อผ้าเด็ก และขนม',
    'pouch',
    null,
    500,
    { material: 'LDPE', colour: 'ใส', size_text: '15×22 ซม.' },
    { size: [220, 150, 0], ...food },
  ),
  sku(
    'ZIP-FOIL-10X15',
    'ซองฟอยล์ซิปล็อก ตั้งได้ 10×15 ซม.',
    'Foil stand-up zip pouch 10×15 cm',
    'สำหรับชา ผงชง และขนมชิ้นเล็ก',
    'pouch',
    null,
    500,
    { material: 'PET/AL/LLDPE', colour: 'เงิน', size_text: '10×15 ซม.' },
    { size: [150, 100, 0], ...food },
  ),
  sku(
    'ZIP-FOIL-15X22',
    'ซองฟอยล์ซิปล็อก ตั้งได้ 15×22 ซม.',
    'Foil stand-up zip pouch 15×22 cm',
    'สำหรับเมล็ดกาแฟ 250 กรัม และขนมอบกรอบ',
    'pouch',
    null,
    500,
    { material: 'PET/AL/LLDPE', colour: 'เงิน', size_text: '15×22 ซม.' },
    { size: [220, 150, 0], ...food },
  ),
  sku(
    'ZIP-KRAFT-WIN-14X20',
    'ซองคราฟท์ตั้งได้ มีหน้าต่าง 14×20 ซม.',
    'Kraft stand-up zip pouch with window 14×20 cm',
    'เห็นสินค้าด้านใน สำหรับธัญพืชและผลไม้อบแห้ง',
    'pouch',
    null,
    500,
    { material: 'กระดาษคราฟท์/PET/LLDPE', colour: 'น้ำตาล', size_text: '14×20 ซม.' },
    { size: [200, 140, 0], ...food },
  ),
  sku(
    'OPP-ADH-10X15',
    'ซอง OPP แถบกาว 10×15 ซม.',
    'OPP bag with adhesive strip 10×15 cm',
    'ซองใสใส่การ์ด สติ๊กเกอร์ และขนมชิ้นเล็ก',
    'pouch',
    null,
    1000,
    { material: 'OPP', colour: 'ใส', size_text: '10×15 ซม.' },
    { size: [150, 100, 0] },
  ),
  sku(
    'VACUUM-20X30',
    'ถุงสุญญากาศ 20×30 ซม. (ลายนูน)',
    'Embossed vacuum bag 20×30 cm',
    'สำหรับเครื่องซีลสุญญากาศ ถนอมอาหารแช่แข็ง',
    'pouch',
    null,
    500,
    { material: 'PA/PE', colour: 'ใส', size_text: '20×30 ซม.' },
    { size: [300, 200, 0], ...food },
  ),
  // Mailers
  sku(
    'MAIL-BAG-17X30',
    'ซองไปรษณีย์พลาสติก 17×30 ซม. (สีขาว)',
    'Plastic mailing bag 17×30 cm (white)',
    'ซองเล็กสำหรับเครื่องประดับและเคสมือถือ',
    'pouch',
    null,
    500,
    { material: 'LDPE', colour: 'ขาว', size_text: '17×30 ซม.' },
    { size: [300, 170, 0] },
  ),
  sku(
    'MAIL-BAG-28X42',
    'ซองไปรษณีย์พลาสติก 28×42 ซม. (สีขาว)',
    'Plastic mailing bag 28×42 cm (white)',
    'สำหรับเสื้อยืดและกางเกง',
    'pouch',
    null,
    500,
    { material: 'LDPE', colour: 'ขาว', size_text: '28×42 ซม.' },
    { size: [420, 280, 0] },
  ),
  sku(
    'MAIL-BAG-38X52',
    'ซองไปรษณีย์พลาสติก 38×52 ซม. (สีขาว)',
    'Plastic mailing bag 38×52 cm (white)',
    'ขนาดใหญ่สำหรับผ้าห่มและเสื้อแจ็กเก็ต',
    'pouch',
    null,
    500,
    { material: 'LDPE', colour: 'ขาว', size_text: '38×52 ซม.' },
    { size: [520, 380, 0] },
  ),
  sku(
    'MAIL-BAG-BLACK-25X35',
    'ซองไปรษณีย์พลาสติก 25×35 ซม. (สีดำ)',
    'Plastic mailing bag 25×35 cm (black)',
    'ทึบแสง มองไม่เห็นสินค้าด้านใน',
    'pouch',
    null,
    500,
    { material: 'LDPE', colour: 'ดำ', size_text: '25×35 ซม.' },
    { size: [350, 250, 0] },
  ),
  sku(
    'BUBBLE-MAILER-13X18',
    'ซองบับเบิ้ลกันกระแทก 13×18 ซม.',
    'Bubble mailer 13×18 cm',
    'สำหรับลิปสติก ต่างหู และอุปกรณ์ไอทีชิ้นเล็ก',
    'pouch',
    null,
    500,
    { material: 'กระดาษคราฟท์ + บับเบิ้ล PE', colour: 'น้ำตาล', size_text: '13×18 ซม.' },
    { size: [180, 130, 0] },
  ),
  sku(
    'BUBBLE-MAILER-22X27',
    'ซองบับเบิ้ลกันกระแทก 22×27 ซม.',
    'Bubble mailer 22×27 cm',
    'สำหรับหนังสือเล่มเล็กและเครื่องสำอางเซ็ต',
    'pouch',
    null,
    500,
    { material: 'กระดาษคราฟท์ + บับเบิ้ล PE', colour: 'น้ำตาล', size_text: '22×27 ซม.' },
    { size: [270, 220, 0] },
  ),
  sku(
    'KRAFT-MAILER-A4',
    'ซองเอกสารคราฟท์ A4 แถบกาว',
    'Kraft document envelope A4, self-seal',
    'สำหรับส่งเอกสาร ใบรับรอง และโปสเตอร์พับ',
    'pouch',
    null,
    500,
    { material: 'กระดาษคราฟท์', colour: 'น้ำตาล', size_text: 'A4' },
    { size: [324, 229, 0] },
  ),
  // Packing supplies
  sku(
    'OPP-TAPE-CLEAR',
    'เทป OPP ใส 2 นิ้ว × 100 หลา',
    'Clear OPP tape 2 in × 100 yd',
    'เทปปิดกล่องเนื้อเหนียว ขายเป็นแพ็ก 6 ม้วน',
    'piece',
    280,
    6,
    { material: 'OPP', colour: 'ใส', size_text: '2 นิ้ว × 100 หลา' },
  ),
  sku(
    'OPP-TAPE-BROWN',
    'เทป OPP สีน้ำตาล 2 นิ้ว × 100 หลา',
    'Brown OPP tape 2 in × 100 yd',
    'เทปปิดกล่องสีน้ำตาลเข้ากับกล่องลูกฟูก ขายเป็นแพ็ก 6 ม้วน',
    'piece',
    280,
    6,
    { material: 'OPP', colour: 'น้ำตาล', size_text: '2 นิ้ว × 100 หลา' },
  ),
  sku(
    'FRAGILE-TAPE',
    'เทประวังแตก 2 นิ้ว × 45 หลา',
    'Fragile warning tape 2 in × 45 yd',
    'พื้นแดงพิมพ์ "ระวังแตก" สำหรับสินค้าเปราะบาง',
    'piece',
    180,
    6,
    { material: 'OPP', colour: 'แดง', size_text: '2 นิ้ว × 45 หลา' },
  ),
  sku(
    'BUBBLE-ROLL-65',
    'บับเบิ้ลกันกระแทก 65 ซม. × 100 ม.',
    'Bubble wrap 65 cm × 100 m',
    'ม้วนบับเบิ้ลเม็ดกลางสำหรับห่อสินค้าแตกง่าย',
    'piece',
    3500,
    1,
    { material: 'PE', colour: 'ใส', size_text: '65 ซม. × 100 ม.' },
    { onHand: 0 },
  ),
  sku(
    'STRETCH-FILM-50',
    'ฟิล์มยืดพันพาเลท 50 ซม. × 300 ม.',
    'Stretch film 50 cm × 300 m',
    'ฟิล์มพันพาเลทและมัดกล่องรวม',
    'piece',
    2600,
    1,
    { material: 'LLDPE', colour: 'ใส', size_text: '50 ซม. × 300 ม.' },
  ),
  sku(
    'PAPER-SHRED-1KG',
    'กระดาษฝอยกันกระแทก 1 กก. (สีน้ำตาล)',
    'Shredded paper filler 1 kg (brown)',
    'รองกล่องของขวัญและกันกระแทกแบบรักษ์โลก',
    'piece',
    1000,
    1,
    { material: 'กระดาษคราฟท์', colour: 'น้ำตาล' },
  ),
  sku(
    'AIR-COLUMN-20',
    'ถุงลมกันกระแทกสำหรับขวด (Air column) 20 ซม.',
    'Air-column bottle protector 20 cm',
    'ถุงลมหุ้มขวดไวน์ ขวดแก้ว และเครื่องสำอาง',
    'pouch',
    null,
    100,
    { material: 'PA/PE', colour: 'ใส', size_text: '20 ซม.' },
  ),
];

/**
 * Stock products. Their rehearsal buy prices copy the dev bottle's fake tiers scaled by weight (pieces with a
 * weight) or the dev stock pouch's tiers (sold by the pouch or the tube) — see `uat-catalog.ts`.
 */
export const UAT_STOCK_PRODUCTS: readonly StockSeed[] = [...FIRST_STOCK_PRODUCTS, ...READY_STOCK_PRODUCTS];

/** The store category (`type` attribute) of a SKU. */
export function stockTypeOf(sku: string): string {
  return UAT_STOCK_TYPES.find(([prefix]) => sku.startsWith(prefix))?.[1] ?? 'บรรจุภัณฑ์พร้อมส่งอื่น ๆ';
}

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
        a: 'ใบเสนอราคามีอายุ 15 วัน และล็อกราคาตลอดช่วงนั้น เมื่อหมดอายุระบบจะคำนวณราคาใหม่ให้',
      },
      {
        q: 'สินค้าที่ไม่มีราคาทันทีสั่งได้อย่างไร',
        a: 'กดขอใบเสนอราคา (RFQ) พร้อมแนบขนาด จำนวน และไฟล์อ้างอิง ทีมงานจะเสนอราคาภายในเวลาที่แจ้งบนหน้าสินค้า',
      },
      {
        q: 'จำนวนที่ได้รับอาจคลาดเคลื่อนได้เท่าไร',
        a: 'งานผลิตตามสั่งมีค่าคลาดเคลื่อนจำนวน ±5% หากได้รับน้อยกว่าที่สั่งภายในเกณฑ์จะคืนเงินตามสัดส่วน ส่วนที่เกินไม่มีค่าใช้จ่ายเพิ่ม',
      },
    ],
  },
  {
    category: { code: 'uat_artwork', nameTh: 'ไฟล์งานและการตรวจแบบก่อนพิมพ์', nameEn: 'Artwork & proofs' },
    items: [
      {
        q: 'ไฟล์งานต้องเตรียมอย่างไร',
        a: 'ส่งไฟล์ PDF ตามแบบไดคัทพร้อมระยะตัดตก ระบบจะไม่รับไฟล์ที่ขนาดไม่ตรงหรือไม่มีระยะตัดตก และจะเตือนเมื่อความละเอียดต่ำหรือเป็นโหมดสี RGB',
      },
      {
        q: 'เริ่มผลิตเมื่อไร',
        a: 'ระบบเริ่มผลิตอัตโนมัติเมื่อคุณอนุมัติแบบตัวอย่าง และชำระงวดที่ต้องชำระก่อนผลิตครบแล้ว',
      },
      {
        q: 'จ้างออกแบบแก้ไขได้กี่ครั้ง',
        a: 'แก้ไขฟรี 3 ครั้ง ตั้งแต่ครั้งที่ 4 มีค่าบริการครั้งละ 500 บาท หรือ 20% ของค่าออกแบบแล้วแต่จำนวนใดสูงกว่า',
      },
    ],
  },
  {
    category: { code: 'uat_payment', nameTh: 'การชำระเงิน', nameEn: 'Payment' },
    items: [
      {
        q: 'ชำระเงินได้ช่องทางใดบ้าง',
        a: 'สแกน QR พร้อมเพย์ บัตรเครดิต / เดบิต หรือโอนเงินแล้วแนบสลิป ระบบตรวจสลิปให้อัตโนมัติ',
      },
      {
        q: 'ต้องชำระเต็มจำนวนหรือไม่',
        a: 'คำสั่งซื้อต่ำกว่า 20,000 บาทชำระเต็มจำนวน ตั้งแต่ 20,000 บาทขึ้นไปชำระมัดจำ 50% และส่วนที่เหลือก่อนจัดส่ง',
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
        a: 'แจ้งเคลมได้ภายใน 7 วันหลังได้รับสินค้า พร้อมรูปสินค้าและรูปกล่องขนส่ง ทีมงานตอบกลับภายใน 1 วันทำการ',
      },
      {
        q: 'ถ้าไม่กดยืนยันรับสินค้าจะเป็นอย่างไร',
        a: 'ระบบยืนยันรับสินค้าให้อัตโนมัติ 7 วันหลังจัดส่งถึง',
      },
    ],
  },
];

/**
 * Placeholder consent texts so the rehearsal can grant and withdraw consents (D-005, D-144). Obviously fake: the
 * real texts are legal content that counsel publishes through `admin.consentPurposes.publishText`.
 */
export const UAT_CONSENT_TEXT = {
  textTh: '[UAT] ข้อความทดสอบสำหรับซ้อม UAT เท่านั้น ไม่ใช่ข้อความทางกฎหมาย (ข้อมูลปลอม)',
  textEn: '[UAT] Rehearsal placeholder only, not a legal text (fake data)',
  reason: 'UAT rehearsal seed (fake text, replaced by legal counsel)',
} as const;
