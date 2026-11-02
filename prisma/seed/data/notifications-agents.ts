import type { NotificationRouteSeed, NotificationTemplateSeed } from './notifications';

/** The sales agent programme's notifications (D-416, D-420): the applicant / agent and the Sales team. */
const inApp = (
  key: string,
  description: string,
  th: { subject: string; body: string },
  en: { subject: string; body: string },
): NotificationTemplateSeed => ({
  key,
  channel: 'in_app',
  category: 'transactional',
  description,
  versions: { th, en },
});

const mjml = (text: string) =>
  `<mjml><mj-body><mj-section><mj-column><mj-text>{{recipient.displayName}}</mj-text><mj-text>${text}</mj-text></mj-column></mj-section></mj-body></mjml>`;

export const AGENT_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  inApp(
    'sales_agent_application.submitted:staff_team',
    'Sales: a customer applied to become an agent (D-416)',
    { subject: 'มีผู้สมัครเป็นตัวแทนขาย', body: '{{payload.legalName}} สมัครเป็นตัวแทนขาย รอการตรวจสอบ' },
    { subject: 'New sales agent application', body: '{{payload.legalName}} applied to become a sales agent' },
  ),
  inApp(
    'sales_agent_application.approved:customer',
    'Applicant: the agent application was approved (D-416)',
    {
      subject: 'คุณเป็นตัวแทนขาย getpack แล้ว',
      body: 'ใบสมัครได้รับอนุมัติ รหัสตัวแทนของคุณคือ {{payload.code}}',
    },
    {
      subject: 'You are now a getpack sales agent',
      body: 'Your application was approved. Your agent code is {{payload.code}}',
    },
  ),
  {
    key: 'sales_agent_application.approved:customer',
    channel: 'email',
    category: 'transactional',
    description: 'Applicant: the agent application was approved (D-416)',
    versions: {
      th: {
        subject: 'คุณเป็นตัวแทนขาย getpack แล้ว',
        body: mjml(
          'ใบสมัครตัวแทนขายของคุณได้รับอนุมัติ รหัสตัวแทนคือ {{payload.code}} เข้าสู่ระบบเพื่อรับลิงก์ของคุณ',
        ),
      },
      en: {
        subject: 'You are now a getpack sales agent',
        body: mjml(
          'Your sales agent application was approved. Your agent code is {{payload.code}}; sign in for your link.',
        ),
      },
    },
  },
  inApp(
    'sales_agent_application.rejected:customer',
    'Applicant: the agent application was not approved (D-416)',
    { subject: 'ใบสมัครตัวแทนขายไม่ผ่าน', body: 'เหตุผล: {{payload.reason}}' },
    { subject: 'Agent application not approved', body: 'Reason: {{payload.reason}}' },
  ),
  inApp(
    'sales_agent_lead.converted:customer',
    'Agent: a lead became a customer or factory (D-417, D-419)',
    {
      subject: 'ผู้มุ่งหวังของคุณสมัครแล้ว',
      body: '{{payload.contactName}} สมัครใช้งาน getpack แล้ว และผูกกับคุณ',
    },
    { subject: 'Your lead signed up', body: '{{payload.contactName}} joined getpack and is linked to you' },
  ),
  inApp(
    'sales_agent_statement.approved:customer',
    'Agent: the month’s commission statement was approved (D-420)',
    {
      subject: 'สรุปค่าตอบแทนได้รับอนุมัติ',
      body: 'สรุปค่าตอบแทน {{payload.statementNo}} ยอด {{payload.totalAmount}} บาท รอโอน',
    },
    {
      subject: 'Commission statement approved',
      body: 'Statement {{payload.statementNo}} of {{payload.totalAmount}} baht is approved for payment',
    },
  ),
  inApp(
    'sales_agent_statement.paid:customer',
    'Agent: the commission was paid (D-420)',
    { subject: 'โอนค่าตอบแทนแล้ว', body: 'สรุปค่าตอบแทน {{payload.statementNo}} โอนแล้ว' },
    { subject: 'Commission paid', body: 'Statement {{payload.statementNo}} has been paid' },
  ),
  // --- agent portal pack: P0 (D-464, D-465), P1 (D-466) ---
  inApp(
    'sales_agent_commission.margin_alert:staff_team',
    'Management: an order’s agent commission exceeds the margin-alert share of its gross margin; never cut (D-464)',
    {
      subject: 'ค่าคอมตัวแทนเกินสัดส่วนที่ตั้งไว้',
      body: 'คำสั่งซื้อ {{payload.orderCode}} ตัวแทน {{payload.agentCode}} ค่าคอม {{payload.amount}} บาท = {{payload.ratioPct}}% ของกำไรขั้นต้น (เกณฑ์ {{payload.alertPct}}%)',
    },
    {
      subject: 'Agent commission above the margin share',
      body: 'Order {{payload.orderCode}}, agent {{payload.agentCode}}: commission {{payload.amount}} baht = {{payload.ratioPct}}% of gross margin (threshold {{payload.alertPct}}%)',
    },
  ),
  inApp(
    'sales_agent_tax_declaration.submitted:staff_team',
    'Finance: an agent sent a ล.ย.01 to check (D-465)',
    {
      subject: 'มี ล.ย.01 รอตรวจ',
      body: 'ตัวแทน {{payload.agentCode}} ส่ง ล.ย.01 ปีภาษี {{payload.taxYear}}',
    },
    {
      subject: 'A ล.ย.01 to check',
      body: 'Agent {{payload.agentCode}} sent a ล.ย.01 for tax year {{payload.taxYear}}',
    },
  ),
  inApp(
    'sales_agent_tax_declaration.accepted:customer',
    'Agent: the ล.ย.01 was accepted (D-465)',
    { subject: 'ล.ย.01 ใช้ได้แล้ว', body: 'ค่าลดหย่อนปีภาษี {{payload.taxYear}} ใช้กับการหักภาษีครั้งถัดไป' },
    {
      subject: 'ล.ย.01 accepted',
      body: 'Your allowances for tax year {{payload.taxYear}} apply from the next statement',
    },
  ),
  inApp(
    'sales_agent_tax_declaration.rejected:customer',
    'Agent: the ล.ย.01 was not accepted (D-465)',
    { subject: 'ล.ย.01 ยังไม่ผ่าน', body: 'เหตุผล: {{payload.reason}} แก้ไขแล้วส่งใหม่ได้' },
    { subject: 'ล.ย.01 not accepted', body: 'Reason: {{payload.reason}}. Correct it and send it again.' },
  ),
  inApp(
    'sales_agent_payout_profile.submitted:staff_team',
    'Finance: an agent sent payout details to verify (D-466)',
    { subject: 'มีข้อมูลรับเงินของตัวแทนรอตรวจ', body: 'ตัวแทน {{payload.agentCode}} ส่งข้อมูลรับเงินแล้ว' },
    {
      subject: 'Agent payout details to verify',
      body: 'Agent {{payload.agentCode}} sent their payout details',
    },
  ),
  inApp(
    'sales_agent_payout_profile.verified:customer',
    'Agent: payout details verified (D-466)',
    { subject: 'ข้อมูลรับเงินตรวจแล้ว', body: 'ค่าคอมของคุณโอนได้ตามรอบ' },
    { subject: 'Payout details verified', body: 'Your commission can now be paid' },
  ),
  inApp(
    'sales_agent_payout_profile.rejected:customer',
    'Agent: payout details need a correction (D-466)',
    { subject: 'ข้อมูลรับเงินต้องแก้ไข', body: 'เหตุผล: {{payload.reason}}' },
    { subject: 'Payout details need a correction', body: 'Reason: {{payload.reason}}' },
  ),
  inApp(
    'sales_agent_statement.payout_profile_needed:customer',
    'Agent: a statement waits for payout details (D-466)',
    {
      subject: 'กรอกข้อมูลรับเงินเพื่อรับค่าคอม',
      body: 'มีสรุปค่าคอมรอโอน กรอกข้อมูลรับเงินและส่งให้ทีมบัญชีตรวจ ค่าคอมไม่สูญหาย',
    },
    {
      subject: 'Add your payout details to be paid',
      body: 'A commission statement is waiting. Add your payout details and send them to Finance; nothing is lost.',
    },
  ),
  // --- agent portal pack: P2 (D-467) ---
  inApp(
    'sales_agent_commission.earned:customer',
    'Agent: a commission is confirmed (D-467)',
    {
      subject: 'ค่าคอมได้รับการยืนยันแล้ว',
      body: 'ค่าคอม {{payload.amount}} บาท ยืนยันแล้ว รวมในสรุปค่าคอมรอบถัดไป',
    },
    {
      subject: 'Commission confirmed',
      body: 'Commission of {{payload.amount}} baht is confirmed for your next statement',
    },
  ),
  inApp(
    'sales_agent_lead.protection_expiring:customer',
    'Agent: a lead’s protection ends in 7 days / 1 day (D-467)',
    {
      subject: 'สิทธิ์ดูแลลูกค้ามุ่งหวังใกล้หมด',
      body: '{{payload.contactName}} อยู่ในความดูแลของคุณถึง {{payload.protectedUntilDate}} (เหลือไม่เกิน {{payload.daysLeft}} วัน)',
    },
    {
      subject: 'Lead protection ending',
      body: '{{payload.contactName}} stays yours until {{payload.protectedUntilDate}} (within {{payload.daysLeft}} days)',
    },
  ),
  // --- agent portal pack: P3 (D-468) ---
  inApp(
    'sales_agent_lead.follow_up_due:customer',
    'Agent: the follow-up time set on a lead has come (D-468)',
    {
      subject: 'ถึงเวลาติดตามลูกค้ามุ่งหวัง',
      body: 'ติดตาม {{payload.contactName}} ตามที่นัดไว้ {{payload.followUpTime}} น.',
    },
    {
      subject: 'Time to follow up',
      body: 'Follow up {{payload.contactName}} as planned ({{payload.followUpTime}})',
    },
  ),
];

const EMAILS: readonly [string, string, string, string, string][] = [
  [
    'sales_agent_application.rejected',
    'ใบสมัครตัวแทนขายไม่ผ่าน',
    'ใบสมัครตัวแทนขายของคุณยังไม่ผ่าน เหตุผล: {{payload.reason}}',
    'Agent application not approved',
    'Your sales agent application was not approved. Reason: {{payload.reason}}',
  ],
  [
    'sales_agent_lead.converted',
    'ผู้มุ่งหวังของคุณสมัครแล้ว',
    '{{payload.contactName}} สมัครใช้งาน getpack แล้ว และผูกกับคุณ',
    'Your lead signed up',
    '{{payload.contactName}} joined getpack and is linked to you.',
  ],
  [
    'sales_agent_statement.approved',
    'สรุปค่าตอบแทนได้รับอนุมัติ',
    'สรุปค่าตอบแทน {{payload.statementNo}} ยอด {{payload.totalAmount}} บาท ได้รับอนุมัติแล้ว',
    'Commission statement approved',
    'Statement {{payload.statementNo}} of {{payload.totalAmount}} baht is approved.',
  ],
  [
    'sales_agent_tax_declaration.accepted',
    'ล.ย.01 ใช้ได้แล้ว',
    'ค่าลดหย่อนปีภาษี {{payload.taxYear}} ของคุณผ่านการตรวจ และใช้กับการหักภาษีครั้งถัดไป',
    'ล.ย.01 accepted',
    'Your allowances for tax year {{payload.taxYear}} were accepted and apply from the next statement.',
  ],
  [
    'sales_agent_tax_declaration.rejected',
    'ล.ย.01 ยังไม่ผ่าน',
    'แบบ ล.ย.01 ของคุณยังไม่ผ่าน เหตุผล: {{payload.reason}} แก้ไขแล้วส่งใหม่ได้ในหน้าตัวแทน',
    'ล.ย.01 not accepted',
    'Your ล.ย.01 was not accepted. Reason: {{payload.reason}}. Correct it and send it again on your agent pages.',
  ],
  [
    'sales_agent_payout_profile.verified',
    'ข้อมูลรับเงินตรวจแล้ว',
    'ข้อมูลรับเงินของคุณผ่านการตรวจ ค่าคอมโอนได้ตามรอบ',
    'Payout details verified',
    'Your payout details were verified; your commission can now be paid.',
  ],
  [
    'sales_agent_payout_profile.rejected',
    'ข้อมูลรับเงินต้องแก้ไข',
    'ข้อมูลรับเงินของคุณต้องแก้ไข เหตุผล: {{payload.reason}}',
    'Payout details need a correction',
    'Your payout details need a correction. Reason: {{payload.reason}}',
  ],
  [
    'sales_agent_statement.payout_profile_needed',
    'กรอกข้อมูลรับเงินเพื่อรับค่าคอม',
    'มีสรุปค่าคอมรอโอน กรอกข้อมูลรับเงิน (เลขประจำตัวผู้เสียภาษี ที่อยู่ บัญชีธนาคาร) ในหน้าตัวแทน แล้วส่งให้ทีมบัญชีตรวจ ค่าคอมไม่สูญหาย',
    'Add your payout details to be paid',
    'A commission statement is waiting. Add your payout details (tax id, address, bank account) on your agent pages; nothing is lost.',
  ],
  [
    'sales_agent_commission.earned',
    'ค่าคอมได้รับการยืนยันแล้ว',
    'ค่าคอม {{payload.amount}} บาท ได้รับการยืนยันแล้ว และจะรวมในสรุปค่าคอมรอบถัดไป ดูรายละเอียดได้ใน getpack Agent',
    'Commission confirmed',
    'Commission of {{payload.amount}} baht is confirmed and goes into your next statement; details are in getpack Agent.',
  ],
  [
    'sales_agent_lead.protection_expiring',
    'สิทธิ์ดูแลลูกค้ามุ่งหวังใกล้หมด',
    '{{payload.contactName}} อยู่ในความดูแลของคุณถึง {{payload.protectedUntilDate}} (เหลือไม่เกิน {{payload.daysLeft}} วัน) ติดต่อให้ลูกค้าสมัครหรือสั่งซื้อก่อนวันนั้น',
    'Lead protection ending',
    '{{payload.contactName}} stays yours until {{payload.protectedUntilDate}} (within {{payload.daysLeft}} days). Get them to sign up or order before then.',
  ],
  [
    'sales_agent_lead.follow_up_due',
    'ถึงเวลาติดตามลูกค้ามุ่งหวัง',
    'ติดตาม {{payload.contactName}} ตามที่นัดไว้ {{payload.followUpTime}} น. บันทึกผลการติดต่อและตั้งวันติดตามครั้งถัดไปได้ใน getpack Agent',
    'Time to follow up',
    'Follow up {{payload.contactName}} as planned ({{payload.followUpTime}}). Log the contact and set the next follow-up in getpack Agent.',
  ],
  [
    'sales_agent_statement.paid',
    'โอนค่าตอบแทนแล้ว',
    'สรุปค่าตอบแทน {{payload.statementNo}} โอนแล้ว ดาวน์โหลดหนังสือรับรองการหักภาษีได้ในหน้าตัวแทน',
    'Commission paid',
    'Statement {{payload.statementNo}} has been paid; the withholding certificate is on your agent pages.',
  ],
];

export const AGENT_EMAIL_TEMPLATES: readonly NotificationTemplateSeed[] = EMAILS.map(
  ([event, subjectTh, bodyTh, subjectEn, bodyEn]): NotificationTemplateSeed => ({
    key: `${event}:customer`,
    channel: 'email',
    category: 'transactional',
    description: `Agent: ${event} (D-416, D-420)`,
    versions: {
      th: { subject: subjectTh, body: mjml(bodyTh) },
      en: { subject: subjectEn, body: mjml(bodyEn) },
    },
  }),
);

/**
 * D-467: the six agent events the agent chooses channels for, on push (getpack Agent PWA) and LINE OA. Plain text;
 * customer words only (no profit / margin wording, D-464).
 */
const AGENT_ZONE_MESSAGES: readonly [
  string,
  { subject: string; body: string },
  { subject: string; body: string },
][] = [
  [
    'sales_agent_lead.converted',
    {
      subject: 'ลูกค้ามุ่งหวังสมัครแล้ว',
      body: '{{payload.contactName}} สมัครใช้งาน getpack แล้ว และผูกกับคุณ',
    },
    { subject: 'Your lead signed up', body: '{{payload.contactName}} joined getpack and is linked to you' },
  ],
  [
    'sales_agent_lead.protection_expiring',
    {
      subject: 'สิทธิ์ดูแลลูกค้ามุ่งหวังใกล้หมด',
      body: '{{payload.contactName}} อยู่ในความดูแลของคุณถึง {{payload.protectedUntilDate}} (เหลือไม่เกิน {{payload.daysLeft}} วัน)',
    },
    {
      subject: 'Lead protection ending',
      body: '{{payload.contactName}} stays yours until {{payload.protectedUntilDate}} (within {{payload.daysLeft}} days)',
    },
  ],
  [
    'sales_agent_commission.earned',
    {
      subject: 'ค่าคอมได้รับการยืนยันแล้ว',
      body: 'ค่าคอม {{payload.amount}} บาท ยืนยันแล้ว รวมในสรุปค่าคอมรอบถัดไป',
    },
    {
      subject: 'Commission confirmed',
      body: 'Commission of {{payload.amount}} baht is confirmed for your next statement',
    },
  ],
  [
    'sales_agent_statement.approved',
    {
      subject: 'สรุปค่าคอมพร้อมแล้ว',
      body: 'สรุปค่าคอม {{payload.statementNo}} ยอด {{payload.totalAmount}} บาท อนุมัติแล้ว รอโอน',
    },
    {
      subject: 'Commission statement ready',
      body: 'Statement {{payload.statementNo}} of {{payload.totalAmount}} baht is approved for payment',
    },
  ],
  [
    'sales_agent_statement.paid',
    {
      subject: 'โอนค่าคอมแล้ว',
      body: 'สรุปค่าคอม {{payload.statementNo}} โอนแล้ว ดาวน์โหลดหนังสือรับรองการหักภาษีได้ใน getpack Agent',
    },
    {
      subject: 'Commission paid',
      body: 'Statement {{payload.statementNo}} has been paid; the withholding certificate is in getpack Agent',
    },
  ],
  [
    'sales_agent_lead.follow_up_due',
    {
      subject: 'ถึงเวลาติดตามลูกค้ามุ่งหวัง',
      body: 'ติดตาม {{payload.contactName}} ตามที่นัดไว้ {{payload.followUpTime}} น.',
    },
    {
      subject: 'Time to follow up',
      body: 'Follow up {{payload.contactName}} as planned ({{payload.followUpTime}})',
    },
  ],
  [
    'sales_agent_statement.payout_profile_needed',
    {
      subject: 'กรอกข้อมูลรับเงินเพื่อรับค่าคอม',
      body: 'มีสรุปค่าคอมรอโอน กรอกข้อมูลรับเงินใน getpack Agent แล้วส่งให้ทีมบัญชีตรวจ ค่าคอมไม่สูญหาย',
    },
    {
      subject: 'Add your payout details to be paid',
      body: 'A commission statement is waiting. Add your payout details in getpack Agent; nothing is lost.',
    },
  ],
];

export const AGENT_ZONE_TEMPLATES: readonly NotificationTemplateSeed[] = AGENT_ZONE_MESSAGES.flatMap(
  ([event, th, en]) =>
    (['web_push', 'line'] as const).map((channel): NotificationTemplateSeed => ({
      key: `${event}:customer`,
      channel,
      category: 'transactional',
      description: `Agent (${channel === 'line' ? 'LINE OA' : 'getpack Agent push'}): ${event} (D-467)`,
      versions:
        channel === 'line'
          ? { th: { body: `${th.subject}\n${th.body}` }, en: { body: `${en.subject}\n${en.body}` } }
          : { th, en },
    })),
);

export const AGENT_NOTIFICATION_ROUTES: readonly NotificationRouteSeed[] = [
  {
    eventType: 'sales_agent_application.submitted',
    audience: 'staff_team',
    staffTeamCode: 'sales',
    templateKey: 'sales_agent_application.submitted:staff_team',
    channel: 'in_app',
  },
  ...(
    [
      ['sales_agent_commission.margin_alert', 'management'],
      ['sales_agent_tax_declaration.submitted', 'finance'],
      ['sales_agent_payout_profile.submitted', 'finance'],
    ] as const
  ).map(([eventType, team]): NotificationRouteSeed => ({
    eventType,
    audience: 'staff_team',
    staffTeamCode: team,
    templateKey: `${eventType}:staff_team`,
    channel: 'in_app',
  })),
  ...(
    [
      ['sales_agent_tax_declaration.accepted', 'in_app'],
      ['sales_agent_tax_declaration.accepted', 'email'],
      ['sales_agent_tax_declaration.rejected', 'in_app'],
      ['sales_agent_tax_declaration.rejected', 'email'],
      ['sales_agent_payout_profile.verified', 'in_app'],
      ['sales_agent_payout_profile.verified', 'email'],
      ['sales_agent_payout_profile.rejected', 'in_app'],
      ['sales_agent_payout_profile.rejected', 'email'],
      ['sales_agent_statement.payout_profile_needed', 'in_app'],
      ['sales_agent_statement.payout_profile_needed', 'email'],
      ['sales_agent_application.approved', 'in_app'],
      ['sales_agent_application.approved', 'email'],
      ['sales_agent_application.rejected', 'in_app'],
      ['sales_agent_application.rejected', 'email'],
      ['sales_agent_lead.converted', 'in_app'],
      ['sales_agent_lead.converted', 'email'],
      ['sales_agent_statement.approved', 'in_app'],
      ['sales_agent_statement.approved', 'email'],
      ['sales_agent_statement.paid', 'in_app'],
      ['sales_agent_statement.paid', 'email'],
      // D-467: the agent zone's events on every channel the agent chooses from
      ['sales_agent_commission.earned', 'in_app'],
      ['sales_agent_commission.earned', 'email'],
      ['sales_agent_lead.protection_expiring', 'in_app'],
      ['sales_agent_lead.protection_expiring', 'email'],
      // D-468: follow-up reminders
      ['sales_agent_lead.follow_up_due', 'in_app'],
      ['sales_agent_lead.follow_up_due', 'email'],
      ...AGENT_ZONE_MESSAGES.flatMap(([event]) => [[event, 'web_push'] as const, [event, 'line'] as const]),
    ] as const
  ).map(([eventType, channel]): NotificationRouteSeed => ({
    eventType,
    audience: 'customer',
    templateKey: `${eventType}:customer`,
    channel,
  })),
];
