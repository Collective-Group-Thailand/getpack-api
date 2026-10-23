import { type LabelledEnum, statusLabel } from '@common/labels/status-labels';

/**
 * Timeline entries in words (UX round 2 Phase 4 §A6 B13, D-313): each activity action and shipment step has its own
 * sentence for the customer — Proof wording from the glossary, never a factory (D-050) — so the timeline no longer
 * falls back to one generic "the order was updated" line. Unknown actions fall back per domain, never to the raw key.
 */
export interface ActivityMessage {
  th: string;
  en: string;
}

type Params = Record<string, unknown>;
type Render = (p: Params) => ActivityMessage;

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const fixed =
  (th: string, en: string): Render =>
  () => ({ th, en });
const status =
  (enumName: LabelledEnum, thPrefix: string, enPrefix: string): Render =>
  (p) => {
    const l = statusLabel(enumName, str(p['to']));
    return { th: `${thPrefix}: ${l.th}`, en: `${enPrefix}: ${l.en}` };
  };
const instalment =
  (th: string, en: string): Render =>
  (p) => {
    const seq = str(p['seq']);
    return seq ? { th: `${th} งวดที่ ${seq}`, en: `${en} — instalment ${seq}` } : { th, en };
  };

const document =
  (th: string, en: string): Render =>
  (p) => {
    const no = str(p['docNumber']);
    return no ? { th: `${th} ${no}`, en: `Document ${no} ${en}` } : { th, en: `Document ${en}` };
  };

const MESSAGES: Record<string, Render> = {
  // Order and group
  'order_group.placed': fixed('สั่งซื้อเรียบร้อย', 'Order placed'),
  'order.placed': fixed('สร้างรายการสั่งผลิต', 'Order item created'),
  'order.status_changed': status('OrderStatus', 'สถานะรายการ', 'Item status'),
  'order_group.status_changed': status('OrderGroupStatus', 'สถานะคำสั่งซื้อ', 'Order status'),
  'order_group.company_approval_requested': fixed(
    'ส่งคำขออนุมัติถึงผู้อนุมัติของบริษัท',
    'Sent for company approval',
  ),
  'order_group.company_approved': fixed('ผู้อนุมัติของบริษัทอนุมัติแล้ว', 'Approved by your company'),
  'order_group.company_rejected': fixed('ผู้อนุมัติของบริษัทไม่อนุมัติ', 'Not approved by your company'),
  'order_group.cancelled': fixed('ยกเลิกคำสั่งซื้อ', 'Order cancelled'),
  'order_group.expired': fixed('คำสั่งซื้อหมดอายุเพราะยังไม่ชำระเงิน', 'Order expired unpaid'),
  'order.cancelled': fixed('ยกเลิกรายการสั่งผลิต', 'Order item cancelled'),
  'order.charge_added': fixed('เพิ่มค่าใช้จ่ายในคำสั่งซื้อ', 'Charge added to the order'),
  'order.repriced': fixed('ปรับราคาคำสั่งซื้อ', 'Order repriced'),
  'order.tracking_link_created': fixed('สร้างลิงก์ติดตามพัสดุ', 'Tracking link created'),
  'order.spec_sheet_generated': fixed('จัดทำใบสเปกงานผลิต', 'Specification sheet ready'),
  // Payment
  'payment_schedule.created': fixed('กำหนดงวดชำระเงิน', 'Payment schedule set'),
  'payment_schedule.rebalanced': fixed('ปรับยอดงวดชำระเงิน', 'Payment schedule updated'),
  'payment_schedule.overridden': fixed('ปรับงวดชำระเงิน', 'Payment schedule changed'),
  'payment_schedule.overpaid': fixed('ชำระเกินยอดที่ต้องชำระ', 'Paid more than due'),
  'instalment.due': instalment('ถึงกำหนดชำระ', 'Payment due'),
  'instalment.paid': instalment('ชำระเงินแล้ว', 'Paid'),
  'instalment.overdue': instalment('เกินกำหนดชำระ', 'Overdue'),
  'instalment.reminder': instalment('แจ้งเตือนการชำระเงิน', 'Payment reminder'),
  'payment.initiated': fixed('เริ่มชำระเงิน', 'Payment started'),
  'payment.received': fixed('ได้รับเงินแล้ว', 'Payment received'),
  'payment.verified': fixed('ตรวจสอบการชำระเงินแล้ว', 'Payment verified'),
  'payment.allocated': fixed('บันทึกยอดชำระเข้าคำสั่งซื้อ', 'Payment applied'),
  'payment.expired': fixed('หมดเวลาชำระเงินรายการนี้', 'Payment attempt expired'),
  'payment.failed': fixed('ชำระเงินไม่สำเร็จ', 'Payment failed'),
  'payment.overpaid': fixed('ชำระเกินยอดที่ต้องชำระ', 'Paid more than due'),
  'payment.slip_uploaded': fixed('ได้รับสลิปโอนเงิน', 'Transfer slip received'),
  'payment.slip_review_required': fixed('เจ้าหน้าที่กำลังตรวจสอบสลิป', 'Slip under review'),
  'payment.slip_rejected': fixed('สลิปไม่ผ่านการตรวจสอบ', 'Slip not accepted'),
  'payment.refund_required': fixed('รอคืนเงิน', 'Refund due'),
  'refund.requested': fixed('ขอคืนเงิน', 'Refund requested'),
  'refund.approved': fixed('อนุมัติคืนเงิน', 'Refund approved'),
  'refund.rejected': fixed('ไม่อนุมัติคืนเงิน', 'Refund rejected'),
  'refund.succeeded': fixed('คืนเงินสำเร็จ', 'Refunded'),
  'refund.failed': fixed('คืนเงินไม่สำเร็จ', 'Refund failed'),
  'customer_document.issued': document('ออกเอกสาร', 'issued'),
  'customer_document.voided': document('ยกเลิกเอกสาร', 'voided'),
  'customer_document.debit_note_issued': fixed('ออกใบเพิ่มหนี้', 'Debit note issued'),
  'customer_document.replaced': document('ออกใบกำกับภาษีฉบับใหม่แทน', 'replaced by a corrected one'),
  'customer_document.correction_requested': document('ขอแก้ไขข้อมูลผู้ซื้อในเอกสาร', 'correction requested'),
  'customer_document.correction_rejected': document('ไม่อนุมัติการแก้ไขเอกสาร', 'correction declined'),
  // Artwork and proof (glossary: แบบตัวอย่าง / ตรวจแบบก่อนพิมพ์)
  'artwork.submitted': fixed('ได้รับไฟล์งานแล้ว', 'Artwork received'),
  'artwork.preflight_completed': fixed('ตรวจไฟล์อัตโนมัติเสร็จแล้ว', 'Automatic file check done'),
  'artwork.accepted_for_proof': fixed(
    'ไฟล์ผ่านการตรวจ กำลังทำแบบตัวอย่าง',
    'File accepted, preparing your proof',
  ),
  'artwork.rejected': fixed('ไฟล์ต้องแก้ไขก่อนพิมพ์', 'File needs changes before printing'),
  'artwork.reused': fixed('ใช้ไฟล์งานจากคำสั่งซื้อเดิม', 'Artwork reused from a previous order'),
  'proof.sent': fixed('แบบตัวอย่างพร้อมให้ตรวจ', 'Your proof is ready to check'),
  'proof.approved': fixed('อนุมัติแบบตัวอย่างแล้ว', 'Proof approved'),
  'proof.approved_on_behalf': fixed(
    'เจ้าหน้าที่บันทึกการอนุมัติแบบตัวอย่างแทนคุณ',
    'Proof approved on your behalf',
  ),
  'proof.changes_requested': fixed('ขอแก้ไขแบบตัวอย่าง', 'Changes to the proof requested'),
  'proof.changes_requested_on_behalf': fixed(
    'เจ้าหน้าที่บันทึกคำขอแก้ไขแบบตัวอย่างแทนคุณ',
    'Proof changes requested on your behalf',
  ),
  'proof.annotated': fixed('เพิ่มความเห็นบนแบบตัวอย่าง', 'Comment added to the proof'),
  // Production (no factory, D-050)
  'production.queued': fixed('เข้าคิวผลิตแล้ว', 'Queued for production'),
  'production.milestone_reached': (p) => ({
    th: str(p['labelTh']) || 'ความคืบหน้าการผลิต',
    en: str(p['labelEn']) || 'Production progress',
  }),
  // Delivery, claims, reviews
  'delivery.reconciled': fixed('สรุปจำนวนที่ได้รับแล้ว', 'Delivered quantity confirmed'),
  'claim.submitted': fixed('แจ้งเคลมแล้ว', 'Claim submitted'),
  'claim.under_review': fixed('กำลังพิจารณาเคลม', 'Claim under review'),
  'claim.info_requested': fixed('ขอหลักฐานเพิ่มเติมสำหรับเคลม', 'More information needed for the claim'),
  'claim.info_provided': fixed('ส่งหลักฐานเพิ่มเติมแล้ว', 'Information provided'),
  'claim.approved': fixed('อนุมัติเคลม', 'Claim approved'),
  'claim.rejected': fixed('ไม่อนุมัติเคลม', 'Claim rejected'),
  'claim.resolved': fixed('ดำเนินการเคลมเรียบร้อย', 'Claim resolved'),
  'claim.closed': fixed('ปิดเรื่องเคลม', 'Claim closed'),
  'review.submitted': fixed('ส่งรีวิวแล้ว', 'Review submitted'),
};

/** Last resort per domain — still words, never the raw key. */
const FALLBACK: [prefix: string, message: ActivityMessage][] = [
  ['payment', { th: 'อัปเดตการชำระเงิน', en: 'Payment update' }],
  ['instalment', { th: 'อัปเดตการชำระเงิน', en: 'Payment update' }],
  ['refund', { th: 'อัปเดตการคืนเงิน', en: 'Refund update' }],
  ['customer_document', { th: 'อัปเดตเอกสาร', en: 'Document update' }],
  ['artwork', { th: 'อัปเดตไฟล์งาน', en: 'Artwork update' }],
  ['proof', { th: 'อัปเดตแบบตัวอย่าง', en: 'Proof update' }],
  ['production', { th: 'อัปเดตการผลิต', en: 'Production update' }],
  ['delivery', { th: 'อัปเดตการจัดส่ง', en: 'Delivery update' }],
  ['claim', { th: 'อัปเดตเคลม', en: 'Claim update' }],
  ['review', { th: 'อัปเดตรีวิว', en: 'Review update' }],
];
const ORDER_FALLBACK: ActivityMessage = { th: 'อัปเดตคำสั่งซื้อ', en: 'Order update' };

/** Whether an action has a sentence of its own (tests: every customer-visible action must). */
export function hasActivityMessage(type: string): boolean {
  return type in MESSAGES || type.startsWith('shipment.');
}

/** The entry's words: its own sentence, a shipment step, or the domain fallback. */
export function activityMessage(type: string, params: Params): ActivityMessage {
  const render = MESSAGES[type];
  if (render) return render(params);
  if (type.startsWith('shipment.')) {
    const l = statusLabel('ShipmentStatus', type.slice('shipment.'.length));
    return { th: `การจัดส่ง: ${l.th}`, en: `Delivery: ${l.en}` };
  }
  return FALLBACK.find(([prefix]) => type.startsWith(`${prefix}.`))?.[1] ?? ORDER_FALLBACK;
}
