import { type PrismaClient } from '../../src/generated/prisma/client';
import { ROLES } from '../../src/modules/iam/roles.catalog';
import { type EntitySeedInput, seedReference, type SeedReport } from './reference-seed';

/** Obviously fake entity for development and tests — never used outside them (CLAUDE.md). */
export const DEV_ENTITY: EntitySeedInput = {
  code: 'DEV',
  displayName: 'Dev entity (fake)',
  legalNameTh: 'บริษัท ตัวอย่างเพื่อการพัฒนา จำกัด (ข้อมูลปลอม)',
  legalNameEn: 'Example Development Co., Ltd. (fake data)',
  taxId: '0000000000000',
  branchCode: '00000',
};

/** Staff role → team for notification routing (D-143). */
const TEAM_OF: Record<string, string> = {
  cs: 'cs',
  cs_lead: 'cs',
  prepress: 'prepress',
  finance: 'finance',
  finance_manager: 'finance',
  logistics: 'logistics',
  partner_manager: 'partner',
  marketing: 'marketing',
  superadmin: 'management',
  c_level: 'management',
  vp: 'management',
  director: 'management',
};

/**
 * `pnpm db:seed:dev` — the reference seed plus one fake staff user per staff role
 * (`<role>@example.invalid`) and one fake customer. Passwords are set once staff login exists (B1.3).
 * Partner and company users need factories/companies (B2.2 / B3.5) and are added there.
 */
export async function seedDev(prisma: PrismaClient): Promise<SeedReport> {
  const report = await seedReference(prisma, DEV_ENTITY);
  const count = (what: string) => (report[what] = (report[what] ?? 0) + 1);

  await prisma.$transaction(async (tx) => {
    const teams = new Map((await tx.team.findMany()).map((t) => [t.code, t.id]));
    for (const role of ROLES.filter((r) => r.audience === 'staff')) {
      const email = `${role.key.replaceAll('_', '-')}@example.invalid`;
      if (await tx.user.findFirst({ where: { kind: 'staff', email } })) continue;
      const roleRow = await tx.role.findUniqueOrThrow({ where: { key: role.key } });
      const teamCode = TEAM_OF[role.key];
      await tx.user.create({
        data: {
          kind: 'staff',
          status: 'active',
          email,
          emailVerifiedAt: new Date(),
          displayName: `Dev ${role.nameEn}`,
          staffProfile: { create: { teamId: teamCode ? (teams.get(teamCode) ?? null) : null } },
          roles: { create: { roleId: roleRow.id, scopeType: 'platform', reason: 'dev seed (fake user)' } },
        },
      });
      count('dev_staff_users');
    }

    const customerEmail = 'customer@example.invalid';
    if (!(await tx.user.findFirst({ where: { kind: 'customer', email: customerEmail } }))) {
      await tx.user.create({
        data: {
          kind: 'customer',
          status: 'active',
          email: customerEmail,
          emailVerifiedAt: new Date(),
          displayName: 'Dev Customer (fake)',
        },
      });
      count('dev_customer_users');
    }
  });
  return report;
}
