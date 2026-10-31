import { randomBytes } from 'node:crypto';

import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type FileObject, type ShipmentStatus } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { hashToken, shipmentEtag, ShipmentsService } from './shipments.service';

/**
 * D-463 amendment (2026-10-31): the factory's carton labels and packing list are re-issued only while the trip is
 * packed and nothing has left — status `ready` (the only status that has partner documents and is before pickup;
 * `draft` has none yet, `picked_up` and later have labels already on the cartons) and no driver confirmed pickup
 * through a handover link (a booked carrier's pickup arrives by callback, so a `ready` trip can already be in a
 * driver's hands).
 */
export const REISSUABLE_STATUSES: readonly ShipmentStatus[] = ['ready'];

/** A label / packing-list file made under D-463 carries `metadata_stripped_at` (set by `renderPartnerDocuments`). */
export const isD463PartnerDocument = (file: Pick<FileObject, 'metadataStrippedAt'> | null): boolean =>
  file !== null && file.metadataStrippedAt !== null;

/** Why a shipment's partner documents cannot be re-issued now (null = they can). Pure. */
export function reissueRefusal(
  status: ShipmentStatus,
  hasDocuments: boolean,
  pickupConfirmed: boolean,
): string | null {
  if (!REISSUABLE_STATUSES.includes(status)) return status;
  if (!hasDocuments) return 'no partner documents';
  if (pickupConfirmed) return 'pickup confirmed by the driver';
  return null;
}

/**
 * What the legacy maintenance run does with a shipment whose stored documents predate D-463 (pure): re-issue them
 * while it is packed and not handed to a driver, otherwise retire them (detach from the factory, unlink).
 */
export function legacyDocumentAction(status: ShipmentStatus, pickupConfirmed: boolean): 'reissue' | 'retire' {
  return reissueRefusal(status, true, pickupConfirmed) === null ? 'reissue' : 'retire';
}

export interface ReissueResult {
  shipmentId: string;
  revokedTrackingLinks: number;
  retiredFileIds: string[];
  labelFileId: string;
  packingListFileId: string;
}

export interface RetireResult {
  shipmentId: string;
  retiredFileIds: string[];
}

/**
 * D-463 follow-up: shipments packed before the sealed carrier label have labels and packing lists that carry the
 * recipient's identity, stored as factory-owned files. Re-issuing gives the trip a new carton tracking token (the old
 * shipment-bound tracking links are revoked; the customer's own order links are untouched), renders both documents
 * again with the D-463 partner document, stores them, and **detaches** the old files from the factory — the file
 * module's convention for "staff only": no owner (`owner_factory_id` null), so `files.canRead` no longer lets the
 * factory scope read them, while the bytes stay as staff evidence (nothing is deleted). One transaction, an audit
 * row (`data_access`, `shipment.documents_reissued`) and a partner-visible activity / event without data, so the
 * factory knows to print the labels again.
 */
@Injectable()
export class ShipmentReissueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentsService,
    private readonly audit: AuditService,
  ) {}

  async reissue(
    actor: Actor,
    shipmentId: bigint,
    opts: { reason?: string; ifMatch?: string; source?: 'staff' | 'maintenance' } = {},
  ): Promise<ReissueResult> {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        cartons: { orderBy: { seq: 'asc' }, select: { seq: true, labelCode: true } },
        items: { orderBy: { id: 'asc' }, take: 1, select: { orderId: true } },
      },
    });
    assertIfMatch(opts.ifMatch, shipmentEtag(shipment), { required: false });
    await this.assertReissuable(shipment);
    const at = new Date();
    const token = randomBytes(24).toString('base64url');
    // The cartons keep their label codes (they carry no identity); only the QR token and the documents change.
    const { labelFile, packingFile } = await this.shipments.renderPartnerDocuments(
      shipment.id,
      token,
      shipment.cartons,
      at,
    );

    return this.prisma.withTx(async (tx) => {
      const locked = await this.shipments.lock(tx, shipment.id);
      if (locked.rowVersion !== shipment.rowVersion)
        throw new DomainException('shipments.invalid_status', {
          params: { status: `${locked.status} (changed)` },
        });
      await this.assertReissuable(locked, tx);
      const old = [locked.labelFileId, locked.packingListFileId].filter((id): id is bigint => id !== null);
      const oldFiles = old.length
        ? await tx.fileObject.findMany({ where: { id: { in: old } }, select: { id: true, publicId: true } })
        : [];
      // Detach: the factory scope no longer reads the old documents (staff keep them; nothing is deleted).
      if (old.length)
        await tx.fileObject.updateMany({ where: { id: { in: old } }, data: { ownerFactoryId: null } });
      const revoked = await tx.trackingLink.updateMany({
        where: { shipmentId: locked.id, revokedAt: null },
        data: { revokedAt: at },
      });
      await tx.trackingLink.create({
        data: { tokenHash: hashToken(token), orderId: shipment.items[0]!.orderId, shipmentId: locked.id },
      });
      await tx.shipment.update({
        where: { id: locked.id },
        data: {
          labelFileId: labelFile.id,
          packingListFileId: packingFile.id,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      const result: ReissueResult = {
        shipmentId: locked.publicId,
        revokedTrackingLinks: revoked.count,
        retiredFileIds: oldFiles.map((f) => f.publicId),
        labelFileId: labelFile.publicId,
        packingListFileId: packingFile.publicId,
      };
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'shipment.documents_reissued',
        resourceType: 'shipment',
        resourcePublicId: locked.publicId,
        entityId: locked.entityId,
        data: { ...result, reason: opts.reason ?? null, source: opts.source ?? 'staff' },
        actor,
      });
      // Partner-visible fact without data: new labels to print (no file ids, tokens or reasons).
      await this.shipments.record(tx, locked, 'shipment.documents_reissued', {}, actor);
      return result;
    });
  }

  /**
   * For a shipment past pickup (or cancelled / returned) whose stored documents predate D-463: they cannot be
   * printed again, so they are only detached from the factory and unlinked from the shipment (the partner response
   * then shows no label files). Audited; staff keep the files. Used by `scripts/reissue-legacy-shipment-docs.ts`.
   */
  async retireLegacy(actor: Actor, shipmentId: bigint, reason: string): Promise<RetireResult> {
    return this.prisma.withTx(async (tx) => {
      const locked = await this.shipments.lock(tx, shipmentId);
      const ids = [locked.labelFileId, locked.packingListFileId].filter((id): id is bigint => id !== null);
      const files = ids.length
        ? await tx.fileObject.findMany({ where: { id: { in: ids } }, select: { id: true, publicId: true } })
        : [];
      if (ids.length)
        await tx.fileObject.updateMany({ where: { id: { in: ids } }, data: { ownerFactoryId: null } });
      await tx.shipment.update({
        where: { id: locked.id },
        data: {
          labelFileId: null,
          packingListFileId: null,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      const result = { shipmentId: locked.publicId, retiredFileIds: files.map((f) => f.publicId) };
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'shipment.documents_retired',
        resourceType: 'shipment',
        resourcePublicId: locked.publicId,
        entityId: locked.entityId,
        data: { ...result, status: locked.status, reason },
        actor,
      });
      return result;
    });
  }

  private async assertReissuable(
    shipment: {
      id: bigint;
      status: ShipmentStatus;
      labelFileId: bigint | null;
      packingListFileId: bigint | null;
    },
    db: Tx = this.prisma,
  ): Promise<void> {
    const pickedUp =
      (await db.shipmentHandoverLink.count({
        where: { shipmentId: shipment.id, pickupConfirmedAt: { not: null } },
      })) > 0;
    const refusal = reissueRefusal(
      shipment.status,
      shipment.labelFileId !== null || shipment.packingListFileId !== null,
      pickedUp,
    );
    if (refusal) throw new DomainException('shipments.invalid_status', { params: { status: refusal } });
  }
}
