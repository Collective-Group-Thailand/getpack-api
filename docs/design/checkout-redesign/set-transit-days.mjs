#!/usr/bin/env node
/**
 * C12 (owner-delegated 2026-10-29, DECISIONS-STAGE-A §17.2, D-460): Logistics confirms `shipping.transit_days` —
 * Bangkok & vicinity 1–2, Central & East 2–3 working days, North / Northeast / South 3–5 (the `default`), remote areas /
 * islands 4–7 once a zone exists for them. Zone codes are the rate card's own (Admin enters zones), so the script is
 * told which code is which; the default is the UAT rehearsal zones (prisma/seed/uat/uat-data.ts `UAT_ZONES`).
 * Changes go through the admin API (`admin.settings.changeValue`: a new effective-dated, audited version), never SQL;
 * `pnpm db:seed` records the confirmation flag (`syncConfirmation`).
 *
 *   API_URL=https://<uat-api-host> UAT_SEED_PASSWORD=… node docs/design/checkout-redesign/set-transit-days.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL (required) · UAT_SEED_PASSWORD or ADMIN_PASSWORD (required) · ADMIN_EMAIL (default admin@example.invalid
 * — the setting is owned by Admin) · ZONES_JSON (optional) e.g. '{"bkk_metro":"bangkok","central_east":"central_east",
 * "islands":"remote"}' mapping the rate card's zone codes to `bangkok` | `central_east` | `regional` | `remote`.
 * Zones not named keep their value (reported when it differs). Node 18+. Idempotent. No password or token is printed.
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.invalid';
const CONFIRM = process.argv.includes('--confirm');
const KEY = 'shipping.transit_days';
const REASON = 'D-460 / DECISIONS-STAGE-A §17.2: transit days confirmed (owner-delegated 2026-10-29, C12)';

/** The decided windows (working days) per kind of zone (D-460). `regional` is also the default. */
export const WINDOWS = {
  bangkok: { min: 1, max: 2 },
  central_east: { min: 2, max: 3 },
  regional: { min: 3, max: 5 },
  remote: { min: 4, max: 7 },
};
/** The UAT rehearsal zone codes (uat-data.ts). */
export const UAT_ZONE_KINDS = {
  uat_bkk_metro: 'bangkok',
  uat_central_east: 'central_east',
  uat_north_northeast: 'regional',
  uat_south: 'regional',
};

const same = (a, b) => !!a && !!b && a.min === b.min && a.max === b.max;

/** The value to write for the value in force (pure, for review), or undefined when it already holds the decision. */
export function planTransit(current, zoneKinds) {
  const notes = [];
  const zones = { ...(current?.zones ?? {}) };
  for (const [code, kind] of Object.entries(zoneKinds)) {
    const window = WINDOWS[kind];
    if (!window) throw new Error(`zone ${code}: unknown kind "${kind}"`);
    // A regional zone uses the default; an entry of its own is only needed when it differs.
    if (kind === 'regional') {
      if (zones[code] && !same(zones[code], window)) notes.push(`${code}: ${JSON.stringify(zones[code])} → default 3–5`);
      delete zones[code];
    } else zones[code] = window;
  }
  for (const [code, window] of Object.entries(zones))
    if (!(code in zoneKinds)) notes.push(`kept (not named): ${code} ${JSON.stringify(window)}`);
  const next = { default: WINDOWS.regional, zones };
  const unchanged =
    current &&
    same(current.default, next.default) &&
    JSON.stringify(Object.entries(current.zones ?? {}).sort()) === JSON.stringify(Object.entries(zones).sort());
  return { value: unchanged ? undefined : next, notes };
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
  const zoneKinds = process.env.ZONES_JSON ? JSON.parse(process.env.ZONES_JSON) : UAT_ZONE_KINDS;
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  const token = login.accessToken;
  const settings = await call('GET', '/v1/admin/settings', { token });
  const setting = settings.find((s) => s.key === KEY);
  if (!setting) throw new Error(`${KEY}: not defined on this API — run \`pnpm db:seed\` first`);
  if (setting.pending) throw new Error(`${KEY}: a change is already pending approval — decide it in the back office first`);
  const { value, notes } = planTransit(setting.current?.value ?? null, zoneKinds);
  notes.forEach((n) => console.log(n));
  if (value === undefined) return console.log(`${KEY}: already the decided windows. Nothing to change.`);
  const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
  console.log(`${CONFIRM ? 'Setting' : 'Would set'} ${KEY} from ${effectiveFrom}:`, JSON.stringify(value));
  if (!CONFIRM) return console.log('Dry run — add --confirm to write.');
  const updated = await call('POST', `/v1/admin/settings/${setting.id}/versions`, {
    token,
    body: { value, effectiveFrom, reason: REASON },
  });
  console.log(`  → version ${updated.versions?.at(-1)?.versionNo ?? '?'} (${updated.pending ? 'pending approval' : 'approved'})`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
