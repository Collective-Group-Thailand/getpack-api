import { PrismaService } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';
import request from 'supertest';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from './e2e';

/** Shared boot and sign-in helpers of the commerce e2e suites (B3). */
export interface CommerceApp {
  app: INestApplication;
  server: ReturnType<INestApplication['getHttpServer']>;
  prisma: PrismaService;
  /** Unique per suite run (the e2e database is shared). */
  run: number;
}

export async function bootCommerceApp(): Promise<CommerceApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: process.env['E2E_LOG'] ? ['error'] : false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  await seedDev(prisma, E2E_DEV_PASSWORD);
  return {
    app,
    server: app.getHttpServer(),
    prisma,
    run: (Date.now() % 1_000_000) + Math.floor(Math.random() * 1000),
  };
}

export async function staffToken(ctx: CommerceApp, role: string): Promise<string> {
  const res = await request(ctx.server)
    .post('/v1/auth/staff/login')
    .send({ email: `${role.replaceAll('_', '-')}@example.invalid`, password: E2E_DEV_PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

/** Signs a customer in by phone OTP (creating the account on first use); `n` makes the phone unique. */
export async function customerToken(ctx: CommerceApp, n: number): Promise<{ token: string; phone: string }> {
  const phone = `08${String(ctx.run * 10 + n)
    .padStart(8, '0')
    .slice(-8)}`;
  const requested = await request(ctx.server)
    .post('/v1/auth/customer/otp/request')
    .send({ phone })
    .expect(200);
  const sms = ctx.app.get<FakeSmsSender>(SMS_SENDER);
  const code = /\b(\d{6})\b/.exec(sms.lastTo(`+66${phone.slice(1)}`)!.text)![1]!;
  const verified = await request(ctx.server)
    .post('/v1/auth/customer/otp/verify')
    .send({ challengeId: requested.body.challengeId, code })
    .expect(200);
  // Give the per-IP hourly OTP budget back: every e2e suite signs in from 127.0.0.1, and the commerce
  // suites create many customers (auth.otp_policy.maxPerIpPerHour stays enforced for real clients).
  const redis = ctx.app.get<Redis>(REDIS);
  const hour = Math.floor(Date.now() / 3_600_000);
  for (const key of await redis.keys(`packio:otp:ip:*:${hour}`)) await redis.decr(key);
  return { token: verified.body.accessToken as string, phone: `+66${phone.slice(1)}` };
}

export function as(ctx: CommerceApp, token: string) {
  const auth = <T extends request.Test>(t: T) => t.auth(token, { type: 'bearer' });
  return {
    get: (url: string) => auth(request(ctx.server).get(url)),
    post: (url: string, body: object = {}) => auth(request(ctx.server).post(url)).send(body),
    patch: (url: string, body: object = {}) => auth(request(ctx.server).patch(url)).send(body),
    put: (url: string, body: object = {}) => auth(request(ctx.server).put(url)).send(body),
    delete: (url: string) => auth(request(ctx.server).delete(url)),
  };
}

/** The dev seed's fake province and subdistrict (postcode 99999). */
export async function devGeo(prisma: PrismaService) {
  const province = await prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
  const subdistrict = await prisma.geoSubdistrict.findUniqueOrThrow({ where: { code: 'DEV10101' } });
  return {
    provinceId: province.publicId,
    subdistrictId: subdistrict.publicId,
    postcode: subdistrict.postcode,
  };
}

/** The dev folding factory with folding switched to instant (switch back in `afterAll`, A-16). */
export async function foldingReady(ctx: CommerceApp): Promise<DevFolding> {
  const { fixture } = await ctx.prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
  await ctx.prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'instant' } });
  return fixture;
}

export async function foldingBackToRfq(ctx: CommerceApp | undefined): Promise<void> {
  await ctx?.prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
}

export function foldingConfiguration(fixture: DevFolding, quantities: number[], graphic = false) {
  return {
    patternId: fixture.patternPublicId,
    w: 200,
    l: 300,
    d: 50,
    materialId: fixture.materialPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities,
    parts: [
      {
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: fixture.inkColourPublicId, percent: 100 })),
        finish1FrontId: fixture.finishPublicId,
        diecutTypeId: fixture.diecutTypePublicId,
      },
    ],
    design: { graphic, structure: false },
  };
}

/** A saved instant quotation of the signed-in customer. */
export async function saveQuote(
  ctx: CommerceApp,
  token: string,
  fixture: DevFolding,
  quantities: number[],
  opts: { graphic?: boolean; postcode?: string } = {},
) {
  const res = await as(ctx, token)
    .post('/v1/store/quotes', {
      productTypeCode: 'folding_carton',
      configuration: foldingConfiguration(fixture, quantities, opts.graphic ?? false),
      ...(opts.postcode && { deliveryPostcode: opts.postcode }),
    })
    .expect(201);
  return res.body as { id: string; options: { id: string; quantity: number; grossAmount: string }[] };
}

/** A delivery address of the signed-in customer on an arbitrary postcode (dev province, no subdistrict). */
export async function addAddress(ctx: CommerceApp, token: string, postcode: string, label = 'ปลายทาง') {
  const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
  const res = await as(ctx, token)
    .post('/v1/store/addresses', {
      kind: 'delivery',
      label,
      recipientName: 'ผู้รับ ทดสอบ',
      phone: '0810001234',
      line1: '1 ถนนทดสอบ',
      provinceId: province.publicId,
      postcode,
    })
    .expect(201);
  return res.body as { id: string };
}

/**
 * Fake shipping for `postcodes`: one customer zone per postcode on a new approved customer rate-card
 * version (THB 120 per shipment) and the dev factory serving them on its own fleet (payout THB 95).
 */
export async function seedShipping(ctx: CommerceApp, factoryPublicId: string, postcodes: string[]) {
  const factory = await ctx.prisma.factory.findUniqueOrThrow({ where: { publicId: factoryPublicId } });
  await ctx.prisma.$transaction(async (tx) => {
    const scheme = await tx.zoneScheme.findUniqueOrThrow({ where: { code: 'customer_default' } });
    const zones = [];
    for (const postcode of postcodes) {
      const zone = await tx.zone.create({
        data: { schemeId: scheme.id, code: `b3_${postcode}_${ctx.run}`, nameTh: postcode, nameEn: postcode },
      });
      // Postcodes are derived from the run number, so an earlier run may hold this one: it moves to the new zone.
      await tx.zonePostcode.upsert({
        where: { schemeId_postcode: { schemeId: scheme.id, postcode } },
        create: { zoneId: zone.id, schemeId: scheme.id, postcode },
        update: { zoneId: zone.id },
      });
      zones.push(zone);
    }
    const card = await tx.customerShippingRateCard.findUniqueOrThrow({ where: { key: 'default' } });
    const last = await tx.customerShippingRateCardVersion.findFirst({
      where: { cardId: card.id },
      orderBy: { versionNo: 'desc' },
    });
    const version = await tx.customerShippingRateCardVersion.create({
      data: {
        cardId: card.id,
        versionNo: (last?.versionNo ?? 0) + 1,
        schemeId: scheme.id,
        effectiveFrom: new Date(Date.now() - 1000),
        reason: 'e2e (fake)',
      },
    });
    await tx.customerShippingRate.createMany({
      data: zones.map((z) => ({
        versionId: version.id,
        schemeId: scheme.id,
        zoneId: z.id,
        weightMinG: 0,
        priceAmount: '120.00',
      })),
    });
    await tx.customerShippingRateCardVersion.update({
      where: { id: version.id },
      data: { status: 'approved', decidedAt: new Date() },
    });
    for (const zone of zones) {
      await tx.factoryDeliveryZone.create({
        data: { factoryId: factory.id, zoneId: zone.id, serves: true, extraLeadDays: 1 },
      });
    }
    const payoutCard =
      (await tx.factoryShippingRateCard.findUnique({ where: { factoryId: factory.id } })) ??
      (await tx.factoryShippingRateCard.create({ data: { factoryId: factory.id } }));
    const lastPayout = await tx.factoryShippingRateCardVersion.findFirst({
      where: { cardId: payoutCard.id },
      orderBy: { versionNo: 'desc' },
    });
    const payout = await tx.factoryShippingRateCardVersion.create({
      data: {
        cardId: payoutCard.id,
        versionNo: (lastPayout?.versionNo ?? 0) + 1,
        schemeId: scheme.id,
        effectiveFrom: new Date(Date.now() - 1000),
        reason: 'e2e (fake)',
      },
    });
    await tx.factoryShippingRate.createMany({
      data: zones.map((z) => ({
        versionId: payout.id,
        schemeId: scheme.id,
        zoneId: z.id,
        weightMinG: 0,
        payoutAmount: '95.00',
        acceptance: 'accepted' as const,
      })),
    });
    const now = new Date();
    await tx.factoryShippingRateCardVersion.update({
      where: { id: payout.id },
      data: { status: 'approved', sentAt: now, factoryAcceptedAt: now, decidedAt: now },
    });
  });
}

/** Unique 5-digit postcodes for a suite run (the e2e database is shared). */
export function postcodes(ctx: CommerceApp, count: number): string[] {
  return Array.from({ length: count }, (_, n) =>
    String(60_000 + ((ctx.run * 13 + n * 7919) % 9_999)).padStart(5, '0'),
  );
}

/** Moves a quotation's validity into the past (test only: the snapshot trigger forbids it otherwise). */
export async function expireQuote(ctx: CommerceApp, quotePublicId: string): Promise<void> {
  await ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `UPDATE quotes SET valid_until = now() - interval '1 minute' WHERE public_id = $1::uuid`,
      quotePublicId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE cart_items SET price_locked_until = now() - interval '1 minute'
        WHERE quote_id = (SELECT id FROM quotes WHERE public_id = $1::uuid)`,
      quotePublicId,
    );
  });
}

/**
 * A customer's placed order group: one quotation per quantity (one item each) delivered to `postcode`
 * (which must have shipping, see `seedShipping`). Returns the group body.
 */
export async function placeOrder(
  ctx: CommerceApp,
  token: string,
  fixture: DevFolding,
  postcode: string,
  quantities: number[] = [1000],
  body: Record<string, unknown> = {},
) {
  const address = await addAddress(ctx, token, postcode);
  for (const quantity of quantities) {
    const quote = await saveQuote(ctx, token, fixture, [quantity]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity }],
      })
      .expect(201);
  }
  const placed = await as(ctx, token)
    .post('/v1/store/checkout', body)
    .set('Idempotency-Key', crypto.randomUUID())
    .expect(201);
  return placed.body as {
    id: string;
    groupCode: string;
    status: string;
    totals: { grossAmount: string; cashAmount: string };
    orders: { id: string; orderCode: string; status: string; totals: { grossAmount: string } }[];
  };
}

/** Switches a feature flag and drops the flag cache. */
export async function setFlag(ctx: CommerceApp, key: string, enabled: boolean): Promise<void> {
  await ctx.prisma.featureFlag.update({ where: { key }, data: { enabled } });
  ctx.app.get(FeatureFlagsService).invalidate();
}

/** A new approved version of a setting, effective now (test fixture: the admin flow is covered elsewhere). */
export async function setSetting(ctx: CommerceApp, key: string, value: unknown): Promise<void> {
  const setting = await ctx.prisma.setting.findFirstOrThrow({ where: { key, scopeType: 'platform' } });
  const last = await ctx.prisma.settingVersion.findFirst({
    where: { settingId: setting.id },
    orderBy: { versionNo: 'desc' },
  });
  await ctx.prisma.settingVersion.create({
    data: {
      settingId: setting.id,
      versionNo: (last?.versionNo ?? 0) + 1,
      effectiveFrom: new Date(Date.now() - 1000),
      status: 'approved',
      value: value as never,
      reason: 'e2e (fake)',
      decidedAt: new Date(),
    },
  });
  ctx.app.get(SettingsService).invalidate(key);
}

/** Uploads a slip file (the fake verifier reads `FAKESLIP;transRef=…;amount=…;date=…;receiver=ok`) and scans it. */
export async function uploadSlipFile(
  ctx: CommerceApp,
  token: string,
  text: string,
  surface: 'store' | 'admin' = 'store',
) {
  return uploadFile(ctx, token, text, 'slip', surface);
}

/** Uploads a small PNG through presign → put → complete → scan and returns its file id. */
export async function uploadFile(
  ctx: CommerceApp,
  token: string,
  text: string,
  purpose: 'slip' | 'evidence' | 'document' | 'design_asset',
  surface: 'store' | 'admin' = 'store',
) {
  const body = Buffer.from(text);
  const presigned = await as(ctx, token)
    .post(`/v1/${surface}/files/presign`, {
      purpose,
      fileName: `${purpose}.png`,
      mimeType: 'image/png',
      sizeBytes: body.length,
    })
    .expect(201);
  const row = await ctx.prisma.fileObject.findUniqueOrThrow({
    where: { publicId: presigned.body.fileId as string },
  });
  ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, 'image/png');
  await as(ctx, token).post(`/v1/${surface}/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
  await ctx.app
    .get(FileProcessingJobs)
    .processOne(await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: row.id } }));
  return presigned.body.fileId as string;
}

/** A valid fake Thai tax id (0000… with its check digit), unique per run and `n`. */
export function fakeTaxId(ctx: CommerceApp, n: number): string {
  const base = `0000${String(ctx.run * 10 + n)
    .padStart(8, '0')
    .slice(-8)}`;
  const sum = [...base].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return base + String((11 - (sum % 11)) % 10);
}

/**
 * An active company (fixture: applied through the API, KYC approval written directly) with its Company
 * Admin and members who accepted `roles`. Returns the company public id.
 */
export async function activeCompany(
  ctx: CommerceApp,
  adminToken: string,
  n: number,
  members: { token: string; phone: string; roles: string[] }[] = [],
  settings: Record<string, unknown> = {},
): Promise<string> {
  const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
  const applied = await as(ctx, adminToken)
    .post('/v1/store/companies', {
      legalName: `บริษัท ทดสอบ ${n} จำกัด`,
      taxId: fakeTaxId(ctx, n),
      isVatRegistered: true,
      withholdsTax: true,
      headOffice: {
        name: 'สำนักงานใหญ่',
        line1: '1 ถนนทดสอบ',
        postcode: '99999',
        provinceId: province.publicId,
      },
      signatory: { name: 'ผู้มีอำนาจ ทดสอบ', position: 'กรรมการ' },
    })
    .expect(201);
  const id = applied.body.id as string;
  await ctx.prisma.company.update({
    where: { publicId: id },
    data: { status: 'active', kycApprovedAt: new Date(), companyCode: `E2E-${ctx.run}-${n}` },
  });
  for (const m of members) {
    await as(ctx, adminToken)
      .post(`/v1/store/companies/${id}/members`, { phone: m.phone, roles: m.roles })
      .expect(201);
    const invitations = await as(ctx, m.token).get('/v1/store/company-invitations').expect(200);
    const invitation = (invitations.body as { id: string; companyId: string }[]).find(
      (i) => i.companyId === id,
    )!;
    await as(ctx, m.token).post(`/v1/store/company-invitations/${invitation.id}/actions/accept`).expect(200);
  }
  if (Object.keys(settings).length > 0) {
    const etag = (await as(ctx, adminToken).get(`/v1/store/companies/${id}`).expect(200)).headers[
      'etag'
    ] as string;
    await as(ctx, adminToken).patch(`/v1/store/companies/${id}`, settings).set('If-Match', etag).expect(200);
  }
  return id;
}
