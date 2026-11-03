import { DomainException } from '@common/errors/domain.exception';

import { type CaptureRoute } from './capture-rules';
import { SalesCaptureService } from './sales-capture.service';

/** D-471 item 1: the capture sources' service rules over a fake transaction. */
describe('SalesCaptureService (D-471)', () => {
  const now = new Date('2026-11-10T03:00:00Z');
  const customer = {
    kind: 'customer',
    status: 'active',
    displayName: 'คุณวิภา',
    phone: '+66890002222',
    email: 'Wipa@Example.invalid',
  };

  function setup(over: {
    user?: unknown;
    agent?: unknown;
    consent?: { id: bigint } | null;
    route?: CaptureRoute;
    orders?: number;
    open?: unknown;
    flag?: boolean;
    designs?: unknown[];
    existingForDesign?: unknown;
    openStudio?: number;
  }) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: { findUnique: jest.fn().mockResolvedValue('user' in over ? over.user : customer) },
      salesAgent: { findUnique: jest.fn().mockResolvedValue(over.agent ?? null) },
      companyMember: { findFirst: jest.fn().mockResolvedValue(null) },
      orderGroup: { count: jest.fn().mockResolvedValue(over.orders ?? 0) },
      dielineDownload: { findUnique: jest.fn() },
      salesInboundLead: {
        findFirst: jest.fn().mockResolvedValue(over.open ?? null),
        findUnique: jest.fn().mockResolvedValue(over.existingForDesign ?? null),
        count: jest.fn().mockResolvedValue(over.openStudio ?? 0),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      withTx: (fn: (t: typeof tx) => unknown) => fn(tx),
      designDocument: { findMany: jest.fn().mockResolvedValue(over.designs ?? []) },
    };
    const settings = {
      at: jest
        .fn()
        .mockResolvedValue({ value: over.flag ?? true, effectiveFrom: new Date('2026-01-01T00:00:00Z') }),
      value: jest.fn((key: string) =>
        Promise.resolve(key === 'capture.studio_idle_days' ? 3 : (over.flag ?? true)),
      ),
    };
    const row = { id: 77n, publicId: 'row' };
    const inbound = {
      intake: jest.fn().mockResolvedValue(row),
      autoAssign: jest.fn().mockResolvedValue(undefined),
      assignInTx: jest.fn().mockResolvedValue(undefined),
    };
    const attribution = {
      marketingConsent: jest.fn().mockResolvedValue('consent' in over ? over.consent : { id: 501n }),
      route: jest.fn().mockResolvedValue(over.route ?? { route: 'pool' }),
    };
    const events = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const activity = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SalesCaptureService(
      prisma as never,
      settings as never,
      inbound as never,
      attribution as never,
      { scoreInbound: jest.fn().mockResolvedValue({ score: 40, reasons: [] }) } as never,
      events as never,
      activity,
    );
    return { service, tx, inbound, attribution, events, row };
  }

  describe('dieline download', () => {
    it('creates an item for a signed-in non-customer with marketing consent, in the pool', async () => {
      const { service, tx, inbound, row } = setup({});
      await expect(service.captureDieline(tx as never, 9n, 'PK-TE-01-K7QD', now)).resolves.toBe('captured');
      expect(inbound.intake).toHaveBeenCalledWith(
        tx,
        'dieline_download',
        'PK-TE-01-K7QD',
        expect.objectContaining({ contactEmail: 'wipa@example.invalid', need: 'dieline · PK-TE-01-K7QD' }),
        expect.objectContaining({
          captureUserId: 9n,
          consentBasis: 'marketing_consent',
          consentRecordId: 501n,
        }),
      );
      expect(inbound.autoAssign).toHaveBeenCalledWith(tx, row, expect.anything());
      // One person at a time (no duplicate item from parallel downloads).
      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('refreshes the open item instead of making another', async () => {
      const open = { id: 5n, publicId: 'open', signalCount: 2, need: 'dieline · A' };
      const { service, tx, inbound, events } = setup({ open });
      await expect(service.captureDieline(tx as never, 9n, 'B', now)).resolves.toBe('refreshed');
      expect(inbound.intake).not.toHaveBeenCalled();
      expect(tx.salesInboundLead.update).toHaveBeenCalledWith({
        where: { id: 5n },
        data: expect.objectContaining({
          signalCount: { increment: 1 },
          lastSignalAt: now,
          need: 'dieline · A · B',
        }),
      });
      expect(events.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: 'sales_inbound_lead.refreshed',
          payload: expect.not.objectContaining({ contactEmail: expect.anything() }),
        }),
        expect.anything(),
      );
    });

    it('skips customers, agents, staff accounts and anyone without marketing consent', async () => {
      expect(
        await setup({ orders: 1 }).service.captureDieline(setup({ orders: 1 }).tx as never, 9n, 'A', now),
      ).toBe('customer');
      const agent = setup({ agent: { id: 1n } });
      expect(await agent.service.captureDieline(agent.tx as never, 9n, 'A', now)).toBe('agent');
      const staff = setup({ user: { ...customer, kind: 'staff' } });
      expect(await staff.service.captureDieline(staff.tx as never, 9n, 'A', now)).toBe(
        'not_customer_account',
      );
      const noConsent = setup({ consent: null });
      expect(await noConsent.service.captureDieline(noConsent.tx as never, 9n, 'A', now)).toBe('no_consent');
      expect(noConsent.inbound.intake).not.toHaveBeenCalled();
    });

    it('never feeds the pool for an agent’s contact — not even by refreshing an open item', async () => {
      const s = setup({
        route: { route: 'agent' },
        open: { id: 5n, publicId: 'o', signalCount: 1, need: null },
      });
      expect(await s.service.captureDieline(s.tx as never, 9n, 'A', now)).toBe('attributed');
      expect(s.inbound.intake).not.toHaveBeenCalled();
      expect(s.tx.salesInboundLead.update).not.toHaveBeenCalled();
    });

    it('gives a rep-attributed contact to that rep, the pool when the rep is gone', async () => {
      const s = setup({ route: { route: 'rep', repUserId: 44n, via: 'inbound' } });
      await s.service.captureDieline(s.tx as never, 9n, 'A', now);
      expect(s.inbound.assignInTx).toHaveBeenCalledWith(
        s.tx,
        s.row,
        44n,
        'attribution',
        null,
        expect.anything(),
      );
      expect(s.inbound.autoAssign).not.toHaveBeenCalled();

      const gone = setup({ route: { route: 'rep', repUserId: 44n, via: 'inbound' } });
      gone.inbound.assignInTx.mockRejectedValue(new DomainException('sales.rep_unavailable'));
      await gone.service.captureDieline(gone.tx as never, 9n, 'A', now);
      expect(gone.inbound.autoAssign).toHaveBeenCalled();
    });

    it('ignores staff and anonymous downloads and a switched-off flag', async () => {
      const s = setup({});
      await s.service.onDielineDownloaded({ payload: { staff: true } } as never, s.tx as never);
      await s.service.onDielineDownloaded({ payload: { anonymous: true } } as never, s.tx as never);
      const off = setup({ flag: false });
      await off.service.onDielineDownloaded({ payload: { downloadId: 'd' } } as never, off.tx as never);
      expect(s.tx.dielineDownload.findUnique).not.toHaveBeenCalled();
      expect(off.tx.dielineDownload.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('studio idle job', () => {
    const design = {
      id: 3n,
      publicId: 'd',
      title: 'กล่องคุกกี้',
      ownerUserId: 9n,
      styleVariant: { code: 'PK-1' },
    };

    it('does nothing while the flag is off', async () => {
      const s = setup({ flag: false, designs: [design] });
      await expect(s.service.captureStudioIdle(now)).resolves.toEqual({
        captured: 0,
        skipped: { flag_off: 1 },
      });
    });

    it('captures one item per design, with the consent record relied on', async () => {
      const s = setup({ designs: [design] });
      await expect(s.service.captureStudioIdle(now)).resolves.toEqual({ captured: 1, skipped: {} });
      expect(s.inbound.intake).toHaveBeenCalledWith(
        s.tx,
        'studio_idle',
        null,
        expect.objectContaining({ need: '“กล่องคุกกี้” · PK-1' }),
        expect.objectContaining({
          designDocumentId: 3n,
          consentBasis: 'marketing_consent',
          consentRecordId: 501n,
        }),
      );
    });

    it('is idempotent and skips attributed, consent-less or already-followed people', async () => {
      const again = setup({ designs: [design], existingForDesign: { id: 1n } });
      expect((await again.service.captureStudioIdle(now)).skipped).toEqual({ already_captured: 1 });
      const rep = setup({ designs: [design], route: { route: 'rep', repUserId: 4n, via: 'inbound' } });
      expect((await rep.service.captureStudioIdle(now)).skipped).toEqual({ attributed: 1 });
      const agent = setup({ designs: [design], route: { route: 'agent' } });
      expect((await agent.service.captureStudioIdle(now)).skipped).toEqual({ attributed: 1 });
      const noConsent = setup({ designs: [design], consent: null });
      expect((await noConsent.service.captureStudioIdle(now)).skipped).toEqual({ no_consent: 1 });
      const open = setup({ designs: [design], openStudio: 1 });
      expect((await open.service.captureStudioIdle(now)).skipped).toEqual({ open_item: 1 });
      for (const s of [again, rep, agent, noConsent, open]) expect(s.inbound.intake).not.toHaveBeenCalled();
    });
  });
});
