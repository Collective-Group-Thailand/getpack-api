import { REDIS } from '@database/redis.module';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { type RumZone } from './rum';

const KEEP_SECONDS = 35 * 86_400;
const dayKey = (at: Date) => `rum:${new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}`;

export interface VitalSample {
  name: string;
  value: number;
  rating: string;
  route: string;
}

export interface VitalSummary {
  zone: string;
  route: string;
  name: string;
  samples: number;
  average: number;
  poorPct: number;
}

/**
 * Daily aggregates of web-vital samples in Redis (one hash per Bangkok day, kept 35 days): count, sum and poor
 * count per zone × route pattern × metric. Fire-and-forget: Redis being down loses samples, never the request.
 */
@Injectable()
export class RumService {
  private readonly logger = new Logger(RumService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async record(zone: RumZone, sample: VitalSample, at = new Date()): Promise<void> {
    const key = dayKey(at);
    const field = `${zone}|${sample.route}|${sample.name}`;
    try {
      await this.redis
        .multi()
        .hincrby(key, `${field}|n`, 1)
        .hincrbyfloat(key, `${field}|sum`, sample.value)
        .hincrby(key, `${field}|poor`, sample.rating === 'poor' ? 1 : 0)
        .expire(key, KEEP_SECONDS)
        .exec();
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'web vital dropped');
    }
  }

  async summary(day: string): Promise<VitalSummary[]> {
    const raw = await this.redis.hgetall(`rum:${day}`);
    const rows = new Map<string, { n: number; sum: number; poor: number }>();
    for (const [field, value] of Object.entries(raw)) {
      const at = field.lastIndexOf('|');
      const key = field.slice(0, at);
      const row = rows.get(key) ?? { n: 0, sum: 0, poor: 0 };
      const kind = field.slice(at + 1) as 'n' | 'sum' | 'poor';
      row[kind] = Number(value);
      rows.set(key, row);
    }
    return [...rows]
      .map(([key, r]) => {
        const [zone, route, name] = key.split('|') as [string, string, string];
        return {
          zone,
          route,
          name,
          samples: r.n,
          average: r.n ? Number((r.sum / r.n).toFixed(3)) : 0,
          poorPct: r.n ? Number(((r.poor * 100) / r.n).toFixed(1)) : 0,
        };
      })
      .sort(
        (a, b) =>
          a.zone.localeCompare(b.zone) || a.route.localeCompare(b.route) || a.name.localeCompare(b.name),
      );
  }
}
