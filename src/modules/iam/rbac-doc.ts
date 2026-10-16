import { SOD_RULES } from '../../../prisma/seed/data/reference';
import { PERMISSIONS } from './permissions.catalog';
import { ROLES } from './roles.catalog';

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
