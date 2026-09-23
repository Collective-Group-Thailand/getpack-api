import { randomUUID } from 'node:crypto';

import { fingerprintOf } from '@common/idempotency/idempotency.interceptor';
import { PrismaIdempotencyStore, splitStoreKey } from '@common/idempotency/prisma-idempotency.store';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';

import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

describe('PrismaIdempotencyStore (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaService;
  let store: PrismaIdempotencyStore;

  const keyFor = () => `anonymous|POST|/v1/admin/things|${randomUUID()}`;
  const fp = fingerprintOf({ amount: '100.00' });
  const response = { status: 201, body: { id: 'x', amount: '100.00' }, headers: { location: '/x' } };

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaService({ get: () => db.url } as unknown as AppConfig);
    store = new PrismaIdempotencyStore(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  it('splits the interceptor key into scope and uuid', () => {
    const key = randomUUID();
    expect(splitStoreKey(`user-1|POST|/v1/x|${key}`)).toEqual({ scope: 'user-1|POST|/v1/x', key });
    expect(() => splitStoreKey('no-separator')).toThrow();
  });

  it('lets exactly one of many concurrent attempts claim a key', async () => {
    const key = keyFor();
    const results = await Promise.all(Array.from({ length: 20 }, () => store.begin(key, fp, 60)));
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toEqual(
      Array.from({ length: 19 }, () => ({
        acquired: false,
        existing: { state: 'in_progress', fingerprint: fp },
      })),
    );
  });

  it('stores the completed response durably for 24 h and replays it', async () => {
    const key = keyFor();
    await store.begin(key, fp, 60);
    await store.complete(key, fp, response, 86_400);
    await expect(store.begin(key, fp, 60)).resolves.toEqual({
      acquired: false,
      existing: { state: 'completed', fingerprint: fp, response },
    });
    const { scope, key: uuid } = splitStoreKey(key);
    const [row] = (
      await db.client.query<{ hours: number }>(
        'SELECT extract(epoch FROM expires_at - now()) / 3600 AS hours FROM idempotency_keys WHERE scope = $1 AND key = $2',
        [scope, uuid],
      )
    ).rows;
    expect(Number(row!.hours)).toBeGreaterThan(23.9);
  });

  it('takes over a crashed attempt once its lock has expired', async () => {
    const key = keyFor();
    await store.begin(key, fp, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(store.begin(key, fingerprintOf({ other: true }), 60)).resolves.toEqual({ acquired: true });
  });

  it('releases an in-progress key but never a completed one', async () => {
    const key = keyFor();
    await store.begin(key, fp, 60);
    await store.release(key);
    await expect(store.begin(key, fp, 60)).resolves.toEqual({ acquired: true });

    await store.complete(key, fp, response, 86_400);
    await store.release(key);
    await expect(store.begin(key, fp, 60)).resolves.toMatchObject({
      acquired: false,
      existing: { state: 'completed' },
    });
  });

  it('purges expired keys', async () => {
    const key = keyFor();
    await store.begin(key, fp, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(store.purgeExpired()).resolves.toBeGreaterThanOrEqual(1);
    const { scope, key: uuid } = splitStoreKey(key);
    const { rowCount } = await db.client.query(
      'SELECT 1 FROM idempotency_keys WHERE scope = $1 AND key = $2',
      [scope, uuid],
    );
    expect(rowCount).toBe(0);
  });
});
