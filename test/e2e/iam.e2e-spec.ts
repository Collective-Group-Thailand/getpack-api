import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

describe('IAM, permissions and SoD (e2e, D-140 / D-168)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};

  /** Tokens are fetched up front: an `await` inside a supertest chain races its ephemeral listener. */
  const token = (role: string): string => {
    const value = tokens[role];
    if (!value) throw new Error(`no token for ${role}`);
    return value;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['superadmin', 'admin', 'cs', 'finance']) {
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

  const createStaff = async (email: string) =>
    (
      await request(server)
        .post('/v1/admin/users')
        .auth(token('superadmin'), { type: 'bearer' })
        .send({
          kind: 'staff',
          email,
          displayName: 'พนักงาน ทดสอบ',
          initialPassword: 'temporary-passphrase-1',
        })
        .expect(201)
    ).body as { id: string };

  it('refuses a permission the role does not hold, and audits the denial', async () => {
    const res = await request(server)
      .get('/v1/admin/users')
      .auth(token('cs'), { type: 'bearer' })
      .expect(403);
    expect(res.body.code).toBe('auth.forbidden');
    const denied = await prisma.auditLog.findFirst({
      where: { action: 'auth.permission_denied' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(denied?.data).toMatchObject({ missing: ['users.read'] });
    await request(server)
      .get('/v1/admin/users?kind=staff&perPage=5')
      .auth(token('admin'), { type: 'bearer' })
      .expect(200);
  });

  it('creates an account, grants a role, and the new user sees it in /v1/admin/me', async () => {
    const created = await createStaff('new.finance@example.invalid');
    const granted = await request(server)
      .post(`/v1/admin/users/${created.id}/roles`)
      .auth(token('superadmin'), { type: 'bearer' })
      .send({ role: 'finance', reason: 'Joined the finance team' })
      .expect(201);
    expect(granted.body.roles).toEqual([
      expect.objectContaining({ role: 'finance', scopeType: 'platform', scopeId: null }),
    ]);

    const login = await request(server)
      .post('/v1/auth/staff/login')
      .send({ email: 'new.finance@example.invalid', password: 'temporary-passphrase-1' })
      .expect(200);
    expect(login.body.subject.roles).toEqual(['finance']);
    expect(
      await prisma.domainEvent.count({ where: { type: 'iam.role_granted', aggregateId: created.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'iam.role_granted', resourcePublicId: created.id } }),
    ).toBe(1);

    await request(server)
      .post('/v1/admin/users')
      .auth(token('superadmin'), { type: 'bearer' })
      .send({
        kind: 'staff',
        email: 'new.finance@example.invalid',
        displayName: 'dup',
        initialPassword: 'temporary-passphrase-1',
      })
      .expect(409);
  });

  it('blocks self-grants, privilege escalation, scope mismatches and SoD role pairs (D-168)', async () => {
    const admin = token('admin');
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: 'admin@example.invalid' } });
    const self = await request(server)
      .post(`/v1/admin/users/${adminUser.publicId}/roles`)
      .auth(admin, { type: 'bearer' })
      .send({ role: 'cs', reason: 'self' })
      .expect(403);
    expect(self.body.code).toBe('iam.self_grant');

    const target = await createStaff('escalation.target@example.invalid');
    // Admin holds roles.assign but not factory_cost.read, so it cannot grant Finance.
    const escalation = await request(server)
      .post(`/v1/admin/users/${target.id}/roles`)
      .auth(admin, { type: 'bearer' })
      .send({ role: 'finance', reason: 'escalation attempt' })
      .expect(403);
    expect(escalation.body.code).toBe('iam.role_escalation');

    const mismatch = await request(server)
      .post(`/v1/admin/users/${target.id}/roles`)
      .auth(token('superadmin'), { type: 'bearer' })
      .send({ role: 'factory_owner', reason: 'wrong audience' })
      .expect(422);
    expect(mismatch.body.code).toBe('iam.role_scope_mismatch');

    const superadmin = token('superadmin');
    await request(server)
      .post(`/v1/admin/users/${target.id}/roles`)
      .auth(superadmin, { type: 'bearer' })
      .send({ role: 'finance', reason: 'team' })
      .expect(201);
    const sod = await request(server)
      .post(`/v1/admin/users/${target.id}/roles`)
      .auth(superadmin, { type: 'bearer' })
      .send({ role: 'auditor', validTo: '2027-01-31T23:59:59+07:00', reason: 'year-end audit' })
      .expect(409);
    expect(sod.body.code).toBe('iam.sod_conflict');
    expect(await prisma.auditLog.count({ where: { action: 'sod.blocked' } })).toBeGreaterThanOrEqual(1);
  });

  it('revokes a role and deactivates an account, ending its sessions at once', async () => {
    const created = await createStaff('leaver@example.invalid');
    const superadmin = token('superadmin');
    const granted = await request(server)
      .post(`/v1/admin/users/${created.id}/roles`)
      .auth(superadmin, { type: 'bearer' })
      .send({ role: 'cs', reason: 'team' })
      .expect(201);
    const leaver = (
      await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: 'leaver@example.invalid', password: 'temporary-passphrase-1' })
        .expect(200)
    ).body;

    const revoked = await request(server)
      .post(`/v1/admin/users/${created.id}/roles/${granted.body.roles[0].id}/actions/revoke`)
      .auth(superadmin, { type: 'bearer' })
      .send({ reason: 'moved team' })
      .expect(200);
    expect(revoked.body.roles).toEqual([]);

    await request(server)
      .post(`/v1/admin/users/${created.id}/actions/deactivate`)
      .auth(superadmin, { type: 'bearer' })
      .send({ reason: 'Left the company' })
      .expect(200);
    const after = await request(server)
      .get('/v1/admin/me')
      .auth(leaver.accessToken as string, { type: 'bearer' })
      .expect(401);
    expect(after.body.code).toBe('auth.session_revoked');
    const relogin = await request(server)
      .post('/v1/auth/staff/login')
      .send({ email: 'leaver@example.invalid', password: 'temporary-passphrase-1' })
      .expect(403);
    expect(relogin.body.code).toBe('auth.account_inactive');
  });

  it('lists the role catalogue', async () => {
    const res = await request(server)
      .get('/v1/admin/roles')
      .auth(token('admin'), { type: 'bearer' })
      .expect(200);
    const finance = (res.body as { key: string; permissions: string[] }[]).find((r) => r.key === 'finance');
    expect(finance?.permissions).toContain('factory_cost.read');
  });

  it('lists dead-lettered events and replays them once (audited)', async () => {
    const event = await prisma.domainEvent.findFirstOrThrow({ where: { type: 'iam.role_granted' } });
    await prisma.outboxMessage.updateMany({
      where: { eventId: event.id },
      data: { status: 'dead', lastError: 'x: boom' },
    });
    const superadmin = token('superadmin');
    const list = await request(server)
      .get('/v1/admin/outbox?status=dead')
      .auth(superadmin, { type: 'bearer' })
      .expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventId: event.id, status: 'dead' })]),
    );

    const replayed = await request(server)
      .post(`/v1/admin/outbox/${event.id}/actions/replay`)
      .auth(superadmin, { type: 'bearer' })
      .expect(200);
    expect(replayed.body).toMatchObject({ status: 'pending', lastError: null });
    const again = await request(server)
      .post(`/v1/admin/outbox/${event.id}/actions/replay`)
      .auth(superadmin, { type: 'bearer' })
      .expect(409);
    expect(again.body.code).toBe('outbox.not_replayable');
    await request(server)
      .post(`/v1/admin/outbox/${event.id}/actions/replay`)
      .auth(token('finance'), { type: 'bearer' })
      .expect(403);
  });
});
