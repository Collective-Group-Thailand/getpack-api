import { RedisIdempotencyStore } from '@common/idempotency/redis-idempotency.store';
import { redisOptions } from '@database/redis.module';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

import { ensureDockerHost, REDIS_IMAGE } from '../support/containers';

describe('RedisIdempotencyStore (Redis container)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let store: RedisIdempotencyStore;

  beforeAll(async () => {
    ensureDockerHost();
    container = await new RedisContainer(REDIS_IMAGE).start();
    redis = new Redis(container.getConnectionUrl(), redisOptions());
    store = new RedisIdempotencyStore(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('lets exactly one of many concurrent attempts claim a key', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.begin('race', 'fp', 60)));
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(19);
  });

  it('stores the completed response with the 24 h TTL and returns it', async () => {
    await store.begin('k1', 'fp', 60);
    await store.complete('k1', 'fp', { status: 201, body: { id: 'x' }, headers: { location: '/x' } }, 86_400);
    await expect(store.begin('k1', 'fp', 60)).resolves.toEqual({
      acquired: false,
      existing: {
        state: 'completed',
        fingerprint: 'fp',
        response: { status: 201, body: { id: 'x' }, headers: { location: '/x' } },
      },
    });
    const ttl = await redis.ttl('getpack:idem:k1');
    expect(ttl).toBeGreaterThan(86_000);
  });

  it('expires the in-progress lock so a crashed attempt does not block forever', async () => {
    await store.begin('k2', 'fp', 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(store.begin('k2', 'fp', 60)).resolves.toEqual({ acquired: true });
  });

  it('releases a key', async () => {
    await store.begin('k3', 'fp', 60);
    await store.release('k3');
    await expect(store.begin('k3', 'fp', 60)).resolves.toEqual({ acquired: true });
  });
});
