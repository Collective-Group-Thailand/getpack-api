import { DomainException } from '@common/errors/domain.exception';

import {
  HANDOVER_LINK_TTL_DAYS,
  HANDOVER_TOKEN,
  handoverLinkState,
  newHandoverToken,
  ShipmentHandoverService,
} from './handover.service';
import { hashToken } from './shipments.service';

/** D-463: the driver handover link — random token, valid until the trip ends or 7 days, every open audited. */
describe('driver handover link (D-463)', () => {
  const now = new Date('2026-10-20T02:00:00Z');
  const token = newHandoverToken();

  const SHIPMENT = {
    id: 1n,
    publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000001',
    shipmentNo: 'SH-2610-0001',
    entityId: 3n,
    status: 'ready',
    cartonsCount: 2,
    weightG: 18000,
    plannedShipOn: null,
    recipientName: 'สมหญิง ใจดี',
    phone: '+66810001234',
    line1: '99/9 ถนนกาญจนวนิช',
    line2: null,
    postcode: '90110',
    province: { nameTh: 'สงขลา', nameEn: 'Songkhla' },
    cartons: [{ seq: 1, labelCode: 'A-01' }],
  };

  function setup(
    link: Record<string, unknown> | null,
    opts: { status?: string; carrier?: string; dispatch?: () => Promise<void> } = {},
  ) {
    const status = opts.status ?? 'ready';
    const row = link && {
      id: 9n,
      publicId: 'l-9',
      shipmentId: 1n,
      expiresAt: new Date(now.getTime() + 86_400_000),
      revokedAt: null,
      openCount: 0,
      pickupConfirmedAt: null,
      ...link,
      shipment: {
        publicId: SHIPMENT.publicId,
        entityId: 3n,
        status,
        carrier: { code: opts.carrier ?? 'factory_fleet' },
      },
    };
    const tx = {
      shipmentHandoverLink: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ publicId: 'l-10' }),
      },
    };
    const prisma = {
      withTx: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      shipmentHandoverLink: { findUnique: jest.fn().mockResolvedValue(row) },
      shipment: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ...SHIPMENT, status }) },
      trackingLink: { count: jest.fn().mockResolvedValue(1) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined), recordStandalone: jest.fn() };
    const shipments = {
      lock: jest.fn().mockResolvedValue({ ...SHIPMENT, status }),
      record: jest.fn().mockResolvedValue(undefined),
      dispatch: jest.fn(opts.dispatch ?? (() => Promise.resolve())),
      documentSender: jest.fn().mockResolvedValue({ name: 'getpack', phone: '+6620000000' }),
    };
    const config = { get: jest.fn().mockReturnValue('https://www.getpack.example/') };
    const service = new ShipmentHandoverService(
      prisma as never,
      config as never,
      audit as never,
      shipments as never,
      { render: jest.fn() },
    );
    return { service, prisma, tx, audit, shipments };
  }

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return error instanceof DomainException ? error.code : String(error);
    }
    return 'resolved';
  };

  it('issues a random `d…` token, stores only its hash, revokes the previous link and audits it', async () => {
    const { service, tx, audit, shipments } = setup(null);
    const issued = await service.issue({ type: 'user', userId: 7n } as never, 1n, now);
    expect(issued.token).toMatch(HANDOVER_TOKEN);
    expect(issued.url).toBe(`https://www.getpack.example/l/${issued.token}`);
    expect(tx.shipmentHandoverLink.updateMany).toHaveBeenCalledWith({
      where: { shipmentId: 1n, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = tx.shipmentHandoverLink.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(created.data.tokenHash).toEqual(hashToken(issued.token));
    expect(
      JSON.stringify(created.data, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toContain(issued.token);
    expect(created.data.expiresAt).toEqual(new Date(now.getTime() + HANDOVER_LINK_TTL_DAYS * 86_400_000));
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ category: 'data_access', action: 'shipment.handover_link_regenerated' }),
    );
    // The partner learns "waybill issued" — the event carries no link and no recipient.
    expect(shipments.record).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      'shipment.waybill_issued',
      { regenerated: true },
      expect.anything(),
    );
  });

  it('refuses a link before the trip is packed', async () => {
    const { service } = setup(null, { status: 'draft' });
    expect(await codeOf(service.issue({ type: 'user', userId: 7n } as never, 1n, now))).toBe(
      'shipments.invalid_status',
    );
  });

  it('opens with a valid, unexpired token: recipient shown, open counted, audit row written', async () => {
    const { service, prisma, tx, audit } = setup({});
    const view = await service.resolve(token, now);
    expect(prisma.shipmentHandoverLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(token) } }),
    );
    expect(view.recipient).toMatchObject({ name: 'สมหญิง ใจดี', phone: '+66810001234', postcode: '90110' });
    expect(view.canConfirmPickup).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/factory/i);
    expect(tx.shipmentHandoverLink.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { openCount: { increment: 1 }, lastOpenedAt: now },
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        category: 'data_access',
        action: 'shipment.handover_opened',
        resourceType: 'shipment',
        resourcePublicId: SHIPMENT.publicId,
        actor: { type: 'system', name: 'driver_handover' },
      }),
    );
    // No token and no recipient in the audit row.
    const entry = JSON.stringify((audit.record.mock.calls[0] as unknown[])[1], (_k, v: unknown) =>
      typeof v === 'bigint' ? String(v) : v,
    );
    expect(entry).not.toContain(token);
    expect(entry).not.toContain('สมหญิง');
  });

  it('refuses malformed and unknown tokens with 404 without touching data', async () => {
    const { service, prisma } = setup(null);
    expect(await codeOf(service.resolve('not-a-token', now))).toBe('http.not_found');
    expect(prisma.shipmentHandoverLink.findUnique).not.toHaveBeenCalled();
    expect(await codeOf(service.resolve(token, now))).toBe('http.not_found');
  });

  it('refuses an expired link (410) and a regenerated one (404), auditing the attempt as denied', async () => {
    const expired = setup({ expiresAt: new Date(now.getTime() - 1) });
    expect(await codeOf(expired.service.resolve(token, now))).toBe('handover.expired');
    expect(expired.audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shipment.handover_opened', outcome: 'denied' }),
    );
    expect(expired.tx.shipmentHandoverLink.update).not.toHaveBeenCalled();
    expect(expired.prisma.shipment.findUniqueOrThrow).not.toHaveBeenCalled();

    const revoked = setup({ revokedAt: new Date(now.getTime() - 1) });
    expect(await codeOf(revoked.service.resolve(token, now))).toBe('http.not_found');
    expect(revoked.audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied' }),
    );
  });

  it('ends with the delivery', async () => {
    for (const status of ['delivered', 'cancelled', 'returned']) {
      const { service } = setup({}, { status });
      expect(await codeOf(service.resolve(token, now))).toBe('handover.expired');
    }
  });

  it('confirms pickup through the shipping gate, once, audited', async () => {
    const { service, shipments, tx, audit } = setup({});
    const view = await service.confirmPickup(token, [], now);
    expect(shipments.dispatch).toHaveBeenCalledWith({ type: 'system', name: 'driver_handover' }, 1n, now);
    expect(tx.shipmentHandoverLink.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { pickupConfirmedAt: now },
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'shipment.handover_pickup_confirmed' }),
    );
    expect(view.canConfirmPickup).toBe(false);

    const again = setup({ pickupConfirmedAt: now });
    await again.service.confirmPickup(token, [], now);
    expect(again.shipments.dispatch).not.toHaveBeenCalled();
  });

  it('says only "not ready" when the gate is closed, and checks scanned cartons', async () => {
    const closed = setup(
      {},
      { dispatch: () => Promise.reject(new DomainException('shipments.payment_pending')) },
    );
    expect(await codeOf(closed.service.confirmPickup(token, [], now))).toBe('handover.not_ready');

    const wrong = setup({});
    wrong.prisma.trackingLink.count.mockResolvedValue(0);
    expect(await codeOf(wrong.service.confirmPickup(token, ['q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh'], now))).toBe(
      'handover.scan_mismatch',
    );
    expect(wrong.shipments.dispatch).not.toHaveBeenCalled();
  });

  it('leaves a booked carrier’s pickup to its callbacks', async () => {
    const { service, shipments } = setup({}, { carrier: 'flash_express' });
    await service.confirmPickup(token, [], now);
    expect(shipments.dispatch).not.toHaveBeenCalled();
  });

  it('computes the link state', () => {
    const live = { expiresAt: new Date(now.getTime() + 1), revokedAt: null };
    expect(handoverLinkState(live, 'ready', now)).toBe('active');
    expect(handoverLinkState(live, 'delivered', now)).toBe('closed');
    expect(handoverLinkState({ ...live, expiresAt: now }, 'in_transit', now)).toBe('expired');
    expect(handoverLinkState({ ...live, revokedAt: now }, 'ready', now)).toBe('revoked');
  });
});
