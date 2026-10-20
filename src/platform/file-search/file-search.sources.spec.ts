import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADMIN_FILE_SOURCES, FILE_SOURCES, PARTNER_FILE_SOURCES } from './file-search.sources';

const MIGRATION = join(__dirname, '../../../prisma/migrations/20261212000001_file_text_search/migration.sql');

/** Each branch of the view: its source key and the admin / partner permission columns. */
function branches(): { source: string; admin: boolean; partner: boolean }[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const view = sql.slice(sql.indexOf('CREATE VIEW search.file_usages'));
  return view.split(/\nUNION ALL\n/).map((branch) => {
    const select = branch.slice(branch.indexOf('SELECT'), branch.indexOf('FROM'));
    const source = /SELECT '([a-z_]+)'/.exec(select)![1]!;
    // Columns 8 and 9 of the select list: admin_permission, partner_permission.
    const cols = select
      .replace(/^SELECT\s+/, '')
      .replace(/\([^()]*\)/g, '()')
      .split(',')
      .map((c) => c.trim());
    return { source, admin: !/^NULL/.test(cols[7]!), partner: !/^NULL/.test(cols[8]!) };
  });
}

describe('content search sources (D-427)', () => {
  it('lists every branch of search.file_usages, on the surfaces the view shows it', () => {
    const rows = branches();
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(FILE_SOURCES));
    for (const s of PARTNER_FILE_SOURCES) expect(rows.some((r) => r.source === s && r.partner)).toBe(true);
    for (const s of ADMIN_FILE_SOURCES) expect(rows.some((r) => r.source === s && r.admin)).toBe(true);
    // A source only one surface lists never carries the other surface's permission.
    for (const r of rows) {
      if (r.partner) expect(PARTNER_FILE_SOURCES).toContain(r.source);
      if (r.admin) expect(ADMIN_FILE_SOURCES).toContain(r.source);
    }
  });

  it('never reads identity, bank or export files', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const view = sql.slice(sql.indexOf('CREATE VIEW search.file_usages'));
    for (const table of [
      'company_kyc_documents',
      'factory_kyc_documents',
      'sales_agent_applications',
      'privacy_requests',
      'pbc_exports',
      'report_runs',
      'bank_statement_imports',
      'artwork_submission_files',
    ])
      expect(view).not.toContain(table);
  });
});
