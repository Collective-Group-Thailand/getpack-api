import type { NotificationRouteSeed, NotificationTemplateSeed } from './notifications';

/**
 * D-469 / D-470: the company sales desk's staff notifications — to the people the event is about (audience
 * `assignee`, resolved by the sales desk: the rep, the sales managers, the deciders of an approval level). In-app,
 * e-mail and web push. No contact data in any message (PDPA): the reference only.
 */
type Text = { subject: string; body: string };
const mjml = (text: string) =>
  `<mjml><mj-body><mj-section><mj-column><mj-text>{{recipient.displayName}}</mj-text><mj-text>${text}</mj-text></mj-column></mj-section></mj-body></mjml>`;

/** [event, description, th, en] — one template per channel. */
export const SALES_DESK_MESSAGES: readonly [string, string, Text, Text][] = [
  [
    'sales_inbound_lead.assigned',
    'Rep: an inbound sales enquiry was assigned to you (D-469)',
    {
      subject: 'มีงานขายใหม่ถึงคุณ',
      body: 'ได้รับมอบหมายรายการ {{payload.mode}} โปรดติดต่อลูกค้าภายในเวลาที่กำหนด',
    },
    {
      subject: 'A sales enquiry is yours',
      body: 'An enquiry was assigned to you ({{payload.mode}}); answer it in time',
    },
  ],
  [
    'sales_inbound_lead.sla_breached',
    'Sales managers: an inbound enquiry passed its first-response time (D-469, P-05)',
    {
      subject: 'งานขายเกินเวลาตอบกลับ',
      body: 'รายการ {{payload.sourceRef}} ยังไม่มีการตอบกลับเกินเวลาที่กำหนด ผู้รับผิดชอบ: {{payload.assigneeName}}',
    },
    {
      subject: 'Sales enquiry past its reply time',
      body: 'Enquiry {{payload.sourceRef}} has no answer past its due time. Rep: {{payload.assigneeName}}',
    },
  ],
];

const CHANNELS = ['in_app', 'email', 'web_push'] as const;

export const SALES_DESK_TEMPLATES: readonly NotificationTemplateSeed[] = SALES_DESK_MESSAGES.flatMap(
  ([event, description, th, en]) =>
    CHANNELS.map((channel): NotificationTemplateSeed => ({
      key: `${event}:assignee`,
      channel,
      category: 'transactional',
      description,
      versions:
        channel === 'email'
          ? {
              th: { subject: th.subject, body: mjml(th.body) },
              en: { subject: en.subject, body: mjml(en.body) },
            }
          : { th, en },
    })),
);

export const SALES_DESK_ROUTES: readonly NotificationRouteSeed[] = SALES_DESK_MESSAGES.flatMap(([event]) =>
  CHANNELS.map((channel): NotificationRouteSeed => ({
    eventType: event,
    audience: 'assignee',
    templateKey: `${event}:assignee`,
    channel,
  })),
);
