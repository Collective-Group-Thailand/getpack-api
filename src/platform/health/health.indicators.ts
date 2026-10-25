import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { PrismaService } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { type Redis } from 'ioredis';

const TIMEOUT_MS = 2_000;

@Injectable()
export class DependencyHealthIndicators {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  database() {
    return this.health
      .check('database')
      .attempt(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      })
      .withTimeout(TIMEOUT_MS);
  }

  redisPing() {
    return this.health
      .check('redis')
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(TIMEOUT_MS);
  }

  objectStorage() {
    return this.health
      .check('storage')
      .attempt(({ signal }) => this.storage.ping(signal))
      .withTimeout(TIMEOUT_MS);
  }
}
