import { type PrismaService } from '@database/prisma.service';
import { PERMISSIONS } from '@modules/iam/permissions.catalog';

import { DashboardService } from './dashboard.service';

describe('admin dashboard queues (U-B0.3)', () => {
  const definitions = new DashboardService({} as PrismaService).definitions();

  it('has unique keys, each gated on a permission of the catalogue', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    expect(new Set(definitions.map((d) => d.key)).size).toBe(definitions.length);
    for (const d of definitions) expect(known.has(d.permission)).toBe(true);
  });

  it('carries every finance queue the finance home reads (F6)', () => {
    expect(definitions.map((d) => d.key)).toEqual(
      expect.arrayContaining([
        'finance.slips',
        'finance.unmatched_bank_lines',
        'finance.unidentified_receipts',
        'finance.payout_runs_awaiting_approval',
        'finance.deliveries_without_gr',
        'finance.bills_missing_tax_invoice',
        'finance.wht_certificates_missing',
        'finance.overdue_b2b_invoices',
        'finance.refunds_to_pay',
        'finance.close_tasks',
      ]),
    );
  });
});
