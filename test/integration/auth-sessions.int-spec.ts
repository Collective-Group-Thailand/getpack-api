import { FakeSmsSender } from '@collective/integrations/sms';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { OtpService } from '@modules/auth/login/otp.service';
import { SessionService } from '@modules/auth/sessions/session.service';
import { AuditService } from '@platform/audit/audit.service';
import { SettingsService } from '@platform/settings/settings.service';
import { Redis } from 'ioredis';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

describe('sessions, OTP and settings resolution (PostgreSQL 18 + Redis)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let redis: Redis;
  let settings: SettingsService;
  let sessions: SessionService;
  let userId: bigint;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    redis = new Redis(infra.env.REDIS_URL!);
    await seedDev(prisma);
    settings = new SettingsService(prisma);
    sessions = new SessionService(prisma, settings, new AuditService(prisma), redis);
    userId = (await prisma.user.findFirstOrThrow({ where: { email: 'finance@example.invalid' } })).id;
  });

  afterAll(async () => {
    redis?.disconnect();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  const login = () =>
    prisma.withTx((tx) => sessions.create(tx, { userId, audience: 'staff', loginMethod: 'password' }));

  it('applies the staff lifetimes from auth.refresh_token_lifetimes (12 h absolute, 2 h idle)', async () => {
    const issued = await login();
    const row = await prisma.authSession.findUniqueOrThrow({ where: { id: issued.sessionId } });
    expect(Math.round((row.expiresAt.getTime() - row.issuedAt.getTime()) / 3_600_000)).toBe(12);
    expect(Math.round((row.idleExpiresAt.getTime() - row.issuedAt.getTime()) / 3_600_000)).toBe(2);
    expect(Buffer.from(row.refreshTokenHash).toString('hex')).not.toContain(
      Buffer.from(issued.refreshToken).toString('hex'),
    );
  });

  it('lets exactly one of many concurrent rotations win and revokes the family for the rest', async () => {
    const issued = await login();
    const results = await Promise.all(Array.from({ length: 10 }, () => sessions.rotate(issued.refreshToken)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'reused')).toBe(true);
    const open = await prisma.authSession.count({ where: { familyId: issued.familyId, revokedAt: null } });
    expect(open).toBe(0);
    await expect(sessions.isRevoked(issued.familyId)).resolves.toBe(true);
  });

  it('refuses expired sessions and sessions of suspended users', async () => {
    const issued = await login();
    await prisma.$executeRaw`UPDATE auth_sessions SET idle_expires_at = issued_at + interval '1 second' WHERE id = ${issued.sessionId}`;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(sessions.rotate(issued.refreshToken)).resolves.toEqual({ ok: false, reason: 'expired' });
    await expect(sessions.rotate('never-issued')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('spends OTP attempts atomically and never accepts a code twice', async () => {
    const sms = new FakeSmsSender();
    const otp = new OtpService(
      { get: () => undefined } as unknown as AppConfig,
      prisma,
      settings,
      redis,
      sms,
    );
    const { challengeId } = await otp.request('+66810009999', 'login', '198.51.100.7');
    const code = /\d{6}/.exec(sms.sent[0]!.text)![0];
    const wrong = code === '000000' ? '111111' : '000000';

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => otp.verify(challengeId, wrong, 'login')),
    );
    const codes = attempts.map((a) => (a.status === 'rejected' ? (a.reason as { code: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'auth.otp_invalid')).toHaveLength(5); // maxAttempts from auth.otp_policy
    expect(codes.filter((c) => c === 'auth.otp_expired')).toHaveLength(3);
    await expect(otp.verify(challengeId, code, 'login')).rejects.toMatchObject({ code: 'auth.otp_expired' });

    const second = await otp.request('+66810008888', 'login', '198.51.100.7');
    const secondCode = /\d{6}/.exec(sms.sent[1]!.text)![0];
    await expect(otp.verify(second.challengeId, secondCode, 'link_phone')).rejects.toMatchObject({
      code: 'auth.otp_expired',
    });
    await expect(otp.verify(second.challengeId, secondCode, 'login')).resolves.toBe('+66810008888');
    await expect(otp.verify(second.challengeId, secondCode, 'login')).rejects.toMatchObject({
      code: 'auth.otp_expired',
    });
    const stored = await prisma.otpChallenge.findFirstOrThrow({ where: { publicId: second.challengeId } });
    expect(Buffer.from(stored.codeHash).toString('utf8')).not.toContain(secondCode);
  });

  it('resolves settings by effective date: before, exactly at and after a future version (ADR-0005)', async () => {
    const setting = await prisma.setting.findFirstOrThrow({ where: { key: 'pricing.margin_floor_pct' } });
    const future = new Date('2027-01-01T00:00:00+07:00');
    await prisma.settingVersion.create({
      data: {
        settingId: setting.id,
        versionNo: 2,
        effectiveFrom: future,
        status: 'approved',
        value: '12',
        reason: 'test',
        decidedAt: new Date(),
      },
    });
    await prisma.settingVersion.create({
      data: {
        settingId: setting.id,
        versionNo: 3,
        effectiveFrom: future,
        status: 'proposed',
        value: '99',
        reason: 'not approved',
      },
    });
    settings.invalidate();
    const before = await settings.at('pricing.margin_floor_pct', { at: new Date(future.getTime() - 1) });
    const exactly = await settings.at('pricing.margin_floor_pct', { at: future });
    expect(before.value).toBe('10');
    expect(before.versionNo).toBe(1);
    expect(exactly).toMatchObject({ value: '12', versionNo: 2 });
    await expect(settings.value('pricing.margin_floor_pct')).resolves.toBe('10');
    await expect(
      settings.at('pricing.margin_floor_pct', { at: new Date('2020-01-01T00:00:00Z') }),
    ).rejects.toThrow('no approved version');
    await expect(settings.at('no.such_key')).rejects.toThrow('no approved version');
  });
});
