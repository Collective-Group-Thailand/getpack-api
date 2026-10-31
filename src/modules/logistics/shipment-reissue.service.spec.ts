import { DomainException } from '@common/errors/domain.exception';

import {
  isD463PartnerDocument,
  legacyDocumentAction,
  reissueRefusal,
  ShipmentReissueService,
} from './shipment-reissue.service';
import { hashToken } from './shipments.service';

/** D-463 follow-up: re-issue the factory's documents of trips packed before the sealed carrier label. */
describe('partner document re-issue (D-463)', () => {
  const SHIPMENT = {
    id: 1n,
    publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000001',
    entityId: 3n,
    status: 'ready',
    rowVersion: 4,
    labelFileId: 50n,
    packingListFileId: 51n,
    cartons: [{ seq: 1, labelCode: 'A-01' }],
    items: [{ orderId: 9n }],
  };

  function setup(opts: { status?: string; pickupConfirmed?: boolean; rowVersion?: number } = {}) {
    const shipment = { ...SHIPMENT, status: opts.status ?? 'ready' };
    const tx = {
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: 50n, publicId: 'old-label' },
          { id: 51n, publicId: 'old-packing' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      trackingLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      shipment: { update: jest.fn().mockResolvedValue({}) },
      shipmentHandoverLink: { count: jest.fn().mockResolvedValue(opts.pickupConfirmed ? 1 : 0) },
    };
    const prisma = {
      withTx: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      shipment: { findUniqueOrThrow: jest.fn().mockResolvedValue(shipment) },
      shipmentHandoverLink: tx.shipmentHandoverLink,
    };
    const shipments = {
      renderPartnerDocuments: jest.fn().mockResolvedValue({
        labelFile: { id: 60n, publicId: 'new-label' },
        packingFile: { id: 61n, publicId: 'new-packing' },
      }),
      lock: jest.fn().mockResolvedValue({ ...shipment, rowVersion: opts.rowVersion ?? shipment.rowVersion }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ShipmentReissueService(prisma as never, shipments as never, audit as never);
    return { service, tx, shipments, audit };
  }

  const actor = { type: 'user', audience: 'staff', userId: 7n } as never;
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return error instanceof DomainException ? error.code : String(error);
    }
    return 'resolved';
  };

  it('issues a new carton token, revokes the old shipment links, stores new files and detaches the old ones', async () => {
    const { service, tx, shipments, audit } = setup();
    const result = await service.reissue(actor, 1n, { reason: 'legacy label' });

    const [, token, cartons] = shipments.renderPartnerDocuments.mock.calls[0] as [bigint, string, unknown];
    expect(cartons).toEqual(SHIPMENT.cartons);
    expect(tx.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { shipmentId: 1n, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.trackingLink.create).toHaveBeenCalledWith({
      data: { tokenHash: hashToken(token), orderId: 9n, shipmentId: 1n },
    });
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [50n, 51n] } },
      data: { ownerFactoryId: null },
    });
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({ labelFileId: 60n, packingListFileId: 61n }),
    });
    expect(result).toEqual({
      shipmentId: SHIPMENT.publicId,
      revokedTrackingLinks: 1,
      retiredFileIds: ['old-label', 'old-packing'],
      labelFileId: 'new-label',
      packingListFileId: 'new-packing',
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        category: 'data_access',
        action: 'shipment.documents_reissued',
        data: expect.objectContaining({
          reason: 'legacy label',
          retiredFileIds: ['old-label', 'old-packing'],
        }),
      }),
    );
    // The factory learns "re-issued" with no data (no token, file id or reason).
    expect(shipments.record).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      'shipment.documents_reissued',
      {},
      actor,
    );
  });

  it('refuses before packing, after pickup and once a driver confirmed pickup', async () => {
    for (const status of ['draft', 'picked_up', 'in_transit', 'delivered', 'cancelled'])
      expect(await codeOf(setup({ status }).service.reissue(actor, 1n))).toBe('shipments.invalid_status');
    expect(await codeOf(setup({ pickupConfirmed: true }).service.reissue(actor, 1n))).toBe(
      'shipments.invalid_status',
    );
    const { service, shipments } = setup({ status: 'picked_up' });
    await codeOf(service.reissue(actor, 1n));
    expect(shipments.renderPartnerDocuments).not.toHaveBeenCalled();
  });

  it('refuses when the shipment changed while the documents were rendered', async () => {
    const { service, tx } = setup({ rowVersion: 5 });
    expect(await codeOf(service.reissue(actor, 1n))).toBe('shipments.invalid_status');
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it('retires legacy files of a trip past pickup: detached from the factory, unlinked, audited', async () => {
    const { service, tx, audit } = setup({ status: 'delivered' });
    const result = await service.retireLegacy(actor, 1n, 'legacy');
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [50n, 51n] } },
      data: { ownerFactoryId: null },
    });
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({ labelFileId: null, packingListFileId: null }),
    });
    expect(result.retiredFileIds).toEqual(['old-label', 'old-packing']);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'shipment.documents_retired' }),
    );
  });

  it('tells D-463 documents from legacy ones and plans the maintenance run', () => {
    expect(isD463PartnerDocument({ metadataStrippedAt: new Date() })).toBe(true);
    expect(isD463PartnerDocument({ metadataStrippedAt: null })).toBe(false);
    expect(isD463PartnerDocument(null)).toBe(false);
    expect(reissueRefusal('ready', true, false)).toBeNull();
    expect(reissueRefusal('ready', false, false)).toBe('no partner documents');
    expect(legacyDocumentAction('ready', false)).toBe('reissue');
    expect(legacyDocumentAction('ready', true)).toBe('retire');
    expect(legacyDocumentAction('delivered', false)).toBe('retire');
  });
});
