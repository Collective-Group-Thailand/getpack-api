import { stopTestInfra } from '../support/containers';

export default async function globalTeardown(): Promise<void> {
  await stopTestInfra(globalThis.__GETPACK_E2E_INFRA__);
}
