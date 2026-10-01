import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Catalogue administration (B2.1, D-005 / D-100): generic CRUD kit, collections, quote mode. */
describe('catalogue admin (e2e, B2.1)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = Date.now().toString(36);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['admin', 'cs', 'marketing']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
    put: (url: string, body: object, etag: string) =>
      request(server).put(url).auth(tokens[role]!, { type: 'bearer' }).set('If-Match', etag).send(body),
    patch: (url: string, body: object, etag?: string) => {
      const req = request(server).patch(url).auth(tokens[role]!, { type: 'bearer' });
      return (etag ? req.set('If-Match', etag) : req).send(body);
    },
  });
  const admin = as('admin');

  let seq = 0;
  async function productType(
    calculatorKey: string | null = 'folding',
  ): Promise<{ id: string; etag: string }> {
    const n = ++seq;
    const category = await admin
      .post('/v1/admin/catalog/product-categories', {
        code: `e2e_cat_${run}_${n}`,
        nameTh: 'หมวดทดสอบ',
        nameEn: 'Test category',
        status: 'active',
      })
      .expect(201);
    const type = await admin
      .post('/v1/admin/catalog/product-types', {
        code: `e2e_type_${run}_${n}`,
        categoryId: category.body.id,
        nameTh: 'ประเภททดสอบ',
        nameEn: 'Test type',
        calculatorKey,
      })
      .expect(201);
    return { id: type.body.id as string, etag: type.headers['etag'] as string };
  }

  it('creates, reads, lists and updates with ETags, audit rows and events', async () => {
    const family = await admin
      .post('/v1/admin/catalog/material-families', {
        code: `e2e_family_${run}`,
        nameTh: 'กระดาษทดสอบ',
        nameEn: 'Test paper',
        indexUnit: 'THB/kg',
      })
      .expect(201);
    expect(family.headers['location']).toBe(`/v1/admin/catalog/material-families/${family.body.id}`);

    const created = await admin
      .post('/v1/admin/catalog/materials', {
        code: `e2e-art-${run}`,
        kind: 'paper',
        familyId: family.body.id,
        nameTh: 'อาร์ตการ์ดทดสอบ 350 แกรม',
        nameEn: 'Test art card 350',
        gsm: 350,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      kind: 'paper',
      gsm: 350,
      familyId: family.body.id,
      status: 'draft',
    });

    const read = await admin.get(`/v1/admin/catalog/materials/${created.body.id}`).expect(200);
    const etag = read.headers['etag'] as string;
    expect(etag).toBe(created.headers['etag']);

    // Missing / stale If-Match.
    await admin.patch(`/v1/admin/catalog/materials/${created.body.id}`, { status: 'active' }).expect(428);
    const updated = await admin
      .patch(`/v1/admin/catalog/materials/${created.body.id}`, { status: 'active', gsm: 360 }, etag)
      .expect(200);
    expect(updated.body).toMatchObject({ status: 'active', gsm: 360 });
    const stale = await admin
      .patch(`/v1/admin/catalog/materials/${created.body.id}`, { gsm: 370 }, etag)
      .expect(412);
    expect(stale.body.code).toBe('concurrency.stale');

    const list = await admin
      .get(`/v1/admin/catalog/materials?q=${encodeURIComponent('ทดสอบ')}&kind=paper`)
      .expect(200);
    expect((list.body.data as { id: string }[]).map((m) => m.id)).toContain(created.body.id);
    await admin.get('/v1/admin/catalog/materials?sort=nope').expect(422);

    expect(
      await prisma.auditLog.count({
        where: {
          resourcePublicId: created.body.id,
          action: { in: ['catalog.material_created', 'catalog.material_updated'] },
        },
      }),
    ).toBe(2);
    expect(await prisma.domainEvent.count({ where: { aggregateId: created.body.id } })).toBe(2);
  });

  it('refuses duplicates, unknown references and staff without catalog.manage', async () => {
    const body = { code: `e2e-dup-${run}`, name: 'ฟอยล์ทดสอบ' };
    await admin.post('/v1/admin/catalog/foil-types', body).expect(201);
    const conflict = await admin.post('/v1/admin/catalog/foil-types', body).expect(409);
    expect(conflict.body.code).toBe('catalog.code_taken');

    const unknown = await admin
      .post('/v1/admin/catalog/materials', {
        code: `e2e-unknown-${run}`,
        kind: 'paper',
        familyId: '0192f3a0-7c1e-7d2a-9b1f-0000000000ff',
        nameTh: 'x',
        nameEn: 'x',
      })
      .expect(422);
    expect(unknown.body.errors).toEqual([expect.objectContaining({ path: 'familyId', code: 'exists' })]);

    await as('cs').get('/v1/admin/catalog/materials').expect(200);
    await as('cs')
      .post('/v1/admin/catalog/foil-types', { code: `e2e-cs-${run}`, name: 'x' })
      .expect(403);
  });

  it('keeps a new type on RFQ until its calculator ships (D-100)', async () => {
    // Every calculator ships since U-B6: a type without a calculator stays RFQ (the switch is covered in folding-quotes).
    const type = await productType(null);
    const refused = await admin
      .post(`/v1/admin/catalog/product-types/${type.id}/actions/change-quote-mode`, {
        quoteMode: 'instant',
        reason: 'Trying too early',
      })
      .set('If-Match', type.etag)
      .expect(422);
    expect(refused.body.code).toBe('catalog.calculator_required');
    // quoteMode is not an editable field: unknown properties are refused.
    const patched = await admin
      .patch(`/v1/admin/catalog/product-types/${type.id}`, { quoteMode: 'instant' }, type.etag)
      .expect(422);
    expect(patched.body.errors).toEqual([expect.objectContaining({ path: 'quoteMode' })]);
  });

  it('replaces the patterns and options of a catalogue product in one step', async () => {
    const type = await productType();
    const pattern = await admin
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.id,
        code: `E2E-RTE-${run}`,
        name: 'ฝาเสียบทดสอบ',
        constraints: { minW: 30 },
      })
      .expect(201);
    const coating = await admin
      .post('/v1/admin/catalog/finishes', {
        code: `e2e-varnish-${run}`,
        nameTh: 'วานิช',
        nameEn: 'Varnish',
        finishKind: 'coating',
      })
      .expect(201);
    const foil = await admin
      .post('/v1/admin/catalog/finishes', {
        code: `e2e-foil-${run}`,
        nameTh: 'ฟอยล์',
        nameEn: 'Foil',
        finishKind: 'foil',
        isSpecial: true,
      })
      .expect(201);
    const product = await admin
      .post('/v1/admin/catalog/catalog-products', {
        productTypeId: type.id,
        slug: `e2e-box-${run}`,
        nameTh: 'กล่องทดสอบ',
        nameEn: 'Test box',
      })
      .expect(201);
    const url = `/v1/admin/catalog/catalog-products/${product.body.id}`;

    const withPatterns = await admin
      .put(
        `${url}/patterns`,
        { patterns: [{ patternId: pattern.body.id, factorNw: 1.5 }] },
        product.headers['etag'] as string,
      )
      .expect(200);
    expect(withPatterns.body.patterns).toEqual([
      expect.objectContaining({ patternId: pattern.body.id, factorNw: 1.5 }),
    ]);

    // A foil offered as a coating is refused (only coatings/laminations).
    await admin
      .put(
        `${url}/options`,
        { options: [{ kind: 'coating', optionId: foil.body.id }] },
        withPatterns.headers['etag'] as string,
      )
      .expect(422);
    const withOptions = await admin
      .put(
        `${url}/options`,
        {
          options: [
            { kind: 'coating', optionId: coating.body.id, isDefault: true },
            { kind: 'finish', optionId: foil.body.id },
          ],
        },
        withPatterns.headers['etag'] as string,
      )
      .expect(200);
    expect(withOptions.body.options).toEqual([
      expect.objectContaining({ kind: 'coating', optionId: coating.body.id, isDefault: true }),
      expect.objectContaining({ kind: 'finish', optionId: foil.body.id }),
    ]);
    // The old ETag no longer matches.
    await admin.put(`${url}/patterns`, { patterns: [] }, withPatterns.headers['etag'] as string).expect(412);

    const read = await admin.get(url).expect(200);
    expect(read.body.options).toHaveLength(2);
  });

  it('carries the corrugate calculator data: formulas, flute ct, coatable board, automatic assemblies (U-B6)', async () => {
    const type = await productType('corrugate');
    const flute = await admin
      .post('/v1/admin/catalog/flute-types', {
        code: `E2E-B-${run}`,
        name: 'ลอน B',
        layers: 3,
        colFh: 3,
        ct: 2,
      })
      .expect(201);
    expect(flute.body.ct).toBe(2);
    const board = await admin
      .post('/v1/admin/catalog/materials', {
        code: `e2e-ka125-${run}`,
        kind: 'corrugated_board',
        nameTh: 'KA125',
        nameEn: 'KA125',
        gsm: 450,
        fluteTypeId: flute.body.id,
        coatable: true,
      })
      .expect(201);
    expect(board.body.coatable).toBe(true);
    const packing = await admin
      .post('/v1/admin/catalog/assemblies', {
        code: `e2e-packing-${run}`,
        nameTh: 'ค่าห่อ',
        nameEn: 'Packing',
        autoAdd: true,
      })
      .expect(201);
    expect(packing.body.autoAdd).toBe(true);

    const tele = await admin
      .post('/v1/admin/catalog/patterns', { productTypeId: type.id, code: `E2E-TELE-${run}`, name: 'Tele' })
      .expect(201);
    expect(tele.body).toMatchObject({ geometryFormula: null, corrugateFormula: null });
    const lid = await admin
      .post('/v1/admin/catalog/sub-patterns', {
        patternId: tele.body.id,
        seq: 2,
        name: 'ฝา',
        corrugateFormula: 'tele_lid',
      })
      .expect(201);
    expect(lid.body).toMatchObject({
      corrugateFormula: 'tele_lid',
      geometryFormula: null,
      swapDimensions: false,
    });

    const rsc = await admin
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.id,
        code: `E2E-RSC-${run}`,
        name: 'ฝาชน',
        corrugateFormula: 'rsc',
      })
      .expect(201);
    expect(rsc.body.corrugateFormula).toBe('rsc');
    // One calculator per pattern: refused on create and on an update that would set the other formula.
    const both = await admin
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.id,
        code: `E2E-BOTH-${run}`,
        name: 'x',
        geometryFormula: 'flat',
        corrugateFormula: 'rsc',
      })
      .expect(422);
    expect(both.body.errors[0].path).toBe('corrugateFormula');
    await admin
      .patch(
        `/v1/admin/catalog/patterns/${rsc.body.id}`,
        { geometryFormula: 'flat' },
        rsc.headers['etag'] as string,
      )
      .expect(422);
    await admin
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.id,
        code: `E2E-X-${run}`,
        name: 'x',
        corrugateFormula: 'box',
      })
      .expect(422);
  });

  it('keeps the default difficulty level of a catalogue product, which prices it online (U-B6)', async () => {
    const type = await productType('corrugate');
    const level = await admin
      .post('/v1/admin/catalog/difficulty-levels', {
        code: `e2e-std-${run}`,
        nameTh: 'มาตรฐาน',
        nameEn: 'Standard',
      })
      .expect(201);
    const product = await admin
      .post('/v1/admin/catalog/catalog-products', {
        productTypeId: type.id,
        slug: `e2e-carton-${run}`,
        nameTh: 'กล่องลูกฟูกทดสอบ',
        nameEn: 'Test carton',
        defaultDifficultyLevelId: level.body.id,
      })
      .expect(201);
    expect(product.body.defaultDifficultyLevelId).toBe(level.body.id);
    const url = `/v1/admin/catalog/catalog-products/${product.body.id}`;
    const cleared = await admin
      .patch(url, { defaultDifficultyLevelId: null }, product.headers['etag'] as string)
      .expect(200);
    expect(cleared.body.defaultDifficultyLevelId).toBeNull();
    await admin
      .patch(
        url,
        { defaultDifficultyLevelId: '0192f3a0-7c1e-7d2a-9b1f-0000000000ff' },
        cleared.headers['etag'] as string,
      )
      .expect(422);
  });

  it('edits the geometry the calculators read: band tables, conditions, pattern slots, standard blanks (U-B6)', async () => {
    const table = await admin
      .post('/v1/admin/catalog/geometry-band-tables', {
        code: `e2e_w_${run}`,
        name: 'เผื่อตาม W',
        status: 'active',
      })
      .expect(201);
    const bandsUrl = `/v1/admin/catalog/geometry-band-tables/${table.body.id}/bands`;
    const overlap = await admin
      .put(
        bandsUrl,
        {
          bands: [
            { lower: 0, upper: 100, value: 3 },
            { lower: 100, upper: 200, value: 4 },
          ],
        },
        table.headers['etag'] as string,
      )
      .expect(422);
    expect(overlap.body.errors[0]).toMatchObject({ path: 'bands[1]', code: 'overlap' });
    const banded = await admin
      .put(
        bandsUrl,
        {
          bands: [
            { lower: 100.01, upper: 900, value: 4 },
            { lower: 0, upper: 100, value: -1.5 },
          ],
        },
        table.headers['etag'] as string,
      )
      .expect(200);
    // Kept in the order given: the calculators read bands in that order.
    expect(banded.body.bands).toEqual([
      { lower: 100.01, upper: 900, value: 4 },
      { lower: 0, upper: 100, value: -1.5 },
    ]);
    await admin.put(bandsUrl, { bands: [] }, table.headers['etag'] as string).expect(412);

    const byW = await admin
      .post('/v1/admin/catalog/geometry-conditions', {
        code: `e2e_i_${run}`,
        bandTableId: table.body.id,
        variable: 'i',
        determinant: 'w',
        status: 'active',
      })
      .expect(201);
    expect(byW.body).toMatchObject({ bandTableId: table.body.id, determinant: 'w' });
    const listed = await admin
      .get(`/v1/admin/catalog/geometry-conditions?bandTableId=${table.body.id}`)
      .expect(200);
    expect((listed.body.data as { id: string }[]).map((c) => c.id)).toEqual([byW.body.id]);

    const type = await productType('corrugate');
    const pattern = await admin
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.id,
        code: `E2E-GEO-${run}`,
        name: 'ฝาชน',
        corrugateFormula: 'rsc',
      })
      .expect(201);
    const geometryUrl = `/v1/admin/catalog/patterns/${pattern.body.id}`;
    // `j` is read by W ÷ L; a folding slot does not belong on a corrugate pattern.
    const wrongDim = await admin
      .put(
        `${geometryUrl}/geometry-conditions`,
        { conditions: [{ slot: 'j', conditionId: byW.body.id }] },
        pattern.headers['etag'] as string,
      )
      .expect(422);
    expect(wrongDim.body.errors[0]).toMatchObject({ path: 'conditions[0].conditionId', code: 'determinant' });
    await admin
      .put(
        `${geometryUrl}/geometry-conditions`,
        { conditions: [{ slot: 'dw', conditionId: byW.body.id }] },
        pattern.headers['etag'] as string,
      )
      .expect(422);
    const slotted = await admin
      .put(
        `${geometryUrl}/geometry-conditions`,
        {
          conditions: [
            { slot: 'i', conditionId: byW.body.id },
            { slot: 'k', conditionId: byW.body.id },
          ],
        },
        pattern.headers['etag'] as string,
      )
      .expect(200);
    expect(slotted.body.conditions).toEqual([
      { subPatternId: null, slot: 'i', seq: 1, conditionId: byW.body.id },
      { subPatternId: null, slot: 'k', seq: 1, conditionId: byW.body.id },
    ]);
    // The condition is read in slot i: it cannot move to W ÷ L.
    const inUse = await admin
      .patch(
        `/v1/admin/catalog/geometry-conditions/${byW.body.id}`,
        { determinant: 'w_over_l' },
        byW.headers['etag'] as string,
      )
      .expect(422);
    expect(inUse.body.errors[0]).toMatchObject({ path: 'determinant', code: 'inUse' });

    const product = await admin
      .post('/v1/admin/catalog/catalog-products', {
        productTypeId: type.id,
        slug: `e2e-geo-${run}`,
        nameTh: 'กล่องทดสอบ',
        nameEn: 'Test box',
      })
      .expect(201);
    const size = await admin
      .post('/v1/admin/catalog/standard-sizes', {
        catalogProductId: product.body.id,
        code: 'M',
        name: 'M',
        lengthMm: 300,
        widthMm: 200,
        heightMm: 150,
      })
      .expect(201);
    const blank = { standardSizeId: size.body.id, dwMm: 520, dlMm: 1030 };
    await admin
      .put(
        `${geometryUrl}/standard-blanks`,
        { standardBlanks: [blank, blank] },
        slotted.headers['etag'] as string,
      )
      .expect(422);
    const blanks = await admin
      .put(`${geometryUrl}/standard-blanks`, { standardBlanks: [blank] }, slotted.headers['etag'] as string)
      .expect(200);
    expect(blanks.body.standardBlanks).toEqual([blank]);

    const read = await admin.get(`${geometryUrl}/geometry`).expect(200);
    expect(read.headers['etag']).toBe(blanks.headers['etag']);
    expect(read.body).toMatchObject({ patternId: pattern.body.id, standardBlanks: [blank] });
    expect(read.body.conditions).toHaveLength(2);
    expect(
      await prisma.auditLog.count({
        where: { action: 'catalog.pattern_updated', resourcePublicId: pattern.body.id },
      }),
    ).toBe(2);
    await as('marketing').get(`${geometryUrl}/geometry`).expect(200);
    await as('marketing')
      .put(`${geometryUrl}/standard-blanks`, { standardBlanks: [] }, blanks.headers['etag'] as string)
      .expect(403);
  });

  it('lets Marketing read the catalogue but not edit it', async () => {
    await as('marketing').get('/v1/admin/catalog/product-types').expect(200);
    await as('marketing')
      .post('/v1/admin/catalog/packing-types', { code: `e2e-m-${run}`, nameTh: 'x', nameEn: 'x' })
      .expect(403);
  });
});
