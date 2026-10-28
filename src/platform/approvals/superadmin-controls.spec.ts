import { type UserActor } from '@common/context/actor';
import { Prisma } from '@generated/prisma/client';

import {
  OWNER_APPROVAL_THRESHOLD_C1D,
  OWNER_CREDIT_LIMIT_THRESHOLD_C1F,
  thresholdAmendmentOf,
  type VersionFacts,
} from '../../../prisma/seed/data/approval-policies';
import { ApprovalsService } from './approvals.service';
import {
  belowThreshold,
  conditionUsesAmount,
  soloOwnerModeOn,
  soloOwnerValueProblem,
  TYPED_REASON_MIN_LENGTH,
} from './solo-owner';

/** C1d (owner decisions 2026-10-28, D-449): solo-owner mode (A) and the approval threshold (B). Fake data only. */
const NOW = new Date('2026-10-28T04:00:00Z');
const DAY = 86_400_000;

describe('solo-owner mode rules (D-449 A)', () => {
  it('is on only while enabled and before its expiry', () => {
    expect(soloOwnerModeOn(null, NOW)).toBe(false);
    expect(soloOwnerModeOn({ enabled: false, expiresAt: '2027-01-01T00:00:00Z' }, NOW)).toBe(false);
    expect(soloOwnerModeOn({ enabled: true, expiresAt: null }, NOW)).toBe(false);
    expect(soloOwnerModeOn({ enabled: true, expiresAt: '2026-10-28T03:59:59Z' }, NOW)).toBe(false);
    expect(soloOwnerModeOn({ enabled: true, expiresAt: '2026-10-28T04:00:01Z' }, NOW)).toBe(true);
  });

  it('accepts an expiry up to the configured days (90) and refuses beyond or in the past', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(soloOwnerValueProblem({ enabled: true, expiresAt: at(90 * DAY) }, 90, NOW)).toBeNull();
    expect(soloOwnerValueProblem({ enabled: true, expiresAt: at(90 * DAY + 1000) }, 90, NOW)).toMatch(
      /90 days/,
    );
    expect(soloOwnerValueProblem({ enabled: true, expiresAt: at(-1000) }, 90, NOW)).toMatch(/after now/);
    expect(soloOwnerValueProblem({ enabled: true, expiresAt: null }, 90, NOW)).toMatch(/ISO/);
    expect(soloOwnerValueProblem({ enabled: false, expiresAt: null }, 90, NOW)).toBeNull();
    expect(soloOwnerValueProblem('on', 90, NOW)).not.toBeNull();
  });
});

describe('approval threshold rules (D-449 B)', () => {
  it('compares the amount with the version amount (at or below = auto-approve)', () => {
    const max = new Prisma.Decimal('500000.00');
    expect(belowThreshold('500000.00', max)).toBe(true);
    expect(belowThreshold('499999.99', max)).toBe(true);
    expect(belowThreshold('500000.01', max)).toBe(false);
    expect(belowThreshold(undefined, max)).toBe(false);
    expect(belowThreshold('100.00', null)).toBe(false);
    expect(belowThreshold('-1.00', max)).toBe(false);
  });

  it('recognises an amount condition anywhere in a step condition', () => {
    expect(conditionUsesAmount({ field: 'amount', op: 'lte', value: '100000.00' })).toBe(true);
    expect(conditionUsesAmount({ all: [{ field: 'pct', op: 'gt', value: '5' }] })).toBe(false);
    expect(
      conditionUsesAmount({
        any: [
          { field: 'flags', op: 'includes', value: 'x' },
          { field: 'amount', op: 'gt', ref: 'r' },
        ],
      }),
    ).toBe(true);
    expect(conditionUsesAmount(null)).toBe(false);
  });
});

// --- engine ---------------------------------------------------------------------------------------------------------

const SUPERADMIN: UserActor = { type: 'user', userId: 1n, publicId: 'sa-1', audience: 'staff', scopes: [] };
const FINANCE: UserActor = { type: 'user', userId: 2n, publicId: 'fi-1', audience: 'staff', scopes: [] };
const ROLE_IDS = { superadmin: 10n, finance: 11n, finance_manager: 12n, company_approver: 13n };

function engine(opts: {
  roles: Record<string, string[]>;
  soloOn?: boolean;
  otherApprover?: boolean;
  request?: Partial<Record<string, unknown>>;
  stepRole?: bigint;
  stepAudience?: string;
  versionMax?: string | null;
}) {
  const audit = { record: jest.fn() };
  const events = { record: jest.fn() };
  const actions: Record<string, unknown>[] = [];
  const request = {
    id: 100n,
    publicId: 'req-1',
    entityId: 1n,
    policyId: 5n,
    policyVersionId: 6n,
    subjectType: 'refund',
    subjectId: 7n,
    subjectPublicId: 'sub-1',
    requesterUserId: SUPERADMIN.userId,
    status: 'pending',
    currentStepNo: 1,
    expiresAt: null,
    amount: new Prisma.Decimal('1000.00'),
    ...opts.request,
  };
  const step = {
    id: 200n,
    requestId: 100n,
    stepNo: 1,
    approverRoleId: opts.stepRole ?? ROLE_IDS.finance_manager,
    approverScopeId: null,
    quorum: 1,
  };
  const created: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 100n }]),
    approvalRequest: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(request),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...request, ...data }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 101n,
          publicId: 'req-new',
          ...data,
          amount: new Prisma.Decimal(String(data['amount'])),
        };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    approvalRequestStep: {
      findFirstOrThrow: jest.fn().mockResolvedValue(step),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push({ step: data });
        return Promise.resolve(data);
      }),
    },
    approvalAction: {
      count: jest.fn(({ where }: { where: { actorUserId?: bigint } }) =>
        Promise.resolve(where.actorUserId !== undefined ? 0 : actions.length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        actions.push(data);
        return Promise.resolve(data);
      }),
    },
    approvalPolicy: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ key: 'refund' }),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 5n, key: 'credit_limit', subjectType: 'company_credit_limit' }),
    },
    approvalPolicyVersion: {
      findFirst: jest.fn().mockResolvedValue({
        id: 6n,
        versionNo: 2,
        expiryRule: null,
        autoApproveMaxAmount:
          opts.versionMax === undefined || opts.versionMax === null
            ? null
            : new Prisma.Decimal(opts.versionMax),
        steps: [
          {
            stepNo: 1,
            approverRoleId: ROLE_IDS.finance,
            approverScope: 'platform',
            condition: { field: 'amount', op: 'lte', value: '100000.00' },
            quorum: 1,
            slaMinutes: null,
            slaCalendar: 'business',
          },
          {
            stepNo: 2,
            approverRoleId: ROLE_IDS.superadmin,
            approverScope: 'platform',
            condition: { field: 'amount', op: 'gt', value: '100000.00' },
            quorum: 1,
            slaMinutes: null,
            slaCalendar: 'business',
          },
        ],
      }),
    },
    entity: { findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'GP' }) },
    role: { findUnique: jest.fn().mockResolvedValue({ audience: opts.stepAudience ?? 'staff' }) },
  };
  const prisma = {
    withTx: (fn: (t: typeof tx) => unknown) => fn(tx),
    role: {
      findMany: jest.fn().mockResolvedValue(Object.entries(ROLE_IDS).map(([key, id]) => ({ key, id }))),
    },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    approvalRequest: { findUnique: jest.fn().mockResolvedValue({ ...request, actions }) },
  };
  const permissions = {
    forUser: jest.fn((userId: bigint) =>
      Promise.resolve({
        roles: (opts.roles[userId.toString()] ?? []).map((key) => ({ key, scopeId: null })),
      }),
    ),
  };
  const soloOwner = {
    isOn: jest.fn().mockResolvedValue(opts.soloOn ?? false),
    otherApproverExists: jest.fn().mockResolvedValue(opts.otherApprover ?? false),
  };
  const service = new ApprovalsService(
    prisma as never,
    permissions as never,
    { checkAction: jest.fn() } as never,
    audit as never,
    events as never,
    { defaultEntityId: jest.fn().mockResolvedValue(1n) } as never,
    { calendar: jest.fn() } as never,
    soloOwner as never,
  );
  return { service, actions, audit, events, created, soloOwner, tx };
}

const auditActions = (audit: { record: jest.Mock }) =>
  audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
const eventTypes = (events: { record: jest.Mock }) =>
  events.record.mock.calls.map((c) => (c[1] as { type: string }).type);

describe('self-approval under solo-owner mode (D-449 A)', () => {
  const REASON = 'ยังไม่มีผู้อนุมัติคนอื่น (fake)';

  it('lets a Superadmin approve their own request with a reason: flagged, audited, evented', async () => {
    const { service, actions, audit, events } = engine({ roles: { '1': ['superadmin'] }, soloOn: true });
    await service.approve(SUPERADMIN, 'req-1', undefined, REASON);
    expect(actions[0]).toMatchObject({ action: 'approve', selfApproved: true, selfApprovalReason: REASON });
    expect(auditActions(audit)).toEqual(['approval.self_approved', 'approval.approved']);
    expect(eventTypes(events)).toEqual(['approval.self_approved', 'approval.approved']);
  });

  it('refuses without a reason, with a short reason, when off, or when another approver exists', async () => {
    await expect(
      engine({ roles: { '1': ['superadmin'] }, soloOn: true }).service.approve(SUPERADMIN, 'req-1'),
    ).rejects.toMatchObject({ code: 'approval.self_approval' });
    await expect(
      engine({ roles: { '1': ['superadmin'] }, soloOn: true }).service.approve(
        SUPERADMIN,
        'req-1',
        undefined,
        'x'.repeat(TYPED_REASON_MIN_LENGTH - 1),
      ),
    ).rejects.toMatchObject({ code: 'validation.failed' });
    await expect(
      engine({ roles: { '1': ['superadmin'] }, soloOn: false }).service.approve(
        SUPERADMIN,
        'req-1',
        undefined,
        REASON,
      ),
    ).rejects.toMatchObject({ code: 'approval.solo_owner_mode_off' });
    await expect(
      engine({ roles: { '1': ['superadmin'] }, soloOn: true, otherApprover: true }).service.approve(
        SUPERADMIN,
        'req-1',
        undefined,
        REASON,
      ),
    ).rejects.toMatchObject({ code: 'approval.other_approver_exists' });
  });

  it('never lets anyone else approve their own request, even under solo-owner mode', async () => {
    const { service, actions } = engine({
      roles: { '2': ['finance_manager'] },
      soloOn: true,
      request: { requesterUserId: FINANCE.userId },
    });
    await expect(service.approve(FINANCE, 'req-1', undefined, REASON)).rejects.toMatchObject({
      code: 'approval.self_approval',
    });
    expect(actions).toHaveLength(0);
  });

  it('lets a Superadmin decide a step of any staff role, but not a customer company step', async () => {
    const staffStep = engine({ roles: { '1': ['superadmin'] }, request: { requesterUserId: 2n } });
    await staffStep.service.approve(SUPERADMIN, 'req-1');
    expect(staffStep.actions[0]).toMatchObject({ selfApproved: false, selfApprovalReason: null });

    const companyStep = engine({
      roles: { '1': ['superadmin'] },
      request: { requesterUserId: 2n },
      stepRole: ROLE_IDS.company_approver,
      stepAudience: 'customer',
    });
    await expect(companyStep.service.approve(SUPERADMIN, 'req-1')).rejects.toMatchObject({
      code: 'approval.not_authorised',
    });
  });

  it('lets a Superadmin decide every step of their own multi-step request, each with its own reason (C1f, D-451)', async () => {
    const h = engine({ roles: { '1': ['superadmin'] }, soloOn: true, request: { currentStepNo: 2 } });
    // Step 1 was already self-approved by the same Superadmin; step 2 is pending.
    h.actions.push({
      requestId: 100n,
      requestStepId: 199n,
      action: 'approve',
      actorUserId: 1n,
      selfApproved: true,
    });
    const step2 = {
      id: 200n,
      requestId: 100n,
      stepNo: 2,
      approverRoleId: ROLE_IDS.finance_manager,
      approverScopeId: null,
      quorum: 1,
    };
    h.tx.approvalRequestStep.findFirstOrThrow.mockResolvedValue(step2);
    h.tx.approvalAction.count.mockImplementation(
      ({ where }: { where: { requestId?: bigint; requestStepId?: bigint; actorUserId?: bigint } }) =>
        Promise.resolve(
          h.actions.filter(
            (a) =>
              (where.requestId === undefined || a['requestId'] === where.requestId) &&
              (where.requestStepId === undefined || a['requestStepId'] === where.requestStepId) &&
              (where.actorUserId === undefined || a['actorUserId'] === where.actorUserId),
          ).length,
        ),
    );
    await h.service.approve(SUPERADMIN, 'req-1', undefined, 'ขั้นที่สอง: ไม่มีผู้อนุมัติคนอื่น (fake)');
    expect(h.actions[1]).toMatchObject({ requestStepId: 200n, selfApproved: true });
    expect(h.soloOwner.otherApproverExists).toHaveBeenCalledWith(expect.anything(), 1n, step2);
    expect(auditActions(h.audit)).toEqual(['approval.self_approved', 'approval.approved']);

    // The same step twice is still refused.
    await expect(
      h.service.approve(SUPERADMIN, 'req-1', undefined, 'อีกครั้งในขั้นเดิม (fake)'),
    ).rejects.toMatchObject({ code: 'approval.already_acted' });
  });

  it('keeps one approval per person per request for everyone else', async () => {
    const h = engine({ roles: { '1': ['superadmin'] }, request: { requesterUserId: 2n, currentStepNo: 2 } });
    h.tx.approvalAction.count.mockImplementation(({ where }: { where: { actorUserId?: bigint } }) =>
      Promise.resolve('requestId' in where && where.actorUserId === 1n ? 1 : 0),
    );
    await expect(h.service.approve(SUPERADMIN, 'req-1')).rejects.toMatchObject({
      code: 'approval.already_acted',
    });
  });

  it('refuses a self-approval reason on somebody else’s request', async () => {
    const { service } = engine({ roles: { '1': ['superadmin'] }, request: { requesterUserId: 2n } });
    await expect(service.approve(SUPERADMIN, 'req-1', undefined, REASON)).rejects.toMatchObject({
      code: 'approval.not_self_approval',
    });
  });
});

describe('approval threshold at request creation (D-449 B)', () => {
  const input = (amount: string) => ({
    policyKey: 'credit_limit',
    subject: { type: 'company_credit_limit', id: 7n, publicId: 'sub-1' },
    requester: FINANCE,
    amount,
    payload: {},
  });

  it('approves at or below ฿100,000.00 (C1f) without the second approval: audited "below threshold", evented', async () => {
    const { service, audit, events, created, tx } = engine({ roles: {}, versionMax: '100000.00' });
    const request = await service.create(tx as never, input('100000.00'));
    expect(request).toMatchObject({
      status: 'approved',
      autoApprovedReason: 'below_threshold',
      currentStepNo: null,
    });
    expect(
      created.filter((c) => 'step' in c).every((c) => (c['step'] as { status: string }).status === 'skipped'),
    ).toBe(true);
    expect(auditActions(audit)).toEqual(['approval.auto_approved']);
    expect(audit.record.mock.calls[0]![1]).toMatchObject({
      data: { reason: 'below threshold', threshold: '100000.00' },
    });
    expect(eventTypes(events)).toEqual(['approval.approved']);
    expect(events.record.mock.calls[0]![1]).toMatchObject({
      payload: { autoApproved: true, reason: 'below_threshold' },
    });
  });

  it('routes above the threshold, or without one, as before', async () => {
    for (const [amount, max] of [
      ['100000.01', '100000.00'],
      ['1000.00', null],
    ] as const) {
      const { service, events, tx } = engine({ roles: {}, versionMax: max });
      const request = await service.create(tx as never, input(amount));
      expect(request).toMatchObject({ status: 'pending', autoApprovedReason: null });
      expect(eventTypes(events)).toEqual(['approval.requested']);
    }
  });
});

describe('credit-limit threshold amendment in the seed (C1f, D-451, DECISIONS-STAGE-A §14.5)', () => {
  const HISTORY = [OWNER_APPROVAL_THRESHOLD_C1D, OWNER_CREDIT_LIMIT_THRESHOLD_C1F];
  const v = (over: Partial<VersionFacts>): VersionFacts => ({
    reason: 'Seed from D-121',
    autoApproveMaxAmount: null,
    createdById: null,
    ...over,
  });

  it('moves a seeded ฿500,000.00 (first seed or C1d amendment) or a pre-C1d database to ฿100,000.00 once', () => {
    const c1dSeed = v({ autoApproveMaxAmount: '500000.00' });
    expect(thresholdAmendmentOf(HISTORY, c1dSeed, [c1dSeed])).toBe(OWNER_CREDIT_LIMIT_THRESHOLD_C1F);
    const amended = v({ autoApproveMaxAmount: '500000.00', reason: OWNER_APPROVAL_THRESHOLD_C1D.reason });
    expect(thresholdAmendmentOf(HISTORY, amended, [v({}), amended])).toBe(OWNER_CREDIT_LIMIT_THRESHOLD_C1F);
    const preC1d = v({});
    expect(thresholdAmendmentOf(HISTORY, preC1d, [preC1d])).toBe(OWNER_CREDIT_LIMIT_THRESHOLD_C1F);
    expect(OWNER_CREDIT_LIMIT_THRESHOLD_C1F.amount).toBe('100000.00');
  });

  it('never repeats itself, never overrides a Superadmin, never re-adds a removed amount', () => {
    const done = v({ autoApproveMaxAmount: '100000.00', reason: OWNER_CREDIT_LIMIT_THRESHOLD_C1F.reason });
    expect(thresholdAmendmentOf(HISTORY, done, [v({}), done])).toBeNull();
    const fresh = v({ autoApproveMaxAmount: '100000.00' });
    expect(thresholdAmendmentOf(HISTORY, fresh, [fresh])).toBeNull();
    const edited = v({ autoApproveMaxAmount: '250000.00', reason: 'Superadmin', createdById: 1n });
    expect(
      thresholdAmendmentOf(HISTORY, edited, [v({ autoApproveMaxAmount: '500000.00' }), edited]),
    ).toBeNull();
    const removed = v({ autoApproveMaxAmount: null, reason: 'Superadmin removed it', createdById: 1n });
    expect(
      thresholdAmendmentOf(HISTORY, removed, [v({ autoApproveMaxAmount: '500000.00' }), removed]),
    ).toBeNull();
    const removedBySeedLike = v({});
    expect(
      thresholdAmendmentOf(HISTORY, removedBySeedLike, [
        v({ autoApproveMaxAmount: '500000.00' }),
        removedBySeedLike,
      ]),
    ).toBeNull();
    expect(thresholdAmendmentOf(undefined, fresh, [fresh])).toBeNull();
  });
});
