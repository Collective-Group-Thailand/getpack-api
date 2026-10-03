import { type AppConfig } from '@config/app-config';
import { type PrismaService } from '@database/prisma.service';

import { FeatureFlagsService } from './feature-flags.service';

/** D-296: the production boot guard. */
describe('FeatureFlagsService boot guard (D-296)', () => {
  const service = (production: boolean, on: { key: string }[]) =>
    new FeatureFlagsService(
      { featureFlag: { findMany: () => Promise.resolve(on) } } as unknown as PrismaService,
      { isProduction: production } as unknown as AppConfig,
    );

  it('refuses to start in production with a development-only flag on', async () => {
    await expect(
      service(true, [{ key: 'payments.scb_direct_debit' }]).onApplicationBootstrap(),
    ).rejects.toThrow(/payments\.scb_direct_debit/);
  });

  it('starts when none is on, and outside production in any case', async () => {
    await expect(service(true, []).onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(
      service(false, [{ key: 'payments.scb_direct_debit' }]).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
