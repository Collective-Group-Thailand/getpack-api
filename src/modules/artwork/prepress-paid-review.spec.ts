import { DomainException } from '@common/errors/domain.exception';
import { SettingNotFoundError } from '@platform/settings/settings.service';

import { ArtworkService } from './artwork.service';

/**
 * B-API-6 (DECISIONS-STAGE-A §7): Prepress reviews paid orders only — accept / reject refuse an unpaid order's
 * submission with 409 `artwork.order_unpaid`, and the "changes requested" list holds paid orders only.
 * Obviously fake fixtures (CLAUDE.md).
 */
const PAID_AT = new Date('2026-10-20T03:00:00Z');

function txFor(paidForProductionAt: Date | null, status = 'submitted') {
  const submission = {
    id: 9n,
    publicId: 'sub-1',
    orderId: 50n,
    versionNo: 1,
    status,
    preflightStatus: 'passed',
  };
  return {
    artworkSubmission: {
      findUnique: jest.fn(() => Promise.resolve(submission)),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(submission)),
      update: jest.fn(() => Promise.resolve(submission)),
    },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    order: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          id: 50n,
          publicId: 'o-1',
          status: paidForProductionAt ? 'paid_for_production' : 'waiting_payment',
          artworkStatus: 'uploaded',
          customerUserId: 100n,
          paidForProductionAt,
        }),
      ),
      update: jest.fn(() => Promise.resolve({})),
    },
    user: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ publicId: 'cust-1' })) },
  };
}

function setup(tx: ReturnType<typeof txFor>) {
  const prisma = {
    withTx: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    proof: {
      findMany: jest.fn(() => Promise.resolve([])),
      count: jest.fn(() => Promise.resolve(0)),
    },
  };
  const events = { record: jest.fn(() => Promise.resolve({ id: 1n })) };
  const activity = { record: jest.fn(() => Promise.resolve(undefined)) };
  const settings = {
    at: jest.fn((key: string, { at }: { at: Date }) => Promise.reject(new SettingNotFoundError(key, at))),
  };
  const service = new ArtworkService(
    prisma as never,
    {} as never,
    events as never,
    activity,
    {} as never,
    settings as never,
    {} as never,
  );
  return { service, prisma };
}

const prepress = { type: 'user', userId: 7n, audience: 'staff' } as never;

async function codeOf(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof DomainException) return error.code;
    throw error;
  }
}

describe('Prepress reviews paid orders only (B-API-6)', () => {
  it.each(['accept', 'reject'] as const)(
    '%s refuses a submission of an unpaid order (409)',
    async (action) => {
      const tx = txFor(null);
      const { service } = setup(tx);
      const work =
        action === 'accept'
          ? service.accept(prepress, 'sub-1')
          : service.reject(prepress, 'sub-1', 'ขนาดไม่ตรง');
      await expect(codeOf(work)).resolves.toBe('artwork.order_unpaid');
      expect(tx.artworkSubmission.update).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    },
  );

  it('answers 409 for artwork.order_unpaid', () => {
    expect(new DomainException('artwork.order_unpaid').status).toBe(409);
  });

  it.each(['accept', 'reject'] as const)('%s goes through on a paid order', async (action) => {
    const tx = txFor(PAID_AT);
    const { service } = setup(tx);
    if (action === 'accept') await service.accept(prepress, 'sub-1');
    else await service.reject(prepress, 'sub-1', 'ขนาดไม่ตรง');
    expect(tx.artworkSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: action === 'accept' ? 'accepted_for_proof' : 'rejected' }),
      }),
    );
  });

  it('lists "changes requested" for paid orders only; "proofs waiting" is unchanged', async () => {
    const { service, prisma } = setup(txFor(PAID_AT));
    await service.queue('changes_requested', 1, 20, new Date('2026-10-21T03:00:00Z'));
    expect(prisma.proof.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'changes_requested',
          order: expect.objectContaining({
            artworkStatus: 'changes_requested',
            paidForProductionAt: { not: null },
          }),
        }),
      }),
    );
    prisma.proof.findMany.mockClear();
    await service.queue('proofs_waiting', 1, 20, new Date('2026-10-21T03:00:00Z'));
    const call = (prisma.proof.findMany.mock.calls as unknown as [{ where: { order: object } }][])[0]![0];
    expect(call.where.order).not.toHaveProperty('paidForProductionAt');
  });
});
