#!/usr/bin/env node
/**
 * C1f item 5 (owner 2026-10-28 13:58, DECISIONS-STAGE-A §14.5, D-451): the `credit_limit` approval threshold is
 * ฿100,000.00 (was ฿500,000.00, D-449 B) — "I am the executive and the approver". The seed gives an existing database a
 * new effective-dated version while the value in force is still the seed's; a database where the policy was already
 * edited in the back office (UAT) is changed here instead — through the admin API, never by SQL:
 *
 *   1. `admin.approvalPolicies.proposeVersion` — a new version of `credit_limit` with the steps in force unchanged and
 *      `autoApproveMaxAmount` = 100000.00 (Superadmin only), effective a minute from now. History is never edited.
 *   2. The proposal is an `approval_policy_change` request: another Superadmin approves it in the back office, or —
 *      with `--self-approve "<reason ≥ 10 characters>"` while solo-owner mode is on (D-449 A) — this script
 *      self-approves it ("อนุมัติด้วยตนเอง", audited, in the daily digest).
 *
 *   API_URL=https://<uat-api-host> SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… \
 *     node docs/design/superadmin-controls/set-credit-threshold.mjs            # dry run (default): reports only
 *   … --confirm                                                                # proposes the version
 *   … --confirm --self-approve "ตั้งเกณฑ์ตามมติเจ้าของ 28 ต.ค. 2569"            # proposes and self-approves
 *
 * Env: API_URL, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD (all required; a Superadmin without MFA challenge on this
 * environment). Node 18+ (global fetch). Idempotent: a policy already at ฿100,000.00 is left alone; a pending proposal
 * stops the script (decide it first). The password and tokens are never printed (PDPA / CLAUDE.md).
 */
import { randomUUID } from 'node:crypto';

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.SUPERADMIN_EMAIL ?? '';
const PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';
const CONFIRM = process.argv.includes('--confirm');
const selfIndex = process.argv.indexOf('--self-approve');
const SELF_REASON = selfIndex > 0 ? (process.argv[selfIndex + 1] ?? '').trim() : null;

/** The decided value (D-451) and the version's reason. */
const POLICY_KEY = 'credit_limit';
const THRESHOLD = '100000.00';
const REASON =
  'Owner decision 2026-10-28 13:58 (D-451, DECISIONS-STAGE-A §14.5): credit-limit requests of ≤ THB 100,000.00 skip the second approval';

if (!API_URL || !EMAIL || !PASSWORD) {
  console.error('Set API_URL, SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD.');
  process.exit(2);
}
if (SELF_REASON !== null && SELF_REASON.length < 10) {
  console.error('--self-approve needs a reason of at least 10 characters.');
  process.exit(2);
}

async function call(method, path, { token, body, idempotent } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotent ? { 'idempotency-key': randomUUID() } : {}),
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
  const login = await call('POST', '/v1/auth/staff/login', { body: { email: EMAIL, password: PASSWORD } });
  if (!login?.accessToken) throw new Error(`sign-in of ${EMAIL} returned no access token (MFA or a challenge?)`);
  const token = login.accessToken;
  const list = await call('GET', '/v1/admin/approval-policies', { token });
  const policy = (Array.isArray(list) ? list : (list?.data ?? [])).find((p) => p.key === POLICY_KEY);
  if (!policy) throw new Error(`${POLICY_KEY}: not on this API — run \`pnpm db:seed\` first`);
  if (policy.pending)
    throw new Error(`${POLICY_KEY}: version ${policy.pending.versionNo} is pending approval — decide it first`);
  const current = policy.current;
  if (!current) throw new Error(`${POLICY_KEY}: no version in force`);
  const upcoming = policy.upcoming;
  if (upcoming)
    console.warn(`${POLICY_KEY}: version ${upcoming.versionNo} starts ${upcoming.effectiveFrom} — it will override this`);
  if (current.autoApproveMaxAmount === THRESHOLD) {
    console.log(`${POLICY_KEY}: already ฿${THRESHOLD} (version ${current.versionNo}). Nothing to change.`);
    return;
  }
  // A minute ahead: `effectiveFrom` must not be in the past when the API checks it.
  const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
  const steps = current.steps.map((s) => ({
    name: s.name,
    approverRole: s.approverRole,
    approverScope: s.approverScope,
    condition: s.condition ?? null,
    quorum: s.quorum,
    slaMinutes: s.slaMinutes,
    slaCalendar: s.slaCalendar,
    escalateToRole: s.escalateToRole,
  }));
  console.log(
    `${CONFIRM ? 'Proposing' : 'Would propose'} ${POLICY_KEY} version from ${effectiveFrom}: auto-approve ≤ ฿${THRESHOLD} ` +
      `(now ${current.autoApproveMaxAmount ? `฿${current.autoApproveMaxAmount}` : 'none'}, version ${current.versionNo}); ` +
      `steps unchanged: ${steps.map((s) => s.name).join(' / ')}`,
  );
  if (!CONFIRM) {
    console.log('Dry run — add --confirm to write.');
    return;
  }
  const version = await call('POST', `/v1/admin/approval-policies/${policy.id}/versions`, {
    token,
    idempotent: true,
    body: { effectiveFrom, reason: REASON, steps, autoApproveMaxAmount: THRESHOLD },
  });
  console.log(`  → version ${version.versionNo} proposed (approval ${version.approvalId ?? '?'})`);
  if (!version.approvalId) return;
  if (SELF_REASON === null) {
    console.log('  Another Superadmin approves it in the back office (approvals), or rerun with --self-approve.');
    return;
  }
  const decided = await call('POST', `/v1/admin/approvals/${version.approvalId}/actions/approve`, {
    token,
    idempotent: true,
    body: { selfApprovalReason: SELF_REASON },
  });
  console.log(`  → approval ${decided.status ?? '?'} (self-approved under solo-owner mode)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
