import { quantityBand } from '@modules/rfq/rfq-spec';

import { outboxProperties } from './outbox-events.subscriber';
import { bind, DIMENSIONS_SQL, ROLLUP_JOBS } from './rollups.sql';

describe('analytics rollup SQL (B6.1)', () => {
  it('binds only a valid calendar day, as a literal', () => {
    const sql = bind('SELECT :day, :start, :end', '2026-10-31');
    expect(sql).toBe(
      "SELECT DATE '2026-10-31', (DATE '2026-10-31'::timestamp AT TIME ZONE 'Asia/Bangkok'), ((DATE '2026-10-31' + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')",
    );
    for (const bad of ['2026-13-01', "2026-10-01'; DROP TABLE orders; --", '20261001', '2026-10-32'])
      expect(() => bind('SELECT :day', bad)).toThrow('invalid rollup day');
  });

  it('rebuilds each fact of one date only: delete that date, then insert', () => {
    expect(new Set(ROLLUP_JOBS.map((j) => j.key)).size).toBe(ROLLUP_JOBS.length);
    for (const job of ROLLUP_JOBS) {
      const statements = job.statements.map((s) => bind(s, '2026-10-01'));
      const del = statements.findIndex((s) =>
        s.startsWith(`DELETE FROM analytics.${job.key} WHERE date_key = DATE '2026-10-01'`),
      );
      expect(del).toBeGreaterThanOrEqual(0);
      expect(statements.at(-1)).toMatch(new RegExp(`^INSERT INTO analytics\\.${job.key} `));
      expect(del).toBeLessThan(statements.length - 1);
      for (const s of statements) expect(s).not.toMatch(/:(day|start|end)\b/);
    }
    for (const s of DIMENSIONS_SQL) expect(bind(s, '2026-10-01')).not.toMatch(/:(day|start|end)\b/);
  });

  it('uses the same quantity bands as unmet demand (SQL twin in the migration)', () => {
    // Keep in step with analytics.quantity_band() and analytics.dim_quantity_band.
    const edges: [number, string][] = [
      [0, '0-99'],
      [99, '0-99'],
      [100, '100-499'],
      [499, '100-499'],
      [500, '500-999'],
      [1000, '1000-4999'],
      [5000, '5000-9999'],
      [10_000, '10000-49999'],
      [49_999, '10000-49999'],
      [50_000, '50000+'],
    ];
    for (const [q, band] of edges) expect(quantityBand(q)).toBe(band);
  });

  it('copies only short codes from outbox payloads', () => {
    expect(
      outboxProperties({
        aggregateType: 'order_group',
        payload: {
          channel: 'web',
          status: 'in_progress',
          customerId: '0192f3a0-7c1e-7d2a-9b1f-000000310001',
          grossAmount: '1070.00',
          note: 'call me on 0812345678',
          from: 'Waiting Payment',
        },
      }),
    ).toEqual({ aggregateType: 'order_group', channel: 'web', status: 'in_progress' });
  });
});
