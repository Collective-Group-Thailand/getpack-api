#!/usr/bin/env node
/**
 * C12 (owner-delegated 2026-10-29, DECISIONS-STAGE-A §17.3, D-460): the approved wording of two customer notices on a
 * database whose templates were seeded before (UAT) — the seed never overwrites a template (reference-seed
 * `ensureNotifications`). Through the admin API: a new draft version per locale (`admin.notificationTemplates.addVersion`)
 * then publish it (`…publish`) — audited, never SQL. Only a template whose latest published version differs is changed.
 *
 *   - `file_check.checked:customer` (e-mail + LINE) — flag `artwork.file_check_notify` stays OFF (the owner turns it on);
 *   - `order_group.payment_overdue:customer` (e-mail + LINE) — flag `orders.payment_overdue_reminder` stays OFF.
 *
 *   API_URL=https://<uat-api-host> UAT_SEED_PASSWORD=… node docs/design/content/set-notice-wording.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL (required) · UAT_SEED_PASSWORD or ADMIN_PASSWORD (required) · ADMIN_EMAIL (default admin@example.invalid,
 * `notification_templates.manage`). The bodies below are generated from prisma/seed/data/notification-matrix.ts
 * (`MATRIX_TEMPLATES`) — keep them in step if the seed changes. Node 18+. Idempotent. No password or token is printed.
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.invalid';
const CONFIRM = process.argv.includes('--confirm');

/** The approved templates (D-460), as the seed builds them. */
export const TEMPLATES = [
  {
    "key": "order_group.payment_overdue:customer",
    "channel": "email",
    "versions": {
      "th": {
        "subject": "คำสั่งซื้อ {{payload.groupCode}} เลยกำหนดชำระ",
        "body": "<mjml><mj-body><mj-section><mj-column><mj-text>เรียน {{recipient.displayName}}</mj-text><mj-text>คำสั่งซื้อ {{payload.orderCode}} เลยกำหนดชำระแล้ว แต่ยังไม่ถูกยกเลิก กด \"ตรวจราคาใหม่และชำระ\" เพื่อดูราคาและวันส่งของวันนี้ แล้วชำระต่อได้ทันที<br/>{{#if link}}<a href=\"{{link}}\">ตรวจราคาใหม่และชำระ</a>{{/if}}</mj-text><mj-text font-size=\"12px\" color=\"#5b6470\">ข้อความนี้ส่งจาก getpack โดยอัตโนมัติ</mj-text></mj-column></mj-section></mj-body></mjml>"
      },
      "en": {
        "subject": "Order {{payload.groupCode}} is past its payment date",
        "body": "<mjml><mj-body><mj-section><mj-column><mj-text>Dear {{recipient.displayName}}</mj-text><mj-text>Order {{payload.orderCode}} is past its payment date but has not been cancelled. Press \"Re-check price and pay\" to see today's price and delivery date, then pay<br/>{{#if link}}<a href=\"{{link}}\">Re-check price and pay</a>{{/if}}</mj-text><mj-text font-size=\"12px\" color=\"#5b6470\">This message was sent automatically by getpack</mj-text></mj-column></mj-section></mj-body></mjml>"
      }
    }
  },
  {
    "key": "order_group.payment_overdue:customer",
    "channel": "line",
    "versions": {
      "th": {
        "subject": "คำสั่งซื้อ {{payload.groupCode}} เลยกำหนดชำระ",
        "body": "คำสั่งซื้อ {{payload.orderCode}} เลยกำหนดชำระแล้ว แต่ยังไม่ถูกยกเลิก กด \"ตรวจราคาใหม่และชำระ\" เพื่อดูราคาและวันส่งของวันนี้ แล้วชำระต่อได้ทันที{{#if link}}\nตรวจราคาใหม่และชำระ: {{link}}{{/if}}"
      },
      "en": {
        "subject": "Order {{payload.groupCode}} is past its payment date",
        "body": "Order {{payload.orderCode}} is past its payment date but has not been cancelled. Press \"Re-check price and pay\" to see today's price and delivery date, then pay{{#if link}}\nRe-check price and pay: {{link}}{{/if}}"
      }
    }
  },
  {
    "key": "file_check.checked:customer",
    "channel": "email",
    "versions": {
      "th": {
        "subject": "ตรวจไฟล์งานเสร็จแล้ว",
        "body": "<mjml><mj-body><mj-section><mj-column><mj-text>เรียน {{recipient.displayName}}</mj-text><mj-text>ไฟล์งานที่คุณอัปโหลดตรวจเสร็จแล้ว{{#if payload.mustFix}} มี {{payload.mustFix}} ข้อที่ต้องแก้ก่อนสั่งซื้อ{{else}} ไม่มีข้อที่ต้องแก้ เลือกสเปกและจำนวนแล้วสั่งซื้อต่อได้{{/if}}<br/>{{#if link}}<a href=\"{{link}}\">ดูผลตรวจไฟล์</a>{{/if}}</mj-text><mj-text font-size=\"12px\" color=\"#5b6470\">ข้อความนี้ส่งจาก getpack โดยอัตโนมัติ</mj-text></mj-column></mj-section></mj-body></mjml>"
      },
      "en": {
        "subject": "Your file check is done",
        "body": "<mjml><mj-body><mj-section><mj-column><mj-text>Dear {{recipient.displayName}}</mj-text><mj-text>The file you uploaded has been checked.{{#if payload.mustFix}} Items to fix before you order: {{payload.mustFix}}.{{else}} Nothing needs fixing; choose the spec and quantity to go on and order.{{/if}}<br/>{{#if link}}<a href=\"{{link}}\">See the result</a>{{/if}}</mj-text><mj-text font-size=\"12px\" color=\"#5b6470\">This message was sent automatically by getpack</mj-text></mj-column></mj-section></mj-body></mjml>"
      }
    }
  },
  {
    "key": "file_check.checked:customer",
    "channel": "line",
    "versions": {
      "th": {
        "subject": "ตรวจไฟล์งานเสร็จแล้ว",
        "body": "ไฟล์งานที่คุณอัปโหลดตรวจเสร็จแล้ว{{#if payload.mustFix}} มี {{payload.mustFix}} ข้อที่ต้องแก้ก่อนสั่งซื้อ{{else}} ไม่มีข้อที่ต้องแก้ เลือกสเปกและจำนวนแล้วสั่งซื้อต่อได้{{/if}}{{#if link}}\nดูผลตรวจไฟล์: {{link}}{{/if}}"
      },
      "en": {
        "subject": "Your file check is done",
        "body": "The file you uploaded has been checked.{{#if payload.mustFix}} Items to fix before you order: {{payload.mustFix}}.{{else}} Nothing needs fixing; choose the spec and quantity to go on and order.{{/if}}{{#if link}}\nSee the result: {{link}}{{/if}}"
      }
    }
  }
];

/** The latest published version of a locale, or null. */
const published = (template, locale) =>
  template.versions
    .filter((v) => v.locale === locale && v.status === 'published')
    .sort((a, b) => b.versionNo - a.versionNo)[0] ?? null;

/** Per template and locale: what to publish (pure, for review). */
export function planNotices(existing) {
  const plan = [];
  const notes = [];
  for (const want of TEMPLATES) {
    const template = existing.find((t) => t.key === want.key && t.channel === want.channel);
    if (!template) {
      notes.push(`${want.key} (${want.channel}): not on this API — run \`pnpm db:seed\` (it creates it with this wording)`);
      continue;
    }
    for (const locale of ['th', 'en']) {
      const current = published(template, locale);
      const next = want.versions[locale];
      if (current && current.body === next.body && (current.subject ?? null) === (next.subject ?? null))
        notes.push(`${want.key} (${want.channel}, ${locale}): already the approved wording`);
      else plan.push({ template, locale, version: next });
    }
  }
  return { plan, notes };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = json?.detail ?? json?.title ?? text;
    throw new Error(`${method} ${path} → ${res.status} ${json?.code ?? ''} ${detail}`.trim());
  }
  return json;
}

async function main() {
  if (!API_URL || !PASSWORD) {
    console.error('Set API_URL and UAT_SEED_PASSWORD (or ADMIN_PASSWORD).');
    process.exit(2);
  }
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  const token = login.accessToken;
  const templates = await call('GET', '/v1/admin/notification-templates', { token });
  const { plan, notes } = planNotices(templates);
  notes.forEach((n) => console.log(n));
  for (const { template, locale, version } of plan) {
    console.log(`${CONFIRM ? 'Publishing' : 'Would publish'} ${template.key} (${template.channel}, ${locale})`);
    if (!CONFIRM) continue;
    const draft = await call('POST', `/v1/admin/notification-templates/${template.id}/versions`, {
      token,
      body: { locale, ...(version.subject ? { subject: version.subject } : {}), body: version.body },
    });
    const added = draft.versions.filter((v) => v.locale === locale).sort((a, b) => b.versionNo - a.versionNo)[0];
    await call(
      'POST',
      `/v1/admin/notification-templates/${template.id}/versions/${locale}/${added.versionNo}/actions/publish`,
      { token, body: {} },
    );
    console.log(`  → version ${added.versionNo} published`);
  }
  if (!plan.length) console.log('Nothing to change.');
  else if (!CONFIRM) console.log('Dry run — add --confirm to write.');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
