import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

/** Same images as docker-compose.yml and production (ADR-0001). */
export const POSTGRES_IMAGE = 'pgvector/pgvector:pg18';
export const REDIS_IMAGE = 'redis:7-alpine';

export interface TestInfra {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  env: Record<string, string>;
}

/**
 * Docker Desktop (macOS) serves its socket at ~/.docker/run/docker.sock and only symlinks
 * /var/run/docker.sock when "Allow the default Docker socket" is on. Point Testcontainers at it
 * when DOCKER_HOST is not set; Ryuk still mounts the in-VM path. CI runners are unaffected.
 */
export function ensureDockerHost(): void {
  if (process.env.DOCKER_HOST || existsSync('/var/run/docker.sock')) return;
  const desktopSocket = join(homedir(), '.docker', 'run', 'docker.sock');
  if (!existsSync(desktopSocket)) return;
  process.env.DOCKER_HOST = `unix://${desktopSocket}`;
  process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
}

export async function startTestInfra(): Promise<TestInfra> {
  ensureDockerHost();
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('packio_test').start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  return {
    postgres,
    redis,
    env: {
      NODE_ENV: 'test',
      INTEGRATIONS_MODE: 'fake',
      LOG_LEVEL: 'silent',
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      S3_BUCKET: 'packio-test',
      // Every test request comes from one IP.
      AUTH_LOGIN_THROTTLE_LIMIT: '10000',
    },
  };
}

/** Tolerates containers a test already stopped. */
export async function stopTestInfra(infra: TestInfra | undefined): Promise<void> {
  await Promise.allSettled([infra?.postgres.stop(), infra?.redis.stop()]);
}
