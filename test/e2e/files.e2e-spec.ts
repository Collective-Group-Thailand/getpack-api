import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { EICAR_TEST_STRING } from '@integrations/virus-scan/fake-virus-scanner';
import { PasswordService } from '@modules/auth/password.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import sharp from 'sharp';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

const FACTORY_A = '0192f3a0-7c1e-7d2a-9b1f-0000000fa001';
const FACTORY_B = '0192f3a0-7c1e-7d2a-9b1f-0000000fb002';
const FAKE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>\n%%EOF',
);

describe('files (e2e, contract §3 Files)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storage: FakeObjectStorage;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get<FakeObjectStorage>(OBJECT_STORAGE);
    await seedDev(prisma, E2E_DEV_PASSWORD);

    // Real factories (B2.2): the factory scope resolver of the partners module maps their ids.
    const ids = new Map<string, bigint>();
    for (const [publicId, code, branchCode] of [
      [FACTORY_A, 'E2EFILESA', '00011'],
      [FACTORY_B, 'E2EFILESB', '00012'],
    ] as const) {
      const existing = await prisma.factory.findUnique({ where: { publicId } });
      const factory =
        existing ??
        (await prisma.factory.create({
          data: {
            publicId,
            code,
            legalName: `${code} (fake)`,
            juristicType: 'company',
            taxId: '0000000000019',
            branchCode,
            vendor: {
              create: {
                kind: 'factory',
                legalName: `${code} (fake)`,
                juristicType: 'company',
                taxId: '0000000000019',
                branchCode,
              },
            },
          },
        }));
      ids.set(publicId, factory.id);
    }
    const owner = await prisma.role.findUniqueOrThrow({ where: { key: 'factory_owner' } });
    const passwordHash = await new PasswordService().hash(E2E_DEV_PASSWORD);
    for (const [name, scopeId] of [
      ['files-a', ids.get(FACTORY_A)!],
      ['files-b', ids.get(FACTORY_B)!],
    ] as const) {
      if (!(await prisma.user.findFirst({ where: { email: `${name}@factory.invalid` } }))) {
        await prisma.user.create({
          data: {
            kind: 'partner',
            status: 'active',
            email: `${name}@factory.invalid`,
            displayName: `${name} (fake)`,
            passwordHash,
            roles: { create: { roleId: owner.id, scopeType: 'factory', scopeId, reason: 'e2e' } },
          },
        });
      }
      tokens[name] = (
        await request(server)
          .post('/v1/auth/partner/login')
          .send({ email: `${name}@factory.invalid`, password: E2E_DEV_PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    }
    for (const role of ['cs', 'prepress']) {
      tokens[role] = (
        await request(server)
          .post('/v1/auth/staff/login')
          .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    }
    const sms = app.get<FakeSmsSender>(SMS_SENDER);
    for (const [name, phone] of [
      ['customer-1', '081-000-3001'],
      ['customer-2', '081-000-3002'],
    ] as const) {
      const otp = await request(server).post('/v1/auth/customer/otp/request').send({ phone }).expect(200);
      const code = /\d{6}/.exec(sms.lastTo(`+66${phone.replace(/-/g, '').slice(1)}`)!.text)![0];
      tokens[name] = (
        await request(server)
          .post('/v1/auth/customer/otp/verify')
          .send({ challengeId: otp.body.challengeId, code })
          .expect(200)
      ).body.accessToken as string;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (who: string) => ({
    token: tokens[who]!,
    surface: who.startsWith('customer') ? 'store' : who.startsWith('files-') ? 'partner' : 'admin',
  });

  /** presign → PUT (fake) → complete. */
  async function upload(
    who: string,
    body: Buffer,
    meta: { purpose: string; fileName: string; mimeType: string },
  ) {
    const { token, surface } = as(who);
    const presigned = await request(server)
      .post(`/v1/${surface}/files/presign`)
      .auth(token, { type: 'bearer' })
      .send({ ...meta, sizeBytes: body.length })
      .expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    storage.putDirect(row.storageKey, body, meta.mimeType);
    const completed = await request(server)
      .post(`/v1/${surface}/files/${presigned.body.fileId}/actions/complete`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(200);
    return completed.body as { id: string; scanStatus: string };
  }
  const get = (who: string, id: string, path = '') =>
    request(server)
      .get(`/v1/${as(who).surface}/files/${id}${path}`)
      .auth(as(who).token, { type: 'bearer' });

  it('uploads a customer artwork, serves it only after a clean scan, with metadata', async () => {
    const file = await upload('customer-1', FAKE_PDF, {
      purpose: 'artwork',
      fileName: 'box-front.pdf',
      mimeType: 'application/pdf',
    });
    expect(file.scanStatus).toBe('pending');
    const early = await get('customer-1', file.id, '/download').expect(409);
    expect(early.body.code).toBe('file.not_ready');

    await app.get(FileProcessingJobs).processUploaded();
    const meta = await get('customer-1', file.id).expect(200);
    expect(meta.body).toMatchObject({
      scanStatus: 'clean',
      pageCount: 2,
      retentionClass: 'customer_content',
      sizeBytes: FAKE_PDF.length,
    });
    expect(meta.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const download = await get('customer-1', file.id, '/download').expect(200);
    expect(download.body.url).toContain('op=get');
    const key = (await prisma.fileObject.findUniqueOrThrow({ where: { publicId: file.id } })).storageKey;
    expect(key).toMatch(/^customer_content\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/); // no personal data in keys
  });

  it('hides files from other customers and factories (404) but not from staff with files.read', async () => {
    const file = await upload('customer-1', FAKE_PDF, {
      purpose: 'artwork',
      fileName: 'private.pdf',
      mimeType: 'application/pdf',
    });
    await get('customer-2', file.id).expect(404);
    await get('customer-2', file.id, '/download').expect(404);
    await get('files-a', file.id).expect(404);
    await get('cs', file.id).expect(200);
  });

  it('scopes factory uploads to the factory: other factories get 404', async () => {
    const file = await upload('files-a', FAKE_PDF, {
      purpose: 'evidence',
      fileName: 'qc-photo.pdf',
      mimeType: 'application/pdf',
    });
    const row = await prisma.fileObject.findUniqueOrThrow({ where: { publicId: file.id } });
    expect(row.ownerFactoryId).toBe(
      (await prisma.factory.findUniqueOrThrow({ where: { publicId: FACTORY_A } })).id,
    );
    await get('files-a', file.id).expect(200);
    await get('files-b', file.id).expect(404);
    await request(server)
      .post('/v1/partner/files/presign')
      .auth(tokens['files-a']!, { type: 'bearer' })
      .send({
        purpose: 'evidence',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        factoryId: FACTORY_B,
      })
      .expect(404);
  });

  it('enforces purpose types and sizes, and checks the uploaded size', async () => {
    const presign = (body: object) =>
      request(server)
        .post('/v1/store/files/presign')
        .auth(tokens['customer-1']!, { type: 'bearer' })
        .send(body);
    expect(
      (
        await presign({
          purpose: 'slip',
          fileName: 'slip.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 10,
        }).expect(422)
      ).body.code,
    ).toBe('file.type_not_allowed');
    expect(
      (
        await presign({
          purpose: 'slip',
          fileName: 'slip.png',
          mimeType: 'image/png',
          sizeBytes: 11 * 1024 * 1024,
        }).expect(422)
      ).body.code,
    ).toBe('file.too_large');

    const started = await presign({
      purpose: 'slip',
      fileName: 'slip.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 999,
    }).expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: started.body.fileId as string },
    });
    expect(row.retentionClass).toBe('financial_record');
    storage.putDirect(row.storageKey, FAKE_PDF, 'application/pdf');
    const mismatch = await request(server)
      .post(`/v1/store/files/${started.body.fileId}/actions/complete`)
      .auth(tokens['customer-1']!, { type: 'bearer' })
      .send({})
      .expect(422);
    expect(mismatch.body.code).toBe('file.upload_incomplete');
    await request(server)
      .post(`/v1/store/files/${started.body.fileId}/actions/complete`)
      .auth(tokens['customer-2']!, { type: 'bearer' })
      .send({})
      .expect(404);
    await request(server)
      .post(`/v1/store/files/${started.body.fileId}/actions/abort`)
      .auth(tokens['customer-1']!, { type: 'bearer' })
      .expect(204);
    await request(server)
      .post('/v1/admin/files/presign')
      .auth(tokens['prepress']!, { type: 'bearer' })
      .send({ purpose: 'proof', fileName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(201);
  });

  it('keeps published images (purpose image) at standard retention, images only (D-415)', async () => {
    const presign = (body: object) =>
      request(server)
        .post('/v1/store/files/presign')
        .auth(tokens['customer-1']!, { type: 'bearer' })
        .send(body);
    const started = await presign({
      purpose: 'image',
      fileName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 999,
    }).expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: started.body.fileId as string },
    });
    expect(row.retentionClass).toBe('standard');
    expect(row.storageKey).toMatch(/^standard\//);
    expect(
      (
        await presign({
          purpose: 'image',
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        }).expect(422)
      ).body.code,
    ).toBe('file.type_not_allowed');
  });

  it('never serves an infected file and removes it from storage', async () => {
    const file = await upload('customer-1', Buffer.from(`%PDF-1.4 ${EICAR_TEST_STRING}`), {
      purpose: 'artwork',
      fileName: 'bad.pdf',
      mimeType: 'application/pdf',
    });
    await app.get(FileProcessingJobs).processUploaded();
    const row = await prisma.fileObject.findUniqueOrThrow({ where: { publicId: file.id } });
    expect(row.scanStatus).toBe('infected');
    expect(storage.objects.has(row.storageKey)).toBe(false);
    expect((await get('customer-1', file.id, '/download').expect(409)).body.code).toBe('file.infected');
    expect(
      await prisma.auditLog.count({ where: { action: 'file.infected', resourcePublicId: file.id } }),
    ).toBe(1);
  });

  it('reads image dimensions and makes a WebP thumbnail that follows the original’s access', async () => {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#88aacc' } })
      .png()
      .toBuffer();
    const file = await upload('customer-1', png, {
      purpose: 'artwork',
      fileName: 'mock.png',
      mimeType: 'image/png',
    });
    await app.get(FileProcessingJobs).processUploaded();
    const meta = await get('customer-1', file.id).expect(200);
    expect(meta.body).toMatchObject({ widthPx: 1200, heightPx: 800 });
    expect(meta.body.thumbnailId).toBeTruthy();
    const thumb = await get('customer-1', meta.body.thumbnailId as string).expect(200);
    expect(thumb.body).toMatchObject({ mimeType: 'image/webp', widthPx: 400, scanStatus: 'clean' });
    await get('customer-2', meta.body.thumbnailId as string).expect(404);
  });

  it('uploads large files in parts (multipart)', async () => {
    const size = 101 * 1024 * 1024;
    const presigned = await request(server)
      .post('/v1/store/files/presign')
      .auth(tokens['customer-1']!, { type: 'bearer' })
      .send({ purpose: 'artwork', fileName: 'big.zip', mimeType: 'application/zip', sizeBytes: size })
      .expect(201);
    expect(presigned.body.uploadUrl).toBeNull();
    const { uploadId, partSize, parts } = presigned.body.multipart as {
      uploadId: string;
      partSize: number;
      parts: { partNumber: number }[];
    };
    expect(parts).toHaveLength(Math.ceil(size / partSize));
    const content = Buffer.alloc(size, 1);
    const etags = parts.map((p) => ({
      partNumber: p.partNumber,
      etag: storage.putPart(
        uploadId,
        p.partNumber,
        content.subarray((p.partNumber - 1) * partSize, p.partNumber * partSize),
      ),
    }));
    const url = `/v1/store/files/${presigned.body.fileId}/actions/complete`;
    await request(server).post(url).auth(tokens['customer-1']!, { type: 'bearer' }).send({}).expect(422);
    const done = await request(server)
      .post(url)
      .auth(tokens['customer-1']!, { type: 'bearer' })
      .send({ parts: etags })
      .expect(200);
    expect(done.body).toMatchObject({ uploadStatus: 'uploaded', sizeBytes: size });
  });
});
