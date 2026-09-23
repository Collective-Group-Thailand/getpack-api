import { AppConfig } from '@config/app-config';
import { redisOptions } from '@database/redis.module';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Fails fast if Redis is unreachable, then keeps the process alive until SIGTERM/SIGINT. */
@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private keepAlive?: NodeJS.Timeout;

  constructor(private readonly config: AppConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    const probe = new Redis(this.config.get('REDIS_URL'), redisOptions({ maxRetriesPerRequest: 1 }));
    try {
      await probe.ping();
    } finally {
      probe.disconnect();
    }
    this.keepAlive = setInterval(() => undefined, 60_000);
    this.logger.log('worker ready (no queues registered yet)');
  }

  onApplicationShutdown(signal?: string): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.logger.log(`worker stopped${signal ? ` (${signal})` : ''}`);
  }
}
