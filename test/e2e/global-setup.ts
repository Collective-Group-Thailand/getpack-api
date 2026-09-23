import { startTestInfra, type TestInfra } from '../support/containers';

declare global {
  var __PACKIO_E2E_INFRA__: TestInfra | undefined;
}

/** Starts PostgreSQL 18 + Redis once for the e2e run; tests read the connection env. */
export default async function globalSetup(): Promise<void> {
  const infra = await startTestInfra();
  globalThis.__PACKIO_E2E_INFRA__ = infra;
  Object.assign(process.env, infra.env);
}
