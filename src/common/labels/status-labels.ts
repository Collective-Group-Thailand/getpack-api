import {
  type ArtworkStatus,
  type ClaimStatus,
  type DesignRoundStatus,
  type DesignServiceStatus,
  type InstalmentStatus,
  type MilestoneStatus,
  type OrderGroupStatus,
  type OrderStatus,
  type PaymentStatus,
  type PreflightStatus,
  type ProductionJobStatus,
  type ProofStatus,
  type QuoteStatus,
  type RefundStatus,
  type RfqQuoteStatus,
  type RfqStatus,
  type SampleStatus,
  type ShipmentStatus,
  type SlipStatus,
  type SubmissionStatus,
} from '@generated/prisma/enums';
import { type CustomerOrderStatus } from '@modules/orders/customer-status';

/**
 * One status value in words (D-313, UX round 2 Phase 4 §A3): `th` for the customer (glossary: "ตรวจแบบก่อนพิมพ์" /
 * "แบบตัวอย่าง", never a factory, D-050), `adminTh` for staff and factories ("Proof", factory steps by name), `en`.
 * Enum values never change; only these words do.
 */
export interface StatusLabel {
  th: string;
  adminTh: string;
  en: string;
}

type Labels<E extends string> = Record<E, StatusLabel>;

/** Same words for everyone. */
const L = (th: string, en: string, adminTh = th): StatusLabel => ({ th, adminTh, en });

const ORDER_GROUP: Labels<OrderGroupStatus> = {
  pending_company_approval: L('รอผู้อนุมัติของบริษัท', 'Awaiting company approval'),
  waiting_payment: L('รอชำระเงิน', 'Awaiting payment'),
  in_progress: L('กำลังดำเนินการ', 'In progress'),
  completed: L('สำเร็จ', 'Completed'),
  cancelled: L('ยกเลิกแล้ว', 'Cancelled'),
};

const ORDER: Labels<OrderStatus> = {
  waiting_payment: L('รอชำระเงิน', 'Awaiting payment'),
  paid_for_production: L('ชำระเงินแล้ว', 'Paid'),
  artwork_approved: L('อนุมัติแบบตัวอย่างแล้ว', 'Artwork approved', 'อนุมัติไฟล์แล้ว'),
  in_production: L('กำลังผลิต', 'In production'),
  shipping: L('กำลังจัดส่ง', 'Shipping'),
  completed: L('สำเร็จ', 'Completed'),
  cancelled: L('ยกเลิกแล้ว', 'Cancelled'),
};

/** D-437: the one customer status of an order (`customer-status.ts`); staff read the same words. */
const CUSTOMER_ORDER: Labels<CustomerOrderStatus> = {
  awaiting_payment: L('รอชำระเงิน', 'Awaiting payment'),
  awaiting_artwork: L('รอไฟล์งาน', 'Awaiting artwork'),
  awaiting_approval: L('รออนุมัติแบบ', 'Awaiting design approval'),
  in_production: L('กำลังผลิต', 'In production'),
  shipping: L('กำลังจัดส่ง', 'Shipping'),
  received: L('ได้รับแล้ว', 'Received'),
  claim_in_review: L('ได้รับแล้ว · เคลมกำลังตรวจ', 'Received · claim under review'),
  completed: L('เสร็จสิ้น', 'Completed'),
  cancelled: L('ยกเลิก', 'Cancelled'),
};

const PAYMENT: Labels<PaymentStatus> = {
  initiated: L('เริ่มชำระเงิน', 'Initiated'),
  pending: L('รอชำระเงิน', 'Pending'),
  awaiting_verification: L('รอตรวจสอบการชำระเงิน', 'Awaiting verification'),
  succeeded: L('ชำระเงินสำเร็จ', 'Succeeded'),
  failed: L('ชำระเงินไม่สำเร็จ', 'Failed'),
  cancelled: L('ยกเลิกการชำระเงิน', 'Cancelled'),
  expired: L('หมดเวลาชำระเงิน', 'Expired'),
  refunded: L('คืนเงินแล้ว', 'Refunded'),
  partially_refunded: L('คืนเงินบางส่วน', 'Partially refunded'),
};

const INSTALMENT: Labels<InstalmentStatus> = {
  pending: L('ยังไม่ถึงกำหนด', 'Scheduled'),
  due: L('ถึงกำหนดชำระ', 'Due'),
  partially_paid: L('ชำระบางส่วน', 'Partially paid'),
  paid: L('ชำระแล้ว', 'Paid'),
  overdue: L('เกินกำหนดชำระ', 'Overdue'),
  cancelled: L('ยกเลิกแล้ว', 'Cancelled'),
  refunded: L('คืนเงินแล้ว', 'Refunded'),
};

const SLIP: Labels<SlipStatus> = {
  pending: L('รอตรวจสลิป', 'Pending'),
  passed: L('สลิปถูกต้อง', 'Passed'),
  failed: L('สลิปไม่ผ่าน', 'Failed'),
  manual_review: L('รอเจ้าหน้าที่ตรวจสอบ', 'Manual review', 'รอการเงินตรวจสอบ'),
  manual_approved: L('สลิปถูกต้อง', 'Approved by Finance', 'การเงินอนุมัติ'),
  manual_rejected: L('สลิปไม่ผ่าน', 'Rejected by Finance', 'การเงินไม่อนุมัติ'),
};

const REFUND: Labels<RefundStatus> = {
  requested: L('ขอคืนเงินแล้ว', 'Requested'),
  pending_approval: L('รออนุมัติคืนเงิน', 'Pending approval'),
  approved: L('อนุมัติคืนเงินแล้ว', 'Approved'),
  processing: L('กำลังคืนเงิน', 'Processing'),
  succeeded: L('คืนเงินสำเร็จ', 'Refunded'),
  failed: L('คืนเงินไม่สำเร็จ', 'Failed'),
  rejected: L('ไม่อนุมัติคืนเงิน', 'Rejected'),
};

const ARTWORK: Labels<ArtworkStatus> = {
  // D-438: "รอแบบไดคัท" split by who acts — the team sends the dieline / the customer sends the file.
  awaiting_template: L(
    'รอทีมส่งแบบไดคัทให้',
    'Awaiting the dieline from our team',
    'รอทีมส่งแบบไดคัทให้ลูกค้า',
  ),
  awaiting_upload: L('รอไฟล์จากคุณ', 'Awaiting your file', 'รอไฟล์จากลูกค้า'),
  uploaded: L('อัปโหลดไฟล์แล้ว', 'Uploaded'),
  in_review: L('กำลังตรวจแบบก่อนพิมพ์', 'In review', 'กำลังตรวจไฟล์'),
  proof_sent: L('แบบตัวอย่างพร้อมให้ตรวจ', 'Proof sent', 'ส่ง Proof ให้ลูกค้าแล้ว'),
  changes_requested: L('ขอให้แก้ไขไฟล์', 'Changes requested'),
  approved: L('อนุมัติแบบตัวอย่างแล้ว', 'Approved', 'อนุมัติไฟล์แล้ว'),
};

const SUBMISSION: Labels<SubmissionStatus> = {
  submitted: L('ส่งไฟล์แล้ว', 'Submitted'),
  superseded: L('มีไฟล์ใหม่แทนแล้ว', 'Superseded'),
  accepted_for_proof: L(
    'ไฟล์ผ่านการตรวจ กำลังทำแบบตัวอย่าง',
    'Accepted for proof',
    'ผ่านการตรวจ พร้อมทำ Proof',
  ),
  rejected: L('ส่งคืนให้แก้ไข', 'Sent back'),
};

const PROOF: Labels<ProofStatus> = {
  pending_customer: L('รอคุณตรวจแบบตัวอย่าง', 'Awaiting customer', 'รอ Proof จากลูกค้า'),
  approved: L('อนุมัติแบบตัวอย่างแล้ว', 'Approved', 'Proof อนุมัติแล้ว'),
  changes_requested: L('ขอแก้ไขแบบตัวอย่าง', 'Changes requested', 'ขอให้แก้ไข Proof'),
  superseded: L('มีแบบตัวอย่างฉบับใหม่แล้ว', 'Superseded', 'มี Proof ฉบับใหม่แทนแล้ว'),
};

const PREFLIGHT: Labels<PreflightStatus> = {
  pending: L('รอตรวจไฟล์อัตโนมัติ', 'Pending'),
  running: L('กำลังตรวจไฟล์อัตโนมัติ', 'Running'),
  passed: L('ผ่านการตรวจ', 'Passed'),
  passed_with_warnings: L('ผ่านแต่มีคำเตือน', 'Passed with warnings'),
  blocked: L('ไม่ผ่าน ต้องแก้ไฟล์', 'Blocked'),
  error: L('ตรวจไม่สำเร็จ', 'Check failed'),
};

/** A production job: the customer never sees the factory (D-050). */
const PRODUCTION_JOB: Labels<ProductionJobStatus> = {
  released: L('เตรียมผลิต', 'Awaiting acceptance', 'รอโรงงานรับงาน'),
  accepted: L('เตรียมผลิต', 'Accepted', 'โรงงานรับงานแล้ว'),
  rejected: L('กำลังจัดหาผู้ผลิต', 'Rejected', 'โรงงานปฏิเสธงาน'),
  in_progress: L('กำลังผลิต', 'In production'),
  on_hold: L('พักการผลิตชั่วคราว', 'On hold', 'พักงานไว้'),
  completed: L('ผลิตเสร็จแล้ว', 'Completed'),
  cancelled: L('ยกเลิกการผลิต', 'Cancelled', 'ยกเลิกงาน'),
};

const MILESTONE: Labels<MilestoneStatus> = {
  pending: L('ยังไม่เริ่ม', 'Not started'),
  in_progress: L('กำลังทำ', 'In progress'),
  completed: L('เสร็จแล้ว', 'Done'),
  skipped: L('ข้ามขั้นนี้', 'Skipped'),
};

const SHIPMENT: Labels<ShipmentStatus> = {
  draft: L('เตรียมจัดส่ง', 'Draft', 'ร่างรอบส่ง'),
  ready: L('พร้อมส่ง', 'Ready'),
  // D-435: the customer's words never name where it left from; staff keep theirs.
  picked_up: L('จัดส่งออกแล้ว', 'Dispatched', 'ออกจากโรงงานแล้ว'),
  in_transit: L('กำลังส่ง', 'In transit'),
  out_for_delivery: L('กำลังนำส่ง', 'Out for delivery'),
  delivered: L('ส่งถึงแล้ว', 'Delivered'),
  failed: L('นำส่งไม่สำเร็จ', 'Failed'),
  returned: L('ตีกลับ', 'Returned'),
  cancelled: L('ยกเลิกการส่ง', 'Cancelled'),
};

const CLAIM: Labels<ClaimStatus> = {
  submitted: L('แจ้งเคลมแล้ว', 'Submitted'),
  under_review: L('กำลังพิจารณาเคลม', 'Under review'),
  need_info: L('รอหลักฐานเพิ่มเติม', 'Needs information'),
  factory_review: L('กำลังพิจารณาเคลม', 'Factory review', 'รอโรงงานตรวจสอบ'),
  approved: L('อนุมัติเคลม', 'Approved'),
  rejected: L('ไม่อนุมัติเคลม', 'Rejected'),
  resolved: L('ดำเนินการเรียบร้อย', 'Resolved'),
  closed: L('ปิดเรื่องแล้ว', 'Closed'),
};

const QUOTE: Labels<QuoteStatus> = {
  calculated: L('คำนวณแล้ว', 'Calculated'),
  saved: L('บันทึกแล้ว', 'Saved'),
  shared: L('แชร์แล้ว', 'Shared'),
  converted: L('สั่งซื้อแล้ว', 'Converted'),
  expired: L('หมดอายุ', 'Expired'),
  superseded: L('มีฉบับใหม่แทนแล้ว', 'Superseded'),
  declined: L('ไม่รับใบเสนอราคา', 'Declined'),
  routed_to_rfq: L('ส่งให้ทีมขายแล้ว', 'Sent to sales'),
};

const RFQ: Labels<RfqStatus> = {
  submitted: L('ได้รับคำขอแล้ว', 'Submitted'),
  in_review: L('กำลังพิจารณาคำขอ', 'In review'),
  need_info: L('รอข้อมูลเพิ่มเติม', 'Needs information'),
  quoted: L('เสนอราคาแล้ว', 'Quoted'),
  accepted: L('รับราคาแล้ว', 'Accepted', 'ลูกค้ารับราคาแล้ว'),
  declined: L('ปฏิเสธคำขอ', 'Declined'),
  expired: L('คำขอหมดอายุ', 'Expired'),
};

const RFQ_QUOTE: Labels<RfqQuoteStatus> = {
  draft: L('ร่างใบเสนอราคา', 'Draft'),
  sent: L('ส่งใบเสนอราคาแล้ว', 'Sent'),
  accepted: L('ยอมรับแล้ว', 'Accepted', 'ลูกค้ายอมรับ'),
  superseded: L('มีฉบับใหม่แทนแล้ว', 'Superseded'),
  expired: L('หมดอายุ', 'Expired'),
};

const SAMPLE: Labels<SampleStatus> = {
  requested: L('รอใบเสนอราคา', 'Awaiting quote'),
  quoted: L('เสนอราคาแล้ว', 'Quoted'),
  paid: L('ชำระแล้ว', 'Paid'),
  in_production: L('กำลังทำตัวอย่างจริง', 'Being made', 'กำลังทำตัวอย่าง'),
  shipped: L('ส่งแล้ว', 'Shipped'),
  delivered: L('ถึงแล้ว รอตรวจ', 'Delivered — to check'),
  approved: L('อนุมัติแล้ว', 'Approved'),
  changes_requested: L('ขอแก้ไข', 'Changes requested'),
  rejected: L('ไม่ผ่าน', 'Rejected'),
  cancelled: L('ยกเลิก', 'Cancelled'),
  expired: L('หมดอายุ', 'Expired'),
};

const DESIGN_SERVICE: Labels<DesignServiceStatus> = {
  brief_pending: L('รอบรีฟงานออกแบบ', 'Awaiting brief'),
  in_progress: L('กำลังออกแบบ', 'In progress'),
  delivered: L('ส่งแบบแล้ว', 'Delivered'),
  revision_requested: L('ขอแก้แบบ', 'Revision requested'),
  approved: L('อนุมัติแบบแล้ว', 'Approved'),
  cancelled: L('ยกเลิกงานออกแบบ', 'Cancelled'),
  requoted: L('เสนอราคาใหม่', 'Re-quoted'),
};

const DESIGN_ROUND: Labels<DesignRoundStatus> = {
  awaiting_payment: L('รอชำระค่าแก้ไขเพิ่ม', 'Awaiting payment'),
  in_progress: L('กำลังแก้ไข', 'In progress'),
  delivered: L('ส่งงานรอบนี้แล้ว', 'Delivered'),
  approved: L('อนุมัติแล้ว', 'Approved'),
  changes_requested: L('ขอแก้ไขเพิ่ม', 'Changes requested'),
};

/** Every labelled status enum, by its OpenAPI component name (`enumName`). */
export const STATUS_LABELS = {
  OrderGroupStatus: ORDER_GROUP,
  OrderStatus: ORDER,
  CustomerOrderStatus: CUSTOMER_ORDER,
  PaymentStatus: PAYMENT,
  InstalmentStatus: INSTALMENT,
  SlipStatus: SLIP,
  RefundStatus: REFUND,
  ArtworkStatus: ARTWORK,
  SubmissionStatus: SUBMISSION,
  ProofStatus: PROOF,
  PreflightStatus: PREFLIGHT,
  ProductionJobStatus: PRODUCTION_JOB,
  MilestoneStatus: MILESTONE,
  ShipmentStatus: SHIPMENT,
  ClaimStatus: CLAIM,
  QuoteStatus: QUOTE,
  RfqStatus: RFQ,
  RfqQuoteStatus: RFQ_QUOTE,
  SampleStatus: SAMPLE,
  DesignServiceStatus: DESIGN_SERVICE,
  DesignRoundStatus: DESIGN_ROUND,
} as const;

export type LabelledEnum = keyof typeof STATUS_LABELS;
export const LABELLED_ENUMS = Object.keys(STATUS_LABELS) as LabelledEnum[];

/** The words for one value; an unknown value (a newer enum member) falls back to the value itself. */
export function statusLabel(enumName: LabelledEnum, value: string): StatusLabel {
  const labels = STATUS_LABELS[enumName] as Record<string, StatusLabel>;
  return labels[value] ?? { th: value, adminTh: value, en: value };
}

type LabelFields<F extends string> = `${F}LabelTh` | `${F}LabelAdminTh`;

/**
 * `<field>LabelTh` + `<field>LabelAdminTh` to spread next to a status field (`status` → `statusLabelTh`,
 * `artworkStatus` → `artworkStatusLabelTh`); null words for a null status.
 */
export function statusLabels<F extends string = 'status'>(
  enumName: LabelledEnum,
  value: string,
  field?: F,
): Record<LabelFields<F>, string>;
export function statusLabels<F extends string = 'status'>(
  enumName: LabelledEnum,
  value: string | null,
  field?: F,
): Record<LabelFields<F>, string | null>;
export function statusLabels(enumName: LabelledEnum, value: string | null, field = 'status') {
  const l = value === null ? null : statusLabel(enumName, value);
  return { [`${field}LabelTh`]: l?.th ?? null, [`${field}LabelAdminTh`]: l?.adminTh ?? null };
}
