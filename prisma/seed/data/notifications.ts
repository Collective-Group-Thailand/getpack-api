import { MATRIX_ROUTES, MATRIX_TEMPLATES } from './notification-matrix';

/**
 * Platform notifications seeded by `pnpm db:seed` (B1.3): approvers hear about requests routed to
 * them (ADR-0006). Business notifications (orders, payments, shipping…) are added with their modules
 * (the full D-143 matrix in B4.6). Texts are editable templates; the seed never overwrites them.
 */
export interface NotificationTemplateSeed {
  key: string;
  channel: 'email' | 'in_app' | 'line' | 'sms' | 'web_push' | 'teams';
  category: 'transactional' | 'marketing' | 'security';
  description: string;
  versions: Record<'th' | 'en', { subject?: string; body: string }>;
}

export interface NotificationRouteSeed {
  eventType: string;
  audience: 'customer' | 'company_member' | 'staff_team' | 'factory' | 'assignee';
  templateKey: string;
  channel: NotificationTemplateSeed['channel'];
  isCritical?: boolean;
  /** For `staff_team` routes: the team (TEAMS code). */
  staffTeamCode?: string;
}

const PLATFORM_TEMPLATES: readonly NotificationTemplateSeed[] = [
  {
    key: 'approval.requested:assignee',
    channel: 'in_app',
    category: 'transactional',
    description: 'Approvers: a request waits for your decision (ADR-0006)',
    versions: {
      th: { subject: 'มีคำขออนุมัติรอคุณ', body: 'คำขออนุมัติ {{payload.policyKey}} รอการตัดสินใจของคุณ' },
      en: {
        subject: 'An approval waits for you',
        body: 'A {{payload.policyKey}} request waits for your decision',
      },
    },
  },
  {
    key: 'approval.requested:assignee',
    channel: 'email',
    category: 'transactional',
    description: 'Approvers: a request waits for your decision (ADR-0006)',
    versions: {
      th: {
        subject: 'มีคำขออนุมัติรอคุณ ({{payload.policyKey}})',
        body: '<mjml><mj-body><mj-section><mj-column><mj-text>เรียน {{recipient.displayName}}</mj-text><mj-text>คำขออนุมัติ {{payload.policyKey}} รอการตัดสินใจของคุณในระบบ Packio</mj-text></mj-column></mj-section></mj-body></mjml>',
      },
      en: {
        subject: 'An approval waits for you ({{payload.policyKey}})',
        body: '<mjml><mj-body><mj-section><mj-column><mj-text>Dear {{recipient.displayName}}</mj-text><mj-text>A {{payload.policyKey}} request waits for your decision in Packio.</mj-text></mj-column></mj-section></mj-body></mjml>',
      },
    },
  },
  {
    key: 'approval.step_approved:assignee',
    channel: 'in_app',
    category: 'transactional',
    description: 'Next approvers: an earlier step was approved and the request is now yours (ADR-0006)',
    versions: {
      th: {
        subject: 'มีคำขออนุมัติรอคุณ',
        body: 'คำขออนุมัติ {{payload.policyKey}} ผ่านขั้นก่อนหน้าแล้ว รอการตัดสินใจของคุณ',
      },
      en: {
        subject: 'An approval waits for you',
        body: 'A {{payload.policyKey}} request passed the previous step and waits for you',
      },
    },
  },
  {
    key: 'approval.sla_breached:assignee',
    channel: 'in_app',
    category: 'transactional',
    description: 'Approvers: a request is past its SLA (ADR-0006)',
    versions: {
      th: {
        subject: 'คำขออนุมัติเกินกำหนด',
        body: 'คำขออนุมัติ {{payload.policyKey}} เกินเวลาที่กำหนดแล้ว กรุณาดำเนินการ',
      },
      en: {
        subject: 'Approval overdue',
        body: 'A {{payload.policyKey}} request is past its deadline; please decide',
      },
    },
  },
  {
    key: 'report_run.completed:assignee',
    channel: 'in_app',
    category: 'transactional',
    description: 'Recipients of a report: the file is ready to download in Packio (B6.2)',
    versions: {
      th: { subject: 'รายงานพร้อมแล้ว', body: 'รายงาน {{payload.reportNameTh}} พร้อมดาวน์โหลดแล้ว ({{payload.rowCount}} แถว)' },
      en: { subject: 'Report ready', body: 'The {{payload.reportNameEn}} report is ready to download ({{payload.rowCount}} rows)' },
    },
  },
  {
    key: 'report_run.completed:assignee',
    channel: 'email',
    category: 'transactional',
    description: 'Recipients of a report: the file is ready to download in Packio — never attached (B6.2)',
    versions: {
      th: {
        subject: 'รายงาน {{payload.reportNameTh}} พร้อมแล้ว',
        body: '<mjml><mj-body><mj-section><mj-column><mj-text>เรียน {{recipient.displayName}}</mj-text><mj-text>รายงาน {{payload.reportNameTh}} ({{payload.rowCount}} แถว) พร้อมดาวน์โหลดในเมนูรายงานของระบบ Packio</mj-text></mj-column></mj-section></mj-body></mjml>',
      },
      en: {
        subject: 'The {{payload.reportNameEn}} report is ready',
        body: '<mjml><mj-body><mj-section><mj-column><mj-text>Dear {{recipient.displayName}}</mj-text><mj-text>The {{payload.reportNameEn}} report ({{payload.rowCount}} rows) is ready to download from Reports in Packio.</mj-text></mj-column></mj-section></mj-body></mjml>',
      },
    },
  },
  {
    key: 'report_run.failed:assignee',
    channel: 'in_app',
    category: 'transactional',
    description: 'Recipients of a report: the file could not be generated (B6.2)',
    versions: {
      th: { subject: 'สร้างรายงานไม่สำเร็จ', body: 'สร้างรายงาน {{payload.reportNameTh}} ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ' },
      en: { subject: 'Report failed', body: 'The {{payload.reportNameEn}} report could not be generated; please contact an administrator' },
    },
  },
];

const PLATFORM_ROUTES: readonly NotificationRouteSeed[] = [
  {
    eventType: 'approval.requested',
    audience: 'assignee',
    templateKey: 'approval.requested:assignee',
    channel: 'in_app',
  },
  {
    eventType: 'approval.requested',
    audience: 'assignee',
    templateKey: 'approval.requested:assignee',
    channel: 'email',
  },
  {
    eventType: 'approval.step_approved',
    audience: 'assignee',
    templateKey: 'approval.step_approved:assignee',
    channel: 'in_app',
  },
  {
    eventType: 'approval.sla_breached',
    audience: 'assignee',
    templateKey: 'approval.sla_breached:assignee',
    channel: 'in_app',
  },
  {
    eventType: 'report_run.completed',
    audience: 'assignee',
    templateKey: 'report_run.completed:assignee',
    channel: 'in_app',
  },
  {
    eventType: 'report_run.completed',
    audience: 'assignee',
    templateKey: 'report_run.completed:assignee',
    channel: 'email',
  },
  {
    eventType: 'report_run.failed',
    audience: 'assignee',
    templateKey: 'report_run.failed:assignee',
    channel: 'in_app',
  },
];

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  ...PLATFORM_TEMPLATES,
  ...MATRIX_TEMPLATES,
];
export const NOTIFICATION_ROUTES: readonly NotificationRouteSeed[] = [...PLATFORM_ROUTES, ...MATRIX_ROUTES];
