import { APPROVAL_POLICIES } from '../../../prisma/seed/data/approval-policies';
import { PAYMENT_FEATURE_FLAGS } from '../../../prisma/seed/data/commerce';
import { FULFILMENT_FEATURE_FLAGS } from '../../../prisma/seed/data/fulfilment';
import { FINANCE_FEATURE_FLAGS } from '../../../prisma/seed/data/receivables';
import { ENTITY_SETTING_KEYS, SETTINGS } from '../../../prisma/seed/data/settings';

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const value = (v: unknown) =>
  v === null || v === undefined ? '— (not set)' : typeof v === 'string' ? v : JSON.stringify(v);

/**
 * `docs/launch/SETTINGS-REVIEW.md` (B6.3 item 5): every decision-backed setting with its seeded value, decisions,
 * confirmation status and owner, the approval matrices and the feature flags — generated from the seed data by
 * `pnpm launch:settings`; a unit test fails when the committed file differs from the code.
 */
export function renderSettingsReview(): string {
  const count = (status: string) =>
    SETTINGS.filter((s) => !s.unset && (s.confirmation ?? 'confirmed') === status).length;
  const lines = [
    '# Production settings review — packio-api',
    '',
    '> **Generated** by `pnpm launch:settings` from `prisma/seed/data/settings.ts`, `approval-policies.ts`, `commerce.ts`,',
    '> `fulfilment.ts` and `receivables.ts`. Do not edit by hand. Each owner confirms or changes every value **in production**',
    '> (a new effective-dated version, audited — D-063) and signs item 5 of `docs/LAUNCH-CHECKLIST.md`. A *proposed* or',
    '> *pending* value is not a decision: it goes live only once its owner confirms it.',
    '',
    `**${SETTINGS.length} settings** — ${count('confirmed')} confirmed · ${count('proposed')} proposed · ${count('pending_cpa')} pending the CPA (⚖) · ${count('pending_business')} pending the business · ${SETTINGS.filter((s) => s.unset).length} defined without a value (not set until their owner sets them).`,
    '',
    '## Settings',
    '',
    '| Key | Seeded value | Status | Owner | Decisions | What it controls |',
    '|---|---|---|---|---|---|',
    ...[...SETTINGS]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(
        (s) =>
          `| \`${s.key}\` | ${cell(`\`${value(s.unset ? null : s.value)}\``)} | ${s.unset ? 'not set' : (s.confirmation ?? 'confirmed')} | ${s.ownerRole ?? 'superadmin'} | ${s.decisions.join(', ')} | ${cell(s.description)} |`,
      ),
    '',
    '## Legal entity data (D-092)',
    '',
    'Seeded per entity from the `SEED_ENTITY_*` environment variables — never from code. Finance Manager checks each value against the company certificate and ภ.พ.20.',
    '',
    '| Key | What it is |',
    '|---|---|',
    ...Object.values(ENTITY_SETTING_KEYS).map((e) => `| \`${e.key}\` | ${cell(e.description)} |`),
    '',
    '## Approval matrices (ADR-0006)',
    '',
    '| Policy | Subject | Steps (role — condition) | Decisions | Note |',
    '|---|---|---|---|---|',
    ...APPROVAL_POLICIES.map(
      (p) =>
        `| \`${p.key}\` | ${p.subjectType} | ${cell(p.steps.map((s) => `${s.name}: **${s.role}**${s.scope && s.scope !== 'platform' ? ` (${s.scope})` : ''}`).join('<br>'))} | ${p.decisions.join(', ')} | ${cell(p.reason)} |`,
    ),
    '',
    '## Feature flags (seeded off)',
    '',
    'Every integration flag is seeded **off** and switched on by a superadmin once its account exists and its UAT scenario passed (`docs/launch/INTEGRATIONS.md`).',
    '',
    '| Flag | What it switches |',
    '|---|---|',
    ...[...PAYMENT_FEATURE_FLAGS, ...FULFILMENT_FEATURE_FLAGS, ...FINANCE_FEATURE_FLAGS].map(
      (f) => `| \`${f.key}\` | ${cell(f.description)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
