/**
 * `node dist/scripts/create-superadmin.js --email <e-mail> --name "<display name>" [--confirm]` — the **first** staff
 * account of an environment. Production has no seeded users (the dev/UAT seeds never run there), so somebody has to
 * hold `superadmin` before anyone can be invited through `/v1/admin/users`.
 *
 * - Bootstrap only: refuses while any active user already holds `superadmin`. Every later account, and every
 *   further Superadmin, is created in the admin console, where maker-checker and the SoD rules apply (D-140, D-168).
 * - One transaction: the active staff user, its staff profile, the platform-scoped `superadmin` grant, the `iam`
 *   audit rows (`iam.user_created`, `iam.role_granted`, actor `system:scripts.create-superadmin`) and the
 *   `user.created` / `iam.role_granted` events — the same rows `UsersAdminService` writes.
 * - The password is `SUPERADMIN_PASSWORD` (at least 16 characters) or, when unset, generated and printed once.
 *   It is never logged anywhere else; hand it over out of band.
 * - Writes nothing without `--confirm`.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { systemActor } from '../src/common/context/actor';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { DomainEvents } from '../src/platform/domain-events/domain-events.service';
import { generatePassword, parseSuperadminArgs } from './superadmin-args';

config({ quiet: true });

const ROLE = 'superadmin';

async function main(): Promise<void> {
  const parsed = parseSuperadminArgs(process.argv.slice(2), process.env.SUPERADMIN_PASSWORD);
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error('usage: create-superadmin --email <e-mail> --name "<display name>" [--confirm]');
    process.exit(2);
  }
  const { email, name, confirm } = parsed;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const role = await prisma.role.findUnique({ where: { key: ROLE } });
    if (!role) throw new Error(`role ${ROLE} missing — run the reference seed first`);
    const holders = await prisma.userRole.count({
      where: {
        roleId: role.id,
        revokedAt: null,
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        user: { status: 'active', anonymisedAt: null },
      },
    });
    if (holders > 0)
      throw new Error(
        `refused: ${holders} active ${ROLE} already — create further accounts in the admin console`,
      );
    if (await prisma.user.count({ where: { kind: 'staff', email, anonymisedAt: null } }))
      throw new Error(`refused: a staff user ${email} already exists`);

    console.log(`plan: staff user ${email} (“${name}”) with the platform-scoped ${ROLE} role`);
    if (!confirm) {
      console.log('dry run: nothing written (add --confirm)');
      return;
    }

    const password = parsed.password ?? generatePassword();
    const passwordHash = await app.get(PasswordService).hash(password);
    const audit = app.get(AuditService);
    const events = app.get(DomainEvents);
    const actor = systemActor('scripts.create-superadmin');
    const reason = 'first superadmin of the environment (scripts/create-superadmin)';

    const user = await prisma.withTx(async (tx) => {
      const created = await tx.user.create({
        data: {
          kind: 'staff',
          status: 'active',
          email,
          emailVerifiedAt: new Date(),
          displayName: name,
          passwordHash,
          passwordChangedAt: new Date(),
          staffProfile: { create: {} },
        },
      });
      const grant = await tx.userRole.create({
        data: { userId: created.id, roleId: role.id, scopeType: 'platform', reason },
      });
      await audit.record(tx, {
        category: 'iam',
        action: 'iam.user_created',
        resourceType: 'user',
        resourcePublicId: created.publicId,
        data: { kind: 'staff', via: 'scripts/create-superadmin' },
        actor,
      });
      await audit.record(tx, {
        category: 'iam',
        action: 'iam.role_granted',
        resourceType: 'user',
        resourcePublicId: created.publicId,
        data: { role: ROLE, scope: null, validTo: null, reason },
        actor,
      });
      await events.record(
        tx,
        {
          type: 'user.created',
          aggregateType: 'user',
          aggregateId: created.publicId,
          payload: { userId: created.publicId, kind: 'staff' },
        },
        actor,
      );
      await events.record(
        tx,
        {
          type: 'iam.role_granted',
          aggregateType: 'user',
          aggregateId: created.publicId,
          payload: { userId: created.publicId, grantId: grant.publicId, role: ROLE, scope: null },
        },
        actor,
      );
      return created;
    });

    console.log(`created ${user.publicId} ${email} (${ROLE})`);
    if (!parsed.password)
      console.log(`password (shown once, store it in the password manager now): ${password}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
