#!/usr/bin/env node
/**
 * C11 item 4 (owner 2026-10-29, DECISIONS-STAGE-A §16.4, D-459): the Studio settings on a database that already holds
 * them (UAT) — through the admin API (`admin.settings.changeValue`: a new effective-dated, audited version), never by
 * SQL. The reference seed does the same for a database it seeds (`fillIfUnset` / `amendInForce`).
 *
 *   - `catalog.hero_presets`: the mailer shape offers its catalogue product's postal sizes A–D
 *     (`standardSizeCodes: ["A","B","C","D"]` — the product's own standard sizes, never typed numbers); only while no
 *     shape names standard sizes yet (an Admin's own choice is kept). The home hero reads the same setting.
 *   - `studio.featured_styles`: usage threshold `{ minDesigns: 200, windowDays: 90 }`; the styles list stays as the
 *     Admin chose it (empty when unset — the Admin picks styles in /style-library/studio-featured).
 *
 *   API_URL=https://<uat-api-host> UAT_SEED_PASSWORD=… node docs/design/studio-redesign/set-studio-settings.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL (required) · UAT_SEED_PASSWORD or ADMIN_PASSWORD (required) · ADMIN_EMAIL (default
 * admin@example.invalid — both settings are owned by Admin; a Superadmin may change them too, D-448 §11.6).
 * Node 18+ (global fetch). Idempotent. The password and tokens are never printed (PDPA / CLAUDE.md).
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.invalid';
const CONFIRM = process.argv.includes('--confirm');

export const MAILER_SIZE_CODES = ['A', 'B', 'C', 'D'];
export const USAGE = { minDesigns: 200, windowDays: 90 };
const REASON = 'D-459 / DECISIONS-STAGE-A §16.4: owner decision 2026-10-29 (C11) — Studio hero sizes and featured styles';

/** The hero presets with the mailer's postal sizes, or null when there is nothing to change (pure). */
export function heroPresetsPlan(value) {
  if (!value || !Array.isArray(value.shapes)) return null;
  if (value.shapes.some((s) => s.standardSizeCodes !== undefined)) return null;
  if (!value.shapes.some((s) => s.id === 'mailer')) return null;
  return {
    ...value,
    shapes: value.shapes.map((s) => (s.id === 'mailer' ? { ...s, standardSizeCodes: [...MAILER_SIZE_CODES] } : s)),
  };
}

/** The featured-styles value with the decided usage threshold, or null when it already has it (pure). */
export function featuredStylesPlan(value) {
  if (!value) return { styles: [], usage: { ...USAGE } };
  if (value.usage?.minDesigns === USAGE.minDesigns && value.usage?.windowDays === USAGE.windowDays) return null;
  return { ...value, usage: { ...USAGE } };
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
  const byKey = new Map(settings.map((s) => [s.key, s]));

  const plan = [];
  const hero = byKey.get('catalog.hero_presets');
  if (!hero) console.warn('catalog.hero_presets: not defined on this API');
  else {
    const value = heroPresetsPlan(hero.current?.value ?? null);
    if (value) plan.push({ setting: hero, value });
    else console.log('catalog.hero_presets: nothing to change (no value, no mailer, or standard sizes already chosen)');
  }
  const featured = byKey.get('studio.featured_styles');
  if (!featured) console.warn('studio.featured_styles: not defined on this API — deploy C7 and run `pnpm db:seed` first');
  else {
    const value = featuredStylesPlan(featured.current?.value ?? null);
    if (value) plan.push({ setting: featured, value });
    else console.log('studio.featured_styles: already 200 designs within 90 days');
  }

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
  else if (!CONFIRM) console.log('Dry run — add --confirm to write. Then open the home page / /studio: the mailer offers เบอร์ A–D.');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
