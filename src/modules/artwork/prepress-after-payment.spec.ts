import { type Actor } from '@common/context/actor';
import { orderQueueWhere } from '@modules/orders/order-operations.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { SettingNotFoundError } from '@platform/settings/settings.service';

import { ArtworkService } from './artwork.service';

/**
 * B-API-4b (DECISIONS-STAGE-A §7): own-file uploads before payment are allowed and preflighted at once, but the
 * prepress review queue holds paid orders only; Prepress hears of the file when the order is paid.
 * Obviously fake fixtures (CLAUDE.md).
 */
const CUSTOMER = 100n;
const PAID_AT = new Date('2026-10-20T03:00:00Z');
const SUBMITTED_AT = new Date('2026-10-18T03:00:00Z');

const orderRef = (publicId: string, paidForProductionAt: Date | null) => ({
  publicId,
  orderCode: `OR-${publicId}`,
  artworkStatus: 'uploaded',
  paidForProductionAt,
  productType: { code: 'folding_carton' },
  orderGroup: { customer: { publicId: 'cust-1', displayName: 'Fake Customer' } },
  prepressAssignee: null,
});

const SUBMISSIONS = [
  { publicId: 'sub-unpaid', versionNo: 1, preflightStatus: 'passed', order: orderRef('o-unpaid', null) },
  { publicId: 'sub-paid', versionNo: 1, preflightStatus: 'passed', order: orderRef('o-paid', PAID_AT) },
].map((r) => ({ ...r, submittedAt: SUBMITTED_AT, preflightCompletedAt: SUBMITTED_AT }));

/** Applies the order filter the queue asks for (only the payment fact matters here). */
function matches(
  where: { order?: { paidForProductionAt?: { not: null } } },
  row: (typeof SUBMISSIONS)[number],
) {
  return where.order?.paidForProductionAt?.not === null ? row.order.paidForProductionAt !== null : true;
}

function setup() {
  const prisma = {
    artworkSubmission: {
      findMany: jest.fn(({ where }) => Promise.resolve(SUBMISSIONS.filter((r) => matches(where, r)))),
      count: jest.fn(({ where }) => Promise.resolve(SUBMISSIONS.filter((r) => matches(where, r)).length)),
    },
  };
  const events = { record: jest.fn(() => Promise.resolve({ id: 1n })) };
  const activity = { record: jest.fn(() => Promise.resolve(undefined)) };
  const settings = {
    at: jest.fn((key: string, { at }: { at: Date }) => Promise.reject(new SettingNotFoundError(key, at))),
  };
  const orders = {
    order: jest.fn(() => Promise.resolve({ id: 50n, publicId: 'o-1', customerUserId: CUSTOMER })),
  };
  const service = new ArtworkService(
    prisma as never,
    orders as never,
    events as never,
    activity,
    {} as never,
    settings as never,
    {} as never,
  );
  return { service, prisma, events, activity };
}

/** A transaction able to run `submitIn` on order 50 (paid or not). */
function submitTx(paidForProductionAt: Date | null) {
  return {
    fileObject: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: 7n,
            publicId: 'file-1',
            ownerUserId: CUSTOMER,
            uploadStatus: 'uploaded',
            scanStatus: 'clean',
          },
        ]),
      ),
    },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    order: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          id: 50n,
          publicId: 'o-1',
          status: paidForProductionAt ? 'paid_for_production' : 'waiting_payment',
          artworkStatus: 'awaiting_upload',
          customerUserId: CUSTOMER,
          paidForProductionAt,
        }),
      ),
      update: jest.fn(() => Promise.resolve({})),
    },
    artworkSubmission: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      create: jest.fn(() => Promise.resolve({ id: 9n, publicId: 'sub-1', source: 'upload', channel: 'web' })),
    },
    artworkSubmissionFile: { create: jest.fn(() => Promise.resolve({})) },
    proof: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
    user: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ publicId: 'cust-1' })) },
  };
}

const customer = { type: 'user', userId: CUSTOMER, audience: 'customer' } as unknown as Actor;
const paidFact = (fact: string): DomainEventEnvelope =>
  ({ type: 'order.fact_recorded', aggregateType: 'order', aggregateId: 'o-1', payload: { fact } }) as never;

describe('prepress queue after payment (B-API-4b)', () => {
  it("leaves an unpaid order's submission out of the queue and lists a paid one", async () => {
    const { service } = setup();
    const { data, total } = await service.queue('submissions', 1, 20, new Date('2026-10-21T03:00:00Z'));
    expect(data.map((i) => i.itemId)).toEqual(['sub-paid']);
    expect(total).toBe(1);
  });

  it('counts a file received before payment as waiting for Prepress from the payment', async () => {
    const { service } = setup();
    const { data } = await service.queue('submissions', 1, 20, new Date('2026-10-21T03:00:00Z'));
    expect(data[0]!.since).toBe('2026-10-20T10:00:00+07:00');
  });

  it('keeps unpaid orders out of the admin "รอตรวจไฟล์" order queue and its dashboard counter', () => {
    expect(orderQueueWhere('artwork_review')).toMatchObject({ paidForProductionAt: { not: null } });
  });

  it('records the file of an unpaid order without telling Prepress (no artwork.submitted)', async () => {
    const tx = submitTx(null);
    const { service, events } = setup();
    await service.submitIn(
      tx as never,
      customer,
      'o-1',
      { files: [{ fileId: 'file-1' }] },
      {
        customerUserId: CUSTOMER,
        channel: 'web',
      },
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'artwork.submitted_before_payment' }),
      customer,
    );
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ artworkStatus: 'uploaded' }) }),
    );
  });

  it('tells Prepress at once when the order is already paid', async () => {
    const tx = submitTx(PAID_AT);
    const { service, events } = setup();
    await service.submitIn(
      tx as never,
      customer,
      'o-1',
      { files: [{ fileId: 'file-1' }] },
      {
        customerUserId: CUSTOMER,
        channel: 'web',
      },
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'artwork.submitted' }),
      customer,
    );
  });

  it('announces the pending submission to Prepress when the order is paid (internal activity)', async () => {
    const tx = {
      order: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 50n, publicId: 'o-1', customerUserId: CUSTOMER, cancelledAt: null }),
        ),
      },
      artworkSubmission: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            publicId: 'sub-1',
            versionNo: 2,
            source: 'upload',
            channel: 'web',
            _count: { files: 1 },
          }),
        ),
      },
      user: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ publicId: 'cust-1' })) },
    };
    const { service, events, activity } = setup();
    await service.onPaid(paidFact('paid_for_production'), tx as never);
    expect(tx.artworkSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 50n, status: 'submitted' } }),
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'artwork.submitted',
        aggregateId: 'o-1',
        payload: expect.objectContaining({ submissionId: 'sub-1', afterPayment: true, customerId: 'cust-1' }),
      }),
      expect.objectContaining({ type: 'system' }),
    );
    expect(activity.record).toHaveBeenCalledWith(tx, expect.objectContaining({ visibility: ['internal'] }));
  });

  it('does nothing for other facts or without a pending submission', async () => {
    const tx = {
      order: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 50n, publicId: 'o-1', customerUserId: CUSTOMER, cancelledAt: null }),
        ),
      },
      artworkSubmission: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };
    const { service, events } = setup();
    await service.onPaid(paidFact('artwork_approved'), tx as never);
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    await service.onPaid(paidFact('paid_for_production'), tx as never);
    expect(events.record).not.toHaveBeenCalled();
  });
});
