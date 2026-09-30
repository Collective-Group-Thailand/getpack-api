import { randomUUID } from 'node:crypto';

import {
  activeCompany,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  fakeTaxId,
  uploadFile,
} from '../support/commerce-e2e';

/**
 * U-B0.1 slice 11: the store's B2B gaps — signatory and contact phone, my roles and capabilities, branch place
 * names, member role changes (D-123, D-140, D-125).
 */
describe('store companies (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  const company = (token: string, id: string) => as(ctx, token).get(`/v1/store/companies/${id}`).expect(200);

  it('shows my roles and capabilities, the signatory and the branch place names', async () => {
    const admin = await customerToken(ctx, 1);
    const buyer = await customerToken(ctx, 2);
    const id = await activeCompany(ctx, admin.token, 1, [{ ...buyer, roles: ['company_buyer'] }]);

    const mine = (await company(admin.token, id)).body;
    expect(mine).toMatchObject({
      myRoles: ['company_admin'],
      can: {
        manageMembers: true,
        manageSettings: true,
        manageAssets: true,
        approveOrders: false,
        viewFinance: true,
        order: true,
      },
      signatory: { name: 'ผู้มีอำนาจ ทดสอบ', position: 'กรรมการ' },
      contactPhone: null,
      discountPct: null,
    });
    expect(mine.branches[0]).toMatchObject({
      provinceId: expect.any(String),
      provinceNameTh: expect.any(String),
      provinceNameEn: expect.any(String),
    });
    const theirs = (await company(buyer.token, id)).body;
    expect(theirs).toMatchObject({
      myRoles: ['company_buyer'],
      can: {
        manageMembers: false,
        manageSettings: false,
        manageAssets: false,
        viewFinance: false,
        order: true,
      },
    });
    const listed = (await as(ctx, buyer.token).get('/v1/store/companies').expect(200)).body as {
      id: string;
      myRoles: string[];
    }[];
    expect(listed.find((c) => c.id === id)?.myRoles).toEqual(['company_buyer']);

    const updated = await as(ctx, admin.token)
      .patch(`/v1/store/companies/${id}`, {
        contactPhone: '020000000',
        signatory: { name: 'ผู้มีอำนาจ ใหม่', position: 'กรรมการผู้จัดการ' },
      })
      .set('If-Match', (await company(admin.token, id)).headers['etag'] as string)
      .expect(200);
    expect(updated.body).toMatchObject({
      contactPhone: '020000000',
      signatory: { name: 'ผู้มีอำนาจ ใหม่', position: 'กรรมการผู้จัดการ' },
    });
  });

  it('asks for the signatory before the KYC review (D-120)', async () => {
    const { token } = await customerToken(ctx, 3);
    const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
    const applied = await as(ctx, token)
      .post('/v1/store/companies', {
        legalName: 'บริษัท ไม่มีผู้ลงนาม จำกัด',
        taxId: fakeTaxId(ctx, 3),
        isVatRegistered: false,
        headOffice: {
          name: 'สำนักงานใหญ่',
          line1: '1 ถนนทดสอบ',
          postcode: '99999',
          provinceId: province.publicId,
        },
      })
      .expect(201);
    expect(applied.body.signatory).toBeNull();
    const refused = await as(ctx, token)
      .post(`/v1/store/companies/${applied.body.id as string}/actions/submit-kyc`)
      .expect(409);
    expect(refused.body.code).toBe('companies.kyc_incomplete');
    expect(refused.body.detail).toContain('signatory details');
  });

  it('changes a member’s roles and keeps the last Company Admin (D-123, D-140)', async () => {
    const admin = await customerToken(ctx, 4);
    const member = await customerToken(ctx, 5);
    const id = await activeCompany(ctx, admin.token, 4, [{ ...member, roles: ['company_buyer'] }]);
    const members = (await company(admin.token, id)).body.members as { id: string; roles: string[] }[];
    const me = members.find((m) => m.roles.includes('company_admin'))!;
    const them = members.find((m) => m.roles.includes('company_buyer'))!;

    await as(ctx, member.token)
      .put(`/v1/store/companies/${id}/members/${me.id}/roles`, { roles: ['company_buyer'] })
      .expect(403);
    const last = await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${me.id}/roles`, { roles: ['company_buyer'] })
      .expect(409);
    expect(last.body.code).toBe('companies.last_admin');

    await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${them.id}/roles`, {
        roles: ['company_approver', 'company_accountant'],
      })
      .expect(200);
    const after = (await company(member.token, id)).body;
    expect(after).toMatchObject({
      myRoles: ['company_approver', 'company_accountant'],
      can: { order: false, approveOrders: true, viewFinance: true },
    });
    await as(ctx, member.token).get(`/v1/store/companies/${id}/credit`).expect(200);

    // With a second admin the first may step down.
    await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${them.id}/roles`, { roles: ['company_admin'] })
      .expect(200);
    const stepped = await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${me.id}/roles`, { roles: ['company_buyer'] })
      .expect(200);
    expect((stepped.body as { myRoles: string[] }).myRoles).toEqual(['company_buyer']);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'iam.role_revoked', data: { path: ['reason'], equals: 'Company roles changed' } },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps a brand library the Company Admin manages and every member uses (D-227)', async () => {
    const admin = await customerToken(ctx, 6);
    const buyer = await customerToken(ctx, 7);
    const id = await activeCompany(ctx, admin.token, 6, [{ ...buyer, roles: ['company_buyer'] }]);
    const fileId = await uploadFile(ctx, admin.token, 'fake-logo', 'design_asset');
    await as(ctx, buyer.token)
      .post(`/v1/store/companies/${id}/brand-assets`, { fileId, kind: 'logo', name: 'โลโก้' })
      .expect(403);
    const added = await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/brand-assets`, { fileId, kind: 'logo', name: 'โลโก้' })
      .expect(201);
    expect(added.body).toMatchObject({
      kind: 'logo',
      name: 'โลโก้',
      fileId,
      mimeType: 'image/png',
      url: expect.any(String),
    });
    expect(
      (
        await as(ctx, admin.token)
          .post(`/v1/store/companies/${id}/brand-assets`, { fileId, kind: 'logo', name: 'x' })
          .expect(409)
      ).body.code,
    ).toBe('companies.asset_exists');
    const listed = (await as(ctx, buyer.token).get(`/v1/store/companies/${id}/brand-assets`).expect(200))
      .body as { id: string }[];
    expect(listed.map((a) => a.id)).toEqual([added.body.id]);
    // The buyer reads the file through the files API too.
    await as(ctx, buyer.token).get(`/v1/store/files/${fileId}/download`).expect(200);
    await as(ctx, buyer.token)
      .delete(`/v1/store/companies/${id}/brand-assets/${added.body.id as string}`)
      .expect(403);
    await as(ctx, admin.token)
      .delete(`/v1/store/companies/${id}/brand-assets/${added.body.id as string}`)
      .expect(204);
    expect(
      (await as(ctx, buyer.token).get(`/v1/store/companies/${id}/brand-assets`).expect(200)).body,
    ).toEqual([]);
  });

  it('shows credit eligibility, lets the Company Admin apply and summarises what is owed (D-121, D-122)', async () => {
    const admin = await customerToken(ctx, 8);
    const buyer = await customerToken(ctx, 9);
    const id = await activeCompany(ctx, admin.token, 8, [{ ...buyer, roles: ['company_buyer'] }]);
    const credit = (await as(ctx, admin.token).get(`/v1/store/companies/${id}/credit`).expect(200)).body;
    expect(credit.eligibility).toMatchObject({
      paidOrdersCount: 0,
      paidOrdersNeeded: 3,
      eligible: false,
      financialStatementOnFile: false,
      allowedTermDays: [15, 30, 45, 60],
      defaultTermDays: 30,
    });
    const apply = (body: object, token = admin.token) =>
      as(ctx, token)
        .post(`/v1/store/companies/${id}/credit-applications`, body)
        .set('Idempotency-Key', randomUUID());
    const body = { limitAmount: '50000.00', termDays: 30, basis: 'paid_orders', note: 'สั่งซื้อทุกเดือน' };
    await apply(body, buyer.token).expect(403);
    expect((await apply(body).expect(409)).body.code).toBe('companies.credit_not_eligible');
    await apply({ ...body, termDays: 20 }).expect(422);
    await ctx.prisma.company.update({
      where: { publicId: id },
      data: { creditStatus: 'eligible', paidOrdersCount: 3 },
    });
    const applied = await apply(body).expect(201);
    expect(applied.body).toMatchObject({
      pendingRequest: { limitAmount: '50000.00', termDays: 30 },
      eligibility: { eligible: true },
    });
    expect((await apply(body).expect(409)).body.code).toBe('approval.already_pending');

    const owed = (await as(ctx, admin.token).get(`/v1/store/companies/${id}/receivables`).expect(200)).body;
    expect(owed).toMatchObject({
      openAmount: '0.00',
      overdueAmount: '0.00',
      creditOrdersBlocked: false,
      notices: [],
      oldestOverdueDays: null,
    });
    await as(ctx, buyer.token).get(`/v1/store/companies/${id}/receivables`).expect(403);
    await ctx.prisma.company.update({ where: { publicId: id }, data: { creditStatus: 'blocked_overdue' } });
    const blocked = (await as(ctx, admin.token).get(`/v1/store/companies/${id}/receivables`).expect(200))
      .body;
    expect(blocked).toMatchObject({
      creditOrdersBlocked: true,
      notices: [expect.objectContaining({ code: 'credit_blocked' })],
    });
    expect(
      (await as(ctx, admin.token).get(`/v1/store/companies/${id}/issued-statements`).expect(200)).body,
    ).toEqual([]);
    const spend = (await as(ctx, admin.token).get(`/v1/store/companies/${id}/spend`).expect(200)).body;
    expect(spend).toMatchObject({ total: { orders: 0, grossAmount: '0.00' }, byMember: [] });
    expect(spend.byMonth).toHaveLength(12);
  });
});
