import { startTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

declare global {
  var __PACKIO_E2E_INFRA__: TestInfra | undefined;
}

/** Starts PostgreSQL 18 + Redis once for the e2e run, applies every migration; tests read the connection env. */
export default async function globalSetup(): Promise<void> {
  const infra = await startTestInfra();
  migrateDeploy(infra.env.DATABASE_URL!);
  globalThis.__PACKIO_E2E_INFRA__ = infra;
  Object.assign(process.env, infra.env);
}
