import { type NotificationRouteSeed, type NotificationTemplateSeed } from './notifications';

/**
 * The D-143 routing matrix for the business events of B2–B4 (event × audience × channel) with its th/en
 * templates, seeded by `pnpm db:seed` (B4.6). Customers: e-mail for everything, LINE when linked, web push
 * when permitted, SMS only for critical events (instalment due, shipped, claim decision — OTP is sent by the
 * auth module); staff: in-app + the team's LINE group; factories: partner-zone push (in-app) + LINE +
 * e-mail. All transactional (D-144 quiet hours and consent apply to marketing only). Texts are editable
 * templates and routes can be switched off by admins; the seed never overwrites them. Finance events
 * (B5) add their rows with their modules.
 */
type Channel = NotificationTemplateSeed['channel'];
interface Text {
  th: string;
  en: string;
}
interface Row {
  event: string;
  audience: 'customer' | 'staff_team' | 'factory';
  team?: string;
  channels: Channel[];
  critical?: Channel[];
  subject: Text;
  body: Text;
  description: string;
  /** Marketing rows get the D-144 consent and quiet hours in the router; everything else is transactional. */
  category?: 'marketing';
  /** Route conditions on the payload (the router's `conditions`). */
  conditions?: Record<string, string | number | boolean>;
  /** The deep link's words when they name the action (D-453: "ตรวจราคาใหม่และชำระ"); default "เปิดใน getpack". */
  linkLabel?: Text;
}

const email = (greeting: string, body: string, footer: string) =>
  `<mjml><mj-body><mj-section><mj-column><mj-text>${greeting} {{recipient.displayName}}</mj-text>` +
  `<mj-text>${body}</mj-text><mj-text font-size="12px" color="#5b6470">${footer}</mj-text>` +
  `</mj-column></mj-section></mj-body></mjml>`;

const C = (
  event: string,
  channels: Channel[],
  subject: Text,
  body: Text,
  description: string,
  critical: Channel[] = [],
): Row => ({
  event,
  audience: 'customer',
  channels,
  critical,
  subject,
  body,
  description,
});
const T = (
  event: string,
  team: string,
  channels: Channel[],
  subject: Text,
  body: Text,
  description: string,
): Row => ({
  event,
  audience: 'staff_team',
  team,
  channels,
  subject,
  body,
  description,
});
const F = (event: string, channels: Channel[], subject: Text, body: Text, description: string): Row => ({
  event,
  audience: 'factory',
  channels,
  subject,
  body,
  description,
});

const ROWS: Row[] = [
  // --- customers -------------------------------------------------------------------------------------------
  {
    ...C(
      'reorder.suggestion_due',
      ['email', 'line'],
      {
        th: 'ถึงเวลาสั่ง{{payload.productTypeNameTh}}อีกครั้ง',
        en: 'Time to reorder your {{payload.productTypeNameEn}}',
      },
      {
        th: 'จากประวัติการสั่งซื้อ getpack แนะนำให้สั่งซ้ำจำนวน {{payload.suggestedQuantity}} (คำสั่งซื้อล่าสุด {{payload.orderCode}}) สั่งซ้ำได้ในไม่กี่คลิกที่ getpack',
        en: 'From your order history getpack suggests reordering a quantity of {{payload.suggestedQuantity}} (last order {{payload.orderCode}}); reorder in a few clicks on getpack',
      },
      'Customer: reorder suggestion due — marketing, consent and quiet hours apply (D-288, D-144)',
    ),
    category: 'marketing',
  },
  C(
    'call_off.accepted',
    ['email', 'line', 'in_app'],
    { th: 'สัญญาสั่งผลิตแบบทยอยเริ่มแล้ว', en: 'Your call-off agreement is active' },
    {
      th: 'ราคาถูกล็อกไว้จนถึง {{payload.expiresAt}} เรียกสินค้าเป็นงวดได้ที่ getpack',
      en: 'Your price is locked until {{payload.expiresAt}}; release quantities on getpack',
    },
    'Customer: call-off agreement accepted by the factory (D-290)',
  ),
  C(
    'call_off.declined',
    ['email', 'in_app'],
    { th: 'สัญญาสั่งผลิตแบบทยอยไม่ได้รับการตอบรับ', en: 'Your call-off request was declined' },
    {
      th: 'เหตุผล: {{payload.reason}} ใบเสนอราคาเดิมยังสั่งซื้อได้ตามปกติจนหมดอายุ',
      en: 'Reason: {{payload.reason}}. Your quotation can still be ordered as usual until it expires',
    },
    'Customer: call-off agreement declined (D-290)',
  ),
  C(
    'call_off.expired',
    ['email', 'in_app'],
    { th: 'สัญญาสั่งผลิตแบบทยอยสิ้นสุดแล้ว', en: 'Your call-off agreement has ended' },
    {
      th: 'จำนวนที่ยังไม่ได้เรียกจะไม่ถูกเรียกเก็บเงิน',
      en: 'The quantity not released is not charged',
    },
    'Customer: call-off agreement expired; what was not released lapses without charge (D-290)',
  ),
  C(
    'order_group.placed',
    ['email', 'line', 'in_app'],
    { th: 'ได้รับคำสั่งซื้อ {{payload.groupCode}} แล้ว', en: 'Order {{payload.groupCode}} received' },
    {
      th: 'ขอบคุณสำหรับคำสั่งซื้อ {{payload.groupCode}} ยอดรวม {{payload.grossAmount}} บาท',
      en: 'Thank you for order {{payload.groupCode}}, total THB {{payload.grossAmount}}',
    },
    'Customer: order group placed (D-051)',
  ),
  C(
    'instalment.due',
    ['email', 'line', 'web_push', 'sms'],
    { th: 'ถึงกำหนดชำระงวดที่ {{payload.seq}}', en: 'Instalment {{payload.seq}} is due' },
    {
      th: 'งวดที่ {{payload.seq}} จำนวน {{payload.cashAmount}} บาท ถึงกำหนดชำระแล้ว ชำระได้ที่ getpack',
      en: 'Instalment {{payload.seq}} of THB {{payload.cashAmount}} is due; pay on getpack',
    },
    'Customer: an instalment is due (D-020; SMS critical, D-143)',
    ['sms'],
  ),
  C(
    'instalment.overdue',
    ['email', 'line'],
    { th: 'งวดที่ {{payload.seq}} เลยกำหนดชำระ', en: 'Instalment {{payload.seq}} is overdue' },
    {
      th: 'งวดที่ {{payload.seq}} จำนวน {{payload.cashAmount}} บาท เลยกำหนดชำระแล้ว',
      en: 'Instalment {{payload.seq}} of THB {{payload.cashAmount}} is overdue',
    },
    'Customer: an instalment is overdue (D-020)',
  ),
  C(
    'instalment.reminder',
    ['email', 'line'],
    { th: 'แจ้งเตือนชำระงวดที่ {{payload.seq}}', en: 'Reminder: instalment {{payload.seq}}' },
    {
      th: 'คำสั่งซื้อ {{payload.groupCode}} งวดที่ {{payload.seq}} จำนวน {{payload.cashAmount}} บาท รอการชำระ ชำระได้ที่ getpack',
      en: 'Order {{payload.groupCode}}: instalment {{payload.seq}} of THB {{payload.cashAmount}} is waiting; pay on getpack',
    },
    'Customer: CS reminds of an instalment due (U-B0.2, D-143)',
  ),
  C(
    'customer_document.sent',
    ['email', 'line'],
    { th: 'เอกสาร {{payload.docNumber}} จาก getpack', en: 'Document {{payload.docNumber}} from getpack' },
    {
      th: 'เอกสาร {{payload.docNumber}} ของคุณพร้อมแล้ว ดาวน์โหลดได้ที่บัญชี getpack ของคุณ',
      en: 'Your document {{payload.docNumber}} is ready; download it from your getpack account',
    },
    'Customer: staff send (again) a tax invoice, receipt or note (U-B0.3, D-143)',
  ),
  C(
    'instalment.paid',
    ['email', 'in_app'],
    { th: 'ได้รับชำระเงินแล้ว', en: 'Payment received' },
    { th: 'เราได้รับชำระเงินของคุณเรียบร้อยแล้ว ขอบคุณค่ะ', en: 'We received your payment, thank you' },
    'Customer: an instalment is paid (D-061)',
  ),
  C(
    'payment.slip_rejected',
    ['email', 'line'],
    { th: 'สลิปโอนเงินไม่ผ่านการตรวจสอบ', en: 'Transfer slip not accepted' },
    {
      th: 'สลิปโอนเงินของคุณไม่ผ่านการตรวจสอบ โปรดตรวจสอบและอัปโหลดใหม่',
      en: 'Your transfer slip was not accepted; please check it and upload again',
    },
    'Customer: a slip was rejected by Finance (D-061)',
  ),
  C(
    'artwork.rejected',
    ['email', 'line'],
    { th: 'ไฟล์งานต้องแก้ไข', en: 'Your artwork needs changes' },
    {
      th: 'ไฟล์งานของคุณยังใช้พิมพ์ไม่ได้ โปรดดูรายละเอียดและส่งไฟล์ใหม่',
      en: 'Your artwork cannot be printed yet; see the details and send a new file',
    },
    'Customer: artwork rejected by Prepress (D-070)',
  ),
  C(
    'proof.sent',
    ['email', 'line', 'web_push'],
    { th: 'แบบตัวอย่างพร้อมให้ตรวจแล้ว', en: 'Your proof is ready' },
    {
      th: 'แบบตัวอย่างงานของคุณพร้อมแล้ว โปรดตรวจและอนุมัติเพื่อเริ่มผลิต',
      en: 'Your proof is ready; review and approve it to start production',
    },
    'Customer: a proof waits for approval (D-070)',
  ),
  C(
    'design_service.delivered',
    ['email', 'line'],
    { th: 'แบบงานออกแบบพร้อมแล้ว', en: 'Your design is ready' },
    {
      th: 'นักออกแบบส่งงานรอบใหม่แล้ว โปรดตรวจและแจ้งความเห็น',
      en: 'The designer delivered a new round; please review it',
    },
    'Customer: a design round was delivered (D-071)',
  ),
  C(
    'production.queued',
    ['in_app', 'line'],
    { th: 'คำสั่งซื้อเข้าคิวผลิตแล้ว', en: 'Your order is queued for production' },
    {
      th: 'คำสั่งซื้อของคุณเข้าคิวผลิตแล้ว เราจะแจ้งความคืบหน้าให้ทราบ',
      en: 'Your order is queued for production; we will keep you posted',
    },
    'Customer: production released (D-073)',
  ),
  C(
    'production.milestone_reached',
    ['in_app', 'web_push'],
    { th: '{{payload.labelTh}}', en: '{{payload.labelEn}}' },
    { th: 'ความคืบหน้าการผลิต: {{payload.labelTh}}', en: 'Production progress: {{payload.labelEn}}' },
    'Customer: a customer-visible milestone (D-075)',
  ),
  C(
    'shipment.picked_up',
    ['email', 'line', 'web_push', 'sms'],
    { th: 'สินค้าออกจัดส่งแล้ว', en: 'Your order has shipped' },
    {
      th: 'สินค้าของคุณออกจัดส่งแล้ว (เลขที่ {{payload.shipmentNo}}) ติดตามได้ที่ getpack',
      en: 'Your order has shipped (no. {{payload.shipmentNo}}); track it on getpack',
    },
    'Customer: shipped (SMS critical, D-143)',
    ['sms'],
  ),
  C(
    'shipment.delivered',
    ['email', 'line', 'in_app'],
    { th: 'สินค้าส่งถึงแล้ว', en: 'Your order was delivered' },
    {
      th: 'สินค้า (เลขที่ {{payload.shipmentNo}}) ส่งถึงแล้ว หากพบปัญหาแจ้งเคลมได้ภายใน 7 วัน',
      en: 'Shipment {{payload.shipmentNo}} was delivered; report any problem within 7 days',
    },
    'Customer: delivered with POD (D-013, D-082)',
  ),
  C(
    'claim.submitted',
    ['email'],
    { th: 'ได้รับเรื่องเคลม {{payload.claimNo}}', en: 'Claim {{payload.claimNo}} received' },
    {
      th: 'เราได้รับเรื่องเคลม {{payload.claimNo}} แล้ว และจะแจ้งผลการตรวจสอบ',
      en: 'We received claim {{payload.claimNo}} and will let you know the outcome',
    },
    'Customer: claim received (D-082)',
  ),
  C(
    'claim.info_requested',
    ['email', 'line'],
    {
      th: 'ขอข้อมูลเพิ่มเติมสำหรับเคลม {{payload.claimNo}}',
      en: 'More information needed for claim {{payload.claimNo}}',
    },
    { th: 'โปรดส่งข้อมูลเพิ่มเติม: {{payload.note}}', en: 'Please send more information: {{payload.note}}' },
    'Customer: getpack asks for information (D-082)',
  ),
  C(
    'claim.approved',
    ['email', 'line', 'sms'],
    { th: 'เคลม {{payload.claimNo}} ได้รับการอนุมัติ', en: 'Claim {{payload.claimNo}} approved' },
    {
      th: 'เคลม {{payload.claimNo}} ได้รับการอนุมัติ เราจะดำเนินการแก้ไขให้',
      en: 'Claim {{payload.claimNo}} is approved; we will put it right',
    },
    'Customer: claim decision (SMS critical, D-143)',
    ['sms'],
  ),
  C(
    'claim.rejected',
    ['email', 'line', 'sms'],
    { th: 'ผลการพิจารณาเคลม {{payload.claimNo}}', en: 'Decision on claim {{payload.claimNo}}' },
    {
      th: 'เคลม {{payload.claimNo}} ไม่ได้รับการอนุมัติ ดูรายละเอียดได้ที่ getpack',
      en: 'Claim {{payload.claimNo}} was not approved; see the details on getpack',
    },
    'Customer: claim decision (SMS critical, D-143)',
    ['sms'],
  ),
  C(
    'claim.resolved',
    ['email'],
    { th: 'ดำเนินการเคลม {{payload.claimNo}} แล้ว', en: 'Claim {{payload.claimNo}} resolved' },
    {
      th: 'เราได้ดำเนินการตามผลเคลม {{payload.claimNo}} แล้ว',
      en: 'We have carried out the resolution of claim {{payload.claimNo}}',
    },
    'Customer: claim resolution executed (D-083)',
  ),
  C(
    'refund.succeeded',
    ['email'],
    { th: 'คืนเงินเรียบร้อยแล้ว', en: 'Refund completed' },
    { th: 'เราคืนเงินจำนวน {{payload.amount}} บาท เรียบร้อยแล้ว', en: 'We refunded THB {{payload.amount}}' },
    'Customer: refund executed (D-169)',
  ),
  C(
    'rfq.quoted',
    ['email', 'line'],
    { th: 'ใบเสนอราคาพร้อมแล้ว', en: 'Your quotation is ready' },
    {
      th: 'ใบเสนอราคาตามคำขอของคุณพร้อมแล้ว ดูและสั่งซื้อได้ที่ getpack',
      en: 'The quotation you asked for is ready; view and order it on getpack',
    },
    'Customer: RFQ quoted (D-062)',
  ),
  C(
    'rfq.info_requested',
    ['email', 'line'],
    { th: 'ขอข้อมูลเพิ่มเติมสำหรับคำขอใบเสนอราคา', en: 'More information needed for your request' },
    {
      th: 'ทีมงานต้องการข้อมูลเพิ่มเติมเพื่อเสนอราคา โปรดตอบกลับที่ getpack',
      en: 'Our team needs more information to quote; please reply on getpack',
    },
    'Customer: RFQ information request (D-062)',
  ),
  C(
    'order_group.expired',
    ['email'],
    { th: 'คำสั่งซื้อถูกยกเลิกเนื่องจากไม่ได้ชำระเงิน', en: 'Order cancelled: not paid' },
    {
      th: 'คำสั่งซื้อของคุณถูกยกเลิกอัตโนมัติเนื่องจากไม่ได้ชำระเงินภายในกำหนด',
      en: 'Your order was cancelled automatically because it was not paid in time',
    },
    'Customer: unpaid order expired (D-060)',
  ),
  {
    ...C(
      'order_group.payment_overdue',
      ['email', 'line'],
      { th: 'เลยกำหนดชำระ {{payload.groupCode}}', en: 'Payment overdue: {{payload.groupCode}}' },
      {
        th: 'คำสั่งซื้อ {{payload.orderCode}} เลยกำหนดชำระแล้ว ระบบไม่ได้ยกเลิกคำสั่งซื้อ ตรวจราคาและวันส่งใหม่ แล้วชำระได้ทันที',
        en: "Order {{payload.orderCode}} is past its payment deadline. It has not been cancelled: re-check today's price and delivery date, then pay",
      },
      'Customer: payment deadline passed — one reminder per deadline (D-453, D-436; flag orders.payment_overdue_reminder)',
    ),
    linkLabel: { th: 'ตรวจราคาใหม่และชำระ', en: 'Re-check price and pay' },
  },
  C(
    'points.expiring',
    ['email'],
    { th: 'คะแนนสะสมใกล้หมดอายุ', en: 'Points about to expire' },
    {
      th: 'คะแนนสะสมบางส่วนของคุณจะหมดอายุเร็ว ๆ นี้ ใช้เป็นส่วนลดได้ที่ getpack',
      en: 'Some of your points expire soon; use them as a discount on getpack',
    },
    'Customer: points expiring (D-130)',
  ),

  // --- staff teams -----------------------------------------------------------------------------------------
  T(
    'order_group.placed',
    'cs',
    ['in_app'],
    { th: 'คำสั่งซื้อใหม่ {{payload.groupCode}}', en: 'New order {{payload.groupCode}}' },
    {
      th: 'คำสั่งซื้อใหม่ {{payload.groupCode}} ยอด {{payload.grossAmount}} บาท',
      en: 'New order {{payload.groupCode}}, THB {{payload.grossAmount}}',
    },
    'CS: new order group',
  ),
  T(
    'artwork.submitted',
    'prepress',
    ['in_app', 'line'],
    { th: 'มีไฟล์งานใหม่รอตรวจ', en: 'New artwork to check' },
    {
      th: 'ลูกค้าส่งไฟล์งานใหม่ รอตรวจในคิว Prepress',
      en: 'A customer sent new artwork; it waits in the Prepress queue',
    },
    'Prepress: artwork submitted (D-070)',
  ),
  T(
    'proof.changes_requested',
    'prepress',
    ['in_app'],
    { th: 'ลูกค้าขอแก้ Proof', en: 'Proof changes requested' },
    {
      th: 'ลูกค้าขอแก้ไข Proof โปรดดูความเห็นและส่ง Proof ใหม่',
      en: 'The customer asked for proof changes; see the comments and send a new version',
    },
    'Prepress: proof changes requested (D-070)',
  ),
  T(
    'design_service.brief_submitted',
    'prepress',
    ['in_app'],
    { th: 'มีบรีฟงานออกแบบใหม่', en: 'New design brief' },
    {
      th: 'ลูกค้าส่งบรีฟงานออกแบบ รอมอบหมายนักออกแบบ',
      en: 'A customer sent a design brief; assign a designer',
    },
    'Prepress: design brief submitted (D-071)',
  ),
  T(
    'payment.slip_review_required',
    'finance',
    ['in_app', 'line'],
    { th: 'มีสลิปรอตรวจ', en: 'Slip to review' },
    { th: 'มีสลิปโอนเงินรอตรวจสอบในคิวการเงิน', en: 'A transfer slip waits in the Finance queue' },
    'Finance: slip review (D-061)',
  ),
  T(
    'refund.failed',
    'finance',
    ['in_app', 'line'],
    { th: 'คืนเงินไม่สำเร็จ', en: 'Refund failed' },
    {
      th: 'การคืนเงิน {{payload.amount}} บาท ไม่สำเร็จ โปรดตรวจสอบ',
      en: 'A refund of THB {{payload.amount}} failed; please check',
    },
    'Finance: refund failed (D-169)',
  ),
  T(
    'company.kyc_submitted',
    'finance',
    ['in_app'],
    { th: 'บริษัทส่งเอกสาร KYC', en: 'Company KYC submitted' },
    { th: 'มีบริษัทส่งเอกสาร KYC รอตรวจ', en: 'A company submitted KYC documents to review' },
    'Finance: company KYC (D-121)',
  ),
  T(
    'rfq.submitted',
    'cs',
    ['in_app'],
    { th: 'มีคำขอใบเสนอราคาใหม่', en: 'New request for quotation' },
    { th: 'ลูกค้าส่งคำขอใบเสนอราคาใหม่', en: 'A customer sent a new request for quotation' },
    'CS: RFQ submitted (D-062)',
  ),
  T(
    'production.release_blocked',
    'cs',
    ['in_app'],
    { th: 'เริ่มผลิตไม่ได้', en: 'Production blocked' },
    {
      th: 'คำสั่งซื้อพร้อมแต่เริ่มผลิตไม่ได้ ({{payload.reason}})',
      en: 'An order is ready but cannot start production ({{payload.reason}})',
    },
    'CS: release blocked (D-073)',
  ),
  T(
    'production_job.escalated',
    'partner',
    ['in_app', 'line'],
    { th: 'งานผลิต {{payload.jobNo}} ต้องหาโรงงานใหม่', en: 'Job {{payload.jobNo}} needs a factory' },
    {
      th: 'งาน {{payload.jobNo}} ไม่มีโรงงานรับ โปรดดำเนินการ',
      en: 'Job {{payload.jobNo}} has no factory accepting it; please act',
    },
    'Partner team: escalation (D-012, D-074)',
  ),
  T(
    'production_job.rejected',
    'partner',
    ['in_app'],
    { th: 'โรงงานปฏิเสธงาน {{payload.jobNo}}', en: 'Factory rejected job {{payload.jobNo}}' },
    {
      th: 'โรงงานปฏิเสธงาน {{payload.jobNo}} ({{payload.reasonCode}})',
      en: 'The factory rejected job {{payload.jobNo}} ({{payload.reasonCode}})',
    },
    'Partner team: job rejected (D-074)',
  ),
  T(
    'production_job.at_risk',
    'partner',
    ['in_app'],
    { th: 'งาน {{payload.jobNo}} เสี่ยงล่าช้า', en: 'Job {{payload.jobNo}} at risk' },
    {
      th: 'งาน {{payload.jobNo}} คาดว่าจะเสร็จช้ากว่ากำหนด',
      en: 'Job {{payload.jobNo}} is predicted to finish late',
    },
    'Partner team: SLA at risk (D-075)',
  ),
  T(
    'production_job.issue_raised',
    'partner',
    ['in_app', 'line'],
    { th: 'โรงงานแจ้งปัญหางาน {{payload.jobNo}}', en: 'Issue on job {{payload.jobNo}}' },
    {
      th: 'โรงงานแจ้งปัญหาในงาน {{payload.jobNo}}',
      en: 'The factory raised an issue on job {{payload.jobNo}}',
    },
    'Partner team: production issue',
  ),
  T(
    'production_job.inspection_planned',
    'partner',
    ['in_app'],
    { th: 'มีงานต้องตรวจคุณภาพ', en: 'Inspection to plan' },
    {
      th: 'งาน {{payload.jobNo}} ต้องตรวจคุณภาพโดย getpack',
      en: 'Job {{payload.jobNo}} needs a getpack inspection',
    },
    'Partner team: inspection planned (D-076)',
  ),
  T(
    'production_job.inspection_failed',
    'partner',
    ['in_app', 'line'],
    { th: 'งาน {{payload.jobNo}} ตรวจไม่ผ่าน', en: 'Job {{payload.jobNo}} failed inspection' },
    {
      th: 'งาน {{payload.jobNo}} ตรวจคุณภาพไม่ผ่าน งานถูกพักไว้',
      en: 'Job {{payload.jobNo}} failed its inspection and is on hold',
    },
    'Partner team: inspection failed (D-076)',
  ),
  T(
    'factory.activation_requested',
    'partner',
    ['in_app'],
    { th: 'โรงงานขอเปิดใช้งาน', en: 'Factory activation requested' },
    { th: 'มีโรงงานขอเปิดใช้งาน รอพิจารณา', en: 'A factory asked for activation' },
    'Partner team: factory activation (D-100)',
  ),
  T(
    'price_proposal.submitted',
    'partner',
    ['in_app'],
    { th: 'โรงงานเสนอราคาใหม่', en: 'New price proposal' },
    { th: 'มีโรงงานเสนอราคาใหม่ รอพิจารณา', en: 'A factory submitted a price proposal' },
    'Partner team: price proposal (D-040)',
  ),
  T(
    'factory_change_request.created',
    'partner',
    ['in_app'],
    {
      th: 'โรงงาน {{payload.factoryCode}} ขอเปลี่ยนแปลงข้อมูล',
      en: 'Factory {{payload.factoryCode}} asks for a change',
    },
    {
      th: 'โรงงาน {{payload.factoryCode}} ส่งคำขอเรื่อง {{payload.topic}} รอทีมพาร์ทเนอร์ตอบ',
      en: 'Factory {{payload.factoryCode}} sent a {{payload.topic}} request for the Partner team',
    },
    'Partner team: a factory change request (U-B0.3)',
  ),
  T(
    'shipment.carrier_requested',
    'logistics',
    ['in_app', 'line'],
    { th: 'โรงงานขอให้จองขนส่ง', en: 'A factory asks for a carrier' },
    {
      th: 'โรงงานขอให้ getpack จองขนส่งสำหรับ {{payload.shipmentNo}} ({{payload.reason}})',
      en: 'A factory asks getpack to book a carrier for {{payload.shipmentNo}} ({{payload.reason}})',
    },
    'Logistics: a factory asks for a fallback carrier (D-013, D-114; U-B0.3)',
  ),
  T(
    'shipment.gate_bypassed',
    'logistics',
    ['in_app', 'line'],
    { th: 'ขนส่งรับของก่อนเงื่อนไขครบ', en: 'Carrier picked up before the gate' },
    {
      th: 'ขนส่งรับของ {{payload.shipmentNo}} ก่อนชำระเงิน/ตรวจคุณภาพครบ ({{payload.reason}})',
      en: 'The carrier picked up {{payload.shipmentNo}} before the shipping gate ({{payload.reason}})',
    },
    'Logistics: shipping gate bypassed (D-114)',
  ),
  T(
    'claim.submitted',
    'cs',
    ['in_app', 'line'],
    { th: 'มีเคลมใหม่ {{payload.claimNo}}', en: 'New claim {{payload.claimNo}}' },
    {
      th: 'มีเคลมใหม่ {{payload.claimNo}} ({{payload.type}})',
      en: 'New claim {{payload.claimNo}} ({{payload.type}})',
    },
    'CS: claim submitted (D-082)',
  ),
  T(
    'claim.factory_responded',
    'cs',
    ['in_app'],
    { th: 'โรงงานตอบเคลม {{payload.claimNo}}', en: 'Factory answered claim {{payload.claimNo}}' },
    {
      th: 'โรงงานตอบเคลม {{payload.claimNo}}: {{payload.response}}',
      en: 'The factory answered claim {{payload.claimNo}}: {{payload.response}}',
    },
    'CS: factory response on a claim (D-083)',
  ),

  {
    ...C(
      'conversation.replied',
      ['in_app', 'web_push', 'email'],
      { th: 'getpack ตอบข้อความของคุณแล้ว', en: 'getpack replied to your message' },
      {
        th: 'ทีมบริการลูกค้าตอบข้อความของคุณแล้ว เปิดอ่านได้ในแชท getpack',
        en: 'Customer service replied to your message; read it in your getpack chat',
      },
      'Customer: CS replied on the web thread — a reply sent to LINE is the LINE message itself (D-300, D-143)',
    ),
    conditions: { 'payload.via': 'web' },
  },
  T(
    'conversation.opened',
    'cs',
    ['in_app', 'line'],
    { th: 'มีลูกค้าทักแชทใหม่', en: 'New customer chat' },
    {
      th: 'ลูกค้าเริ่มแชทใหม่ ({{payload.channel}}) รอตอบในกล่องข้อความ',
      en: 'A customer started a chat ({{payload.channel}}); answer it in the inbox',
    },
    'CS: new chat from LINE or the web (D-151)',
  ),

  // --- factories -------------------------------------------------------------------------------------------
  // --- getpack Factory ERP alerts (D-347, D-355, D-356, D-358): the factory's own users only -------------
  F(
    'erp_alert.price_rise',
    ['in_app'],
    {
      th: 'ราคาซื้อขึ้น {{payload.changePct}}% — {{payload.item}}',
      en: 'Price up {{payload.changePct}}% — {{payload.item}}',
    },
    {
      th: '{{payload.supplier}} ใน {{payload.documentNo}} ราคา {{payload.price}} บาท/{{payload.unit}} (ครั้งก่อน {{payload.previous}})',
      en: '{{payload.supplier}} on {{payload.documentNo}}: {{payload.price}} THB/{{payload.unit}} (last paid {{payload.previous}})',
    },
    'Factory ERP: a purchase price rose above the alert threshold (D-347)',
  ),
  F(
    'erp_alert.quote_expiring',
    ['in_app'],
    { th: 'ราคาเสนอใกล้หมดอายุ — {{payload.item}}', en: 'Quotation ending — {{payload.item}}' },
    {
      th: 'ราคาของ {{payload.supplier}} ใช้ได้ถึง {{payload.validUntil}} ขอราคาใหม่หรือเปิดใบสั่งซื้อก่อนหมดอายุ',
      en: '{{payload.supplier}}’s price holds until {{payload.validUntil}}: ask again or order before then',
    },
    'Factory ERP: a quotation or quantity-break price list is about to end (D-347)',
  ),
  F(
    'erp_alert.supplier_review_due',
    ['in_app'],
    { th: 'ถึงรอบทบทวนผู้ขาย — {{payload.supplier}}', en: 'Supplier review due — {{payload.supplier}}' },
    {
      th: 'การอนุมัติ {{payload.supplier}} สำหรับ {{payload.item}} ครบกำหนดทบทวน {{payload.reviewOn}}',
      en: '{{payload.supplier}}’s approval for {{payload.item}} is due for review on {{payload.reviewOn}}',
    },
    'Factory ERP: an approved supplier is due for review (D-351)',
  ),
  F(
    'erp_alert.maintenance_due',
    ['in_app', 'email'],
    { th: 'ถึงรอบซ่อมบำรุง {{payload.machine}}', en: 'Maintenance due — {{payload.machine}}' },
    {
      th: '{{payload.title}} ({{payload.mtNo}}) ถึงกำหนดแล้ว นัดเวลาในตารางเครื่องจักร',
      en: '{{payload.title}} ({{payload.mtNo}}) is due: give it a window on the machine schedule',
    },
    'Factory ERP: a preventive maintenance plan is due (D-355)',
  ),
  F(
    'erp_alert.machine_breakdown',
    ['in_app', 'email', 'line'],
    {
      th: 'เครื่องเสีย {{payload.machine}} — {{payload.mtNo}}',
      en: 'Breakdown on {{payload.machine}} — {{payload.mtNo}}',
    },
    {
      th: '{{payload.title}} (แจ้งโดย {{payload.reportedBy}}) เครื่องหยุดจนกว่าจะปิดงานซ่อม',
      en: '{{payload.title}} (reported by {{payload.reportedBy}}): the machine is down until the repair is done',
    },
    'Factory ERP: a machine breakdown was reported (D-355)',
  ),
  F(
    'erp_alert.document_expiring',
    ['in_app', 'email'],
    { th: 'เอกสารใกล้หมดอายุ — {{payload.title}}', en: 'Document expiring — {{payload.title}}' },
    {
      th: '{{payload.title}} หมดอายุ {{payload.expiresOn}} อัปโหลดฉบับใหม่ในเอกสารโรงงาน',
      en: '{{payload.title}} expires on {{payload.expiresOn}}: upload the renewed version in the factory’s documents',
    },
    'Factory ERP: a certificate, permit or contract is near or past its expiry (D-356)',
  ),
  F(
    'erp_alert.quote_follow_up',
    ['in_app', 'email'],
    { th: 'ใบเสนอราคาใกล้หมดอายุ — {{payload.quoteNo}}', en: 'Quotation expiring — {{payload.quoteNo}}' },
    {
      th: 'ใบเสนอราคา {{payload.quoteNo}} ของ {{payload.customer}} ใช้ได้ถึง {{payload.validUntil}} ติดตามลูกค้าก่อนหมดอายุ',
      en: 'Quotation {{payload.quoteNo}} for {{payload.customer}} is valid until {{payload.validUntil}}: follow up before it lapses',
    },
    'Factory ERP: a sent quotation is near its validity date (D-360)',
  ),
  F(
    'erp_alert.invoice_overdue',
    ['in_app', 'email'],
    { th: 'ใบแจ้งหนี้เกินกำหนด — {{payload.invoiceNo}}', en: 'Invoice overdue — {{payload.invoiceNo}}' },
    {
      th: '{{payload.customer}} ยังค้างชำระ {{payload.open}} บาท ตามใบแจ้งหนี้ {{payload.invoiceNo}} (ครบกำหนด {{payload.dueDate}})',
      en: '{{payload.customer}} still owes THB {{payload.open}} on invoice {{payload.invoiceNo}} (due {{payload.dueDate}})',
    },
    'Factory ERP: a customer invoice is past its due date (D-365)',
  ),
  F(
    'erp_alert.activity_overdue',
    ['in_app'],
    { th: 'งานติดตามลูกค้าเลยกำหนด', en: 'Follow-up overdue' },
    {
      th: '{{payload.subject}} ของ {{payload.assignee}} เลยกำหนดแล้ว',
      en: '{{payload.subject}} assigned to {{payload.assignee}} is overdue',
    },
    'Factory ERP: a CRM activity is past its due time (D-359)',
  ),
  F(
    'erp_alert.ncr_overdue',
    ['in_app', 'line'],
    { th: 'NCR เลยกำหนดแก้ไข — {{payload.ncrNo}}', en: 'NCR action overdue — {{payload.ncrNo}}' },
    {
      th: '{{payload.title}} ({{payload.owner}}) ครบกำหนดแก้ไข {{payload.dueOn}} แล้ว ยังไม่ปิด',
      en: '{{payload.title}} ({{payload.owner}}) was due {{payload.dueOn}} and is still open',
    },
    'Factory ERP: a nonconformance is past its corrective-action date (D-374, D-383)',
  ),
  F(
    'erp_alert.oee_low',
    ['in_app'],
    { th: 'OEE ต่ำ — {{payload.machine}}', en: 'Low OEE — {{payload.machine}}' },
    {
      th: 'เมื่อวาน ({{payload.day}}) {{payload.machine}} ได้ OEE {{payload.oeePct}}% ต่ำกว่าเกณฑ์ {{payload.thresholdPct}}%',
      en: 'Yesterday ({{payload.day}}) {{payload.machine}} ran at {{payload.oeePct}}% OEE, under the {{payload.thresholdPct}}% threshold',
    },
    'Factory ERP: a machine ran under the factory’s OEE threshold yesterday (D-377, D-383)',
  ),
  F(
    'erp_daily.summary',
    ['in_app', 'line'],
    { th: 'สรุปโรงงานประจำวัน {{payload.day}}', en: 'Factory daily summary {{payload.day}}' },
    {
      th: 'ยอดขายเดือนนี้ {{payload.salesMonth}} บาท ({{payload.salesPct}}% ของเป้า) · ลูกหนี้เกินกำหนด {{payload.arOverdue}} บาท · ใบสั่งผลิตล่าช้า {{payload.lateOrders}} · เครื่องเสีย {{payload.machinesDown}} · OEE เมื่อวาน {{payload.oeePct}}% · NCR เปิดอยู่ {{payload.openNcrs}}',
      en: 'Sales this month THB {{payload.salesMonth}} ({{payload.salesPct}}% of target) · overdue receivables THB {{payload.arOverdue}} · late orders {{payload.lateOrders}} · machines down {{payload.machinesDown}} · yesterday’s OEE {{payload.oeePct}}% · open NCRs {{payload.openNcrs}}',
    },
    'Factory ERP: the owner’s 07:40 summary to whoever reads insight (D-379)',
  ),
  F(
    'factory_change_request.answered',
    ['in_app', 'email'],
    { th: 'ทีมพาร์ทเนอร์ตอบคำขอของคุณ', en: 'The Partner team answered your request' },
    {
      th: 'คำขอเรื่อง {{payload.topic}} มีสถานะ {{payload.status}} ดูคำตอบได้ในพื้นที่พาร์ทเนอร์',
      en: 'Your {{payload.topic}} request is {{payload.status}}; read the answer in the partner zone',
    },
    'Factory: the Partner team answered a change request (U-B0.3)',
  ),
  F(
    'rfq.consultation_requested',
    ['in_app', 'email', 'line'],
    { th: 'ขอราคา {{payload.rfqCode}}', en: 'Price request {{payload.rfqCode}}' },
    {
      th: 'getpack ขอราคางาน {{payload.rfqCode}} ตอบได้ในพื้นที่พาร์ทเนอร์',
      en: 'getpack asks your price for {{payload.rfqCode}}; answer in the partner zone',
    },
    'Factory: getpack asks for a buy price (D-043, D-143)',
  ),
  F(
    'rfq.consultation_reminded',
    ['in_app', 'email', 'line'],
    { th: 'เตือนขอราคา {{payload.rfqCode}}', en: 'Reminder: price request {{payload.rfqCode}}' },
    {
      th: 'getpack รอราคางาน {{payload.rfqCode}} ของคุณ ตอบได้ในพื้นที่พาร์ทเนอร์',
      en: 'getpack is waiting for your price for {{payload.rfqCode}}; answer in the partner zone',
    },
    'Factory: CS reminds of an open price request (U-B0.2, D-143)',
  ),
  F(
    'production_job.released',
    ['in_app', 'email', 'line'],
    { th: 'งานใหม่ {{payload.jobNo}}', en: 'New job {{payload.jobNo}}' },
    {
      th: 'มีงานใหม่ {{payload.jobNo}} โปรดรับหรือปฏิเสธภายใน 1 วันทำการ',
      en: 'New job {{payload.jobNo}}: accept or reject within 1 business day',
    },
    'Factory: job released (D-073, D-074)',
  ),
  F(
    'production_job.acceptance_overdue',
    ['email', 'line'],
    { th: 'งาน {{payload.jobNo}} เลยเวลารับงาน', en: 'Job {{payload.jobNo}} acceptance overdue' },
    {
      th: 'งาน {{payload.jobNo}} ยังไม่ได้รับงานภายในเวลาที่กำหนด',
      en: 'Job {{payload.jobNo}} was not accepted in time',
    },
    'Factory: acceptance SLA passed (D-074)',
  ),
  F(
    'production_job.held',
    ['in_app', 'email'],
    { th: 'งาน {{payload.jobNo}} ถูกพัก', en: 'Job {{payload.jobNo}} on hold' },
    {
      th: 'getpack พักงาน {{payload.jobNo}} ไว้ ({{payload.reason}})',
      en: 'getpack put job {{payload.jobNo}} on hold ({{payload.reason}})',
    },
    'Factory: job on hold',
  ),
  F(
    'production_job.resumed',
    ['in_app', 'email'],
    { th: 'งาน {{payload.jobNo}} ดำเนินการต่อได้', en: 'Job {{payload.jobNo}} resumed' },
    { th: 'งาน {{payload.jobNo}} ดำเนินการต่อได้แล้ว', en: 'Job {{payload.jobNo}} can continue' },
    'Factory: job resumed',
  ),
  F(
    'production_job.inspection_scheduled',
    ['in_app', 'email'],
    { th: 'นัดตรวจคุณภาพงาน {{payload.jobNo}}', en: 'Inspection scheduled for {{payload.jobNo}}' },
    {
      th: 'getpack นัดตรวจคุณภาพงาน {{payload.jobNo}} ({{payload.scheduledAt}})',
      en: 'getpack scheduled an inspection of {{payload.jobNo}} ({{payload.scheduledAt}})',
    },
    'Factory: inspection scheduled (D-076)',
  ),
  F(
    'shipment.carrier_booked',
    ['in_app', 'email'],
    { th: 'จองขนส่งให้ {{payload.shipmentNo}}', en: 'Carrier booked for {{payload.shipmentNo}}' },
    {
      th: 'getpack จองขนส่ง {{payload.carrier}} มารับ {{payload.shipmentNo}} ที่โรงงาน',
      en: 'getpack booked {{payload.carrier}} to collect {{payload.shipmentNo}} at the factory',
    },
    'Factory: fallback carrier booked (D-114)',
  ),
  F(
    'claim.sent_to_factory',
    ['in_app', 'email', 'line'],
    { th: 'เคลม {{payload.claimNo}} รอโรงงานตอบ', en: 'Claim {{payload.claimNo}} for your review' },
    {
      th: 'getpack ส่งเคลม {{payload.claimNo}} ให้โรงงานพิจารณา โปรดตอบรับหรือโต้แย้ง',
      en: 'getpack sent claim {{payload.claimNo}} for your review: accept or dispute',
    },
    'Factory: claim review (D-083)',
  ),
  F(
    'claim.approved',
    ['email'],
    { th: 'ผลเคลม {{payload.claimNo}}', en: 'Claim {{payload.claimNo}} decided' },
    {
      th: 'เคลม {{payload.claimNo}} อนุมัติโดยโรงงานเป็นผู้รับผิดชอบ',
      en: 'Claim {{payload.claimNo}} was approved with the factory liable',
    },
    'Factory: claim approved against the factory (D-083)',
  ),
  C(
    'structural_request.submitted',
    ['email', 'in_app'],
    { th: 'ได้รับคำขอออกแบบโครงสร้างแล้ว', en: 'Structure request received' },
    {
      th: 'เราได้รับคำขอออกแบบโครงสร้างของคุณแล้ว ทีมงานจะติดต่อกลับเร็วๆ นี้',
      en: 'We received your structure request; our team will be in touch shortly',
    },
    'Customer: structural design request submitted (D-273)',
  ),
  C(
    'structural_request.assigned',
    ['email', 'in_app'],
    { th: 'มีผู้ออกแบบรับคำขอของคุณแล้ว', en: 'A designer took your request' },
    {
      th: 'ผู้ออกแบบโครงสร้างของ getpack รับคำขอของคุณแล้ว',
      en: 'A getpack structural designer is now working on your request',
    },
    'Customer: structural design request assigned (D-273)',
  ),
  C(
    'structural_request.quoted',
    ['email', 'in_app'],
    { th: 'ใบเสนอราคาค่าออกแบบพร้อมแล้ว', en: 'Design fee quotation ready' },
    {
      th: 'ค่าออกแบบโครงสร้างพร้อมให้ตรวจสอบในใบขอใบเสนอราคาของคุณแล้ว',
      en: 'The structural design fee is ready for you in your quotation requests',
    },
    'Customer: structural design request quoted (D-273)',
  ),
  C(
    'structural_request.delivered',
    ['email', 'in_app'],
    { th: 'แบบโครงสร้างอยู่ระหว่างตรวจสอบ', en: 'Your design is in review' },
    {
      th: 'ผู้ออกแบบส่งแบบโครงสร้างแล้ว ทีม Prepress กำลังตรวจสอบ',
      en: 'The designer delivered your structure; Prepress is reviewing it',
    },
    'Customer: structural design request delivered (D-273)',
  ),
  C(
    'structural_request.approved',
    ['email', 'in_app'],
    { th: 'แบบโครงสร้างพร้อมแล้ว', en: 'Your structure is ready' },
    {
      th: 'แบบโครงสร้างได้รับการอนุมัติแล้ว ดาวน์โหลดไดคัทได้ที่ getpack',
      en: 'Your structure was approved; download the dieline on getpack',
    },
    'Customer: structural design request approved (D-273)',
  ),
  C(
    'structural_request.published',
    ['email', 'in_app'],
    { th: 'แบบของคุณอยู่ในคลังสไตล์แล้ว', en: 'Your structure is in the style library' },
    {
      th: 'แบบโครงสร้างของคุณเผยแพร่เป็นสไตล์ {{payload.publishedBaseCode}} แล้ว',
      en: 'Your structure is now style {{payload.publishedBaseCode}} in the library',
    },
    'Customer: structural design request published (D-273)',
  ),
  C(
    'structural_request.declined',
    ['email', 'in_app'],
    { th: 'คำขอออกแบบโครงสร้างไม่ได้รับการดำเนินการ', en: 'Structure request declined' },
    {
      th: 'ขออภัย เราไม่สามารถดำเนินการคำขอออกแบบโครงสร้างนี้ได้ ดูเหตุผลได้ที่ getpack',
      en: 'Sorry, we cannot take this structure request; see the reason on getpack',
    },
    'Customer: structural design request declined (D-273)',
  ),
  C(
    'design.commented',
    ['email', 'in_app'],
    { th: 'มีความคิดเห็นใหม่ในแบบ {{payload.title}}', en: 'New comment on {{payload.title}}' },
    {
      th: 'มีผู้แสดงความคิดเห็นในแบบ {{payload.title}} ดูได้ที่สตูดิโอ getpack',
      en: 'Someone commented on {{payload.title}}; see it in the getpack studio',
    },
    'Customer: a comment on my studio design (D-285)',
  ),
  C(
    'design.comment_mentioned',
    ['email', 'in_app'],
    { th: 'มีผู้กล่าวถึงคุณในแบบ {{payload.title}}', en: 'You were mentioned on {{payload.title}}' },
    {
      th: 'มีผู้กล่าวถึงคุณในความคิดเห็นของแบบ {{payload.title}} ในสตูดิโอ getpack',
      en: 'You were mentioned in a comment on {{payload.title}} in the getpack studio',
    },
    'Customer: mentioned in a studio comment (D-285)',
  ),
  T(
    'structural_request.submitted',
    'cs',
    ['in_app'],
    { th: 'คำขอออกแบบโครงสร้างใหม่', en: 'New structure request' },
    {
      th: 'มีคำขอออกแบบโครงสร้างใหม่ ({{payload.productTypeCode}}) รอมอบหมายผู้ออกแบบ',
      en: 'A new structure request ({{payload.productTypeCode}}) waits for a designer',
    },
    'CS: a structural design request to assign (D-273)',
  ),
  T(
    'structural_request.assigned',
    'prepress',
    ['in_app'],
    { th: 'มีคำขอออกแบบโครงสร้างมอบหมายให้ทีม', en: 'Structure request assigned' },
    {
      th: 'คำขอออกแบบโครงสร้าง ({{payload.productTypeCode}}) ถูกมอบหมายให้ทีม Prepress',
      en: 'A structure request ({{payload.productTypeCode}}) was assigned to Prepress',
    },
    'Prepress: a structural design request assigned (D-273)',
  ),
  T(
    'style_intake.submitted',
    'prepress',
    ['in_app'],
    { th: 'โรงงานส่งไดคัทใหม่', en: 'A factory offered a dieline' },
    {
      th: 'โรงงานส่งไดคัท "{{payload.title}}" รอการตรวจสอบ',
      en: 'A factory offered the dieline "{{payload.title}}" for review',
    },
    'Prepress: a partner dieline to review (D-272)',
  ),
  F(
    'style_intake.matched',
    ['in_app', 'email'],
    { th: 'ไดคัทของคุณตรงกับสไตล์ที่มีอยู่', en: 'Your dieline matches a library style' },
    {
      th: 'Prepress เทียบไดคัทของคุณกับสไตล์ในคลังแล้ว ดูรายงานความต่างได้ที่ getpack',
      en: 'Prepress matched your dieline to a library style; see the deviation report on getpack',
    },
    'Factory: dieline intake matched (D-272)',
  ),
  F(
    'style_intake.approved',
    ['in_app', 'email'],
    { th: 'ไดคัทของคุณได้รับการอนุมัติ', en: 'Your dieline was approved' },
    {
      th: 'ไดคัทที่ส่งมาได้รับการอนุมัติเข้าคลังสไตล์แล้ว ขอบคุณครับ',
      en: 'Your dieline was approved into the style library; thank you',
    },
    'Factory: dieline intake approved (D-272)',
  ),
  F(
    'style_intake.rejected',
    ['in_app', 'email'],
    { th: 'ไดคัทของคุณไม่ได้รับการอนุมัติ', en: 'Your dieline was not approved' },
    {
      th: 'ไดคัทที่ส่งมาไม่ได้รับการอนุมัติ ดูเหตุผลได้ที่ getpack',
      en: 'Your dieline was not approved; see the reason on getpack',
    },
    'Factory: dieline intake rejected (D-272)',
  ),
  F(
    'factory.daily_digest',
    ['email', 'line'],
    { th: 'สรุปงานประจำวัน {{payload.day}}', en: 'Daily digest {{payload.day}}' },
    {
      th: 'รอรับงาน {{payload.awaitingAcceptance}} · ครบกำหนดวันนี้ {{payload.dueToday}} · ขั้นตอนเลยกำหนด {{payload.overdueSteps}} · เสี่ยงล่าช้า {{payload.atRisk}}',
      en: 'Awaiting acceptance {{payload.awaitingAcceptance}} · due today {{payload.dueToday}} · overdue steps {{payload.overdueSteps}} · at risk {{payload.atRisk}}',
    },
    'Factory: daily digest (D-075)',
  ),
  F(
    'call_off.requested',
    ['in_app', 'email', 'line'],
    { th: 'คำขอสัญญาสั่งผลิตแบบทยอยใหม่', en: 'New call-off request' },
    {
      th: 'ลูกค้าขอให้คงราคาสำหรับ {{payload.committedQuantity}} หน่วย {{payload.months}} เดือน กรุณาตอบรับหรือปฏิเสธที่ getpack',
      en: 'A customer asks you to hold the price for {{payload.committedQuantity}} units for {{payload.months}} months; accept or decline on getpack',
    },
    'Factory: call-off agreement requested (D-290)',
  ),
];

const GREETING = { th: 'เรียน', en: 'Dear' };
const FOOTER = {
  th: 'ข้อความนี้ส่งจาก getpack โดยอัตโนมัติ',
  en: 'This message was sent automatically by getpack',
};

const keyOf = (r: Row) => `${r.event}:${r.audience}${r.team ? `:${r.team}` : ''}`;

/** D-299: a message to one person (customer, factory user) ends with its deep link when the event has a page. */
const LINK = {
  th: {
    email: '{{#if link}}<a href="{{link}}">เปิดใน getpack</a>{{/if}}',
    text: '{{#if link}}\n{{link}}{{/if}}',
  },
  en: {
    email: '{{#if link}}<a href="{{link}}">Open in getpack</a>{{/if}}',
    text: '{{#if link}}\n{{link}}{{/if}}',
  },
};
const linked = (r: Row, channel: Channel) =>
  r.audience !== 'staff_team' && ['email', 'line', 'sms'].includes(channel);
function linkOf(r: Row, lang: 'th' | 'en', kind: 'email' | 'text'): string {
  if (!r.linkLabel) return LINK[lang][kind];
  return kind === 'email'
    ? `{{#if link}}<a href="{{link}}">${r.linkLabel[lang]}</a>{{/if}}`
    : `{{#if link}}\n${r.linkLabel[lang]}: {{link}}{{/if}}`;
}
function bodyOf(r: Row, channel: Channel, lang: 'th' | 'en'): string {
  const withLink = (body: string, kind: 'email' | 'text') =>
    linked(r, channel) ? `${body}${kind === 'email' ? '<br/>' : ''}${linkOf(r, lang, kind)}` : body;
  return channel === 'email'
    ? email(GREETING[lang], withLink(r.body[lang], 'email'), FOOTER[lang])
    : withLink(r.body[lang], 'text');
}

export const MATRIX_TEMPLATES: NotificationTemplateSeed[] = ROWS.flatMap((r) =>
  r.channels.map((channel) => ({
    key: keyOf(r),
    channel,
    category: r.category ?? ('transactional' as const),
    description: r.description,
    versions: {
      th: { subject: r.subject.th, body: bodyOf(r, channel, 'th') },
      en: { subject: r.subject.en, body: bodyOf(r, channel, 'en') },
    },
  })),
);

export const MATRIX_ROUTES: NotificationRouteSeed[] = ROWS.flatMap((r) =>
  r.channels.map((channel) => ({
    eventType: r.event,
    audience: r.audience,
    templateKey: keyOf(r),
    channel,
    ...(r.team && { staffTeamCode: r.team }),
    ...(r.critical?.includes(channel) && { isCritical: true }),
    ...(r.conditions && { conditions: r.conditions }),
  })),
);
