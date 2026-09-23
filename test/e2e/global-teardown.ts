import { stopTestInfra } from '../support/containers';

export default async function globalTeardown(): Promise<void> {
  await stopTestInfra(globalThis.__PACKIO_E2E_INFRA__);
}
