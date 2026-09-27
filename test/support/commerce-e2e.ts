import { PrismaService } from '@database/prisma.service';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

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
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  await seedDev(prisma, E2E_DEV_PASSWORD);
  return { app, server: app.getHttpServer(), prisma, run: (Date.now() % 1_000_000) + Math.floor(Math.random() * 1000) };
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
  const phone = `08${String(ctx.run * 10 + n).padStart(8, '0').slice(-8)}`;
  const requested = await request(ctx.server).post('/v1/auth/customer/otp/request').send({ phone }).expect(200);
  const sms = ctx.app.get<FakeSmsSender>(SMS_SENDER);
  const code = /\b(\d{6})\b/.exec(sms.lastTo(`+66${phone.slice(1)}`)!.text)![1]!;
  const verified = await request(ctx.server)
    .post('/v1/auth/customer/otp/verify')
    .send({ challengeId: requested.body.challengeId, code })
    .expect(200);
  return { token: verified.body.accessToken as string, phone: `+66${phone.slice(1)}` };
}

export function as(ctx: CommerceApp, token: string) {
  const auth = <T extends request.Test>(t: T) => t.auth(token, { type: 'bearer' });
  return {
    get: (url: string) => auth(request(ctx.server).get(url)),
    post: (url: string, body: object = {}) => auth(request(ctx.server).post(url)).send(body),
    patch: (url: string, body: object = {}) => auth(request(ctx.server).patch(url)).send(body),
    delete: (url: string) => auth(request(ctx.server).delete(url)),
  };
}

/** The dev seed's fake province and subdistrict (postcode 99999). */
export async function devGeo(prisma: PrismaService) {
  const province = await prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
  const subdistrict = await prisma.geoSubdistrict.findUniqueOrThrow({ where: { code: 'DEV10101' } });
  return { provinceId: province.publicId, subdistrictId: subdistrict.publicId, postcode: subdistrict.postcode };
}
