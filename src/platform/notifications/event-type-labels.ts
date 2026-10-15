/**
 * What a notification is about, in words, for the inbox chip (UX round 2 Phase 4 §A6 B2, D-313): one label per
 * event domain; the title and body carry the details. Customer wording follows the glossary ("แบบตัวอย่าง").
 */
const DOMAINS: Record<string, { th: string; en: string }> = {
  approval: { th: 'คำขออนุมัติ', en: 'Approval' },
  artwork: { th: 'ไฟล์งาน', en: 'Artwork' },
  proof: { th: 'แบบตัวอย่าง', en: 'Proof' },
  design: { th: 'งานออกแบบ', en: 'Design' },
  design_service: { th: 'บริการออกแบบ', en: 'Design service' },
  order_group: { th: 'คำสั่งซื้อ', en: 'Order' },
  order: { th: 'คำสั่งซื้อ', en: 'Order' },
  instalment: { th: 'การชำระเงิน', en: 'Payment' },
  payment: { th: 'การชำระเงิน', en: 'Payment' },
  refund: { th: 'การคืนเงิน', en: 'Refund' },
  customer_document: { th: 'เอกสาร', en: 'Document' },
  points: { th: 'คะแนนสะสม', en: 'Points' },
  production: { th: 'การผลิต', en: 'Production' },
  production_job: { th: 'งานผลิต', en: 'Production job' },
  shipment: { th: 'การจัดส่ง', en: 'Delivery' },
  claim: { th: 'เคลม', en: 'Claim' },
  rfq: { th: 'ขอใบเสนอราคา', en: 'Quote request' },
  call_off: { th: 'สัญญาเรียกส่ง', en: 'Call-off' },
  reorder: { th: 'สั่งซ้ำ', en: 'Reorder' },
  conversation: { th: 'ข้อความ', en: 'Message' },
  company: { th: 'บัญชีบริษัท', en: 'Company account' },
  factory: { th: 'โรงงานพาร์ตเนอร์', en: 'Partner factory' },
  factory_change_request: { th: 'คำขอแก้ไขข้อมูลโรงงาน', en: 'Factory change request' },
  price_proposal: { th: 'ข้อเสนอราคา', en: 'Price proposal' },
  structural_request: { th: 'คำขอแบบโครงสร้าง', en: 'Structural request' },
  style_intake: { th: 'คำขอเพิ่มแบบกล่อง', en: 'Style request' },
  ops: { th: 'การแจ้งเตือนระบบ', en: 'Operations alert' },
  report_run: { th: 'รายงาน', en: 'Report' },
  erp_alert: { th: 'ระบบโรงงาน', en: 'Factory ERP' },
  erp_daily: { th: 'สรุปโรงงานประจำวัน', en: 'Factory daily summary' },
  sales_agent_application: { th: 'สมัครตัวแทนขาย', en: 'Agent application' },
  sales_agent_lead: { th: 'ผู้มุ่งหวัง', en: 'Lead' },
  sales_agent_statement: { th: 'ค่าตอบแทนตัวแทน', en: 'Agent commission' },
};
const OTHER = { th: 'การแจ้งเตือน', en: 'Notification' };

export function hasEventTypeLabel(eventType: string): boolean {
  return eventType.slice(0, eventType.indexOf('.')) in DOMAINS;
}

/** `eventTypeLabelTh` / `eventTypeLabelEn` of an inbox item. */
export function eventTypeLabels(eventType: string): { eventTypeLabelTh: string; eventTypeLabelEn: string } {
  const l = DOMAINS[eventType.slice(0, eventType.indexOf('.'))] ?? OTHER;
  return { eventTypeLabelTh: l.th, eventTypeLabelEn: l.en };
}
