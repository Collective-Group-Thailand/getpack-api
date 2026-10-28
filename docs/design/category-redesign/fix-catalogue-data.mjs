#!/usr/bin/env node
/**
 * C2b item 2 (owner 2026-10-28 17:48, DECISIONS-STAGE-A §15.2, D-454): catalogue data bugs found by the category
 * redesign (C2, PLAN.md §1.3). The UAT / dev seeds are fixed in the repo; a database that already holds the data (UAT)
 * is fixed here — through the admin API, never by SQL. Every write is an ordinary audited admin change.
 *
 *   a. A description that says "เลือกพิมพ์โลโก้ 1–2 สีได้" gets the print options the product really offers, derived
 *      from its print model in force (outside side): "เลือกพิมพ์โลโก้ 1 สี หรือพิมพ์ 4 สี (CMYK) ได้" for N = 1 spot
 *      colour + CMYK. No print model → the colour count is removed ("เลือกพิมพ์โลโก้ได้" when the product offers
 *      inks, else the sentence goes). Nothing is invented. Other colour counts in descriptions are only reported.
 *   b. "[DEV] " is removed from customer-facing names of active catalogue products: the product names, the names of
 *      their patterns and pattern parts (sub-patterns — the fruit box's "[DEV] ฝา") and their standard sizes.
 *   c. Standard-size names written W × L × H ("เบอร์ 00 (9.75×14×6 ซม.)", where 9.75 cm is the width) are rewritten
 *      L × W × H ("เบอร์ 00 (14×9.75×6 ซม.)") — the order of the spec label (GLOBAL-RULES §5, ยาว × กว้าง × สูง). Only
 *      when the three numbers are exactly the size's width, length and height in cm and the width ≠ the length; a
 *      name that is already L × W × H, a pouch (W × H by its own spec label) and 2-D names are left alone and listed.
 *
 *   API_URL=https://<uat-api-host> ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node docs/design/category-redesign/fix-catalogue-data.mjs            # dry run (default): reports only
 *   … --confirm                                                           # writes
 *
 * Env: API_URL, ADMIN_EMAIL, ADMIN_PASSWORD (a staff user with catalogue write permission — Admin / Superadmin —
 * without an MFA challenge on this environment). Node 18+ (global fetch). Idempotent: a second run finds nothing to
 * change. The password and tokens are never printed (PDPA / CLAUDE.md).
 */

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.ADMIN_EMAIL ?? '';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const CONFIRM = process.argv.includes('--confirm');

if (!API_URL || !EMAIL || !PASSWORD) {
  console.error('Set API_URL, ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(2);
}

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
  if (!res.ok) {
    const detail = json?.detail ?? json?.title ?? text;
    throw new Error(`${method} ${path} → ${res.status} ${json?.code ?? ''} ${detail}`.trim());
  }
  return { json, etag: res.headers.get('etag') };
}

async function all(path) {
  const rows = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const { json } = await call('GET', `${path}${sep}page=${page}&perPage=100`);
    rows.push(...(json?.data ?? []));
    const meta = json?.meta;
    if (!meta || page * meta.perPage >= meta.total) return rows;
  }
}

/** PATCH with the ETag of a fresh read (If-Match is required). */
async function patch(path, body, label) {
  console.log(`  ${CONFIRM ? 'PATCH' : 'would PATCH'} ${label}: ${JSON.stringify(body)}`);
  if (!CONFIRM) return;
  const { etag } = await call('GET', path);
  await call('PATCH', path, { body, ifMatch: etag ?? undefined });
}

// --- a. print sentence from the print model ---------------------------------------------------------------------

/** The print options of one side as a sentence, or null when it offers no print. */
export function printSentence(model) {
  const side = model?.outside ?? model?.inside;
  if (!side) return null;
  const parts = [];
  if (side.methods?.includes('spot') && side.spot) {
    const n = side.spot.maxColours;
    parts.push(n === 1 ? 'พิมพ์โลโก้ 1 สี' : `พิมพ์โลโก้ 1–${n} สี`);
  }
  if (side.methods?.includes('cmyk') && side.cmyk) {
    const addOn = side.cmyk.addOn;
    parts.push(
      addOn?.enabled && addOn.maxColours > 0
        ? `พิมพ์ 4 สี (CMYK) เพิ่มสีพิเศษได้ ${addOn.maxColours} สี`
        : 'พิมพ์ 4 สี (CMYK)',
    );
  }
  return parts.length > 0 ? `เลือก${parts.join(' หรือ')} ได้` : null;
}

const BAD_COUNT = /เลือกพิมพ์โลโก้\s*\d+\s*[–-]\s*\d+\s*สี\s*ได้/;
const ANY_COUNT = /\d+\s*(?:[–-]\s*\d+\s*)?สี/;

function fixedDescription(product) {
  const text = product.descriptionTh ?? '';
  if (!BAD_COUNT.test(text)) return null;
  const derived = printSentence(product.printModel);
  const offersInk = (product.options ?? []).some((o) => o.kind === 'ink_colour');
  const sentence = derived ?? (offersInk ? 'เลือกพิมพ์โลโก้ได้' : '');
  return text.replace(BAD_COUNT, sentence).replace(/\s{2,}/g, ' ').trim();
}

// --- c. size names ------------------------------------------------------------------------------------------------

const TRIPLE = /(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)/;
const cm = (mm) => Number(mm) / 10;

/** The size name in L × W × H order, or null when it is not a W × L × H name of this size. */
export function lwhName(size) {
  const m = TRIPLE.exec(size.name ?? '');
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [l, w, h] = [cm(size.lengthMm), cm(size.widthMm), cm(size.heightMm)];
  if (w === l || a !== w || b !== l || c !== h) return null;
  return size.name.replace(m[0], `${m[2]}×${m[1]}×${m[3]}`);
}

const stripDev = (name) => (typeof name === 'string' && name.startsWith('[DEV] ') ? name.slice(6) : null);

async function main() {
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login.json?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  token = login.json.accessToken;
  let changes = 0;

  const products = (await all('/v1/admin/catalog/catalog-products')).filter((p) => p.status === 'active');
  console.log(`${products.length} active catalogue products. ${CONFIRM ? 'Writing.' : 'Dry run — add --confirm to write.'}`);

  console.log('\na. Descriptions with a colour count that is not the print model:');
  for (const p of products) {
    const next = fixedDescription(p);
    if (next !== null && next !== p.descriptionTh) {
      changes++;
      await patch(`/v1/admin/catalog/catalog-products/${p.id}`, { descriptionTh: next }, `${p.slug} descriptionTh`);
    } else if (ANY_COUNT.test(p.descriptionTh ?? '') || ANY_COUNT.test(p.descriptionEn ?? '')) {
      console.log(`  review (not changed): ${p.slug} — "${p.descriptionTh ?? p.descriptionEn}"`);
    }
  }

  console.log('\nb. "[DEV] " in customer-facing names:');
  const patternIds = new Set();
  for (const p of products) {
    for (const pattern of p.patterns ?? []) patternIds.add(pattern.patternId);
    const th = stripDev(p.nameTh);
    const en = stripDev(p.nameEn);
    if (th !== null || en !== null) {
      changes++;
      await patch(
        `/v1/admin/catalog/catalog-products/${p.id}`,
        { ...(th !== null && { nameTh: th }), ...(en !== null && { nameEn: en }) },
        `${p.slug} name`,
      );
    }
  }
  for (const patternId of patternIds) {
    const { json: pattern } = await call('GET', `/v1/admin/catalog/patterns/${patternId}`);
    const name = stripDev(pattern?.name);
    if (name !== null) {
      changes++;
      await patch(`/v1/admin/catalog/patterns/${patternId}`, { name }, `pattern ${pattern.code} name`);
    }
    for (const part of await all(`/v1/admin/catalog/sub-patterns?patternId=${patternId}`)) {
      const partName = stripDev(part.name);
      if (partName !== null) {
        changes++;
        await patch(
          `/v1/admin/catalog/sub-patterns/${part.id}`,
          { name: partName },
          `pattern ${pattern?.code ?? patternId} part ${part.seq} "${part.name}"`,
        );
      }
    }
  }

  console.log('\nc. Standard-size names W × L × H → L × W × H:');
  for (const p of products) {
    const sizes = await all(`/v1/admin/catalog/standard-sizes?catalogProductId=${p.id}`);
    for (const size of sizes) {
      const dev = stripDev(size.name);
      const base = { ...size, name: dev ?? size.name };
      const name = lwhName(base) ?? (dev !== null ? dev : null);
      if (name !== null && name !== size.name) {
        changes++;
        await patch(`/v1/admin/catalog/standard-sizes/${size.id}`, { name }, `${p.slug} ${size.code} "${size.name}"`);
      } else if (!TRIPLE.test(size.name ?? '') && /×/.test(size.name ?? '')) {
        console.log(`  review (2-D, not changed): ${p.slug} ${size.code} "${size.name}" = L ${size.lengthMm} × W ${size.widthMm} mm`);
      }
    }
  }

  console.log(`\n${changes} change(s) ${CONFIRM ? 'written' : 'to write'}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
