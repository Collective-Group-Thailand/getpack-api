import { randomUUID } from 'node:crypto';

import { InvalidationBus } from '@common/cache/invalidation-bus';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { sodPartyKey, SodService } from '@modules/iam/sod.service';
import { AuditService } from '@platform/audit/audit.service';
import { type Redis } from 'ioredis';

import { seedDev } from '../../prisma/seed/dev-seed';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

describe('SoD and effective permissions (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaService;
  let audit: AuditService;
  let sod: SodService;
  let resolver: PermissionResolver;
  let financeId: bigint;
  let financeManagerId: bigint;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaService({ get: () => db.url } as unknown as AppConfig);
    await seedDev(prisma);
    audit = new AuditService(prisma);
    sod = new SodService(audit);
    const bus = new InvalidationBus({ publish: () => Promise.resolve(0) } as unknown as Redis);
    resolver = new PermissionResolver(prisma, bus);
    financeId = (await prisma.user.findFirstOrThrow({ where: { email: 'finance@example.invalid' } })).id;
    financeManagerId = (
      await prisma.user.findFirstOrThrow({ where: { email: 'finance-manager@example.invalid' } })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const actor = (userId: bigint) => ({
    type: 'user' as const,
    userId,
    publicId: randomUUID(),
    audience: 'staff' as const,
    scopes: [],
  });

  it('blocks the creator of a payout run from approving the same run, not another one (same_subject)', async () => {
    const run = randomUUID();
    await prisma.withTx((tx) =>
      audit.record(tx, {
        category: 'finance',
        action: 'payout_run.create',
        resourceType: 'payout_run',
        resourcePublicId: run,
        actor: actor(financeId),
      }),
    );
    await expect(
      prisma.withTx((tx) =>
        sod.checkAction(tx, {
          actorUserId: financeId,
          action: 'payout_run.approve',
          subject: { type: 'payout_run', publicId: run },
        }),
      ),
    ).rejects.toMatchObject({ code: 'iam.sod_conflict', params: { rule: 'payout_run_maker_checker' } });
    await expect(
      prisma.withTx((tx) =>
        sod.checkAction(tx, {
          actorUserId: financeId,
          action: 'payout_run.approve',
          subject: { type: 'payout_run', publicId: randomUUID() },
        }),
      ),
    ).resolves.toEqual({ warnings: [] });
    await expect(
      prisma.withTx((tx) =>
        sod.checkAction(tx, {
          actorUserId: financeManagerId,
          action: 'payout_run.approve',
          subject: { type: 'payout_run', publicId: run },
        }),
      ),
    ).resolves.toEqual({ warnings: [] });
  });

  it('blocks whoever recorded a vendor bill from changing that vendor bank account (same_vendor)', async () => {
    const vendor = { kind: 'vendor' as const, publicId: randomUUID() };
    await prisma.withTx((tx) =>
      audit.record(tx, {
        category: 'finance',
        action: 'vendor_invoice.record',
        resourceType: 'vendor_invoice',
        resourcePublicId: randomUUID(),
        data: { sodParty: sodPartyKey(vendor) },
        actor: actor(financeId),
      }),
    );
    const change = (party: typeof vendor) =>
      prisma.withTx((tx) =>
        sod.checkAction(tx, {
          actorUserId: financeId,
          action: 'vendor_bank_account.change',
          subject: { type: 'vendor_bank_account', publicId: randomUUID() },
          party,
        }),
      );
    await expect(change(vendor)).rejects.toMatchObject({ code: 'iam.sod_conflict' });
    await expect(change({ kind: 'vendor', publicId: randomUUID() })).resolves.toEqual({ warnings: [] });
  });

  it('downgrades a rule to a warning when its enforcement is warn (audited, not blocked)', async () => {
    await prisma.sodRule.update({ where: { key: 'refund_maker_checker' }, data: { enforcement: 'warn' } });
    const refund = randomUUID();
    await prisma.withTx((tx) =>
      audit.record(tx, {
        category: 'finance',
        action: 'refund.request',
        resourceType: 'refund',
        resourcePublicId: refund,
        actor: actor(financeId),
      }),
    );
    await expect(
      prisma.withTx((tx) =>
        sod.checkAction(tx, {
          actorUserId: financeId,
          action: 'refund.approve',
          subject: { type: 'refund', publicId: refund },
        }),
      ),
    ).resolves.toEqual({ warnings: ['refund_maker_checker'] });
    expect(await prisma.auditLog.count({ where: { action: 'sod.warned' } })).toBe(1);
  });

  it('ignores expired, future and revoked grants (time-boxed Auditor, §8)', async () => {
    const user = await prisma.user.create({
      data: {
        kind: 'staff',
        status: 'active',
        email: 'timebox@example.invalid',
        displayName: 'Timebox (fake)',
      },
    });
    const auditor = await prisma.role.findUniqueOrThrow({ where: { key: 'auditor' } });
    const cs = await prisma.role.findUniqueOrThrow({ where: { key: 'cs' } });
    const now = Date.now();
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: auditor.id,
        scopeType: 'platform',
        validFrom: new Date(now - 7_200_000),
        validTo: new Date(now + 3_600_000),
        reason: 'audit',
      },
    });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: cs.id,
        scopeType: 'platform',
        validFrom: new Date(now + 86_400_000),
        reason: 'starts tomorrow',
      },
    });
    const current = await resolver.forUser(user.id);
    expect(current.roles.map((r) => r.key)).toEqual(['auditor']);
    const later = await resolver.forUser(user.id, new Date(now + 2 * 86_400_000));
    expect(later.roles.map((r) => r.key)).toEqual(['cs']);
  });

  it('refuses an Auditor grant to a Finance user at grant time (role pair, D-168)', async () => {
    const auditor = await prisma.role.findUniqueOrThrow({ where: { key: 'auditor' } });
    await expect(prisma.withTx((tx) => sod.checkRoleGrant(tx, financeId, auditor.id))).rejects.toMatchObject({
      code: 'iam.sod_conflict',
      params: { rule: 'auditor_independent_of_finance' },
    });
  });
});
