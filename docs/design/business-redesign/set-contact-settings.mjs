#!/usr/bin/env node
/**
 * C11 item 1 (owner 2026-10-29, DECISIONS-STAGE-A §16.1, D-459): the contact settings C10 created (D-458).
 * The reference / dev / UAT seeds give an UNSET setting the decided value as its first version; a database that
 * already holds the settings (UAT) is changed here — through the admin API (`admin.settings.changeValue`: a new
 * effective-dated, audited version), never by SQL.
 *
 *   - `support.callback_slots` = 09:00–12:00 · 12:00–15:00 · 15:00–18:00 (set when it differs).
 *   - `support.topic_queues` — the routing quote/business → sales, partnership → partner, artwork → prepress,
 *     payment → finance, else cs is CONFIRMED: set only while the setting is unset; a value the CS Lead already
 *     entered is kept and, when it differs, only reported (re-run `pnpm db:seed` to record the confirmation flag).
 *   - `support.reply_business_days_by_topic` stays unset (1 business day for every topic) — not touched.
 *
 *   API_URL=https://<uat-api-host> UAT_SEED_PASSWORD=… node docs/design/business-redesign/set-contact-settings.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL (required) · UAT_SEED_PASSWORD or ADMIN_PASSWORD (required) · ADMIN_EMAIL (default
 * cs-lead@example.invalid — both settings are owned by the CS Lead; a Superadmin may change them too, D-448 §11.6).
 * Node 18+ (global fetch). Idempotent: a setting already holding the value is left alone. The password and tokens are
 * never printed (PDPA / CLAUDE.md).
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.ADMIN_EMAIL ?? 'cs-lead@example.invalid';
const CONFIRM = process.argv.includes('--confirm');

/** The decided values (D-459). */
export const CALLBACK_SLOTS = [
  { key: 'morning', from: '09:00', to: '12:00' },
  { key: 'midday', from: '12:00', to: '15:00' },
  { key: 'afternoon', from: '15:00', to: '18:00' },
];
export const TOPIC_QUEUES = {
  default: 'cs',
  topics: { quote: 'sales', business: 'sales', partnership: 'partner', artwork: 'prepress', payment: 'finance' },
};
const REASON = 'D-459 / DECISIONS-STAGE-A §16.1: owner decision 2026-10-29 (C11) — call-back windows and routing';

/** Key-order-independent equality of two JSON values. */
export function same(a, b) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** What to write for each setting given its admin view (`current.value`, `masked`, `pending`): pure, for review. */
export function planContact(byKey) {
  const plan = [];
  const notes = [];
  const slots = byKey.get('support.callback_slots');
  if (!slots) notes.push('support.callback_slots: not defined on this API — deploy C10 and run `pnpm db:seed` first');
  else if (same(slots.current?.value ?? null, CALLBACK_SLOTS)) notes.push('support.callback_slots: already decided');
  else plan.push({ setting: slots, value: CALLBACK_SLOTS });

  const queues = byKey.get('support.topic_queues');
  if (!queues) notes.push('support.topic_queues: not defined on this API — deploy C10 and run `pnpm db:seed` first');
  else if (queues.current?.value == null) plan.push({ setting: queues, value: TOPIC_QUEUES });
  else if (same(queues.current.value, TOPIC_QUEUES)) notes.push('support.topic_queues: already the confirmed routing');
  else
    notes.push(
      `support.topic_queues: review (kept, set by the CS Lead): ${JSON.stringify(queues.current.value)} — confirmed routing is ${JSON.stringify(TOPIC_QUEUES)}`,
    );
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
  const settings = await call('GET', '/v1/admin/settings', { token });
  const { plan, notes } = planContact(new Map(settings.map((s) => [s.key, s])));
  notes.forEach((n) => console.log(n));
  for (const { setting } of plan)
    if (setting.pending)
      throw new Error(`${setting.key}: a change is already pending approval — decide it in the back office first`);

  // A minute ahead: `effectiveFrom` must not be in the past when the API checks it (`settings.backdated`).
  const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
  for (const { setting, value } of plan) {
    console.log(`${CONFIRM ? 'Setting' : 'Would set'} ${setting.key} from ${effectiveFrom}:`, JSON.stringify(value));
    if (!CONFIRM) continue;
    const updated = await call('POST', `/v1/admin/settings/${setting.id}/versions`, {
      token,
      body: { value, effectiveFrom, reason: REASON },
    });
    console.log(`  → version ${updated.versions?.at(-1)?.versionNo ?? '?'} (${updated.pending ? 'pending approval' : 'approved'})`);
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
