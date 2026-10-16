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
    ] as const
  ).map(([eventType, channel]): NotificationRouteSeed => ({
    eventType,
    audience: 'customer',
    templateKey: `${eventType}:customer`,
    channel,
  })),
];
