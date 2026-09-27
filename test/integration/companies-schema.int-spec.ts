import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { Client } from 'pg';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy, SQLSTATE } from '../support/database';

/** Guards of the B3.5 company, credit and discount-memo tables (schema-design §3.6, A-35; PostgreSQL 18). */
describe('companies schema — companies, credit, discount memos (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let client: Client;
  let fx: { entityId: bigint; customerId: bigint; provinceId: bigint };
  let seq = 0;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
    await seedDev(prisma);
    const province = await prisma.geoProvince.create({ data: { code: 'INT-C1', nameTh: '[INT] จังหวัด', nameEn: '[INT] Province' } });
    fx = {
      entityId: (await prisma.entity.findFirstOrThrow({ where: { isDefault: true } })).id,
      customerId: (await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } })).id,
      provinceId: province.id,
    };
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  async function state(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  const company = (extra: Record<string, unknown> = {}) => {
    seq += 1;
    return prisma.company.create({
      data: {
        entityId: fx.entityId,
        legalName: `[INT] บริษัท ${seq} จำกัด`,
        taxId: String(1_000_000_000_000 + seq),
        appliedById: fx.customerId,
        ...extra,
      },
    });
  };

  it('checks tax ids, KYC before activation, credit only for active companies, one open company per tax id', async () => {
    const c = await company();
    expect(await state('UPDATE companies SET tax_id = $2 WHERE id = $1', [c.id, '12345'])).toBe(SQLSTATE.checkViolation);
    expect(await state("UPDATE companies SET status = 'active' WHERE id = $1", [c.id])).toBe(SQLSTATE.checkViolation);
    expect(await state("UPDATE companies SET credit_status = 'credit' WHERE id = $1", [c.id])).toBe(SQLSTATE.checkViolation);
    expect(await state("UPDATE companies SET status = 'active', kyc_approved_at = now(), credit_status = 'credit' WHERE id = $1", [c.id])).toBeNull();
    expect(
      await state(`INSERT INTO companies (entity_id, legal_name, tax_id, applied_by) VALUES ($1, 'x', $2, $3)`, [fx.entityId, c.taxId, fx.customerId]),
    ).toBe(SQLSTATE.uniqueViolation);
    expect(await state('DELETE FROM companies WHERE id = $1', [c.id])).toBe(SQLSTATE.restrictViolation);
  });

  it('keeps branch codes to five digits with the head office on 00000', async () => {
    const c = await company();
    const branch = `INSERT INTO company_branches (company_id, branch_type, branch_code, name, line1, postcode, province_id)
                    VALUES ($1, $2, $3, 'สาขา', '1 ถนน', '10110', $4)`;
    expect(await state(branch, [c.id, 'head_office', '00001', fx.provinceId])).toBe(SQLSTATE.checkViolation);
    expect(await state(branch, [c.id, 'branch', 'A0001', fx.provinceId])).toBe(SQLSTATE.checkViolation);
    expect(await state(branch, [c.id, 'head_office', '00000', fx.provinceId])).toBeNull();
    expect(await state(branch, [c.id, 'branch', '00000', fx.provinceId])).toBe(SQLSTATE.uniqueViolation);
  });

  it('freezes a decided credit-limit version', async () => {
    const c = await company();
    const limit = await prisma.companyCreditLimit.create({ data: { companyId: c.id } });
    const v = await prisma.companyCreditLimitVersion.create({
      data: {
        creditLimitId: limit.id,
        versionNo: 1,
        effectiveFrom: new Date(),
        limitAmount: '50000.00',
        termDays: 30,
        eligibilityBasis: 'paid_orders',
        reason: 'ทดสอบ',
      },
    });
    expect(await state("UPDATE company_credit_limit_versions SET status = 'approved' WHERE id = $1", [v.id])).toBe(SQLSTATE.checkViolation);
    expect(await state("UPDATE company_credit_limit_versions SET status = 'approved', decided_at = now() WHERE id = $1", [v.id])).toBeNull();
    expect(await state('UPDATE company_credit_limit_versions SET limit_amount = 90000 WHERE id = $1', [v.id])).toBe(SQLSTATE.restrictViolation);
    expect(await state("UPDATE company_credit_limit_versions SET status = 'withdrawn' WHERE id = $1", [v.id])).toBe(SQLSTATE.restrictViolation);
    expect(await state('DELETE FROM company_credit_limit_versions WHERE id = $1', [v.id])).toBe(SQLSTATE.restrictViolation);
  });

  it('checks discount memo amounts, scope and decisions', async () => {
    const insert = `INSERT INTO discount_memos (entity_id, scope, requested_by, customer_user_id, company_id, order_value, requested_pct,
                      requested_amount, reason, valid_until, status, approved_pct, decided_at)
                    VALUES ($1, $2, $3, $4, $5, 10000, $6, 800, 'คู่แข่งเสนอราคาต่ำกว่า', now() + interval '15 days', $7, $8, $9)`;
    const staff = (await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } })).id;
    expect(await state(insert, [fx.entityId, 'order', staff, fx.customerId, null, '8', 'pending_approval', null, null])).toBeNull();
    expect(await state(insert, [fx.entityId, 'company', staff, fx.customerId, null, '8', 'pending_approval', null, null])).toBe(SQLSTATE.checkViolation);
    expect(await state(insert, [fx.entityId, 'order', staff, fx.customerId, null, '0', 'pending_approval', null, null])).toBe(SQLSTATE.checkViolation);
    expect(await state(insert, [fx.entityId, 'order', staff, fx.customerId, null, '8', 'approved', null, new Date()])).toBe(SQLSTATE.checkViolation);
    expect(await state(insert, [fx.entityId, 'order', staff, fx.customerId, null, '8', 'approved', '9', new Date()])).toBe(SQLSTATE.checkViolation);
    expect(await state(insert, [fx.entityId, 'order', staff, fx.customerId, null, '8', 'applied', '8', new Date()])).toBe(SQLSTATE.checkViolation);
  });
});
