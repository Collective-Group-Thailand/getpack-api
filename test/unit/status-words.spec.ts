import { consentLabels, LABELLED_CONSENT_PURPOSES } from '@common/labels/consent-labels';
import {
  LABELLED_ENUMS,
  STATUS_LABELS,
  type StatusLabel,
  statusLabel,
  statusLabels,
} from '@common/labels/status-labels';
import { STATUS_LABEL_DICTIONARY } from '@modules/catalog/store/status-labels.controller';
import { activityMessage, hasActivityMessage } from '@modules/timeline/activity-messages';
import { collapseRepeats } from '@modules/timeline/timeline.service';
import { eventTypeLabels, hasEventTypeLabel } from '@platform/notifications/event-type-labels';

import contract from '../../contract/openapi.json';
import { NOTIFICATION_ROUTES, NOTIFICATION_TEMPLATES } from '../../prisma/seed/data/notifications';
import { CONSENT_PURPOSES } from '../../prisma/seed/data/reference';

/** UX round 2 Phase 4 §A3 / §A6 (B2, B8, B13, B14), D-313: the API speaks in words, never in keys. */
describe('status words (D-313)', () => {
  const schemas = (contract as { components: { schemas: Record<string, { enum?: string[] }> } }).components
    .schemas;

  it('labels every value of every labelled enum the contract publishes, in three non-empty words', () => {
    for (const enumName of LABELLED_ENUMS) {
      const values = schemas[enumName]?.enum ?? [];
      expect(values.length).toBeGreaterThan(0);
      const labels = STATUS_LABELS[enumName] as Record<string, StatusLabel>;
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const l of Object.values(labels)) {
        expect(l.th.trim()).not.toBe('');
        expect(l.adminTh.trim()).not.toBe('');
        expect(l.en.trim()).not.toBe('');
      }
    }
  });

  it('keeps "Proof" for staff and the glossary words for customers', () => {
    for (const enumName of LABELLED_ENUMS)
      for (const l of Object.values(STATUS_LABELS[enumName] as Record<string, StatusLabel>))
        expect(l.th).not.toMatch(/Proof/);
    expect(statusLabel('ProofStatus', 'approved')).toEqual({
      th: 'อนุมัติแบบตัวอย่างแล้ว',
      adminTh: 'Proof อนุมัติแล้ว',
      en: 'Approved',
    });
  });

  it('never shows a customer that a factory turned a job down (D-050)', () => {
    expect(statusLabel('ProductionJobStatus', 'rejected').th).not.toMatch(/โรงงาน/);
    expect(statusLabel('ProductionJobStatus', 'released').th).not.toMatch(/โรงงาน/);
    expect(statusLabel('ClaimStatus', 'factory_review').th).not.toMatch(/โรงงาน/);
  });

  it('spreads the words next to any status field, null for a null status', () => {
    expect(statusLabels('ShipmentStatus', 'in_transit')).toEqual({
      statusLabelTh: 'กำลังส่ง',
      statusLabelAdminTh: 'กำลังส่ง',
    });
    expect(statusLabels('PreflightStatus', null, 'preflightStatus')).toEqual({
      preflightStatusLabelTh: null,
      preflightStatusLabelAdminTh: null,
    });
    expect(statusLabel('OrderStatus', 'brand_new')).toEqual({
      th: 'brand_new',
      adminTh: 'brand_new',
      en: 'brand_new',
    });
  });

  it('publishes the same words in the dictionary', () => {
    const proof = STATUS_LABEL_DICTIONARY.find((e) => e.enumName === 'ProofStatus')!;
    expect(proof.values).toContainEqual({
      value: 'pending_customer',
      labelTh: 'รอคุณตรวจแบบตัวอย่าง',
      labelAdminTh: 'รอ Proof จากลูกค้า',
      labelEn: 'Awaiting customer',
    });
    expect(STATUS_LABEL_DICTIONARY).toHaveLength(LABELLED_ENUMS.length);
  });
});

describe('timeline words (B13)', () => {
  /** Every action seen in the customer's order timeline (UAT rehearsal data, 2026-10-07) plus the fixed ones. */
  const CUSTOMER_ACTIONS = [
    'order.status_changed',
    'production.milestone_reached',
    'instalment.due',
    'customer_document.issued',
    'order.placed',
    'payment_schedule.created',
    'order_group.placed',
    'payment.initiated',
    'instalment.paid',
    'payment.received',
    'order_group.status_changed',
    'artwork.submitted',
    'artwork.preflight_completed',
    'proof.sent',
    'production.queued',
    'artwork.accepted_for_proof',
    'proof.approved',
    'delivery.reconciled',
    'order_group.company_approval_requested',
    'claim.under_review',
    'payment.slip_review_required',
    'payment.slip_uploaded',
    'claim.submitted',
    'review.submitted',
    'order.tracking_link_created',
    'order.charge_added',
    'artwork.reused',
    'instalment.reminder',
    'customer_document.voided',
    'order_group.requoted',
  ];

  it('has a sentence of its own for every action a customer sees', () => {
    expect(CUSTOMER_ACTIONS.filter((a) => !hasActivityMessage(a))).toEqual([]);
  });

  it('tells status changes apart by the status reached', () => {
    expect(
      activityMessage('order.status_changed', { from: 'waiting_payment', to: 'paid_for_production' }),
    ).toEqual({
      th: 'สถานะรายการ: ชำระเงินแล้ว',
      en: 'Item status: Paid',
    });
    expect(activityMessage('order_group.status_changed', { to: 'completed' }).th).toBe(
      'สถานะคำสั่งซื้อ: สำเร็จ',
    );
    expect(activityMessage('instalment.due', { seq: 2 }).th).toBe('ถึงกำหนดชำระ งวดที่ 2');
    expect(activityMessage('customer_document.issued', { docNumber: 'TR-1' }).th).toBe('ออกเอกสาร TR-1');
    expect(activityMessage('shipment.out_for_delivery', {}).th).toBe('การจัดส่ง: กำลังนำส่ง');
    expect(activityMessage('production.milestone_reached', { labelTh: 'กำลังพิมพ์' }).th).toBe('กำลังพิมพ์');
    // D-439: rows recorded with the old step words read without the factory.
    expect(activityMessage('production.milestone_reached', { labelTh: 'โรงงานรับงานแล้ว' }).th).toBe(
      'รับงานเข้าผลิตแล้ว',
    );
  });

  it('falls back per domain, never to the raw key', () => {
    expect(activityMessage('payment.something_new', {}).th).toBe('อัปเดตการชำระเงิน');
    expect(activityMessage('order.something_new', {}).th).toBe('อัปเดตคำสั่งซื้อ');
  });

  it('collapses consecutive repeats into the latest, with a count', () => {
    const e = (key: string, type: string, messageTh: string) => ({ _key: key, type, messageTh, count: 1 });
    const out = collapseRepeats([
      e('3', 'instalment.reminder', 'แจ้งเตือน งวดที่ 1'),
      e('1', 'order.placed', 'สร้าง'),
      e('2', 'instalment.reminder', 'แจ้งเตือน งวดที่ 1'),
      e('4', 'instalment.reminder', 'แจ้งเตือน งวดที่ 2'),
      e('5', 'instalment.reminder', 'แจ้งเตือน งวดที่ 1'),
    ]);
    expect(out.map((x) => [x._key, x.count])).toEqual([
      ['1', 1],
      ['3', 2],
      ['4', 1],
      ['5', 1],
    ]);
  });
});

describe('consent and notification words (B8, B2)', () => {
  it('names every seeded consent purpose', () => {
    expect(CONSENT_PURPOSES.map((p) => p.key).filter((k) => !LABELLED_CONSENT_PURPOSES.includes(k))).toEqual(
      [],
    );
    expect(consentLabels('marketing_line')).toEqual({
      labelTh: 'รับข่าวสารและโปรโมชันทาง LINE',
      labelEn: 'News and offers on LINE',
    });
    expect(consentLabels('new_purpose').labelTh).toBe('new purpose');
  });

  it('labels every routed notification event', () => {
    const events = [...new Set(NOTIFICATION_ROUTES.map((r) => r.eventType))];
    expect(events.filter((e) => !hasEventTypeLabel(e))).toEqual([]);
    expect(eventTypeLabels('proof.sent')).toEqual({
      eventTypeLabelTh: 'แบบตัวอย่าง',
      eventTypeLabelEn: 'Proof',
    });
  });

  it('prints no snake_case key in any seeded template text', () => {
    const literal = (text: string) => text.replace(/\{\{[^}]*\}\}/g, '').replace(/https?:\/\/\S+/g, '');
    const offenders = NOTIFICATION_TEMPLATES.flatMap((t) =>
      (['th', 'en'] as const).flatMap((lang) => {
        const v = t.versions[lang];
        const text = literal(`${v.subject ?? ''} ${v.body}`);
        return /\b[a-z]+_[a-z_]+\b/.test(text) ? [`${t.key}|${t.channel}|${lang}`] : [];
      }),
    );
    expect(offenders).toEqual([]);
  });
});
