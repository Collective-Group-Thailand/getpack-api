import { REDIS } from '@database/redis.module';
import { Inject, Injectable } from '@nestjs/common';
import { type Redis } from 'ioredis';

export const REALTIME_CHANNEL_PREFIX = 'getpack:rt:';

/** Realtime signal (contract §6): ids and type only — clients refetch through the API. */
export interface RealtimeSignal {
  type: string;
  id?: string;
}

/** Publishes signals to a principal's channel over Redis pub/sub; SSE streams relay them. */
@Injectable()
export class RealtimePublisher {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** `channel` is `user:<public uuid>`; never throws (realtime is best effort). */
  async publish(channel: string, signal: RealtimeSignal): Promise<void> {
    await this.redis.publish(`${REALTIME_CHANNEL_PREFIX}${channel}`, JSON.stringify(signal)).catch(() => 0);
  }
}
