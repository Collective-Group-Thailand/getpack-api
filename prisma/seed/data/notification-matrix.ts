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
      th: 'งวดที่ {{payload.seq}} จำนวน {{payload.cashAmount}} บาท ถึงกำหนดชำระแล้ว ชำระได้ที่ Packio',
      en: 'Instalment {{payload.seq}} of THB {{payload.cashAmount}} is due; pay on Packio',
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
      th: 'คำสั่งซื้อ {{payload.groupCode}} งวดที่ {{payload.seq}} จำนวน {{payload.cashAmount}} บาท รอการชำระ ชำระได้ที่ Packio',
      en: 'Order {{payload.groupCode}}: instalment {{payload.seq}} of THB {{payload.cashAmount}} is waiting; pay on Packio',
    },
    'Customer: CS reminds of an instalment due (U-B0.2, D-143)',
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
    { th: 'พรูฟพร้อมให้ตรวจแล้ว', en: 'Your proof is ready' },
    {
      th: 'พรูฟงานของคุณพร้อมแล้ว โปรดตรวจและอนุมัติเพื่อเริ่มผลิต',
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
      th: 'สินค้าของคุณออกจัดส่งแล้ว (เลขที่ {{payload.shipmentNo}}) ติดตามได้ที่ Packio',
      en: 'Your order has shipped (no. {{payload.shipmentNo}}); track it on Packio',
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
    'Customer: Packio asks for information (D-082)',
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
      th: 'เคลม {{payload.claimNo}} ไม่ได้รับการอนุมัติ ดูรายละเอียดได้ที่ Packio',
      en: 'Claim {{payload.claimNo}} was not approved; see the details on Packio',
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
      th: 'ใบเสนอราคาตามคำขอของคุณพร้อมแล้ว ดูและสั่งซื้อได้ที่ Packio',
      en: 'The quotation you asked for is ready; view and order it on Packio',
    },
    'Customer: RFQ quoted (D-062)',
  ),
  C(
    'rfq.info_requested',
    ['email', 'line'],
    { th: 'ขอข้อมูลเพิ่มเติมสำหรับคำขอใบเสนอราคา', en: 'More information needed for your request' },
    {
      th: 'ทีมงานต้องการข้อมูลเพิ่มเติมเพื่อเสนอราคา โปรดตอบกลับที่ Packio',
      en: 'Our team needs more information to quote; please reply on Packio',
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
  C(
    'points.expiring',
    ['email'],
    { th: 'คะแนนสะสมใกล้หมดอายุ', en: 'Points about to expire' },
    {
      th: 'คะแนนสะสมบางส่วนของคุณจะหมดอายุเร็ว ๆ นี้ ใช้เป็นส่วนลดได้ที่ Packio',
      en: 'Some of your points expire soon; use them as a discount on Packio',
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
    { th: 'ลูกค้าขอแก้พรูฟ', en: 'Proof changes requested' },
    {
      th: 'ลูกค้าขอแก้ไขพรูฟ โปรดดูความเห็นและส่งพรูฟใหม่',
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
      th: 'งาน {{payload.jobNo}} ต้องตรวจคุณภาพโดย Packio',
      en: 'Job {{payload.jobNo}} needs a Packio inspection',
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
  F(
    'rfq.consultation_requested',
    ['in_app', 'email', 'line'],
    { th: 'ขอราคา {{payload.rfqCode}}', en: 'Price request {{payload.rfqCode}}' },
    {
      th: 'Packio ขอราคางาน {{payload.rfqCode}} ตอบได้ในพื้นที่พาร์ทเนอร์',
      en: 'Packio asks your price for {{payload.rfqCode}}; answer in the partner zone',
    },
    'Factory: Packio asks for a buy price (D-043, D-143)',
  ),
  F(
    'rfq.consultation_reminded',
    ['in_app', 'email', 'line'],
    { th: 'เตือนขอราคา {{payload.rfqCode}}', en: 'Reminder: price request {{payload.rfqCode}}' },
    {
      th: 'Packio รอราคางาน {{payload.rfqCode}} ของคุณ ตอบได้ในพื้นที่พาร์ทเนอร์',
      en: 'Packio is waiting for your price for {{payload.rfqCode}}; answer in the partner zone',
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
      th: 'Packio พักงาน {{payload.jobNo}} ไว้ ({{payload.reason}})',
      en: 'Packio put job {{payload.jobNo}} on hold ({{payload.reason}})',
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
      th: 'Packio นัดตรวจคุณภาพงาน {{payload.jobNo}} ({{payload.scheduledAt}})',
      en: 'Packio scheduled an inspection of {{payload.jobNo}} ({{payload.scheduledAt}})',
    },
    'Factory: inspection scheduled (D-076)',
  ),
  F(
    'shipment.carrier_booked',
    ['in_app', 'email'],
    { th: 'จองขนส่งให้ {{payload.shipmentNo}}', en: 'Carrier booked for {{payload.shipmentNo}}' },
    {
      th: 'Packio จองขนส่ง {{payload.carrier}} มารับ {{payload.shipmentNo}} ที่โรงงาน',
      en: 'Packio booked {{payload.carrier}} to collect {{payload.shipmentNo}} at the factory',
    },
    'Factory: fallback carrier booked (D-114)',
  ),
  F(
    'claim.sent_to_factory',
    ['in_app', 'email', 'line'],
    { th: 'เคลม {{payload.claimNo}} รอโรงงานตอบ', en: 'Claim {{payload.claimNo}} for your review' },
    {
      th: 'Packio ส่งเคลม {{payload.claimNo}} ให้โรงงานพิจารณา โปรดตอบรับหรือโต้แย้ง',
      en: 'Packio sent claim {{payload.claimNo}} for your review: accept or dispute',
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
];

const GREETING = { th: 'เรียน', en: 'Dear' };
const FOOTER = {
  th: 'ข้อความนี้ส่งจาก Packio โดยอัตโนมัติ',
  en: 'This message was sent automatically by Packio',
};

const keyOf = (r: Row) => `${r.event}:${r.audience}${r.team ? `:${r.team}` : ''}`;

export const MATRIX_TEMPLATES: NotificationTemplateSeed[] = ROWS.flatMap((r) =>
  r.channels.map((channel) => ({
    key: keyOf(r),
    channel,
    category: 'transactional' as const,
    description: r.description,
    versions: {
      th: {
        subject: r.subject.th,
        body: channel === 'email' ? email(GREETING.th, r.body.th, FOOTER.th) : r.body.th,
      },
      en: {
        subject: r.subject.en,
        body: channel === 'email' ? email(GREETING.en, r.body.en, FOOTER.en) : r.body.en,
      },
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
  })),
);
