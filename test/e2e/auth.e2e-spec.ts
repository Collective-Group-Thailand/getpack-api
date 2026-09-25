import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { PasswordService } from '@modules/auth/password.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, jwtVerify } from 'jose';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

const DEV_PASSWORD = E2E_DEV_PASSWORD;
const FACTORY_PUBLIC_ID = '0192f3a0-7c1e-7d2a-9b1f-000000000f01';

type Tokens = {
  accessToken: string;
  refreshToken: string;
  subject: { id: string; type: string; scopes: string[] };
};

describe('auth (e2e, ADR-0004)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let sms: FakeSmsSender;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    sms = app.get<FakeSmsSender>(SMS_SENDER);
    await seedDev(prisma, DEV_PASSWORD);
  });

  afterAll(async () => {
    await app?.close();
  });

  const staffLogin = (email: string, password = DEV_PASSWORD) =>
    request(server).post('/v1/auth/staff/login').send({ email, password });

  /** Customer sign-in through phone OTP, reading the code from the fake SMS provider. */
  const otpLogin = async (localPhone: string, purpose?: 'link_phone') => {
    const requested = await request(server)
      .post('/v1/auth/customer/otp/request')
      .send({ phone: localPhone, ...(purpose && { purpose }) })
      .expect(200);
    const e164 = `+66${localPhone.replace(/-/g, '').slice(1)}`;
    const code = /\b(\d{6})\b/.exec(sms.lastTo(e164)!.text)![1]!;
    return { challengeId: requested.body.challengeId as string, code };
  };

  const customerLogin = async (localPhone: string): Promise<Tokens> => {
    const { challengeId, code } = await otpLogin(localPhone);
    const res = await request(server)
      .post('/v1/auth/customer/otp/verify')
      .send({ challengeId, code })
      .expect(200);
    return res.body as Tokens;
  };

  it('signs in staff and returns /v1/admin/me with menu entitlements (D-140)', async () => {
    const login = await staffLogin('finance@example.invalid').expect(200);
    expect(login.body).toMatchObject({ subject: { type: 'staff', roles: ['finance'] } });
    expect(login.body.accessTokenExpiresAt).toMatch(/\+07:00$/);

    const me = await request(server)
      .get('/v1/admin/me')
      .auth(login.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(me.body).toMatchObject({ email: 'finance@example.invalid', roles: ['finance'] });
    const menu = (me.body.menu as { key: string }[]).map((m) => m.key);
    expect(menu).toEqual(expect.arrayContaining(['dashboard', 'approvals', 'audit_logs']));
    expect(menu).not.toContain('users');
    expect(me.body.permissions).toContain('factory_cost.read'); // D-141: Finance sees cost
  });

  it('refuses wrong passwords with one problem and locks after repeated failures', async () => {
    // A dedicated account: the seeded role users are shared by other suites and must not be locked.
    const email = `lockout-${Date.now()}@example.invalid`;
    const locking = await prisma.user.create({
      data: {
        kind: 'staff',
        status: 'active',
        email,
        displayName: 'Lockout (fake)',
        passwordHash: await new PasswordService().hash(DEV_PASSWORD),
      },
    });
    const bad = await staffLogin(email, 'wrong').expect(401);
    expect(bad.body.code).toBe('auth.invalid_credentials');
    await staffLogin('nobody@example.invalid', 'wrong').expect(401);
    for (let i = 0; i < 4; i++) await staffLogin(email, 'wrong');
    const locked = await staffLogin(email).expect(401);
    expect(locked.body.code).toBe('auth.account_locked');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    const audits = await prisma.auditLog.count({
      where: { action: 'auth.account_locked', resourcePublicId: locking.publicId },
    });
    expect(audits).toBe(1);
  });

  it('signs in a customer with phone OTP and creates the account on first use', async () => {
    const tokens = await customerLogin('081-000-1001');
    expect(tokens.subject.type).toBe('customer');
    const me = await request(server)
      .get('/v1/store/me')
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(200);
    expect(me.body).toMatchObject({ phone: '+66810001001', identities: [{ provider: 'phone_otp' }] });
    const events = await prisma.domainEvent.count({
      where: { type: 'customer.registered', aggregateId: tokens.subject.id },
    });
    expect(events).toBe(1);
  });

  it('rejects a wrong OTP, spends attempts, and rate-limits resends', async () => {
    const { challengeId, code } = await otpLogin('081-000-1002');
    const wrongCode = code === '000000' ? '111111' : '000000';
    const wrong = await request(server)
      .post('/v1/auth/customer/otp/verify')
      .send({ challengeId, code: wrongCode })
      .expect(422);
    expect(wrong.body.code).toBe('auth.otp_invalid');
    const again = await request(server)
      .post('/v1/auth/customer/otp/request')
      .send({ phone: '081-000-1002' })
      .expect(429);
    expect(again.body.code).toBe('auth.otp_rate_limited');
    expect(again.headers['retry-after']).toBeDefined();
    await request(server).post('/v1/auth/customer/otp/request').send({ phone: 'not a phone' }).expect(422);
  });

  it('rejects a token of one audience on every other prefix', async () => {
    const staff = (await staffLogin('cs@example.invalid').expect(200)).body as Tokens;
    const customer = await customerLogin('081-000-1003');

    for (const [token, path] of [
      [customer.accessToken, '/v1/admin/me'],
      [customer.accessToken, '/v1/partner/me'],
      [staff.accessToken, '/v1/store/me'],
      [staff.accessToken, '/v1/partner/me'],
    ] as const) {
      const res = await request(server).get(path).auth(token, { type: 'bearer' }).expect(403);
      expect(res.body.code).toBe('auth.wrong_audience');
    }
    expect((await request(server).get('/v1/admin/me').expect(401)).body.code).toBe('auth.unauthenticated');
    await request(server).get('/v1/admin/me').auth('not-a-jwt', { type: 'bearer' }).expect(401);
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.audience_rejected' } }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('rotates refresh tokens and revokes the whole family when one is reused', async () => {
    const first = (await staffLogin('prepress@example.invalid').expect(200)).body as Tokens;
    const second = (
      await request(server).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)
    ).body as Tokens;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await request(server).get('/v1/admin/me').auth(second.accessToken, { type: 'bearer' }).expect(200);

    const reused = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(reused.body.code).toBe('auth.refresh_reused');
    const afterRevoke = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
    expect(afterRevoke.body.code).toBe('auth.refresh_invalid');
    const revoked = await request(server)
      .get('/v1/admin/me')
      .auth(second.accessToken, { type: 'bearer' })
      .expect(401);
    expect(revoked.body.code).toBe('auth.session_revoked');
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('logs out: the refresh token and its access tokens stop working', async () => {
    const tokens = (await staffLogin('logistics@example.invalid').expect(200)).body as Tokens;
    await request(server).post('/v1/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(204);
    await request(server).post('/v1/auth/logout').send({ refreshToken: 'unknown-token' }).expect(204);
    expect(
      (await request(server).get('/v1/admin/me').auth(tokens.accessToken, { type: 'bearer' }).expect(401))
        .body.code,
    ).toBe('auth.session_revoked');
    await request(server).post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
  });

  it('links a LINE account to the signed-in customer, then signs in with LINE alone (D-151)', async () => {
    const customer = await customerLogin('081-000-1004');
    const lineUser = `U${randomUUID().replace(/-/g, '')}`;
    const linked = await request(server)
      .post('/v1/auth/customer/line')
      .auth(customer.accessToken, { type: 'bearer' })
      .send({ liffAccessToken: `fake-line.${lineUser}.Tester` })
      .expect(200);
    expect(linked.body.subject.id).toBe(customer.subject.id);

    const lineOnly = await request(server)
      .post('/v1/auth/customer/line')
      .send({ idToken: `fake-line.${lineUser}` })
      .expect(200);
    expect(lineOnly.body.subject.id).toBe(customer.subject.id);

    const other = await customerLogin('081-000-1005');
    const conflict = await request(server)
      .post('/v1/auth/customer/line')
      .auth(other.accessToken, { type: 'bearer' })
      .send({ idToken: `fake-line.${lineUser}` })
      .expect(409);
    expect(conflict.body.code).toBe('auth.identity_linked_elsewhere');
    expect(
      await prisma.domainEvent.count({
        where: { type: 'customer.identity_linked', aggregateId: customer.subject.id },
      }),
    ).toBe(2);
  });

  it('links a new LINE account to the customer of a verified phone (link_phone OTP)', async () => {
    const existing = await customerLogin('081-000-1006');
    const { challengeId, code } = await otpLogin('081-000-1006', 'link_phone');
    const res = await request(server)
      .post('/v1/auth/customer/line')
      .send({
        idToken: `fake-line.U${randomUUID().replace(/-/g, '')}`,
        otpChallengeId: challengeId,
        otpCode: code,
      })
      .expect(200);
    expect(res.body.subject.id).toBe(existing.subject.id);
    await request(server).post('/v1/auth/customer/line').send({ idToken: 'garbage' }).expect(401);
    await request(server).post('/v1/auth/customer/line').send({}).expect(422);
  });

  it('signs in with Google through Firebase and never links by e-mail alone', async () => {
    const google = await request(server)
      .post('/v1/auth/customer/firebase')
      .send({ idToken: 'fake-firebase.google.uid-e2e-1.customer%40example.invalid' })
      .expect(200);
    // customer@example.invalid belongs to the dev customer: a new account is created without that e-mail.
    const me = await request(server)
      .get('/v1/store/me')
      .auth(google.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(me.body.email).toBeNull();
    expect(me.body.identities).toEqual([expect.objectContaining({ provider: 'firebase_google' })]);
  });

  describe('partners', () => {
    let partnerId: bigint;

    /** A factory (with its vendor) to scope partner users to; offboarded factories never resolve. */
    async function factory(code: string, status: 'applied' | 'offboarded', publicId?: string) {
      const vendor = await prisma.vendor.create({
        data: {
          kind: 'factory',
          legalName: `Factory ${code} (fake)`,
          juristicType: 'company',
          taxId: '0000000000019',
        },
      });
      return prisma.factory.create({
        data: {
          ...(publicId ? { publicId } : {}),
          code,
          vendorId: vendor.id,
          legalName: `Factory ${code} (fake)`,
          juristicType: 'company',
          taxId: '0000000000019',
          branchCode: code === 'E2EOFF' ? '00001' : '00002',
          status,
          ...(status === 'offboarded' ? { offboardedAt: new Date() } : {}),
        },
      });
    }

    beforeAll(async () => {
      const passwordHash = await new PasswordService().hash(DEV_PASSWORD);
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'factory_owner' } });
      const active = await factory('E2EAUTH', 'applied', FACTORY_PUBLIC_ID);
      const gone = await factory('E2EOFF', 'offboarded');
      const user = await prisma.user.create({
        data: {
          kind: 'partner',
          status: 'active',
          email: 'owner@factory.invalid',
          displayName: 'Factory owner (fake)',
          passwordHash,
          roles: { create: { roleId: role.id, scopeType: 'factory', scopeId: active.id, reason: 'e2e' } },
        },
      });
      partnerId = user.id;
      await prisma.user.create({
        data: {
          kind: 'partner',
          status: 'active',
          email: 'former-owner@factory.invalid',
          displayName: 'Former owner (fake)',
          passwordHash,
          roles: { create: { roleId: role.id, scopeType: 'factory', scopeId: gone.id, reason: 'e2e' } },
        },
      });
      await prisma.apiClient.create({
        data: {
          clientId: 'e2e-erp',
          secretHash: await new PasswordService().hash('e2e-secret'),
          name: 'ERP (fake)',
          factoryId: active.id,
        },
      });
    });

    it('refuses partner sign-in when the factory scope cannot be resolved (offboarded factory)', async () => {
      const res = await request(server)
        .post('/v1/auth/partner/login')
        .send({ email: 'former-owner@factory.invalid', password: DEV_PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('auth.scope_unavailable');
    });

    it('signs in with password and device PIN once the factory scope resolves', async () => {
      const login = await request(server)
        .post('/v1/auth/partner/login')
        .send({ email: 'owner@factory.invalid', password: DEV_PASSWORD })
        .expect(200);
      expect(login.body.subject.scopes).toEqual([`factory:${FACTORY_PUBLIC_ID}`]);
      const token = login.body.accessToken as string;

      const me = await request(server).get('/v1/partner/me').auth(token, { type: 'bearer' }).expect(200);
      expect(me.body.factories).toEqual([{ factoryId: FACTORY_PUBLIC_ID, roles: ['factory_owner'] }]);

      await request(server)
        .post('/v1/partner/me/device-pins')
        .auth(token, { type: 'bearer' })
        .send({ deviceId: 'tablet-1', pin: '123456' })
        .expect(204);
      const pin = await request(server)
        .post('/v1/auth/partner/login')
        .send({ email: 'owner@factory.invalid', deviceId: 'tablet-1', pin: '123456' })
        .expect(200);
      expect(pin.body.subject.type).toBe('partner');
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email: 'owner@factory.invalid', deviceId: 'tablet-1', pin: '654321' })
        .expect(401);
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email: 'owner@factory.invalid' })
        .expect(422);
      expect(
        await prisma.authSession.count({ where: { userId: partnerId, loginMethod: 'device_pin' } }),
      ).toBe(1);
    });

    it('issues client-credentials tokens with the factory scope (Basic or body)', async () => {
      const basic = await request(server)
        .post('/v1/auth/token')
        .auth('e2e-erp', 'e2e-secret')
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(200);
      expect(basic.body).toMatchObject({
        token_type: 'Bearer',
        expires_in: 600,
        scope: `factory:${FACTORY_PUBLIC_ID}`,
      });
      const body = await request(server)
        .post('/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: 'e2e-erp', client_secret: 'wrong' })
        .expect(401);
      expect(body.body.code).toBe('auth.invalid_client');
      // A machine token is partner-audience: the store surface refuses it.
      await request(server)
        .get('/v1/store/me')
        .auth(basic.body.access_token as string, { type: 'bearer' })
        .expect(403);
    });
  });

  it('publishes a JWKS that verifies issued access tokens', async () => {
    const tokens = (await staffLogin('director@example.invalid').expect(200)).body as Tokens;
    const jwks = await request(server).get('/v1/auth/.well-known/jwks.json').expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' });
    expect(jwks.body.keys[0].d).toBeUndefined();
    const { payload } = await jwtVerify(tokens.accessToken, createLocalJWKSet(jwks.body), {
      audience: 'staff',
    });
    expect(payload).toMatchObject({ sub: tokens.subject.id, aud: 'staff', scp: [] });
    expect(payload.exp! - payload.iat!).toBe(600);
  });
});
