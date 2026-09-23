import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';

describe('InMemoryIdempotencyStore', () => {
  it('claims once, reports progress, completes, expires', async () => {
    let now = 0;
    const store = new InMemoryIdempotencyStore(() => now);
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({ acquired: true });
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({
      acquired: false,
      existing: { state: 'in_progress', fingerprint: 'fp' },
    });
    await store.complete('k', 'fp', { status: 201, body: { ok: 1 }, headers: {} }, 100);
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({
      acquired: false,
      existing: { state: 'completed' },
    });
    now = 101_000;
    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({ acquired: true });
  });
});
