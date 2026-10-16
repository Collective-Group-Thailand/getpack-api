import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { ensureDockerHost, POSTGRES_IMAGE } from './containers';

export interface MigratedDatabase {
  container: StartedPostgreSqlContainer;
  url: string;
  client: Client;
}

/** Applies prisma/migrations with the real CLI, exactly as `pnpm db:migrate` does. */
export function migrateDeploy(url: string): void {
  const cli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** A PostgreSQL 18 + pgvector container with every migration applied and a connected client. */
export async function startMigratedDatabase(): Promise<MigratedDatabase> {
  ensureDockerHost();
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('getpack_test').start();
  const url = container.getConnectionUri();
  migrateDeploy(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  return { container, url, client };
}

export async function stopMigratedDatabase(db: MigratedDatabase | undefined): Promise<void> {
  await db?.client.end().catch(() => undefined);
  await db?.container.stop().catch(() => undefined);
}

/** Runs `work` in a transaction that is always rolled back, so tests never see each other's rows. */
export async function inRollback<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** The SQLSTATE of a failed statement run inside a savepoint (the outer transaction survives). */
export async function sqlState(client: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await client.query('SAVEPOINT probe');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT probe');
    return null;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    return (error as { code?: string }).code ?? 'unknown';
  }
}

export const SQLSTATE = {
  restrictViolation: '23001',
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
} as const;
