import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { startTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

declare global {
  var __GETPACK_E2E_INFRA__: TestInfra | undefined;
}

/** Starts PostgreSQL 18 + Redis once for the e2e run, applies every migration; tests read the connection env. */
export default async function globalSetup(): Promise<void> {
  const infra = await startTestInfra();
  migrateDeploy(infra.env.DATABASE_URL!);
  globalThis.__GETPACK_E2E_INFRA__ = infra;
  Object.assign(process.env, infra.env);
  // Problems answered during the run, checked against the contract by `pnpm contract:observed-errors` (U-B2).
  const observed = join(process.cwd(), '.e2e-observed-errors');
  rmSync(observed, { recursive: true, force: true });
  process.env.GETPACK_OBSERVED_ERRORS_DIR = observed;
}
