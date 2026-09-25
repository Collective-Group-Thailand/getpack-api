import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { type SettingDetailDto, type SettingDto } from '@platform/settings/settings.dto';
import { SettingsService } from '@platform/settings/settings.service';
import { SettingsAdminService } from '@platform/settings/settings-admin.service';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

describe('settings and feature flags (e2e, ADR-0005 / D-063)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['superadmin', 'director', 'c-level', 'finance']) {
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

  const settingId = async (key: string) =>
    (await prisma.setting.findFirstOrThrow({ where: { key, scopeType: 'platform' } })).publicId;
  const change = (who: string, id: string, body: object) =>
    request(server)
      .post(`/v1/admin/settings/${id}/versions`)
      .auth(tokens[who]!, { type: 'bearer' })
      .send(body);

  it('schedules a future value that resolves by date, keeping the current value until then', async () => {
    const id = await settingId('quotes.validity_days');
    const effectiveFrom = new Date(Date.now() + 30 * 86_400_000);
    const res = await change('superadmin', id, {
      value: 20,
      effectiveFrom: effectiveFrom.toISOString(),
      reason: 'Longer validity from next month',
    }).expect(201);
    const body = res.body as SettingDetailDto;
    expect(body.current).toMatchObject({ value: 15, versionNo: 1 }); // D-051
    expect(body.scheduled).toEqual([expect.objectContaining({ value: 20, versionNo: 2 })]);
    expect(body.versions.map((v) => v.status)).toEqual(['approved', 'approved']);

    const settings = app.get(SettingsService);
    await expect(settings.at('quotes.validity_days').then((r) => r.value)).resolves.toBe(15);
    await expect(
      settings.at('quotes.validity_days', { at: new Date(effectiveFrom.getTime() - 1) }),
    ).resolves.toMatchObject({ value: 15 });
    await expect(settings.at('quotes.validity_days', { at: effectiveFrom })).resolves.toMatchObject({
      value: 20,
      versionNo: 2,
    });

    expect(await prisma.domainEvent.count({ where: { type: 'setting.changed', aggregateId: id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'setting.changed', resourcePublicId: id },
    });
    expect(audit.data).toMatchObject({ key: 'quotes.validity_days', before: 15, after: 20 });
  });

  it('refuses back-dated versions, wrongly typed values, and changes by anyone but the owner role', async () => {
    const id = await settingId('pricing.margin_floor_pct');
    const past = await change('superadmin', id, {
      value: '11',
      effectiveFrom: '2026-01-02T00:00:00+07:00',
      reason: 'back-dated',
    }).expect(422);
    expect(past.body.code).toBe('settings.backdated');
    const typed = await change('superadmin', id, {
      value: 11,
      effectiveFrom: new Date().toISOString(),
      reason: 'number, not a decimal string',
    }).expect(422);
    expect(typed.body.errors[0]).toMatchObject({ path: 'value' });
    await change('finance', id, {
      value: '11',
      effectiveFrom: new Date().toISOString(),
      reason: 'not allowed',
    }).expect(403);
  });

  it('masks sensitive values for users without settings.read_sensitive', async () => {
    await prisma.setting.updateMany({ where: { key: 'entity.tax_id' }, data: { isSensitive: true } });
    const find = async (who: string) =>
      (
        (await request(server).get('/v1/admin/settings').auth(tokens[who]!, { type: 'bearer' }).expect(200))
          .body as SettingDto[]
      ).find((s) => s.key === 'entity.tax_id')!;
    const director = await find('director');
    expect(director).toMatchObject({ masked: true, current: { value: null }, scopeType: 'entity' });
    expect(director.scopeId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await find('c-level')).current?.value).toBe('0000000000000');
  });

  it('routes a change through approval when the setting names a policy, then applies the outcome', async () => {
    const cLevel = await prisma.role.findUniqueOrThrow({ where: { key: 'c_level' } });
    if (!(await prisma.approvalPolicy.findUnique({ where: { key: 'setting_change_test' } }))) {
      const policy = await prisma.approvalPolicy.create({
        data: {
          key: 'setting_change_test',
          subjectType: 'setting_version',
          description: 'test (fake)',
          decisionRefs: ['D-063'],
        },
      });
      const version = await prisma.approvalPolicyVersion.create({
        data: {
          policyId: policy.id,
          versionNo: 1,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          reason: 'test',
        },
      });
      await prisma.approvalStep.create({
        data: { policyVersionId: version.id, stepNo: 1, name: 'C-Level', approverRoleId: cLevel.id },
      });
      await prisma.approvalPolicyVersion.update({
        where: { id: version.id },
        data: { status: 'approved', decidedAt: new Date() },
      });
    }
    await prisma.setting.updateMany({
      where: { key: 'claims.window_days' },
      data: { approvalPolicyKey: 'setting_change_test' },
    });
    const id = await settingId('claims.window_days');

    const proposed = (
      await change('superadmin', id, {
        value: 10,
        effectiveFrom: new Date().toISOString(),
        reason: 'Longer claim window',
      }).expect(201)
    ).body as SettingDetailDto;
    expect(proposed.pending).toMatchObject({ value: 10 });
    expect(proposed.current?.value).toBe(7);
    const again = await change('superadmin', id, {
      value: 11,
      effectiveFrom: new Date().toISOString(),
      reason: 'second',
    }).expect(409);
    expect(again.body.code).toBe('settings.pending_exists');

    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: { subjectType: 'setting_version', status: 'pending' },
    });
    await request(server)
      .post(`/v1/admin/approvals/${approval.publicId}/actions/approve`)
      .auth(tokens['c-level']!, { type: 'bearer' })
      .send({})
      .expect(200);

    // The worker's `settings.apply-approval` subscriber, run here directly on the stored event.
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approval.publicId },
    });
    await prisma.withTx((tx) => app.get(SettingsAdminService).onApprovalOutcome(envelopeFromRow(event), tx));

    const after = (
      await request(server)
        .get(`/v1/admin/settings/${id}`)
        .auth(tokens['director']!, { type: 'bearer' })
        .expect(200)
    ).body as SettingDetailDto;
    expect(after).toMatchObject({ pending: null, current: { value: 10, versionNo: 2 } });
    await expect(
      app
        .get(SettingsService)
        .at('claims.window_days')
        .then((r) => r.value),
    ).resolves.toBe(10);
  });

  it('toggles feature flags and exposes them in /v1/admin/me', async () => {
    await request(server)
      .put('/v1/admin/feature-flags/carriers.deliveree')
      .auth(tokens['superadmin']!, { type: 'bearer' })
      .send({ enabled: true, description: 'Deliveree adapter (fake)', rules: { audiences: ['staff'] } })
      .expect(200);
    const me = await request(server)
      .get('/v1/admin/me')
      .auth(tokens['director']!, { type: 'bearer' })
      .expect(200);
    expect(me.body.featureFlags).toContain('carriers.deliveree');
    await request(server)
      .put('/v1/admin/feature-flags/carriers.deliveree')
      .auth(tokens['director']!, { type: 'bearer' })
      .send({ enabled: false })
      .expect(403);
    await request(server)
      .put('/v1/admin/feature-flags/Bad Key')
      .auth(tokens['superadmin']!, { type: 'bearer' })
      .send({ enabled: false })
      .expect(422);
    expect(await prisma.auditLog.count({ where: { action: 'feature_flag.changed' } })).toBeGreaterThanOrEqual(
      1,
    );
  });
});
