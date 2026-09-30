import {
  activeCompany,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  fakeTaxId,
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
      can: { manageMembers: true, manageSettings: true, manageAssets: true, approveOrders: false, viewFinance: true, order: true },
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
      can: { manageMembers: false, manageSettings: false, manageAssets: false, viewFinance: false, order: true },
    });
    const listed = (await as(ctx, buyer.token).get('/v1/store/companies').expect(200)).body as { id: string; myRoles: string[] }[];
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
        headOffice: { name: 'สำนักงานใหญ่', line1: '1 ถนนทดสอบ', postcode: '99999', provinceId: province.publicId },
      })
      .expect(201);
    expect(applied.body.signatory).toBeNull();
    const refused = await as(ctx, token).post(`/v1/store/companies/${applied.body.id as string}/actions/submit-kyc`).expect(409);
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

    await as(ctx, member.token).put(`/v1/store/companies/${id}/members/${me.id}/roles`, { roles: ['company_buyer'] }).expect(403);
    const last = await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${me.id}/roles`, { roles: ['company_buyer'] })
      .expect(409);
    expect(last.body.code).toBe('companies.last_admin');

    await as(ctx, admin.token)
      .put(`/v1/store/companies/${id}/members/${them.id}/roles`, { roles: ['company_approver', 'company_accountant'] })
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
      await ctx.prisma.auditLog.count({ where: { action: 'iam.role_revoked', data: { path: ['reason'], equals: 'Company roles changed' } } }),
    ).toBeGreaterThanOrEqual(2);
  });
});
