import { PrismaService } from '@database/prisma.service';
import { BankAccountsService } from '@modules/partners/bank-accounts/bank-accounts.service';
import { FactoriesService } from '@modules/partners/factories/factories.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Tax ids with a valid check digit, unique per run (13 digits starting with 0000 — fake, PDPA). */
function taxId(seed: number): string {
  const body = `0000${String(seed).padStart(8, '0')}`;
  const digits = [...body].map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

/** Partner onboarding (B2.2, D-011, D-041, D-171) and bank-account changes (accounting-design.md §8). */
describe('partner onboarding (e2e, B2.2)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = Date.now() % 1_000_000;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['superadmin', 'partner-manager', 'finance', 'finance-manager', 'cs']) {
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

  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).auth(token, { type: 'bearer' }),
    post: (url: string, body: object, etag?: string) => {
      const req = request(server).post(url).auth(token, { type: 'bearer' });
      return (etag ? req.set('If-Match', etag) : req).send(body);
    },
    patch: (url: string, body: object, etag: string) =>
      request(server).patch(url).auth(token, { type: 'bearer' }).set('If-Match', etag).send(body),
  });
  const pm = () => as(tokens['partner-manager']!);

  async function register(mode: 'assisted' | 'self_service' = 'self_service') {
    const res = await pm()
      .post('/v1/admin/factories', {
        legalName: `บริษัท โรงพิมพ์ทดสอบ ${run}-${++seq} จำกัด`,
        juristicType: 'company',
        taxId: taxId(run * 10 + seq),
        isVatRegistered: true,
        onboardingMode: mode,
      })
      .expect(201);
    return {
      id: res.body.id as string,
      etag: res.headers['etag'] as string,
      body: res.body as { code: string; status: string },
    };
  }

  async function owner(factoryId: string) {
    const email = `owner-${run}-${++seq}@factory.example`;
    await pm()
      .post(`/v1/admin/factories/${factoryId}/owner-account`, {
        email,
        displayName: 'เจ้าของ ทดสอบ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    const login = await request(server)
      .post('/v1/auth/partner/login')
      .send({ email, password: E2E_DEV_PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  const outcome = async (service: 'factories' | 'bank', approvalId: string, type = 'approval.approved') => {
    const event = await prisma.domainEvent.findFirstOrThrow({ where: { type, aggregateId: approvalId } });
    await prisma.withTx((tx) =>
      service === 'factories'
        ? app.get(FactoriesService).onActivationOutcome(envelopeFromRow(event), tx)
        : app.get(BankAccountsService).onApprovalOutcome(envelopeFromRow(event), tx),
    );
  };

  it('registers a factory with its vendor, calendar and 13 onboarding steps (D-171)', async () => {
    const bad = await pm()
      .post('/v1/admin/factories', {
        legalName: 'x',
        juristicType: 'company',
        taxId: '0000000000018',
        isVatRegistered: false,
        onboardingMode: 'assisted',
      })
      .expect(422);
    expect(bad.body.errors).toEqual([expect.objectContaining({ path: 'taxId', code: 'thaiTaxId' })]);

    const factory = await register('assisted');
    expect(factory.body).toMatchObject({ status: 'applied', onboarding: { done: 0, total: 13 } });
    expect(factory.body.code).toMatch(/^F\d{4,}$/);
    const row = await prisma.factory.findUniqueOrThrow({
      where: { publicId: factory.id },
      include: { vendor: true, calendar: true, onboardingSteps: true },
    });
    expect(row.vendor).toMatchObject({ kind: 'factory', taxId: row.taxId });
    expect(row.calendar).toMatchObject({ kind: 'factory', factoryId: row.id });
    expect(row.onboardingSteps.every((s) => s.enteredByStaff)).toBe(true);

    await as(tokens['cs']!).get('/v1/admin/factories').expect(403);
  });

  it('lets the owner sign in, see only its factory and submit the application', async () => {
    const mine = await register();
    const other = await register();
    const ownerToken = await owner(mine.id);
    const partner = as(ownerToken);

    const list = await partner.get('/v1/partner/factories').expect(200);
    expect((list.body.data as { id: string }[]).map((f) => f.id)).toEqual([mine.id]);
    await partner.get(`/v1/partner/factories/${other.id}`).expect(404);
    await partner.get(`/v1/partner/factories/${other.id}/contacts`).expect(404);
    // A staff token is refused on the partner surface and vice versa.
    await as(tokens['partner-manager']!).get('/v1/partner/factories').expect(403);
    await partner.get('/v1/admin/factories').expect(403);

    const got = await partner.get(`/v1/partner/factories/${mine.id}`).expect(200);
    const edited = await partner
      .patch(
        `/v1/partner/factories/${mine.id}`,
        { tradeName: 'โรงพิมพ์ของฉัน' },
        got.headers['etag'] as string,
      )
      .expect(200);
    await partner
      .post(`/v1/partner/factories/${mine.id}/contacts`, {
        name: 'ผู้ติดต่อ ทดสอบ',
        phone: '+66810001234',
        isPrimary: true,
      })
      .expect(201);
    const submitted = await partner
      .post(
        `/v1/partner/factories/${mine.id}/actions/submit-application`,
        { reason: 'Complete' },
        edited.headers['etag'] as string,
      )
      .expect(200);
    expect(submitted.body.status).toBe('under_review');

    // Once the trial starts the factory can no longer edit its legal data.
    const trial = await pm()
      .post(
        `/v1/admin/factories/${mine.id}/actions/start-trial`,
        { reason: 'Documents complete' },
        submitted.headers['etag'] as string,
      )
      .expect(200);
    const locked = await partner
      .patch(`/v1/partner/factories/${mine.id}`, { tradeName: 'x' }, trial.headers['etag'] as string)
      .expect(409);
    expect(locked.body.code).toBe('partners.profile_locked');
  });

  it('activates only after a passed site visit and the partner_activation approval (D-041)', async () => {
    const factory = await register();
    let etag = factory.etag;
    for (const action of ['start-review', 'start-trial']) {
      const res = await pm()
        .post(`/v1/admin/factories/${factory.id}/actions/${action}`, { reason: 'ok' }, etag)
        .expect(200);
      etag = res.headers['etag'] as string;
    }
    const direct = await pm()
      .post(`/v1/admin/factories/${factory.id}/actions/reinstate`, { reason: 'x' }, etag)
      .expect(409);
    expect(direct.body.code).toBe('partners.activation_needs_approval');

    const early = await pm()
      .post(`/v1/admin/factories/${factory.id}/activation-requests`, { reason: 'Trial done' })
      .expect(422);
    expect(early.body.code).toBe('partners.site_visit_required');

    const row = await prisma.factory.findUniqueOrThrow({ where: { publicId: factory.id } });
    const inspector = await prisma.user.findFirstOrThrow({
      where: { email: 'partner-manager@example.invalid' },
    });
    await prisma.siteVisit.create({
      data: {
        factoryId: row.id,
        visitedOn: new Date(),
        checklistVersion: 'v1',
        checklist: {},
        result: 'pass',
        recordedById: inspector.id,
      },
    });
    // The superadmin requests; the Partner Manager approves (maker-checker).
    const requested = await as(tokens['superadmin']!)
      .post(`/v1/admin/factories/${factory.id}/activation-requests`, { reason: 'Trial done' })
      .expect(201);
    await pm()
      .post(`/v1/admin/approvals/${requested.body.approvalRequestId}/actions/approve`, {
        comment: 'Site visit passed',
      })
      .expect(200);
    await outcome('factories', requested.body.approvalRequestId as string);

    const active = await pm().get(`/v1/admin/factories/${factory.id}`).expect(200);
    expect(active.body.status).toBe('active');
    expect(active.body.activatedAt).not.toBeNull();
    const history = await prisma.factoryStatusHistory.findMany({
      where: { factoryId: row.id },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['applied', 'under_review', 'trial', 'active']);
  });

  it('activates a bank account only after dual approval and a confirmed verification call (§8)', async () => {
    const factory = await register();
    const ownerToken = await owner(factory.id);
    const proposed = await as(ownerToken)
      .post(`/v1/partner/factories/${factory.id}/bank-accounts`, {
        bankCode: '014',
        accountName: 'บริษัท โรงพิมพ์ทดสอบ จำกัด',
        accountNo: `000-0-${String(run).padStart(5, '0')}-9`,
      })
      .expect(201);
    expect(proposed.body).toMatchObject({
      status: 'pending_approval',
      accountNoLast4: `${String(run).padStart(5, '0').slice(-3)}9`,
    });
    expect(JSON.stringify(proposed.body)).not.toContain(String(run).padStart(5, '0') + '-9');
    expect(proposed.body.verification).toBeNull();

    await as(ownerToken)
      .post(`/v1/partner/factories/${factory.id}/bank-accounts`, {
        bankCode: '014',
        accountName: 'x',
        accountNo: '0000000019',
      })
      .expect(409);

    const approvalId = proposed.body.approvalRequestId as string;
    await as(tokens['finance']!)
      .post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'Called back' })
      .expect(200);
    await as(tokens['finance-manager']!)
      .post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'OK' })
      .expect(200);
    await outcome('bank', approvalId);
    const pending = await as(tokens['finance']!)
      .get(`/v1/admin/factories/${factory.id}/bank-accounts`)
      .expect(200);
    expect(pending.body[0].status).toBe('pending_approval'); // no verification call yet

    const verified = await as(tokens['finance']!)
      .post(`/v1/admin/vendor-bank-accounts/${proposed.body.id}/verification-calls`, {
        outcome: 'confirmed',
        calledAt: new Date().toISOString(),
        calledNumber: '081-000-1234',
      })
      .expect(200);
    expect(verified.body).toMatchObject({
      status: 'active',
      verification: { outcome: 'confirmed', calledNumberMasked: '08x-xxx-1234' },
    });

    const partnerView = await as(ownerToken)
      .get(`/v1/partner/factories/${factory.id}/bank-accounts`)
      .expect(200);
    expect(partnerView.body[0]).toMatchObject({ status: 'active', verification: null });
    const step = await prisma.factoryOnboardingStep.findFirstOrThrow({
      where: { factory: { publicId: factory.id }, step: 'bank_account' },
    });
    expect(step.status).toBe('approved');
    const audit = await prisma.auditLog.findMany({ where: { resourcePublicId: proposed.body.id as string } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.map((a) => a.data))).not.toContain(`${String(run).padStart(5, '0')}9`);
  });
});
