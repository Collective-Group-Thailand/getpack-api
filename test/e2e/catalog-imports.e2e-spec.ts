import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { writeWorkbook } from '@modules/catalog/imports/workbook';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel import with preview → confirm (B2.1, D-005, D-170 geography). */
describe('catalogue Excel import (e2e, B2.1)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storage: FakeObjectStorage;
  const tokens: Record<string, string> = {};
  const run = Date.now().toString(36).toUpperCase();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(OBJECT_STORAGE);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['admin', 'marketing']) {
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

  const auth = (role = 'admin') => ({ type: 'bearer' as const, token: tokens[role]! });
  const post = (url: string, body: object, role = 'admin') =>
    request(server).post(url).auth(auth(role).token, { type: 'bearer' }).send(body);

  /** Uploads a workbook (presign → PUT → complete) and lets the worker scan it. */
  async function upload(sheets: Parameters<typeof writeWorkbook>[0]): Promise<string> {
    const body = await writeWorkbook(sheets);
    const presigned = await post('/v1/admin/files/presign', {
      purpose: 'import',
      fileName: 'geography.xlsx',
      mimeType: XLSX,
      sizeBytes: body.length,
    }).expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    storage.putDirect(row.storageKey, body, XLSX);
    await post(`/v1/admin/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
    await app.get(FileProcessingJobs).processUploaded();
    return presigned.body.fileId as string;
  }

  const province = `P${run}`;
  const district = `${province}01`;
  const geography = (postcode: string, extraSubdistrict?: Record<string, string>) => [
    {
      name: 'provinces',
      headers: ['code', 'name_th', 'name_en', 'region'],
      rows: [{ code: province, name_th: 'จังหวัดทดสอบ', name_en: 'Test province', region: 'central' }],
    },
    {
      name: 'districts',
      headers: ['code', 'province_code', 'name_th', 'name_en'],
      rows: [{ code: district, province_code: province, name_th: 'อำเภอทดสอบ', name_en: 'Test district' }],
    },
    {
      name: 'subdistricts',
      headers: ['code', 'district_code', 'name_th', 'name_en', 'postcode'],
      rows: [
        {
          code: `${district}01`,
          district_code: district,
          name_th: 'ตำบลทดสอบ',
          name_en: 'Test subdistrict',
          postcode,
        },
        ...(extraSubdistrict ? [extraSubdistrict] : []),
      ],
    },
  ];

  it('previews with row errors, then confirms a clean file in one transaction', async () => {
    const broken = await upload(
      geography('99999', {
        code: `${district}02`,
        district_code: 'NOPE',
        name_th: 'x',
        name_en: 'x',
        postcode: '9999',
      }),
    );
    const bad = await post('/v1/admin/catalog/imports/geography/actions/preview', { fileId: broken }).expect(
      200,
    );
    expect(bad.body.canConfirm).toBe(false);
    expect(bad.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'subdistricts', row: 3, column: 'district_code', code: 'ref' }),
        expect.objectContaining({ sheet: 'subdistricts', row: 3, column: 'postcode', code: 'pattern' }),
      ]),
    );
    const refused = await post('/v1/admin/catalog/imports/geography/actions/confirm', {
      fileId: broken,
      previewSha256: bad.body.previewSha256,
    })
      .set('Idempotency-Key', randomUUID())
      .expect(422);
    expect(refused.body.code).toBe('catalog.import_invalid');

    const good = await upload(geography('99999'));
    const preview = await post('/v1/admin/catalog/imports/geography/actions/preview', {
      fileId: good,
    }).expect(200);
    expect(preview.body).toMatchObject({ canConfirm: true, totals: { create: 3, update: 0, invalid: 0 } });
    expect(await prisma.geoProvince.count({ where: { code: province } })).toBe(0); // dry run

    const key = randomUUID();
    const confirmed = await post('/v1/admin/catalog/imports/geography/actions/confirm', {
      fileId: good,
      previewSha256: preview.body.previewSha256,
    })
      .set('Idempotency-Key', key)
      .expect(200);
    expect(confirmed.body.totals).toMatchObject({ create: 3 });
    const sub = await prisma.geoSubdistrict.findFirstOrThrow({
      where: { code: `${district}01` },
      include: { district: { include: { province: true } } },
    });
    expect(sub).toMatchObject({
      postcode: '99999',
      district: { code: district, province: { code: province } },
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'catalog.import_applied', resourcePublicId: good } }),
    ).toBe(1);

    // Replaying the same Idempotency-Key returns the stored response without importing again.
    const replay = await post('/v1/admin/catalog/imports/geography/actions/confirm', {
      fileId: good,
      previewSha256: preview.body.previewSha256,
    })
      .set('Idempotency-Key', key)
      .expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('refuses a stale preview after the data changed, and updates in place on a fresh one', async () => {
    const file = await upload(geography('88888'));
    const preview = await post('/v1/admin/catalog/imports/geography/actions/preview', {
      fileId: file,
    }).expect(200);
    expect(preview.body.totals).toMatchObject({ update: 1, unchanged: 2 });

    await prisma.geoSubdistrict.updateMany({
      where: { code: `${district}01` },
      data: { nameEn: 'Changed meanwhile' },
    });
    const stale = await post('/v1/admin/catalog/imports/geography/actions/confirm', {
      fileId: file,
      previewSha256: preview.body.previewSha256,
    })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(stale.body.code).toBe('catalog.import_stale');

    const fresh = await post('/v1/admin/catalog/imports/geography/actions/preview', { fileId: file }).expect(
      200,
    );
    await post('/v1/admin/catalog/imports/geography/actions/confirm', {
      fileId: file,
      previewSha256: fresh.body.previewSha256,
    })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const sub = await prisma.geoSubdistrict.findFirstOrThrow({ where: { code: `${district}01` } });
    expect(sub).toMatchObject({ postcode: '88888', nameEn: 'Test subdistrict', rowVersion: 2 }); // the import bumps the ETag
  });

  it('exports the current rows as a workbook and audits the export', async () => {
    const res = await post('/v1/admin/catalog/exports/geography', {}).expect(200);
    expect(res.body.rows).toBeGreaterThanOrEqual(3);
    const file = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: res.body.fileId as string },
    });
    expect(file).toMatchObject({ mimeType: XLSX, retentionClass: 'transient', scanStatus: 'clean' });
    expect(storage.objects.get(file.storageKey)?.body.length).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({ where: { action: 'catalog.exported', resourcePublicId: file.publicId } }),
    ).toBe(1);
  });

  it('lists the import kinds and keeps imports to catalog.import holders', async () => {
    const kinds = await request(server)
      .get('/v1/admin/catalog/imports')
      .auth(tokens['admin']!, { type: 'bearer' })
      .expect(200);
    expect((kinds.body as { kind: string }[]).map((k) => k.kind)).toEqual(
      expect.arrayContaining(['geography', 'materials', 'stock_products']),
    );
    await post(
      '/v1/admin/catalog/imports/materials/actions/preview',
      { fileId: randomUUID() },
      'marketing',
    ).expect(403);
    await post('/v1/admin/catalog/imports/unknown/actions/preview', { fileId: randomUUID() }).expect(404);
  });
});
