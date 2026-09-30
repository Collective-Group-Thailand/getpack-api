import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';

/** B2B companies: apply, KYC review and activation, members with company roles, settings (B3.5 slice 2, D-120…D-125). */
describe('companies (e2e, B3.5)', () => {
  let ctx: CommerceApp;
  let provinceId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    provinceId = (await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } })).publicId;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  /** A valid fake tax id (0000… with its check digit) unique to this run. */
  function taxId(n: number): string {
    const base = `0000${String(ctx.run * 10 + n)
      .padStart(8, '0')
      .slice(-8)}`;
    const sum = [...base].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
    return base + String((11 - (sum % 11)) % 10);
  }

  const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  it('applies, uploads KYC, submits; staff verify and activate; the admin invites a buyer who accepts', async () => {
    const admin = await customerToken(ctx, 1);
    const applied = await as(ctx, admin.token)
      .post('/v1/store/companies', {
        legalName: 'บริษัท ทดสอบ จำกัด',
        taxId: taxId(1),
        isVatRegistered: true,
        withholdsTax: true,
        headOffice: { name: 'สำนักงานใหญ่', line1: '1 ถนนทดสอบ', postcode: '99999', provinceId },
        signatory: { name: 'ผู้มีอำนาจ ทดสอบ', position: 'กรรมการ' },
      })
      .expect(201);
    expect(applied.body).toMatchObject({
      status: 'applied',
      creditStatus: 'prepaid',
      companyCode: null,
      branches: [
        expect.objectContaining({ branchType: 'head_office', branchCode: '00000', isDefault: true }),
      ],
      members: [expect.objectContaining({ status: 'active', roles: ['company_admin'] })],
      missingKyc: ['company_certificate', 'signatory_id', 'vat_registration_pp20'],
    });
    const id = applied.body.id as string;
    await as(ctx, admin.token)
      .post('/v1/store/companies', {
        legalName: 'ซ้ำ',
        taxId: taxId(1),
        isVatRegistered: false,
        headOffice: { name: 'x', line1: 'x', postcode: '99999', provinceId },
      })
      .expect(409);

    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/actions/submit-kyc`)
      .expect(409)
      .expect((r) => {
        expect(r.body.code).toBe('companies.kyc_incomplete');
      });
    const oldCert = await uploadFile(ctx, admin.token, 'old certificate', 'evidence');
    const cert = await uploadFile(ctx, admin.token, 'certificate', 'evidence');
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/kyc-documents`, {
        docType: 'company_certificate',
        fileId: oldCert,
        issuedOn: isoDaysAgo(250),
      })
      .expect(201);
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/kyc-documents`, {
        docType: 'company_certificate',
        fileId: cert,
        issuedOn: isoDaysAgo(20),
      })
      .expect(201);
    for (const docType of ['signatory_id', 'vat_registration_pp20'])
      await as(ctx, admin.token)
        .post(`/v1/store/companies/${id}/kyc-documents`, {
          docType,
          fileId: await uploadFile(ctx, admin.token, docType, 'evidence'),
        })
        .expect(201);
    const submitted = await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/actions/submit-kyc`)
      .expect(200);
    expect(submitted.body).toMatchObject({ status: 'kyc_review', missingKyc: [] });

    const reviewer = await staffToken(ctx, 'cs-lead');
    const queue = await as(ctx, reviewer).get('/v1/admin/companies?status=kyc_review').expect(200);
    expect((queue.body.data as { id: string }[]).map((c) => c.id)).toContain(id);
    const docs = submitted.body.kycDocuments as { id: string; docType: string; issuedOn: string | null }[];
    const old = docs.find((d) => d.issuedOn === isoDaysAgo(250))!;
    await as(ctx, reviewer)
      .post(`/v1/admin/companies/${id}/kyc-documents/${old.id}/actions/review`, { outcome: 'verified' })
      .expect(422)
      .expect((r) => {
        expect(r.body.code).toBe('companies.certificate_too_old');
      });
    await as(ctx, reviewer)
      .post(`/v1/admin/companies/${id}/kyc-documents/${old.id}/actions/review`, {
        outcome: 'rejected',
        note: 'เกิน 6 เดือน',
      })
      .expect(200);
    await as(ctx, reviewer).post(`/v1/admin/companies/${id}/actions/approve-kyc`).expect(409);
    for (const d of docs.filter((x) => x.id !== old.id))
      await as(ctx, reviewer)
        .post(`/v1/admin/companies/${id}/kyc-documents/${d.id}/actions/review`, { outcome: 'verified' })
        .expect(200);
    const active = await as(ctx, reviewer).post(`/v1/admin/companies/${id}/actions/approve-kyc`).expect(200);
    expect(active.body).toMatchObject({
      status: 'active',
      companyCode: expect.stringMatching(/^DEVCO-\d{5}$/),
      creditStatus: 'prepaid',
    });
    await as(ctx, await staffToken(ctx, 'cs'))
      .post(`/v1/admin/companies/${id}/actions/approve-kyc`)
      .expect(403);

    // Settings: the approval threshold is audited (D-123); If-Match guards the change.
    const got = await as(ctx, admin.token).get(`/v1/store/companies/${id}`).expect(200);
    await as(ctx, admin.token)
      .patch(`/v1/store/companies/${id}`, { orderApprovalThreshold: '50000.00', poNumberPolicy: 'required' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({ orderApprovalThreshold: '50000.00', poNumberPolicy: 'required' }),
      );
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'company.approval_threshold_changed', resourcePublicId: id },
      }),
    ).toBe(1);

    // Members: invite an existing customer as buyer + approver; they accept and get the company roles.
    const buyer = await customerToken(ctx, 2);
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/members`, { phone: '+66000000000', roles: ['company_buyer'] })
      .expect(422);
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/members`, {
        phone: buyer.phone,
        roles: ['company_buyer', 'company_approver'],
      })
      .expect(201);
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/members`, { phone: buyer.phone, roles: ['company_buyer'] })
      .expect(409);
    await as(ctx, buyer.token).get(`/v1/store/companies/${id}`).expect(404);
    const invitations = await as(ctx, buyer.token).get('/v1/store/company-invitations').expect(200);
    expect(invitations.body).toEqual([
      expect.objectContaining({ companyId: id, roles: ['company_buyer', 'company_approver'] }),
    ]);
    await as(ctx, buyer.token)
      .post(`/v1/store/company-invitations/${invitations.body[0].id as string}/actions/accept`)
      .expect(200);
    const mine = await as(ctx, buyer.token).get('/v1/store/companies').expect(200);
    expect((mine.body as { id: string }[]).map((c) => c.id)).toEqual([id]);
    const buyerUser = await ctx.prisma.user.findFirstOrThrow({ where: { phone: buyer.phone } });
    const company = await ctx.prisma.company.findUniqueOrThrow({ where: { publicId: id } });
    const roles = await ctx.prisma.userRole.findMany({
      where: { userId: buyerUser.id, scopeType: 'company', scopeId: company.id, revokedAt: null },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.key).sort()).toEqual(['company_approver', 'company_buyer']);
    // A buyer cannot change settings or invite.
    const etag = (await as(ctx, buyer.token).get(`/v1/store/companies/${id}`).expect(200)).headers[
      'etag'
    ] as string;
    await as(ctx, buyer.token)
      .patch(`/v1/store/companies/${id}`, { poNumberPolicy: 'none' })
      .set('If-Match', etag)
      .expect(403);

    // Branch and removal.
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/branches`, {
        branchCode: '00001',
        name: 'สาขา 1',
        line1: '2 ถนนทดสอบ',
        postcode: '99999',
        provinceId,
      })
      .expect(201)
      .expect((r) => expect(r.body.branches).toHaveLength(2));
    const member = (
      (await as(ctx, admin.token).get(`/v1/store/companies/${id}`).expect(200)).body.members as {
        id: string;
        user: { id: string };
      }[]
    ).find((m) => m.user.id === buyerUser.publicId)!;
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${id}/members/${member.id}/actions/remove`)
      .expect(200);
    await as(ctx, buyer.token).get(`/v1/store/companies/${id}`).expect(404);
    expect(
      await ctx.prisma.userRole.count({
        where: { userId: buyerUser.id, scopeType: 'company', revokedAt: null },
      }),
    ).toBe(0);
  });
});
