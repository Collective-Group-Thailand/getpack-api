import { randomUUID } from 'node:crypto';

import { ErpPrismaService } from '@database/erp-prisma.service';
import { PrismaService } from '@database/prisma.service';
import { type FakeScbGateway } from '@integrations/payments/fake-payment-gateways';
import { SCB_GATEWAY } from '@integrations/payments/payment-gateways.port';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { PreflightService } from '@modules/artwork/preflight/preflight.service';
import { PasswordService } from '@modules/auth/password.service';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { EventConsumerRunner } from '@platform/domain-events/event-consumer.runner';
import { SubscriberRegistry } from '@platform/domain-events/subscriber-registry';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import { PDFDocument, rgb } from 'pdf-lib';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { as, type CommerceApp } from './commerce-e2e';
import { E2E_DEV_PASSWORD } from './e2e';

/** Shared helpers of the fulfilment e2e suites (B4). */

const PT_PER_MM = 72 / 25.4;

/**
 * A one-page PDF of `widthMm × heightMm` media with an optional trim box inset by `bleedMm` on each side,
 * painted in CMYK only (no fonts, no RGB) unless `rgbPaint` is set.
 */
export async function makePdf(opts: {
  widthMm: number;
  heightMm: number;
  bleedMm?: number;
  rgbPaint?: boolean;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([opts.widthMm * PT_PER_MM, opts.heightMm * PT_PER_MM]);
  if (opts.bleedMm !== undefined) {
    const b = opts.bleedMm * PT_PER_MM;
    page.setTrimBox(b, b, page.getWidth() - 2 * b, page.getHeight() - 2 * b);
    page.setBleedBox(0, 0, page.getWidth(), page.getHeight());
  }
  if (opts.rgbPaint) page.drawRectangle({ x: 20, y: 20, width: 30, height: 30, color: rgb(0.2, 0.4, 0.8) });
  return Buffer.from(await doc.save());
}

/** Uploads `body` through presign → PUT (fake S3) → complete → scan and returns the file id. */
export async function uploadBytes(
  ctx: CommerceApp,
  token: string,
  body: Buffer,
  opts: {
    purpose: 'artwork' | 'proof' | 'evidence' | 'document';
    fileName: string;
    mimeType: string;
    surface?: 'store' | 'admin' | 'partner';
  },
): Promise<string> {
  const surface = opts.surface ?? 'store';
  const presigned = await as(ctx, token)
    .post(`/v1/${surface}/files/presign`, {
      purpose: opts.purpose,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: body.length,
    })
    .expect(201);
  const row = await ctx.prisma.fileObject.findUniqueOrThrow({
    where: { publicId: presigned.body.fileId as string },
  });
  ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, opts.mimeType);
  await as(ctx, token).post(`/v1/${surface}/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
  await ctx.app
    .get(FileProcessingJobs)
    .processOne(await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: row.id } }));
  return presigned.body.fileId as string;
}

export const uploadPdf = (
  ctx: CommerceApp,
  token: string,
  body: Buffer,
  purpose: 'artwork' | 'proof' | 'document' = 'artwork',
  surface: 'store' | 'admin' | 'partner' = 'store',
) =>
  uploadBytes(ctx, token, body, {
    purpose,
    fileName: `${purpose}.pdf`,
    mimeType: 'application/pdf',
    surface,
  });

export interface FulfilmentApp extends CommerceApp {
  /**
   * Runs every registered domain-event subscriber (the worker's consumers, exactly-once through
   * `event_consumptions`) on the events recorded since the suite started, until nothing new happens.
   */
  pump: (opts?: { skip?: string[]; notifications?: boolean }) => Promise<number>;
}

/** The commerce app plus the worker's subscriber registry, so suites can drive event chains (B4). */
export async function bootFulfilmentApp(): Promise<FulfilmentApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
    providers: [SubscriberRegistry, EventConsumerRunner],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: process.env['E2E_LOG'] ? ['error'] : false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  await seedDev(prisma, E2E_DEV_PASSWORD);
  const since = new Date();
  const registry = app.get(SubscriberRegistry);
  const runner = app.get(EventConsumerRunner);
  const pump = async (opts: { skip?: string[]; notifications?: boolean } = {}) => {
    const skip = new Set([...(opts.notifications ? [] : ['notifications.router']), ...(opts.skip ?? [])]);
    let total = 0;
    for (let round = 0; round < 25; round++) {
      const events = await prisma.domainEvent.findMany({
        where: { occurredAt: { gte: since } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      let processed = 0;
      for (const event of events) {
        for (const subscriber of registry.forType(event.type)) {
          if (skip.has(subscriber.consumer)) continue;
          const done = await prisma.eventConsumption.findUnique({
            where: { consumer_eventId: { consumer: subscriber.consumer, eventId: event.id } },
          });
          if (done) continue;
          if ((await runner.consume(subscriber.consumer, envelopeFromRow(event))) === 'processed')
            processed++;
        }
      }
      total += processed;
      if (processed === 0) return total;
    }
    throw new Error('event pump did not settle after 25 rounds');
  };
  return {
    app,
    server: app.getHttpServer(),
    prisma,
    erpPrisma: app.get(ErpPrismaService),
    run: (Date.now() % 1_000_000) + Math.floor(Math.random() * 1000),
    pump,
  };
}

/** Pays what is due on the group by SCB QR, confirmed by the fake SCB callback (flag `payments.scb` on). */
export async function payDue(
  ctx: CommerceApp,
  token: string,
  groupId: string,
): Promise<{ cashAmount: string }> {
  const payment = (
    await as(ctx, token)
      .post(`/v1/store/order-groups/${groupId}/payments`, { method: 'scb_qr' })
      .set('Idempotency-Key', randomUUID())
      .expect(201)
  ).body as { referenceCode: string; cashAmount: string };
  const scb = ctx.app.get<FakeScbGateway>(SCB_GATEWAY);
  await request(ctx.server)
    .post('/webhooks/scb/payment-confirmation')
    .send(scb.settle(payment.referenceCode, payment.cashAmount))
    .expect(200);
  return payment;
}

/** A factory user with `role` in the factory's scope, signed in with a password (fake data). */
export async function factoryToken(
  ctx: CommerceApp,
  factoryPublicId: string,
  role: string,
  n: number,
): Promise<string> {
  const factory = await ctx.prisma.factory.findUniqueOrThrow({ where: { publicId: factoryPublicId } });
  const roleRow = await ctx.prisma.role.findUniqueOrThrow({ where: { key: role } });
  const email = `${role}-${ctx.run}-${n}@factory.invalid`;
  await ctx.prisma.user.create({
    data: {
      kind: 'partner',
      status: 'active',
      email,
      displayName: `${role} (fake)`,
      passwordHash: await new PasswordService().hash(E2E_DEV_PASSWORD),
      roles: {
        create: { roleId: roleRow.id, scopeType: 'factory', scopeId: factory.id, reason: 'e2e (fake)' },
      },
    },
  });
  const login = await request(ctx.server)
    .post('/v1/auth/partner/login')
    .send({ email, password: E2E_DEV_PASSWORD })
    .expect(200);
  return login.body.accessToken as string;
}

/**
 * Artwork approved the real way: the customer uploads a clean PDF, preflight runs, Prepress accepts it and
 * sends a proof, the customer approves it. Returns the approved proof id.
 */
export async function approveArtwork(
  ctx: CommerceApp,
  token: string,
  prepressToken: string,
  orderId: string,
): Promise<string> {
  const file = await uploadPdf(ctx, token, await makePdf({ widthMm: 100, heightMm: 100 }));
  const submission = await as(ctx, token)
    .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: file }] })
    .expect(201);
  await ctx.app.get(PreflightService).runDue();
  await as(ctx, prepressToken)
    .post(`/v1/admin/artwork-submissions/${submission.body.id as string}/actions/accept`)
    .expect(200);
  const proofFile = await uploadPdf(
    ctx,
    prepressToken,
    await makePdf({ widthMm: 100, heightMm: 100 }),
    'proof',
    'admin',
  );
  const proof = await as(ctx, prepressToken)
    .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proofFile })
    .expect(201);
  await as(ctx, token)
    .post(`/v1/store/proofs/${proof.body.id as string}/actions/approve`)
    .set('Idempotency-Key', randomUUID())
    .expect(200);
  return proof.body.id as string;
}
