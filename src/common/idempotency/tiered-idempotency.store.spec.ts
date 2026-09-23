import { type IdempotencyStore, type StoredResponse } from './idempotency.store';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import { TieredIdempotencyStore } from './tiered-idempotency.store';

const RESPONSE: StoredResponse = { status: 201, body: { id: 'x' }, headers: { location: '/x' } };

function brokenStore(): IdempotencyStore {
  const fail = () => Promise.reject(new Error('redis down'));
  return { begin: fail, complete: fail, release: fail };
}

describe('TieredIdempotencyStore', () => {
  let fast: InMemoryIdempotencyStore;
  let durable: InMemoryIdempotencyStore;
  let store: TieredIdempotencyStore;

  beforeEach(() => {
    fast = new InMemoryIdempotencyStore();
    durable = new InMemoryIdempotencyStore();
    store = new TieredIdempotencyStore(fast, durable);
  });

  it('claims a new key in both tiers', async () => {
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({ acquired: true });
    await expect(fast.begin('k', 'fp', 60)).resolves.toMatchObject({ acquired: false });
    await expect(durable.begin('k', 'fp', 60)).resolves.toMatchObject({ acquired: false });
  });

  it('answers a replay from the fast path', async () => {
    await store.begin('k', 'fp', 60);
    await store.complete('k', 'fp', RESPONSE, 86_400);
    const durableBegin = jest.spyOn(durable, 'begin');
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({
      acquired: false,
      existing: { state: 'completed', fingerprint: 'fp', response: RESPONSE },
    });
    expect(durableBegin).not.toHaveBeenCalled();
  });

  it('lets the database win when Redis lost the record, and frees the fast-path claim', async () => {
    await durable.begin('k', 'fp', 60);
    await durable.complete('k', 'fp', RESPONSE, 86_400);

    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({
      acquired: false,
      existing: { state: 'completed', fingerprint: 'fp', response: RESPONSE },
    });
    await expect(fast.begin('k', 'other', 60)).resolves.toEqual({ acquired: true });
  });

  it('writes the completed response to the database first', async () => {
    const order: string[] = [];
    jest.spyOn(durable, 'complete').mockImplementation(() => {
      order.push('durable');
      return Promise.resolve();
    });
    jest.spyOn(fast, 'complete').mockImplementation(() => {
      order.push('fast');
      return Promise.resolve();
    });
    await store.complete('k', 'fp', RESPONSE, 86_400);
    expect(order).toEqual(['durable', 'fast']);
  });

  it('keeps working on the database alone when Redis is down', async () => {
    const degraded = new TieredIdempotencyStore(brokenStore(), durable);
    await expect(degraded.begin('k', 'fp', 60)).resolves.toEqual({ acquired: true });
    await expect(degraded.begin('k', 'fp', 60)).resolves.toMatchObject({ acquired: false });
    await degraded.complete('k', 'fp', RESPONSE, 86_400);
    await expect(degraded.begin('k', 'fp', 60)).resolves.toMatchObject({
      acquired: false,
      existing: { state: 'completed' },
    });
    await degraded.release('k');
  });

  it('releases both tiers', async () => {
    await store.begin('k', 'fp', 60);
    await store.release('k');
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({ acquired: true });
  });
});
