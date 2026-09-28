import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { Client } from 'pg';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy, SQLSTATE } from '../support/database';

/** Guards of the B3.4 loyalty tables (schema-design §3.6, A-34; PostgreSQL 18). */
describe('loyalty schema — points ledger, lots, reviews (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let client: Client;
  let userId: bigint;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
    await seedDev(prisma);
    userId = (await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } })).id;
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  async function state(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  const entry = (data: Partial<Parameters<PrismaService['pointsEntry']['create']>[0]['data']> = {}) =>
    prisma.pointsEntry.create({
      data: {
        userId,
        entryType: 'earn_bonus',
        points: 10,
        pointValue: '2.500000',
        bahtValue: '25.00',
        status: 'pending',
        availableAt: new Date(),
        ...data,
      } as Parameters<PrismaService['pointsEntry']['create']>[0]['data'],
    });

  it('keeps the points ledger append-only; only an earning’s status moves forward', async () => {
    const e = await entry();
    expect(await state('UPDATE points_ledger SET points = 11 WHERE id = $1', [e.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state('DELETE FROM points_ledger WHERE id = $1', [e.id])).toBe(SQLSTATE.restrictViolation);
    expect(
      await state(
        "UPDATE points_ledger SET status = 'available', expires_at = now() + interval '1 year' WHERE id = $1",
        [e.id],
      ),
    ).toBeNull();
    expect(await state("UPDATE points_ledger SET status = 'pending' WHERE id = $1", [e.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state('UPDATE points_ledger SET expires_at = now() WHERE id = $1', [e.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state("UPDATE points_ledger SET status = 'expired' WHERE id = $1", [e.id])).toBeNull();
  });

  it('checks the sign of each entry type, non-earnings being posted and adjustments having a reason', async () => {
    const base = `INSERT INTO points_ledger (user_id, entry_type, points, point_value, baht_value, status, available_at)
                  VALUES ($1, $2, $3, 2.5, 0, $4, now())`;
    expect(await state(base, [userId, 'redeem', 5, 'available'])).toBe(SQLSTATE.checkViolation);
    expect(await state(base, [userId, 'earn_bonus', -5, 'available'])).toBe(SQLSTATE.checkViolation);
    expect(await state(base, [userId, 'redeem', -5, 'pending'])).toBe(SQLSTATE.checkViolation);
    expect(await state(base, [userId, 'adjust', 5, 'available'])).toBe(SQLSTATE.checkViolation);
    expect(await state(base, [userId, 'redeem', -5, 'available'])).toBeNull();
  });

  it('allows each one-off reward once per customer', async () => {
    await entry({ entryType: 'earn_signup', status: 'available' });
    await expect(entry({ entryType: 'earn_signup', status: 'available' })).rejects.toThrow();
    const again = await state(
      `INSERT INTO points_ledger (user_id, entry_type, points, point_value, baht_value, status)
       VALUES ($1, 'earn_signup', 20, 2.5, 50, 'available')`,
      [userId],
    );
    expect(again).toBe(SQLSTATE.uniqueViolation);
  });

  it('keeps lots within their points and consumptions append-only', async () => {
    const e = await entry({ status: 'available', availableAt: null });
    const lot = await prisma.pointsLot.create({
      data: {
        earnEntryId: e.id,
        userId,
        points: 10,
        remaining: 10,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await state('UPDATE points_lots SET remaining = 11 WHERE id = $1', [lot.id])).toBe(
      SQLSTATE.checkViolation,
    );
    expect(await state('UPDATE points_lots SET remaining = -1 WHERE id = $1', [lot.id])).toBe(
      SQLSTATE.checkViolation,
    );
    expect(await state('DELETE FROM points_lots WHERE id = $1', [lot.id])).toBe(SQLSTATE.restrictViolation);
    const c = await prisma.pointsLotConsumption.create({
      data: { lotId: lot.id, consumingEntryId: e.id, points: 3 },
    });
    expect(await state('UPDATE points_lot_consumptions SET points = 4 WHERE id = $1', [c.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state('DELETE FROM points_lot_consumptions WHERE id = $1', [c.id])).toBe(
      SQLSTATE.restrictViolation,
    );
  });

  it('rates reviews 1–5', async () => {
    expect(
      await state(`INSERT INTO order_reviews (order_id, user_id, rating) VALUES (-1, $1, 6)`, [userId]),
    ).toBe(SQLSTATE.checkViolation);
  });
});
