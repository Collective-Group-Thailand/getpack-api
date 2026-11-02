/**
 * The sales agent programme's reference data (D-416 – D-421): the two starting commission plans and the
 * agent agreement, version 1. Figures are proposals for the business to confirm (D-418); the agreement
 * text is the standard version Sales publishes new versions of from the privacy desk.
 */

export interface AgentPlanSeed {
  code: string;
  nameTh: string;
  nameEn: string;
  description: string;
  agentKind: 'freelance' | 'employee';
  version: {
    firstOrderPct: string;
    repeatOrderPct: string;
    attributionMonths: number;
    marginCapPct: string;
    minBaseAmount: string;
    factoryBountyAmount: string;
    factoryQualifyJobs: number;
    factoryQualifyDays: number;
  };
}

export const AGENT_PLANS: readonly AgentPlanSeed[] = [
  {
    code: 'freelance_standard',
    nameTh: 'ตัวแทนอิสระ — มาตรฐาน',
    nameEn: 'Freelance agent — standard',
    description: 'D-418 starting plan for freelance agents (proposed figures)',
    agentKind: 'freelance',
    version: {
      firstOrderPct: '5',
      repeatOrderPct: '3',
      attributionMonths: 12,
      marginCapPct: '30',
      minBaseAmount: '0.00',
      factoryBountyAmount: '0.00',
      factoryQualifyJobs: 0,
      factoryQualifyDays: 0,
    },
  },
  {
    code: 'employee_standard',
    nameTh: 'พนักงานขาย — มาตรฐาน',
    nameEn: 'Employee seller — standard',
    description: 'D-418 starting plan for Collective employees (proposed figures)',
    agentKind: 'employee',
    version: {
      firstOrderPct: '2',
      repeatOrderPct: '1',
      attributionMonths: 12,
      marginCapPct: '20',
      minBaseAmount: '0.00',
      factoryBountyAmount: '0.00',
      factoryQualifyJobs: 0,
      factoryQualifyDays: 0,
    },
  },
];

export const AGENT_AGREEMENT_KEY = 'sales_agent_agreement';

/** Version 1 of the agent agreement (D-416). */
export const AGENT_AGREEMENT_V1_TH = `ข้อตกลงตัวแทนขาย getpack (ฉบับที่ 1)

1. ฐานะของตัวแทน
ตัวแทนอิสระเป็นผู้ประกอบอาชีพอิสระ ไม่ใช่ลูกจ้างของบริษัท ไม่มีอำนาจทำสัญญา รับเงิน ให้ส่วนลด หรือให้คำมั่นใดๆ แทนบริษัท ราคา ส่วนลด ระยะเวลาผลิตและเงื่อนไขทั้งหมดเป็นไปตามที่ระบบ getpack แสดงหรือที่บริษัทยืนยันเป็นลายลักษณ์อักษรเท่านั้น

2. การผูกลูกค้ากับตัวแทน
ลูกค้าใหม่ที่สมัครหรือสั่งซื้อผ่านลิงก์หรือรหัสของตัวแทน หรือที่ตัวแทนลงทะเบียนเป็นผู้มุ่งหวังไว้ก่อน ถือเป็นลูกค้าของตัวแทนตามระยะเวลาในแผนค่าตอบแทน ลูกค้าหนึ่งรายหรือบริษัทหนึ่งแห่งมีตัวแทนได้ครั้งละหนึ่งคน ลูกค้าที่เคยสั่งซื้อแล้วไม่นับเป็นลูกค้าใหม่ การโอนลูกค้าระหว่างตัวแทนทำได้โดยบริษัทเท่านั้นและต้องมีเหตุผล

3. ผู้มุ่งหวัง
ผู้มุ่งหวังที่ลงทะเบียนได้รับความคุ้มครองตามระยะเวลาที่บริษัทกำหนด ตัวแทนต้องได้รับความยินยอมจากผู้มุ่งหวังก่อนให้ข้อมูลติดต่อแก่บริษัท และใช้ข้อมูลนั้นเพื่อการเสนอขาย getpack เท่านั้น ตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล

4. ค่าตอบแทน
ค่าตอบแทนคำนวณตามแผนที่บริษัทกำหนดจากยอดสินค้าก่อนภาษีมูลค่าเพิ่ม ไม่รวมค่าขนส่ง หลังหักส่วนลด ของคำสั่งซื้อที่เสร็จสมบูรณ์ พ้นระยะเคลม และชำระเงินครบแล้ว และไม่เกินสัดส่วนของกำไรที่แผนกำหนด กรณีคืนเงินหรือลดหนี้ ค่าตอบแทนจะถูกปรับลดตามส่วนในรอบถัดไป ค่าแนะนำโรงงานจ่ายเมื่อโรงงานเปิดใช้งานและผลิตงานครบตามเงื่อนไขของแผน บริษัทอาจเปลี่ยนแผนได้โดยมีผลกับคำสั่งซื้อที่เกิดหลังวันที่มีผล

5. การจ่ายเงินและภาษี
บริษัทสรุปค่าตอบแทนเป็นรายเดือนและโอนเข้าบัญชีธนาคารที่ผ่านการตรวจสอบในชื่อของตัวแทน โดยหักภาษี ณ ที่จ่ายตามกฎหมายและออกหนังสือรับรองการหักภาษี ณ ที่จ่ายให้ ตัวแทนรับผิดชอบภาษีเงินได้ของตนเอง

6. ข้อห้าม
ห้ามให้ข้อมูลเท็จหรือเกินจริง ห้ามสัญญาราคาหรือเงื่อนไขที่ระบบไม่ได้แสดง ห้ามรับเงินจากลูกค้า ห้ามส่งข้อความรบกวนหรือใช้ข้อมูลที่ไม่ได้รับความยินยอม ห้ามซื้อเพื่อตนเองหรือผ่านบัญชีที่เกี่ยวข้องเพื่อรับค่าตอบแทน และห้ามใช้ชื่อหรือเครื่องหมายของ getpack ในลักษณะที่ทำให้เข้าใจว่าเป็นบริษัท ค่าตอบแทนที่เกิดจากการกระทำดังกล่าวจะถูกระงับหรือเรียกคืน

7. การรักษาความลับ
ข้อมูลราคา ลูกค้า โรงงาน และข้อมูลภายในที่ได้รับจาก getpack เป็นความลับ ห้ามเปิดเผยหรือใช้เพื่อประโยชน์อื่น ทั้งระหว่างและหลังสิ้นสุดข้อตกลง

8. การระงับและการสิ้นสุด
บริษัทอาจระงับหรือยุติการเป็นตัวแทนได้เมื่อมีเหตุอันควร ตัวแทนยุติได้โดยแจ้งบริษัท ค่าตอบแทนที่เกิดขึ้นแล้วก่อนวันสิ้นสุดยังคงจ่ายตามเงื่อนไข เว้นแต่เกิดจากการผิดข้อตกลง

9. การเปลี่ยนแปลงข้อตกลง
บริษัทอาจออกข้อตกลงฉบับใหม่โดยแจ้งล่วงหน้าผ่านระบบ การใช้งานต่อหลังวันที่มีผลถือเป็นการยอมรับ`;

/** D-466: the CMS FAQ category the public landing reads (`store.agentProgramme.public`). */
export const AGENT_FAQ_CATEGORY = 'agent_programme';

/** Draft FAQ items for Marketing to review and publish (no figures: those come from the plan through the API). */
export const AGENT_FAQ_DRAFTS: readonly { questionTh: string; answerTh: string; questionEn: string; answerEn: string }[] = [
  {
    questionTh: 'ต้องมีประสบการณ์ขายบรรจุภัณฑ์ไหม',
    answerTh: 'ไม่จำเป็น ถ้าคุณรู้จักร้านค้าหรือธุรกิจที่ใช้กล่องและบรรจุภัณฑ์ คุณแนะนำ getpack ได้ ลูกค้าออกแบบ ดูราคา และสั่งผ่านระบบเอง',
    questionEn: 'Do I need packaging sales experience?',
    answerEn: 'No. If you know shops or businesses that use boxes and packaging, you can introduce getpack; customers design, price and order in the system themselves.',
  },
  {
    questionTh: 'ได้ค่าคอมจากอะไร',
    answerTh: 'จากยอดสินค้าก่อน VAT ไม่รวมค่าส่ง ของคำสั่งซื้อที่ลูกค้าที่ผูกกับคุณชำระแล้ว ทั้งออเดอร์แรกและออเดอร์ถัดไปตามระยะเวลาในแผน ไม่จำกัดรายได้',
    questionEn: 'What do I earn commission on?',
    answerEn: 'On the goods before VAT, excluding shipping, of paid orders from customers linked to you — first and later orders for the plan’s months, with no cap.',
  },
  {
    questionTh: 'ลูกค้าจะผูกกับฉันได้อย่างไร',
    answerTh: 'ลูกค้าใหม่ที่เปิดลิงก์หรือสแกน QR ของคุณแล้วสมัคร หรือผู้มุ่งหวังที่คุณลงทะเบียนไว้ก่อนแล้วสมัครด้วยเบอร์ อีเมล หรือเลขผู้เสียภาษีเดียวกัน',
    questionEn: 'How does a customer get linked to me?',
    answerEn: 'A new customer who opens your link or QR and signs up, or a lead you registered first who signs up with the same phone, e-mail or tax id.',
  },
  {
    questionTh: 'ได้รับเงินเมื่อไร',
    answerTh: 'ระบบสรุปค่าคอมทุกต้นเดือน ทีมบัญชีอนุมัติแล้วโอนเข้าบัญชีที่ตรวจแล้ว พร้อมหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)',
    questionEn: 'When am I paid?',
    answerEn: 'Commission is summarised at the start of each month; once Finance approves it, it is transferred to your verified account with a withholding tax certificate.',
  },
  {
    questionTh: 'ต้องส่งเอกสารอะไรบ้าง',
    answerTh: 'สมัครใช้แค่ชื่อ เบอร์ที่ยืนยันแล้ว และอีเมล ส่วนเลขประจำตัวผู้เสียภาษี ที่อยู่ สำเนาบัตร และบัญชีธนาคาร กรอกภายหลังก่อนรับเงินครั้งแรก',
    questionEn: 'What documents do I need?',
    answerEn: 'To apply, only your name, a verified phone and e-mail. Your tax id, address, ID copy and bank account come later, before your first payment.',
  },
  {
    questionTh: 'ต้องสต็อกสินค้าหรือตามงานผลิตเองไหม',
    answerTh: 'ไม่ต้อง getpack ดูแลการผลิต การจัดส่ง และบริการหลังการขายทั้งหมด คุณแนะนำลูกค้าและติดตามความคืบหน้าได้ในหน้าตัวแทน',
    questionEn: 'Do I hold stock or follow up on production?',
    answerEn: 'No. getpack handles production, delivery and after-sales service; you introduce customers and follow their progress on your agent pages.',
  },
];
