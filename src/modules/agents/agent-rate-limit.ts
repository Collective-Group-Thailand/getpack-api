import { DomainException } from '@common/errors/domain.exception';
import { REDIS } from '@database/redis.module';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';

/**
 * Per-agent limits on the agent-zone calls that probe contact data or cost compute (P7 security review, D-440 / D-468):
 * the neutral duplicate check (`store.agentLeads.check`), the CSV import preview (≤ 500 rows through the same check)
 * and the business-card OCR (`store.agentLeads.scanCard`). **Technical / security limits**, not business values (same
 * class as the login throttle, `AUTH_LOGIN_THROTTLE_LIMIT`): they stop enumeration of who is already a customer or
 * another agent's lead, and OCR floods. Counted per agent in Redis by fixed window, on top of the global per-IP
 * throttle; without Redis the call is not limited (warning logged, the global throttle still applies).
 */
export const AGENT_RATE_LIMITS = {
  lead_check: { limit: 30, windowSeconds: 60 },
  card_scan: { limit: 10, windowSeconds: 60 },
  lead_import_preview: { limit: 20, windowSeconds: 3_600 },
} as const;

export type AgentRateLimitedAction = keyof typeof AGENT_RATE_LIMITS;

/** The window's Redis key and the seconds until it closes (pure, unit-tested). */
export function rateWindow(
  agentId: bigint,
  action: AgentRateLimitedAction,
  nowMs: number,
): { key: string; retryAfter: number; ttl: number } {
  const { windowSeconds } = AGENT_RATE_LIMITS[action];
  const windowMs = windowSeconds * 1000;
  const window = Math.floor(nowMs / windowMs);
  return {
    key: `agents:rl:${action}:${agentId}:${window}`,
    retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - nowMs) / 1000)),
    ttl: windowSeconds * 2,
  };
}

@Injectable()
export class AgentRateLimiter {
  private readonly logger = new Logger(AgentRateLimiter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts one call; over the limit → 429 `agents.rate_limited` with `Retry-After`. */
  async hit(agentId: bigint, action: AgentRateLimitedAction, nowMs = Date.now()): Promise<void> {
    const { key, retryAfter, ttl } = rateWindow(agentId, action, nowMs);
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, ttl);
    } catch (error) {
      // The action and the reason only — never the caller's input (PDPA).
      this.logger.warn(`agent rate limit unavailable (${action}): ${(error as Error).message}`);
      return;
    }
    if (count > AGENT_RATE_LIMITS[action].limit)
      throw new DomainException('agents.rate_limited', { headers: { 'Retry-After': String(retryAfter) } });
  }
}
