import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type FakeScbGateway } from '@integrations/payments/fake-payment-gateways';
import { SCB_GATEWAY } from '@integrations/payments/payment-gateways.port';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { EventConsumerRunner } from '@platform/domain-events/event-consumer.runner';
import { SubscriberRegistry } from '@platform/domain-events/subscriber-registry';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { type Redis } from 'ioredis';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * The UAT populate driver's app: the real AppModule on the UAT rehearsal database (`UAT_DATABASE_URL`), fake
 * integrations (OTP codes are read from the fake SMS sender, payments settle through the fake SCB callback), and
 * the worker's subscribers pumped in-process so ledger postings, notifications and read models follow every step.
 * Shaped like the e2e `FulfilmentApp` so the e2e helpers can be reused.
 */
export async function bootUatApp(): Promise<FulfilmentApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
    providers: [SubscriberRegistry, EventConsumerRunner],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: process.env['UAT_LOG'] ? ['error', 'warn'] : false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const since = new Date();
  const registry = app.get(SubscriberRegistry);
  const runner = app.get(EventConsumerRunner);
  const pump = async (opts: { skip?: string[]; notifications?: boolean } = {}) => {
    const skip = new Set(opts.skip ?? []);
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
  return { app, server: app.getHttpServer(), prisma, run: Date.now() % 1_000_000, pump };
}

export const UAT_PASSWORD = () => process.env['UAT_SEED_PASSWORD'] ?? process.env['DEV_SEED_PASSWORD'] ?? '';

export async function staffSignIn(ctx: FulfilmentApp, email: string): Promise<string> {
  const res = await request(ctx.server)
    .post('/v1/auth/staff/login')
    .send({ email, password: UAT_PASSWORD() });
  if (res.status !== 200)
    throw new Error(`staff sign-in ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export const staff = (ctx: FulfilmentApp, role: string) =>
  staffSignIn(ctx, `${role.replaceAll('_', '-')}@example.invalid`);

export async function partnerSignIn(ctx: FulfilmentApp, role: string): Promise<string> {
  const email = `${role.replaceAll('_', '-')}@uat.example.invalid`;
  const res = await request(ctx.server)
    .post('/v1/auth/partner/login')
    .send({ email, password: UAT_PASSWORD() });
  if (res.status !== 200)
    throw new Error(`partner sign-in ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Signs a customer in by phone OTP (the account is created on first use); the code comes from the fake SMS. */
export async function customerSignIn(ctx: FulfilmentApp, phone: string): Promise<string> {
  let requested = await request(ctx.server).post('/v1/auth/customer/otp/request').send({ phone });
  // The OTP endpoints are rate-limited per caller (every persona signs in from 127.0.0.1): wait as told.
  for (let attempt = 0; requested.status === 429 && attempt < 5; attempt++) {
    const wait = Math.min(Number(requested.headers['retry-after'] ?? 60), 120);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    requested = await request(ctx.server).post('/v1/auth/customer/otp/request').send({ phone });
  }
  if (requested.status !== 200) throw new Error(`OTP request ${phone}: ${requested.status}`);
  const sms = ctx.app.get<FakeSmsSender>(SMS_SENDER);
  const code = /\b(\d{6})\b/.exec(sms.lastTo(`+66${phone.slice(1)}`)!.text)![1]!;
  const verify = () =>
    request(ctx.server)
      .post('/v1/auth/customer/otp/verify')
      .send({ challengeId: requested.body.challengeId, code });
  let verified = await verify();
  for (let attempt = 0; verified.status === 429 && attempt < 5; attempt++) {
    const wait = Math.min(Number(verified.headers['retry-after'] ?? 60), 120);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    verified = await verify();
  }
  if (verified.status !== 200) throw new Error(`OTP verify ${phone}: ${verified.status}`);
  // Give the per-IP hourly OTP budget back: every persona signs in from 127.0.0.1.
  const redis = ctx.app.get<Redis>(REDIS);
  const hour = Math.floor(Date.now() / 3_600_000);
  for (const key of await redis.keys(`packio:otp:ip:*:${hour}`)) await redis.decr(key);
  return verified.body.accessToken as string;
}

/** Authenticated calls; mutations carry an Idempotency-Key (ignored where the operation takes none). */
export function as(ctx: FulfilmentApp, token: string) {
  const auth = <T extends request.Test>(t: T) => t.auth(token, { type: 'bearer' });
  return {
    get: (url: string) => auth(request(ctx.server).get(url)),
    post: (url: string, body: object = {}) =>
      auth(request(ctx.server).post(url)).set('Idempotency-Key', randomUUID()).send(body),
    patch: (url: string, body: object = {}, etag?: string) => {
      const t = auth(request(ctx.server).patch(url)).set('Idempotency-Key', randomUUID());
      return (etag ? t.set('If-Match', etag) : t).send(body);
    },
    put: (url: string, body: object = {}) => auth(request(ctx.server).put(url)).send(body),
  };
}

/** Fails with the response body when the status is not the expected one (clearer than supertest's message). */
export async function ok<T = Record<string, unknown>>(
  pending: request.Test,
  status: number | number[] = [200, 201],
): Promise<T> {
  const { method, url } = pending as unknown as { method: string; url: string };
  const res = await pending;
  const expected = Array.isArray(status) ? status : [status];
  if (!expected.includes(res.status)) {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.body).slice(0, 600)}`);
  }
  return res.body as T;
}

export async function setFlag(ctx: FulfilmentApp, key: string, enabled: boolean): Promise<void> {
  await ctx.prisma.featureFlag.update({ where: { key }, data: { enabled } });
  ctx.app.get(FeatureFlagsService).invalidate();
}

/** Pays what is due on the group by SCB QR, confirmed by the fake SCB callback (flag `payments.scb` on). */
export async function payDueByQr(ctx: FulfilmentApp, token: string, groupId: string) {
  const payment = await ok<{ referenceCode: string; cashAmount: string }>(
    as(ctx, token).post(`/v1/store/order-groups/${groupId}/payments`, { method: 'scb_qr' }),
  );
  const scb = ctx.app.get<FakeScbGateway>(SCB_GATEWAY);
  await request(ctx.server)
    .post('/webhooks/scb/payment-confirmation')
    .send(scb.settle(payment.referenceCode, payment.cashAmount))
    .expect(200);
  return payment;
}
