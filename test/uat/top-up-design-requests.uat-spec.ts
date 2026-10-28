import { writeFileSync } from 'node:fs';

import { type FulfilmentApp } from '../support/fulfilment-e2e';
import { type DesignRequestsCustomer, populateDesignRequests } from './populate-design-requests';
import { as, bootUatApp, customerSignIn, ok, staff } from './uat-support';

/**
 * Top-up of an already populated UAT database (docs/launch/UAT-DATA.md §6.2): adds only the RFQ baskets, standalone
 * samples and structural design requests that `pnpm uat:populate` now creates, for databases populated before it did.
 * Skipped unless `UAT_TOPUP_CONFIRM=uat-only`; refuses to run twice (a basket already exists).
 *
 *   UAT_DATABASE_URL=… UAT_TOPUP_CONFIRM=uat-only UAT_SEED_PASSWORD=… pnpm uat:populate test/uat/top-up-design-requests
 */
const enabled = process.env['UAT_TOPUP_CONFIRM'] === 'uat-only';
const PHONES: Record<string, string> = { C01: '0800000101', C06: '0800000106', C07: '0800000107' };

(enabled ? describe : describe.skip)('UAT top-up: RFQ baskets, samples, structural requests', () => {
  let ctx: FulfilmentApp;
  const report: { step: string; ok: boolean; detail: string }[] = [];
  const customers = new Map<string, DesignRequestsCustomer>();
  const tokens: Record<string, string> = {};

  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      report.push({ step: name, ok: true, detail: (await fn()) ?? '' });
    } catch (error) {
      report.push({ step: name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  beforeAll(async () => {
    ctx = await bootUatApp();
    if ((await ctx.prisma.order.count()) === 0) throw new Error('run `pnpm uat:populate` first');
    if ((await ctx.prisma.rfqBasket.count()) > 0) throw new Error('this database already has RFQ baskets');
    tokens['cs'] = await staff(ctx, 'cs');
    tokens['cs_lead'] = await staff(ctx, 'cs_lead');
    for (const [key, phone] of Object.entries(PHONES)) {
      const token = await customerSignIn(ctx, phone);
      const addresses = await ok<{ data: { id: string; postcode: string; isDefault: boolean }[] }>(
        as(ctx, token).get('/v1/store/addresses'),
      );
      const address = addresses.data.find((a) => a.isDefault) ?? addresses.data[0]!;
      customers.set(key, { token, addressId: address.id, postcode: address.postcode });
    }
  }, 600_000);

  afterAll(async () => {
    writeFileSync('.uat-topup-report.json', JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      [
        `UAT top-up: ${report.filter((r) => r.ok).length}/${report.length} steps ok (.uat-topup-report.json)`,
        ...report.map((r) => `${r.ok ? '✓' : '✗'} ${r.step}${r.detail ? ` — ${r.detail}` : ''}`),
      ].join('\n'),
    );
    await ctx?.app.close();
  });

  it('adds the records', async () => {
    const C = (key: string) => {
      const c = customers.get(key);
      if (!c) throw new Error(`customer ${key} is not signed in`);
      return c;
    };
    await populateDesignRequests({ ctx, tokens, step, C });
    expect(report.filter((r) => !r.ok)).toEqual([]);
  }, 900_000);
});
