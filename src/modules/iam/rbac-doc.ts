import { SOD_RULES } from '../../../prisma/seed/data/reference';
import { PERMISSIONS } from './permissions.catalog';
import { ROLES } from './roles.catalog';

/** D-469 / D-470: the sales desk's personal data and field-level visibility (not expressible as a permission grid). */
export const SALES_DESK_NOTES: readonly string[] = [
  '## Company sales desk — personal data and field visibility (D-469, D-470)',
  '',
  '- **Inbound sales enquiries** (`sales_inbound_leads`): contact name, phone, e-mail, organisation and need. Purpose:',
  '  answering a sales enquiry the person sent (contact form, RFQ) or staff entered with their agreement. Retention:',
  '  while open, then 2 years after it closes, unless the person asks for erasure earlier. Access:',
  '  `sales.pipeline.manage` (the whole pool) and the assigned rep (`sales.pipeline.self`). Events carry no contact data.',
  "- **Rep pipeline**: the agent programme's lead rules (D-417, D-468) — a rep reaches only their own employee agent's",
  "  leads; a manager acting on a rep's lead is audited (`sales_lead.acted_for`); freelance agents' leads are read-only.",
  '- **Deal waterfall (D-470)** — three serializers chosen on the server, never hidden client-side:',
  '  - freelance agents: no access to the desk at all (the agent zone shows options and their own commission only);',
  '  - `sales_rep` (`discount_approvals.read` without the two below): `authorityLevel` green / amber / red only —',
  '    no revenue, cost, margin, commission base, credit cost or price lock field is present in the payload;',
  '  - `sales_manager` (`discount_approvals.margin_pct`): discount %, gross margin %, contribution %, floor %, floor check;',
  '  - C-Level, VP, Director, Finance Manager, Superadmin (`discount_approvals.waterfall_full`): the full waterfall and',
  '    the factory price locks.',
  '  Every view, simulation and export is logged in `sales_waterfall_views` (Superadmin, Auditor read it); the only',
  '  export is `discount_approvals.export` (Finance Manager). Bottom line wording: "กำไรหลังหักค่าคอม", never "กำไรสุทธิ".',
  '',
  '## Automatic lead capture and scoring — personal data (D-471)',
  '',
  '- **Captured signals** (`sales_inbound_leads` sources `studio_idle`, `dieline_download`): the account the signal',
  '  came from (`capture_user_id`), its name, phone, e-mail and active company, the idle studio design',
  '  (`design_document_id`), repeat signals (`signal_count`, `last_signal_at`). Purpose: a sales follow-up the person',
  '  agreed to — only when their latest marketing consent is granted; the consent record relied on is kept',
  '  (`consent_record_id`, `consent_basis`). Retention: as the inbound item (while open, then 2 years). Access: as the',
  '  inbound pool (`sales.pipeline.manage`, the assigned rep). Agents never see captured items.',
  '- **Lead score** (`score`, `score_reasons`, `scored_at` on inbound items and agent leads): derived from the item or',
  '  lead itself by `sales.scoring_rules`. Staff with the pipeline permissions see the score and its top 3 reasons; an',
  '  agent sees the score of their own leads only (no reasons). Pricing-page visits are not used (analytics consent is',
  '  for aggregate analytics only).',
  '- **Dieline downloads without sign-in** (`dieline_downloads.device_hash`): SHA-256 of a random browser id, no',
  '  account, no IP. Purpose: asking for a free sign-in from the second download. Retention: as the download log.',
  '  Access: none through the API (counted only).',
  '',
  '## Management P&L planner — confidentiality (D-472)',
  '',
  '- `pnl.read`: C-Level, VP, Director, Finance Manager (+ Superadmin); `pnl.manage` and `pnl.export`: C-Level and',
  '  Finance Manager (+ Superadmin). VP and Director read only. Finance (the accountant role), Auditor, Sales and every',
  '  other role: 403 on every `admin.pnl.*` operation. Every grid / plan-vs-actual view and every export is logged in',
  '  the append-only `pnl_access_logs`; exports are watermarked with the viewer and the time and audited.',
  '- No personal data: the drill-down returns ids, codes and amounts only (leads by stage, run-rate customers as',
  '  company ids, never contact data). Management figures only — nothing is posted to the ledger.',
  '',
  '## Agent programme waiting list — personal data (P7 pilot switch)',
  '',
  '- **`sales_agent_waitlist`**: name, the phone and / or e-mail given, how they sell (optional), sign-up count and',
  '  times, and the consent record relied on (purpose `agent_waitlist`, with its IP and user agent). Purpose: to tell',
  '  the person once, through that contact, when agent sign-up opens. Retention: until 12 months after the public',
  '  opening, or earlier when the person asks (DPO deletes the row). Access: `agent_waitlist.read` (Sales Manager,',
  '  C-Level, Superadmin) — list and CSV export (audited). Sign-ups are anonymous and throttled; the answer is the',
  '  same for a new and an already listed contact.',
];

const AUDIENCES = [
  { key: 'staff', title: 'getpack staff (platform scope)' },
  { key: 'partner', title: 'Partner factory (factory scope)' },
  { key: 'customer', title: 'B2B company members (company scope)' },
] as const;

/**
 * `docs/rbac.md`, generated from the role and permission catalogues and the SoD seed (B1.3).
 * `pnpm rbac:build` writes it; a unit test fails when the committed file differs from the code.
 */
export function renderRbacDoc(): string {
  const lines: string[] = [
    '# RBAC matrix — getpack-api',
    '',
    '> **Generated** by `pnpm rbac:build` from `src/modules/iam/roles.catalog.ts`, `permissions.catalog.ts` and',
    '> `prisma/seed/data/reference.ts`. Do not edit by hand. Roles per D-140; cost and margin visibility per D-141;',
    '> factories see only delivery contact data of customers (D-142, enforced in projections, not by a permission).',
    '> Grants where a decision is silent are the narrowest that lets the role work (docs/PROGRESS.md, B1.2) — **review**.',
    '',
    'Legend: ● granted · ◆ granted and sensitive (cost/margin data, D-141).',
    '',
  ];

  for (const audience of AUDIENCES) {
    const roles = ROLES.filter((r) => r.audience === audience.key);
    const permissions = PERMISSIONS.filter((p) => p.audience === audience.key);
    lines.push(`## ${audience.title}`, '');
    lines.push(`| Permission | ${roles.map((r) => `\`${r.key}\``).join(' | ')} |`);
    lines.push(`|---|${roles.map(() => ':-:').join('|')}|`);
    for (const permission of permissions) {
      const sensitive = 'sensitive' in permission && permission.sensitive;
      const cells = roles.map((r) =>
        (r.permissions as readonly string[]).includes(permission.key) ? (sensitive ? '◆' : '●') : '',
      );
      const refs = 'decisionRefs' in permission ? ` (${permission.decisionRefs.join(', ')})` : '';
      lines.push(`| \`${permission.key}\` — ${permission.description}${refs} | ${cells.join(' | ')} |`);
    }
    lines.push('');
    lines.push('| Role | Name (th) | Name (en) |', '|---|---|---|');
    for (const role of roles) lines.push(`| \`${role.key}\` | ${role.nameTh} | ${role.nameEn} |`);
    lines.push('');
  }

  lines.push(...SALES_DESK_NOTES, '');
  lines.push('## Segregation of duties (`accounting-design.md` §8)', '');
  lines.push('| Rule | Kind | Pair | Match | Decisions |', '|---|---|---|---|---|');
  for (const rule of SOD_RULES) {
    const pair =
      rule.kind === 'role_pair'
        ? rule.roles!.map((r) => `\`${r}\``).join(' × ')
        : rule.actions!.map((a) => `\`${a}\``).join(' → ');
    lines.push(
      `| ${rule.description} | ${rule.kind} | ${pair} | ${rule.subjectMatch ?? '—'} | ${rule.decisions.join(', ')} |`,
    );
  }
  lines.push(
    '',
    'Also enforced by code: nobody grants or revokes their own roles; staff roles can be granted only by someone',
    'who holds all of their permissions; an approval request cannot be approved by its requester, and one person',
    'approves at most one step of a request (ADR-0006).',
    '',
  );
  return lines.join('\n');
}
