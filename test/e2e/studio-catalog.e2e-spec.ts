import request from 'supertest';

import {
  activeCompany,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';

/** U4.B5 brand kits, templates, elements with rights, barcodes and font licences (D-282–D-284). */
describe('studio catalogue (e2e, U4.B5)', () => {
  let ctx: CommerceApp;
  let prepress: string;
  let marketing: string;
  let uploader: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    prepress = await staffToken(ctx, 'prepress');
    marketing = await staffToken(ctx, 'marketing');
    uploader = (await customerToken(ctx, 90)).token;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  async function font(name: string, licensed: boolean) {
    const fileId = await uploadFile(ctx, uploader, `fake-font-${name}`, 'design_asset');
    const file = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: fileId } });
    return ctx.prisma.designFont.create({
      data: {
        name: `[DEV] ${name}`,
        fileObjectId: file.id,
        licenceNote: 'fake licence',
        status: 'active',
        ...(licensed && { licence: 'ofl', printAllowed: true, embeddingAllowed: true }),
      },
    });
  }

  it('serves only OFL fonts licensed for print and embedding (D-284)', async () => {
    const open = await font(`Open Sans ${ctx.run}`, true);
    const unknown = await font(`Unknown Sans ${ctx.run}`, false);
    await request(ctx.server).get(`/v1/store/designer/fonts/${open.publicId}`).expect(200);
    await request(ctx.server).get(`/v1/store/designer/fonts/${unknown.publicId}`).expect(404);
  });

  it('keeps brand kits the Company Admin manages and every member uses (D-282, D-227)', async () => {
    const admin = await customerToken(ctx, 93);
    const buyer = await customerToken(ctx, 94);
    const companyId = await activeCompany(ctx, admin.token, 93, [{ ...buyer, roles: ['company_buyer'] }]);
    const fileId = await uploadFile(ctx, admin.token, 'fake-logo', 'design_asset');
    const asset = await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/brand-assets`, { fileId, kind: 'logo', name: 'โลโก้' })
      .expect(201);
    const served = await font(`Kit Sans ${ctx.run}`, true);
    const unserved = await font(`Kit Serif ${ctx.run}`, false);
    const body = {
      name: 'แบรนด์หลัก',
      palette: [{ name: 'แดง', hex: '#C0392B' }],
      fontPairs: [{ heading: served.publicId, body: served.publicId }],
      logos: [{ brandAssetId: asset.body.id, role: 'primary' }],
    };
    await as(ctx, buyer.token).post(`/v1/store/companies/${companyId}/brand-kits`, body).expect(403);
    const bad = await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/brand-kits`, {
        ...body,
        fontPairs: [{ heading: unserved.publicId, body: served.publicId }],
      })
      .expect(422);
    expect(bad.body.errors[0].path).toBe('fontPairs');
    const kit = await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/brand-kits`, body)
      .expect(201);
    expect(kit.body).toMatchObject({
      name: 'แบรนด์หลัก',
      palette: [{ hex: '#c0392b' }],
      logos: [{ brandAssetId: asset.body.id, role: 'primary' }],
    });
    const listed = await as(ctx, buyer.token).get(`/v1/store/companies/${companyId}/brand-kits`).expect(200);
    expect((listed.body as { id: string }[]).map((k) => k.id)).toEqual([kit.body.id]);
    const got = await as(ctx, admin.token)
      .get(`/v1/store/companies/${companyId}/brand-kits/${kit.body.id}`)
      .expect(200);
    await as(ctx, admin.token)
      .put(`/v1/store/companies/${companyId}/brand-kits/${kit.body.id}`)
      .send({ ...body, name: 'แบรนด์รอง' })
      .expect(428);
    const updated = await as(ctx, admin.token)
      .put(`/v1/store/companies/${companyId}/brand-kits/${kit.body.id}`)
      .set('If-Match', got.headers['etag'] as string)
      .send({ ...body, name: 'แบรนด์รอง' })
      .expect(200);
    expect(updated.body.name).toBe('แบรนด์รอง');
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/brand-kits/${kit.body.id}/actions/archive`)
      .expect(204);
    expect(
      (await as(ctx, buyer.token).get(`/v1/store/companies/${companyId}/brand-kits`).expect(200)).body,
    ).toEqual([]);
    const outsider = await customerToken(ctx, 95);
    await as(ctx, outsider.token).get(`/v1/store/companies/${companyId}/brand-kits`).expect(404);
  });

  it('publishes a template only after Marketing — not its author — approves it (D-216)', async () => {
    const code = `coffee-${ctx.run}`;
    const body = {
      code,
      nameTh: 'กาแฟ (fake)',
      nameEn: 'Coffee (fake)',
      useCases: ['coffee'],
      styleFamilies: [],
      layoutSchemaVersion: 1,
      layout: { zones: [] },
    };
    const created = await as(ctx, prepress).post('/v1/admin/studio-templates', body).expect(201);
    expect(created.body.status).toBe('draft');
    expect((await as(ctx, prepress).post('/v1/admin/studio-templates', body).expect(409)).body.code).toBe(
      'catalog.code_taken',
    );
    const id = created.body.id as string;
    await as(ctx, prepress).post(`/v1/admin/studio-templates/${id}/actions/approve`).expect(403);
    await as(ctx, prepress).post(`/v1/admin/studio-templates/${id}/actions/submit`).expect(200);
    await as(ctx, prepress).put(`/v1/admin/studio-templates/${id}`).send(body).expect(409);
    const store = async () =>
      (
        (await request(ctx.server).get('/v1/store/studio/templates?useCase=coffee').expect(200)).body as {
          code: string;
        }[]
      ).map((t) => t.code);
    expect(await store()).not.toContain(code);
    const approved = await as(ctx, marketing)
      .post(`/v1/admin/studio-templates/${id}/actions/approve`)
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'published',
      approvedBy: { displayName: expect.any(String) },
    });
    expect(await store()).toContain(code);
    await request(ctx.server).get(`/v1/store/studio/templates/${id}`).expect(200);

    // Marketing's own template needs another approver.
    const own = await as(ctx, marketing)
      .post('/v1/admin/studio-templates', { ...body, code: `${code}-m` })
      .expect(201);
    await as(ctx, marketing).post(`/v1/admin/studio-templates/${own.body.id}/actions/submit`).expect(200);
    const self = await as(ctx, marketing)
      .post(`/v1/admin/studio-templates/${own.body.id}/actions/approve`)
      .expect(403);
    expect(self.body.code).toBe('studio.maker_checker');
  });

  it('blocks a mark with legal meaning until its right is declared (D-282)', async () => {
    const element = await as(ctx, prepress)
      .post('/v1/admin/studio-elements', {
        code: `cert-${ctx.run}`,
        kind: 'mark',
        nameTh: 'เครื่องหมายรับรอง (fake)',
        nameEn: 'Certification (fake)',
        path: 'M50 5 L95 90 L5 90 Z',
        tags: [],
        requiresRight: true,
      })
      .expect(201);
    await as(ctx, prepress).post(`/v1/admin/studio-elements/${element.body.id}/actions/publish`).expect(200);
    const { token } = await customerToken(ctx, 96);
    const marks = await as(ctx, token).get('/v1/store/studio/elements?kind=mark').expect(200);
    expect(
      (marks.body as { id: string; usable: boolean }[]).find((e) => e.id === element.body.id)?.usable,
    ).toBe(false);

    const productId = (await ctx.prisma.catalogProduct.findFirstOrThrow({ select: { publicId: true } }))
      .publicId;
    const design = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        title: 'มีเครื่องหมาย (fake)',
        document: {
          content: {
            pattern: { kind: 'none' },
            elements: [{ id: 'm1', type: 'shape', studioElementId: element.body.id, width: 10, height: 10 }],
          },
        },
      })
      .expect(201);
    const blocked = await as(ctx, token).post(`/v1/store/studio/${design.body.id}/checks`, {}).expect(200);
    expect(blocked.body).toMatchObject({
      ready: false,
      findings: [{ ruleId: 'element_right_missing', severity: 'block', elementId: 'm1' }],
    });
    await as(ctx, token)
      .post(`/v1/store/studio/elements/${element.body.id}/right-declarations`, {
        statement: 'ใบรับรองเลขที่ 0000 (fake)',
      })
      .expect(201);
    const cleared = await as(ctx, token).post(`/v1/store/studio/${design.body.id}/checks`, {}).expect(200);
    expect(cleared.body).toMatchObject({ ready: true, counts: { block: 0 } });
    const usable = await as(ctx, token).get('/v1/store/studio/elements?kind=mark').expect(200);
    expect(
      (usable.body as { id: string; usable: boolean }[]).find((e) => e.id === element.body.id)?.usable,
    ).toBe(true);
    const declaration = await ctx.prisma.elementRightDeclaration.findFirstOrThrow({
      where: { element: { publicId: element.body.id as string } },
    });
    await expect(
      ctx.prisma.elementRightDeclaration.delete({ where: { id: declaration.id } }),
    ).rejects.toThrow();
  });

  it('validates barcodes for the web and preflight (D-283)', async () => {
    const ok = await request(ctx.server)
      .post('/v1/store/studio/barcodes/actions/validate')
      .send({ symbology: 'ean13', value: '885123456789' })
      .expect(200);
    expect(ok.body).toEqual({ valid: true, problems: [], normalised: '8851234567898', minWidthMm: 29.83 });
    const bad = await request(ctx.server)
      .post('/v1/store/studio/barcodes/actions/validate')
      .send({ symbology: 'ean13', value: '8851234567890' })
      .expect(200);
    expect(bad.body).toMatchObject({ valid: false, problems: ['check_digit'] });
  });
});
