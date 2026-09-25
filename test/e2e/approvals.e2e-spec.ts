import { randomUUID } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { PasswordService } from '@modules/auth/password.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApprovalJobs } from '@platform/approvals/approval.jobs';
import { type ApprovalRequestDto } from '@platform/approvals/approvals.dto';
import { ApprovalsService, type CreateApprovalInput } from '@platform/approvals/approvals.service';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

describe('approval engine (e2e, ADR-0006)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let approvals: ApprovalsService;
  const tokens: Record<string, string> = {};
  const actors: Record<string, UserActor> = {};
  let subjectSeq = 1_000_000n;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    approvals = app.get(ApprovalsService);
    await seedDev(prisma, E2E_DEV_PASSWORD);

    // A second Finance user, so step 1 can be approved by someone other than the requester.
    if (!(await prisma.user.findFirst({ where: { email: 'finance-two@example.invalid' } }))) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'finance' } });
      await prisma.user.create({
        data: {
          kind: 'staff',
          status: 'active',
          email: 'finance-two@example.invalid',
          displayName: 'Dev Finance two (fake)',
          passwordHash: await new PasswordService().hash(E2E_DEV_PASSWORD),
          roles: { create: { roleId: role.id, scopeType: 'platform', reason: 'e2e' } },
        },
      });
    }
    for (const name of ['finance', 'finance-two', 'finance-manager', 'director', 'cs']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${name}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[name] = res.body.accessToken as string;
      const user = await prisma.user.findFirstOrThrow({ where: { email: `${name}@example.invalid` } });
      actors[name] = {
        type: 'user',
        userId: user.id,
        publicId: user.publicId,
        audience: 'staff',
        scopes: [],
      };
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const create = (input: Partial<CreateApprovalInput> & { policyKey: string; subjectType: string }) => {
    const subjectId = subjectSeq++;
    return prisma.withTx((tx) =>
      approvals.create(tx, {
        subject: { type: input.subjectType, id: subjectId, publicId: randomUUID() },
        requester: actors['finance']!,
        payload: { note: 'e2e (fake)' },
        ...input,
      }),
    );
  };
  const act = (who: string, id: string, action: 'approve' | 'reject' | 'withdraw', body: object = {}) =>
    request(server)
      .post(`/v1/admin/approvals/${id}/actions/${action}`)
      .auth(tokens[who]!, { type: 'bearer' })
      .send(body);

  it('runs a two-step policy in order and never lets the requester approve', async () => {
    const created = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });

    const self = await act('finance', created.publicId, 'approve').expect(403);
    expect(self.body.code).toBe('approval.self_approval');
    const wrongRole = await act('finance-manager', created.publicId, 'approve').expect(403);
    expect(wrongRole.body.code).toBe('approval.not_authorised'); // step 1 belongs to Finance

    const step1 = await act('finance-two', created.publicId, 'approve', {
      comment: 'Called the factory',
    }).expect(200);
    expect(step1.body).toMatchObject({ status: 'pending', currentStepNo: 2 });
    expect((step1.body as ApprovalRequestDto).steps.map((s: { status: string }) => s.status)).toEqual([
      'approved',
      'pending',
    ]);

    const inbox = await request(server)
      .get('/v1/admin/approvals/inbox')
      .auth(tokens['finance-manager']!, { type: 'bearer' })
      .expect(200);
    expect((inbox.body as ApprovalRequestDto[]).map((r: { id: string }) => r.id)).toContain(created.publicId);
    const requesterInbox = await request(server)
      .get('/v1/admin/approvals/inbox')
      .auth(tokens['finance-two']!, { type: 'bearer' })
      .expect(200);
    expect((requesterInbox.body as ApprovalRequestDto[]).map((r: { id: string }) => r.id)).not.toContain(
      created.publicId,
    );

    const done = await act('finance-manager', created.publicId, 'approve').expect(200);
    expect(done.body).toMatchObject({ status: 'approved', currentStepNo: null });
    expect((done.body as ApprovalRequestDto).actions.map((a) => [a.action, a.stepNo])).toEqual([
      ['approve', 1],
      ['approve', 2],
    ]);
    const types = (
      await prisma.domainEvent.findMany({
        where: { aggregateId: created.publicId },
        orderBy: { recordedAt: 'asc' },
      })
    ).map((e) => e.type);
    expect(types).toEqual(['approval.requested', 'approval.step_approved', 'approval.approved']);
    expect(
      await prisma.auditLog.count({ where: { resourcePublicId: created.publicId, category: 'approval' } }),
    ).toBe(3);

    const again = await act('finance-manager', created.publicId, 'approve').expect(409);
    expect(again.body.code).toBe('approval.not_pending');
  });

  it('refuses the database-level bypass too: the maker-checker trigger rejects a self-approval row', async () => {
    const created = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });
    await expect(
      prisma.approvalAction.create({
        data: { requestId: created.id, action: 'approve', actorUserId: actors['finance']!.userId },
      }),
    ).rejects.toThrow(/requester cannot approve/);
  });

  it('lets a delegate approve on behalf of the approver, recorded as such', async () => {
    const created = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });
    await act('finance-two', created.publicId, 'approve').expect(200);
    await act('director', created.publicId, 'approve').expect(403);

    const delegation = await request(server)
      .post('/v1/admin/approval-delegations')
      .auth(tokens['finance-manager']!, { type: 'bearer' })
      .send({
        delegateId: actors['director']!.publicId,
        policy: 'vendor_bank_account_change',
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'Annual leave',
      })
      .expect(201);
    const approved = await act('director', created.publicId, 'approve').expect(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.actions[1]).toMatchObject({
      actor: { id: actors['director']!.publicId },
      onBehalfOf: { id: actors['finance-manager']!.publicId },
    });

    await request(server)
      .post(`/v1/admin/approval-delegations/${delegation.body.id}/actions/revoke`)
      .auth(tokens['finance-manager']!, { type: 'bearer' })
      .expect(200);
    const next = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });
    await act('finance-two', next.publicId, 'approve').expect(200);
    await act('director', next.publicId, 'approve').expect(403);
    await request(server)
      .post('/v1/admin/approval-delegations')
      .auth(tokens['finance-manager']!, { type: 'bearer' })
      .send({
        delegateId: actors['finance-manager']!.publicId,
        validFrom: '2026-10-01T00:00:00+07:00',
        validTo: '2026-10-08T00:00:00+07:00',
        reason: 'self',
      })
      .expect(422);
  });

  it('rejects (comment required) and withdraws (requester only)', async () => {
    const toReject = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });
    await act('finance-two', toReject.publicId, 'reject', {}).expect(422);
    const rejected = await act('finance-two', toReject.publicId, 'reject', {
      comment: 'Bank letter does not match',
    }).expect(200);
    expect(rejected.body.status).toBe('rejected');
    expect((rejected.body as ApprovalRequestDto).steps.map((s: { status: string }) => s.status)).toEqual([
      'rejected',
      'skipped',
    ]);

    const toWithdraw = await create({
      policyKey: 'vendor_bank_account_change',
      subjectType: 'vendor_bank_account',
    });
    expect(
      (await act('finance-two', toWithdraw.publicId, 'withdraw', { reason: 'not mine' }).expect(403)).body
        .code,
    ).toBe('approval.not_authorised');
    expect(
      (await act('finance', toWithdraw.publicId, 'withdraw', { reason: 'Raised by mistake' }).expect(200))
        .body.status,
    ).toBe('withdrawn');
    await request(server)
      .post(`/v1/admin/approvals/${toWithdraw.publicId}/actions/approve`)
      .auth(tokens['cs']!, { type: 'bearer' })
      .send({})
      .expect(403);
  });

  it('routes by amount and fails closed when no step matches (D-121)', async () => {
    const small = await create({
      policyKey: 'credit_limit',
      subjectType: 'company_credit_limit',
      amount: '100000.00',
    });
    const big = await create({
      policyKey: 'credit_limit',
      subjectType: 'company_credit_limit',
      amount: '100000.01',
    });
    const roles = async (id: string) =>
      (
        (
          await request(server)
            .get(`/v1/admin/approvals/${id}`)
            .auth(tokens['finance']!, { type: 'bearer' })
            .expect(200)
        ).body as ApprovalRequestDto
      ).steps.map((s: { role: string }) => s.role);
    expect(await roles(small.publicId)).toEqual(['finance']);
    expect(await roles(big.publicId)).toEqual(['c_level']);
    await expect(
      create({ policyKey: 'credit_limit', subjectType: 'company_credit_limit' }),
    ).rejects.toMatchObject({
      code: 'approval.no_matching_step',
    });
    const subject = { type: 'company_credit_limit', id: 42n, publicId: randomUUID() };
    await prisma.withTx((tx) =>
      approvals.create(tx, {
        policyKey: 'credit_limit',
        subject,
        requester: actors['finance']!,
        payload: {},
        amount: '5.00',
      }),
    );
    await expect(
      prisma.withTx((tx) =>
        approvals.create(tx, {
          policyKey: 'credit_limit',
          subject,
          requester: actors['finance']!,
          payload: {},
          amount: '5.00',
        }),
      ),
    ).rejects.toMatchObject({ code: 'approval.already_pending' });
  });

  it('expires requests with their subject (discount memo = quote validity, D-052) and reports SLA breaches once', async () => {
    const expiring = await create({
      policyKey: 'discount_memo',
      subjectType: 'discount_memo',
      pct: '8',
      expiresAt: new Date(Date.now() + 60_000),
      requester: actors['cs']!,
    });
    const jobs = app.get(ApprovalJobs);
    await expect(jobs.expireDue(new Date(Date.now() + 120_000))).resolves.toBeGreaterThanOrEqual(1);
    const expired = await approvals.get(expiring.publicId);
    expect(expired.status).toBe('expired');
    expect(
      await prisma.domainEvent.count({ where: { aggregateId: expiring.publicId, type: 'approval.expired' } }),
    ).toBe(1);
    await expect(
      create({
        policyKey: 'discount_memo',
        subjectType: 'discount_memo',
        pct: '8',
        requester: actors['cs']!,
      }),
    ).rejects.toThrow(/needs expiresAt/);

    const slow = await create({ policyKey: 'payout_run', subjectType: 'payout_run' });
    await prisma.approvalRequestStep.updateMany({
      where: { requestId: slow.id },
      data: { dueAt: new Date(Date.now() - 1_000) },
    });
    await jobs.reportSlaBreaches();
    await jobs.reportSlaBreaches();
    const breaches = await prisma.domainEvent.findMany({
      where: { aggregateId: slow.publicId, type: 'approval.sla_breached' },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.payload).toMatchObject({ stepNo: 1, approverRole: 'c_level' });
  });
});
