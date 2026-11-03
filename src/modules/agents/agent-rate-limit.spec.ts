import { DomainException } from '@common/errors/domain.exception';

import { AGENT_RATE_LIMITS, AgentRateLimiter, rateWindow } from './agent-rate-limit';

function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    counts,
    incr: jest.fn((key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve(counts.get(key)!);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
  };
}

describe('agent rate limits (P7 security review)', () => {
  it('keeps the documented technical limits', () => {
    expect(AGENT_RATE_LIMITS.lead_check).toEqual({ limit: 30, windowSeconds: 60 });
    expect(AGENT_RATE_LIMITS.card_scan).toEqual({ limit: 10, windowSeconds: 60 });
    expect(AGENT_RATE_LIMITS.lead_import_preview).toEqual({ limit: 20, windowSeconds: 3600 });
  });

  it('keys the window per agent and action and tells when it reopens', () => {
    const w = rateWindow(7n, 'lead_check', 125_500);
    expect(w.key).toBe('agents:rl:lead_check:7:2');
    expect(w.retryAfter).toBe(55);
    expect(rateWindow(8n, 'lead_check', 125_500).key).not.toBe(w.key);
    expect(rateWindow(7n, 'card_scan', 125_500).key).not.toBe(w.key);
  });

  it('allows the limit and refuses the next call with 429 and Retry-After', async () => {
    const redis = fakeRedis();
    const limiter = new AgentRateLimiter(redis as never);
    for (let i = 0; i < 10; i += 1) await limiter.hit(1n, 'card_scan', 1_000);
    const refusal = await limiter.hit(1n, 'card_scan', 1_000).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(DomainException);
    expect((refusal as DomainException).code).toBe('agents.rate_limited');
    expect((refusal as DomainException).headers['Retry-After']).toBe('59');
    // Another agent is not affected.
    await expect(limiter.hit(2n, 'card_scan', 1_000)).resolves.toBeUndefined();
    expect(redis.expire).toHaveBeenCalledTimes(2);
  });

  it('does not block when Redis is down (the per-IP throttle still applies)', async () => {
    const limiter = new AgentRateLimiter({ incr: () => Promise.reject(new Error('down')) } as never);
    await expect(limiter.hit(1n, 'lead_check')).resolves.toBeUndefined();
  });
});
