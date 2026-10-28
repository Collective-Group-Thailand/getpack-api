#!/usr/bin/env node
/**
 * C1b item 7 (owner 2026-10-28, DECISIONS-STAGE-A §10.7, D-447): LINE / CS support hours are daily 09:00–18:00
 * (GLOBAL-RULES §6). The reference / dev / UAT seeds give an UNSET setting this value as its first version; a database
 * that already has a version (UAT, where the CS Lead may have entered the LINE account) is changed here instead —
 * through the admin API (`admin.settings.changeValue`: a new effective-dated, audited version), never by SQL.
 *
 *   API_URL=https://<uat-api-host> UAT_SEED_PASSWORD=… node docs/design/products-redesign/set-support-hours.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL (required) · UAT_SEED_PASSWORD or ADMIN_PASSWORD (required) · ADMIN_EMAIL (default
 * cs-lead@example.invalid — both settings are owned by the CS Lead, `settings.not_owner` for anyone else).
 * Node 18+ (global fetch). Idempotent: a setting already holding the value is left alone.
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.ADMIN_EMAIL ?? 'cs-lead@example.invalid';
const CONFIRM = process.argv.includes('--confirm');

/** The decided value (D-447): the structured hours and the text the storefront shows from the support channels. */
const HOURS = { days: 'daily', open: '09:00', close: '18:00' };
const HOURS_TEXT = 'ทุกวัน 09:00–18:00';
const REASON = 'D-447 / GLOBAL-RULES §6: LINE support daily 09:00–18:00 (owner decision 2026-10-28, C1b)';

if (!API_URL || !PASSWORD) {
  console.error('Set API_URL and UAT_SEED_PASSWORD (or ADMIN_PASSWORD).');
  process.exit(2);
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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  // The password and the token are never printed (PDPA / CLAUDE.md).
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  const token = login.accessToken;
  const settings = await call('GET', '/v1/admin/settings', { token });
  const byKey = new Map(settings.map((s) => [s.key, s]));

  const plan = [];
  const hours = byKey.get('storefront.support_hours');
  if (!hours) console.warn('storefront.support_hours: not defined on this API — run `pnpm db:seed` first');
  else if (same(hours.current?.value ?? null, HOURS)) console.log('storefront.support_hours: already', HOURS);
  else plan.push({ setting: hours, value: HOURS });

  const channels = byKey.get('storefront.support_channels');
  if (!channels) console.warn('storefront.support_channels: not defined on this API — run `pnpm db:seed` first');
  else if (channels.masked) console.warn('storefront.support_channels: masked for this user — not changed');
  else {
    const current = channels.current?.value ?? {};
    if (current.hours === HOURS_TEXT) console.log('storefront.support_channels.hours: already', HOURS_TEXT);
    // Every other field (LINE OA id, phone, e-mail) stays exactly as the CS Lead set it.
    else plan.push({ setting: channels, value: { ...current, hours: HOURS_TEXT } });
  }

  for (const { setting } of plan)
    if (setting.pending)
      throw new Error(`${setting.key}: a change is already pending approval — decide it in the back office first`);

  // A minute ahead: `effectiveFrom` must not be in the past when the API checks it (`settings.backdated`).
  const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
  for (const { setting, value } of plan) {
    console.log(`${CONFIRM ? 'Setting' : 'Would set'} ${setting.key} from ${effectiveFrom}:`, value);
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

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
