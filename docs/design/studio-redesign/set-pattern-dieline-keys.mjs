#!/usr/bin/env node
/**
 * C7 (D-455, DECISIONS-STAGE-A §2 "every style opens in the Studio"): a catalogue pattern with no `dielineKey` cannot
 * open its products in the Studio — the configurator hides "ออกแบบในสตูดิโอ" (e.g. uat-postal-box-b, pattern DEV-RSC).
 * The dev / UAT seeds now set the key on the patterns they create; a database that already holds them (UAT) is fixed
 * here — through the admin API (`PATCH /v1/admin/catalog/patterns/{id}`, If-Match), never by SQL. Only patterns
 * whose key is still empty and whose code is in the table below are changed; anything else is listed for Prepress.
 *
 *   API_URL=https://<uat-api-host> ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node docs/design/studio-redesign/set-pattern-dieline-keys.mjs        # dry run (default): reports only
 *   … --confirm                                                          # writes
 *
 * Idempotent. The password and tokens are never printed (PDPA / CLAUDE.md).
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.ADMIN_EMAIL ?? '';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const CONFIRM = process.argv.includes('--confirm');

/** The seeds' patterns and the engine drawing each one is (the same table as the dev seeds, C7). */
export const DIELINE_KEYS = {
  'DEV-RTE': 'rte',
  'DEV-RSC': 'rsc',
  'DEV-TELE': 'telescope',
  'DEV-FLAT': 'flat-rect',
  'DEV-TAG': 'tag-cut',
  'DEV-POUCH-STAND': 'pouch-standing',
  'DEV-POUCH-3SS': 'pouch-3-seal',
};

let token = '';

async function call(method, path, { body, ifMatch } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ifMatch ? { 'if-match': ifMatch } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.code ?? ''} ${json?.detail ?? json?.title ?? ''}`.trim());
  return { json, etag: res.headers.get('etag') };
}

async function all(path) {
  const rows = [];
  for (let page = 1; ; page++) {
    const { json } = await call('GET', `${path}?page=${page}&perPage=100`);
    rows.push(...(json?.data ?? []));
    const meta = json?.meta;
    if (!meta || page * meta.perPage >= meta.total) return rows;
  }
}

async function main() {
  if (!API_URL || !EMAIL || !PASSWORD) {
    console.error('Set API_URL, ADMIN_EMAIL and ADMIN_PASSWORD.');
    process.exit(2);
  }
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login.json?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  token = login.json.accessToken;
  const patterns = (await all('/v1/admin/catalog/patterns')).filter((p) => p.status === 'active');
  console.log(`${patterns.length} active patterns. ${CONFIRM ? 'Writing.' : 'Dry run — add --confirm to write.'}`);
  let changes = 0;
  const missing = [];
  for (const p of patterns) {
    if (p.dielineKey) continue;
    const key = DIELINE_KEYS[p.code];
    if (!key) {
      missing.push(p.code);
      continue;
    }
    changes++;
    console.log(`  ${CONFIRM ? 'PATCH' : 'would PATCH'} ${p.code} (${p.name}): dielineKey = ${key}`);
    if (!CONFIRM) continue;
    const path = `/v1/admin/catalog/patterns/${p.id}`;
    const { etag } = await call('GET', path);
    await call('PATCH', path, { body: { dielineKey: key }, ifMatch: etag ?? undefined });
  }
  console.log(`\n${changes} change(s).`);
  if (missing.length)
    console.log(`Without a dieline key and not in the table (Prepress to map, never guessed): ${missing.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
