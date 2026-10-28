import { ADMIN_MENU } from '@modules/iam/menu.catalog';
import { ROLES } from '@modules/iam/roles.catalog';
import { listExportOf } from '@modules/reports/list-exports';

import { fileAccessLogWhere } from './customer-file-access.service';

/** C1f (owner 2026-10-28 13:58, D-451, DECISIONS-STAGE-A §14.7): the customer file access log page and its export. */
describe('customer file access log filters (C1f)', () => {
  it('filters by order code, file kind and Superadmin reason access, besides the C1d filters', () => {
    expect(
      fileAccessLogWhere({
        orderCode: 'devor-2610-00001',
        fileKind: 'customer_original',
        withReason: true,
        from: new Date('2026-10-01T00:00:00+07:00'),
      }),
    ).toEqual([
      { order: { orderCode: { equals: 'devor-2610-00001', mode: 'insensitive' } } },
      { fileKind: 'customer_original' },
      { reason: { not: null } },
      { occurredAt: { gte: new Date('2026-10-01T00:00:00+07:00') } },
    ]);
    expect(fileAccessLogWhere({ withReason: false })).toEqual([{ reason: null }]);
    expect(fileAccessLogWhere({})).toEqual([]);
  });

  it('exports through the list-export pattern, behind the log permission, with the typed reason', async () => {
    const def = listExportOf('customer_file_access_logs')!;
    expect(def.permission).toBe('customer_file_access_logs.read');
    expect(def.columns.map((c) => c.key)).toContain('reason');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n,
        occurredAt: new Date('2026-10-28T03:00:00Z'),
        actorType: 'user',
        actorUser: { displayName: 'ซูเปอร์แอดมิน ทดสอบ' },
        actorApiClient: null,
        fileObject: { publicId: 'f-1' },
        order: { orderCode: 'DEVOR-2610-00001' },
        fileKind: 'customer_original',
        channel: 'admin',
        purpose: 'download',
        reason: 'ตรวจไฟล์ตามคำขอลูกค้า (fake)',
        requestId: null,
      },
    ]);
    const rows = [];
    for await (const row of def.rows({ customerFileAccessLog: { findMany } } as never, {
      withReason: 'true',
      from: '2026-10-28',
      to: '2026-10-28',
      fileKind: 'nonsense',
    }))
      rows.push(row);
    expect(rows).toEqual([
      expect.objectContaining({
        actor: 'ซูเปอร์แอดมิน ทดสอบ',
        reason: 'ตรวจไฟล์ตามคำขอลูกค้า (fake)',
        orderCode: 'DEVOR-2610-00001',
      }),
    ]);
    const where = (findMany.mock.calls[0]![0] as { where: { AND: unknown[] } }).where.AND;
    expect(where).toEqual([
      { reason: { not: null } },
      { occurredAt: { gte: new Date('2026-10-28T00:00:00+07:00') } },
      { occurredAt: { lt: new Date('2026-10-29T00:00:00+07:00') } },
      { id: { gt: 0n } },
    ]);
  });

  it('is a menu entry for whoever reads the log (Superadmin, Auditor)', () => {
    const entry = ADMIN_MENU.find((m) => m.key === 'customer_file_access_logs');
    expect(entry).toMatchObject({
      path: '/admin/customer-file-access-logs',
      permission: 'customer_file_access_logs.read',
    });
    const holders = ROLES.filter((r) =>
      (r.permissions as readonly string[]).includes('customer_file_access_logs.read'),
    );
    expect(holders.map((r) => r.key)).toEqual(expect.arrayContaining(['auditor', 'superadmin']));
  });
});
