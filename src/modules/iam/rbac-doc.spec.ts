import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderRbacDoc } from './rbac-doc';

describe('docs/rbac.md', () => {
  it('matches the IAM catalogues (run `pnpm rbac:build` after changing roles or permissions)', () => {
    const committed = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'rbac.md'), 'utf8');
    expect(committed).toBe(renderRbacDoc());
  });

  it('shows D-141 cost visibility only for the roles the decision names', () => {
    const staffTable = renderRbacDoc().split('## Partner factory')[0]!;
    const costRow = staffTable.split('\n').find((l) => l.startsWith('| `factory_cost.read`'))!;
    const header = staffTable.split('\n').find((l) => l.startsWith('| Permission |'))!;
    const roles = header
      .split('|')
      .slice(2, -1)
      .map((c) => c.trim().replace(/`/g, ''));
    const cells = costRow
      .split('|')
      .slice(2, -1)
      .map((c) => c.trim());
    const withCost = roles.filter((_, i) => cells[i] === '◆').sort();
    expect(withCost).toEqual(
      ['c_level', 'finance', 'finance_manager', 'partner_manager', 'superadmin', 'vp'].sort(),
    );
  });
});
