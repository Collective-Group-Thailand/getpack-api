#!/usr/bin/env node
/**
 * C12 (owner-delegated 2026-10-29, DECISIONS-STAGE-A §17.1, D-460): the Prepress profile of `artwork.preflight_rules`
 * on a database that already holds the setting (UAT). New databases get it from the seed; `pnpm db:seed` also amends
 * an existing one the same way — this script does it through the admin API (`admin.settings.changeValue`: a new
 * effective-dated, audited version), never by SQL.
 *
 * Same rule as the seed amendment (`amendPreflightRulesC12`, prisma/seed/data/settings.ts): nothing while a print
 * profile is already set; each part only where nobody decided it — an unset threshold / severity is filled, the
 * earlier seed default is replaced, anything a person set is kept and reported.
 *
 *   API_URL=https://<uat-api-host> SUPERADMIN_EMAIL=… UAT_SEED_PASSWORD=… node docs/design/upload-redesign/set-prepress-rules.mjs
 *   … --confirm        # writes; without it the script only reports what it would change (dry run)
 *
 * Env: API_URL, SUPERADMIN_EMAIL (the setting is owned by Superadmin), UAT_SEED_PASSWORD or ADMIN_PASSWORD — all
 * required. Node 18+ (global fetch). Idempotent. The password and tokens are never printed (PDPA / CLAUDE.md).
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const PASSWORD = process.env.UAT_SEED_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const CONFIRM = process.argv.includes('--confirm');
const KEY = 'artwork.preflight_rules';
const REASON = 'D-460 / DECISIONS-STAGE-A §17.1: Prepress thresholds and print profiles (owner-delegated 2026-10-29, C12)';

/** The decided values (D-460) — the same as PREFLIGHT_RULES_C12 in the seed. */
export const DECIDED = {
  severities: {
    size_mismatch: 'block',
    missing_bleed: 'block',
    low_resolution: 'warn',
    rgb_colour: 'warn',
    fonts_not_embedded: 'block',
    safe_zone: 'info',
    thin_lines: 'info',
    overprint: 'info',
    ink_coverage: 'info',
    ink_count: 'block',
    small_text: 'warn',
    small_text_black: 'warn',
    barcode: 'info',
    die_layer: 'block',
  },
  bleedMm: '3',
  sizeToleranceMm: '1',
  minEffectivePpi: 300,
  blockBelowPpi: 150,
  safeZoneMm: '3',
  minLineWidthPt: '0.25',
  maxInkCoveragePct: 300,
  minTextPt: '6',
  minTextReversedPt: '8',
  blackOnlyTextBelowPt: '12',
  profiles: {
    corrugated: {
      safeZoneMm: '5',
      minEffectivePpi: 200,
      blockBelowPpi: 100,
      minTextPt: '7',
      minLineWidthPt: '0.5',
      maxInkCoveragePct: 240,
    },
  },
};
const BEFORE = {
  severities: { fonts_not_embedded: 'info' },
  bleedMm: '3',
  minEffectivePpi: 300,
  safeZoneMm: '3',
  minLineWidthPt: '0.25',
  maxInkCoveragePct: 300,
};

/** The value to write for the value in force, or undefined (nothing to do); `kept` lists a person's values left alone. */
export function planPreflight(current) {
  const kept = [];
  if (!current || typeof current !== 'object' || !current.severities || typeof current.severities !== 'object')
    return { value: undefined, kept, note: `${KEY}: no value in force — run \`pnpm db:seed\` first` };
  if (current.profiles !== undefined)
    return { value: undefined, kept, note: `${KEY}: a print profile is already set — nothing changed` };
  const severities = { ...current.severities };
  for (const [check, severity] of Object.entries(DECIDED.severities)) {
    if (severities[check] === undefined || severities[check] === BEFORE.severities[check]) severities[check] = severity;
    else if (severities[check] !== severity) kept.push(`severities.${check} = ${severities[check]}`);
  }
  const next = { ...current, severities };
  const unset = (v) => v === undefined || v === null || v === '';
  for (const key of ['bleedMm', 'minEffectivePpi', 'safeZoneMm', 'minLineWidthPt', 'maxInkCoveragePct']) {
    if (unset(next[key]) || next[key] === BEFORE[key]) next[key] = DECIDED[key];
    else if (next[key] !== DECIDED[key]) kept.push(`${key} = ${next[key]}`);
  }
  for (const key of ['blockBelowPpi', 'minTextPt', 'minTextReversedPt', 'blackOnlyTextBelowPt']) {
    if (unset(next[key])) next[key] = DECIDED[key];
    else if (next[key] !== DECIDED[key]) kept.push(`${key} = ${next[key]}`);
  }
  next.profiles = DECIDED.profiles;
  return { value: next, kept, note: null };
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
  if (!API_URL || !PASSWORD || !EMAIL) {
    console.error('Set API_URL, SUPERADMIN_EMAIL and UAT_SEED_PASSWORD (or ADMIN_PASSWORD).');
    process.exit(2);
  }
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  const token = login.accessToken;
  const settings = await call('GET', '/v1/admin/settings', { token });
  const setting = settings.find((s) => s.key === KEY);
  if (!setting) throw new Error(`${KEY}: not defined on this API — deploy and run \`pnpm db:seed\` first`);
  if (setting.pending) throw new Error(`${KEY}: a change is already pending approval — decide it in the back office first`);
  const { value, kept, note } = planPreflight(setting.current?.value ?? null);
  if (note) console.log(note);
  kept.forEach((k) => console.log(`kept (set by a person): ${k}`));
  if (value === undefined) return console.log('Nothing to change.');
  // A minute ahead: `effectiveFrom` must not be in the past when the API checks it (`settings.backdated`).
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
