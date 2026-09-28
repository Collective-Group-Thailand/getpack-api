import { systemActor } from '@common/context/actor';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { type CheckoutDraft, type PlacedGroup } from '@modules/checkout/checkout.extensions';
import { IdentityFingerprints } from '@modules/promotions/identity-fingerprints.service';
import {
  type AppliedPromotion,
  PromotionRedemptions,
} from '@modules/promotions/promotion-redemptions.service';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

/** Coupon usage limits and campaign budgets under concurrent checkouts (D-053, D-154; PostgreSQL 18). */
describe('promotion usage under concurrency (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let redemptions: PromotionRedemptions;
  let identity: IdentityFingerprints;
  let entityId: bigint;
  let customerId: bigint;
  let seq = 0;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    await seedDev(prisma);
    identity = new IdentityFingerprints(new LookupHasher({ get: () => undefined } as unknown as AppConfig));
    redemptions = new PromotionRedemptions(prisma, identity, new DomainEvents(), new ActivityLogService());
    entityId = (await prisma.entity.findFirstOrThrow({ where: { isDefault: true } })).id;
    customerId = (await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  async function customer(): Promise<bigint> {
    seq += 1;
    const u = await prisma.user.create({
      data: { kind: 'customer', status: 'active', displayName: `[INT] ลูกค้า ${seq}` },
    });
    return u.id;
  }

  async function group(customerUserId: bigint): Promise<PlacedGroup> {
    seq += 1;
    const g = await prisma.orderGroup.create({
      data: {
        groupCode: `INT-PU-${seq}`,
        entityId,
        customerUserId,
        placedByUserId: customerUserId,
        channel: 'web',
        status: 'waiting_payment',
        netAmount: '1000.00',
        vatAmount: '70.00',
        grossAmount: '1070.00',
        cashAmount: '1070.00',
      },
    });
    return { groupId: g.id, groupPublicId: g.publicId, orders: [] };
  }

  async function promotion(opts: {
    total?: number;
    perCustomer?: number;
    codeLimit?: number;
    budget?: string;
  }) {
    seq += 1;
    const owner = (await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } })).id;
    const campaign = opts.budget
      ? await prisma.campaign.create({
          data: {
            entityId,
            code: `int-${seq}`,
            name: '[INT] แคมเปญ',
            startsAt: new Date(Date.now() - 60_000),
            status: 'active',
            budgetAmount: opts.budget,
            alertThresholdPct: '80',
            ownerUserId: owner,
          },
        })
      : null;
    const p = await prisma.promotion.create({
      data: {
        entityId,
        campaignId: campaign?.id ?? null,
        name: '[INT] โปร',
        kind: 'coupon',
        priority: 100,
        stacking: 'stackable',
        startsAt: new Date(Date.now() - 60_000),
        conditions: {},
        benefit: { type: 'fixed', amount: '250.00' },
        usageLimitTotal: opts.total ?? null,
        usageLimitPerCustomer: opts.perCustomer ?? null,
        status: 'active',
      },
    });
    const code = await prisma.couponCode.create({
      data: { promotionId: p.id, code: `INT${seq}X`, usageLimit: opts.codeLimit ?? null },
    });
    return { p, code, campaign };
  }

  const applied = (x: Awaited<ReturnType<typeof promotion>>, amount = '250.00'): AppliedPromotion => ({
    promotionId: x.p.id,
    promotionPublicId: x.p.publicId,
    couponCodeId: x.code.id,
    campaignId: x.campaign?.id ?? null,
    usageLimitTotal: x.p.usageLimitTotal,
    usageLimitPerCustomer: x.p.usageLimitPerCustomer,
    amount,
    cappedAmount: '0.00',
    snapshot: { code: x.code.code },
  });

  /** `n` checkouts at once, each for its own order group; returns how many reserved. */
  async function race(n: number, a: AppliedPromotion, customers: bigint[]) {
    const groups = await Promise.all(customers.slice(0, n).map((c) => group(c)));
    const results = await Promise.allSettled(
      groups.map((placed, i) =>
        prisma.withTx((tx) =>
          redemptions.reserve(
            tx,
            { customerUserId: customers[i]!, actor: systemActor('int') } as unknown as CheckoutDraft,
            placed,
            [a],
          ),
        ),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason as { code?: string });
    return { ok: results.length - failed.length, failed };
  }

  it('never exceeds the total usage limit with 20 concurrent checkouts', async () => {
    const x = await promotion({ total: 5 });
    const { ok, failed } = await race(20, applied(x), Array(20).fill(customerId) as bigint[]);
    expect(ok).toBe(5);
    expect(failed.every((f) => f.code === 'promotions.limit_reached')).toBe(true);
    const counter = await prisma.promotionUsageCounter.findUniqueOrThrow({
      where: { promotionId_customerKey: { promotionId: x.p.id, customerKey: 0n } },
    });
    expect(counter.usedCount).toBe(5);
    expect(await prisma.promotionRedemption.count({ where: { promotionId: x.p.id } })).toBe(5);
  });

  it('never exceeds a code’s own limit and marks it used up', async () => {
    const x = await promotion({ codeLimit: 3 });
    const customers = await Promise.all(Array.from({ length: 20 }, () => customer()));
    const { ok } = await race(20, applied(x), customers);
    expect(ok).toBe(3);
    const code = await prisma.couponCode.findUniqueOrThrow({ where: { id: x.code.id } });
    expect(code).toMatchObject({ usedCount: 3, status: 'used_up' });
  });

  it('counts linked accounts (same phone) towards the per-customer limit', async () => {
    const x = await promotion({ perCustomer: 1 });
    const a = await customer();
    const b = await customer();
    await prisma.withTx(async (tx) => {
      await identity.record(tx, a, 'phone', '+66810009999');
      await identity.record(tx, b, 'phone', '+66810009999');
    });
    expect((await race(1, applied(x), [a])).ok).toBe(1);
    const second = await race(1, applied(x), [b]);
    expect(second.ok).toBe(0);
    expect(second.failed[0]!.code).toBe('promotions.limit_reached');
  });

  it('spends the campaign budget exactly, alerts at 80 % and stops when exhausted (D-154)', async () => {
    const x = await promotion({ budget: '1000.00' });
    const customers = await Promise.all(Array.from({ length: 20 }, () => customer()));
    const { ok, failed } = await race(20, applied(x), customers);
    expect(ok).toBe(4);
    expect(failed.every((f) => f.code === 'promotions.budget_exhausted')).toBe(true);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: x.campaign!.id } });
    expect(campaign.spentAmount.toFixed(2)).toBe('1000.00');
    expect(campaign.status).toBe('exhausted');
    expect(campaign.alertedAt).not.toBeNull();
    const events = await prisma.domainEvent.findMany({ where: { aggregateId: campaign.publicId } });
    expect(events.map((e) => e.type).sort()).toEqual(['campaign.budget_alert', 'campaign.exhausted']);
  });
});
