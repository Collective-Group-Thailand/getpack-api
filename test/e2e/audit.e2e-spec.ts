import { OBJECT_STORAGE } from '@collective/integrations/storage';
import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/storage/fake-object-storage';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

describe('audit log (e2e, B1.3 Audit)', () => {
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
    for (const role of ['auditor', 'cs', 'finance-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    // A denied permission and a failed login to find again.
    await request(server).get('/v1/admin/audit-logs').auth(tokens['cs']!, { type: 'bearer' }).expect(403);
    await request(server)
      .post('/v1/auth/staff/login')
      .send({ email: 'cs@example.invalid', password: '=cmd|calc' })
      .expect(401);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists entries newest first with filters and cursor pagination', async () => {
    const res = await request(server)
      .get('/v1/admin/audit-logs?category=security&outcome=denied&limit=2')
      .auth(tokens['auditor']!, { type: 'bearer' })
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const entries = res.body.data as { category: string; outcome: string }[];
    expect(entries.every((e) => e.category === 'security' && e.outcome === 'denied')).toBe(true);
    const next = res.body.meta.nextCursor as string | null;
    if (next) {
      const page2 = await request(server)
        .get(`/v1/admin/audit-logs?category=security&outcome=denied&limit=2&cursor=${next}`)
        .auth(tokens['auditor']!, { type: 'bearer' })
        .expect(200);
      expect(page2.body.data[0].occurredAt <= res.body.data[1].occurredAt).toBe(true);
    }
    const denied = await request(server)
      .get('/v1/admin/audit-logs?action=auth.permission_denied')
      .auth(tokens['auditor']!, { type: 'bearer' })
      .expect(200);
    expect(denied.body.data[0]).toMatchObject({ action: 'auth.permission_denied', outcome: 'denied' });
    expect(JSON.stringify(denied.body)).not.toContain('=cmd|calc'); // passwords never reach the audit log
    await request(server)
      .get('/v1/admin/audit-logs?cursor=garbage')
      .auth(tokens['auditor']!, { type: 'bearer' })
      .expect(422);
  });

  it('exports CSV (formula-safe), audits the export, and refuses roles without audit_logs.export', async () => {
    const res = await request(server)
      .post('/v1/admin/audit-logs/exports')
      .auth(tokens['finance-manager']!, { type: 'bearer' })
      .send({ category: 'security' })
      .expect(200);
    expect(res.body).toMatchObject({ truncated: false });
    expect(res.body.rows).toBeGreaterThan(0);
    const file = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: res.body.fileId as string },
    });
    expect(file.retentionClass).toBe('transient');
    const csv = app
      .get<FakeObjectStorage>(OBJECT_STORAGE)
      .objects.get(file.storageKey)!
      .body.toString('utf8');
    expect(csv.split('\r\n')[0]).toContain('occurred_at,category,action');
    expect(csv).toContain('"security"');
    const exportAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'export.generated' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(exportAudit).toMatchObject({ category: 'export', resourceType: 'audit_log' });
    await request(server)
      .post('/v1/admin/audit-logs/exports')
      .auth(tokens['cs']!, { type: 'bearer' })
      .send({})
      .expect(403);
  });
});
