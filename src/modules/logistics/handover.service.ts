import { randomBytes } from 'node:crypto';

import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { statusLabels } from '@common/labels/status-labels';
import { toBangkokIso } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { type ShipmentHandoverLink, type ShipmentStatus } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { renderWaybillHtml, type WaybillDocument } from './shipment-documents';
import { hashToken, ShipmentsService } from './shipments.service';

/**
 * D-462: how long a driver handover link stays valid at most (it also ends at delivery, cancellation or return).
 * A technical default set by the decision; change it here (and in D-462) if operations needs longer.
 */
export const HANDOVER_LINK_TTL_DAYS = 7;

/** `d` + 32 base64url characters (24 random bytes). The first letter keeps it apart from notification links (D-299). */
export const HANDOVER_TOKEN = /^d[A-Za-z0-9_-]{32}$/;

/** A link can be issued from packed until delivered (the address is frozen once packed). */
export const HANDOVER_ISSUABLE: readonly ShipmentStatus[] = [
  'ready',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'failed',
];
/** The link stops working once the trip is over. */
export const HANDOVER_CLOSED: readonly ShipmentStatus[] = ['delivered', 'cancelled', 'returned'];

export type HandoverLinkState = 'active' | 'expired' | 'revoked' | 'closed';

/** The state of one link at `now` (pure). */
export function handoverLinkState(
  link: Pick<ShipmentHandoverLink, 'expiresAt' | 'revokedAt'>,
  shipmentStatus: ShipmentStatus,
  now: Date,
): HandoverLinkState {
  if (link.revokedAt) return 'revoked';
  if (HANDOVER_CLOSED.includes(shipmentStatus)) return 'closed';
  if (link.expiresAt <= now) return 'expired';
  return 'active';
}

export const newHandoverToken = (): string => `d${randomBytes(24).toString('base64url')}`;

const DRIVER = systemActor('driver_handover');

/** What the driver sees: the recipient and the trip — never the factory, prices or other orders (D-050, D-462). */
export interface DriverHandoverView {
  shipmentNo: string;
  status: ShipmentStatus;
  statusLabelTh: string;
  cartonsCount: number;
  cartons: { seq: number; labelCode: string }[];
  weightG: number;
  plannedShipOn: string | null;
  recipient: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    postcode: string;
    province: { nameTh: string; nameEn: string };
  };
  sender: { name: string; phone: string | null };
  expiresAt: string;
  pickupConfirmedAt: string | null;
  canConfirmPickup: boolean;
}

export interface IssuedHandoverLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface HandoverLinkSummary {
  state: HandoverLinkState;
  issuedAt: string;
  expiresAt: string;
  openCount: number;
  lastOpenedAt: string | null;
  pickupConfirmedAt: string | null;
}

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

/**
 * D-462 "sealed carrier label": the recipient's name, phone and address reach the carrier / driver only — through
 * the getpack waybill (staff download) and a handover link (`<web>/l/<token>`) that getpack staff issue and send to
 * the driver. The token is random, SHA-256 stored only, bound to one shipment, valid until the trip ends and at most
 * {@link HANDOVER_LINK_TTL_DAYS}; regenerating revokes the previous link. Every open and every pickup confirmation
 * is an audit row (`data_access`, with the request's IP and user agent). The partner surface only learns whether a
 * waybill was issued.
 */
@Injectable()
export class ShipmentHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly shipments: ShipmentsService,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  // --- staff ---------------------------------------------------------------------------------------------------

  /** Issue (or regenerate) the shipment's handover link. The URL and token are returned once; only the hash is kept. */
  async issue(actor: UserActor, shipmentId: bigint, now = new Date()): Promise<IssuedHandoverLink> {
    const token = newHandoverToken();
    const expiresAt = new Date(now.getTime() + HANDOVER_LINK_TTL_DAYS * 86_400_000);
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.shipments.lock(tx, shipmentId);
      if (!HANDOVER_ISSUABLE.includes(shipment.status))
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      const revoked = await tx.shipmentHandoverLink.updateMany({
        where: { shipmentId, revokedAt: null },
        data: { revokedAt: now },
      });
      const link = await tx.shipmentHandoverLink.create({
        data: {
          shipmentId,
          tokenHash: hashToken(token),
          expiresAt,
          createdById: actor.userId,
          createdAt: now,
        },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: revoked.count > 0 ? 'shipment.handover_link_regenerated' : 'shipment.handover_link_issued',
        resourceType: 'shipment',
        resourcePublicId: shipment.publicId,
        entityId: shipment.entityId,
        data: { linkId: link.publicId, expiresAt: expiresAt.toISOString() },
        actor,
      });
      // Partner-visible fact without data: "waybill issued" (the link itself never leaves the staff response).
      await this.shipments.record(
        tx,
        shipment,
        'shipment.waybill_issued',
        { regenerated: revoked.count > 0 },
        actor,
      );
    });
    return { url: this.url(token), token, expiresAt: toBangkokIso(expiresAt) };
  }

  /** The latest link of each shipment (staff view), without its token. */
  async summaries(shipmentIds: bigint[], statusOf: Map<bigint, ShipmentStatus>, now = new Date()) {
    const out = new Map<bigint, HandoverLinkSummary>();
    if (shipmentIds.length === 0) return out;
    const links = await this.prisma.shipmentHandoverLink.findMany({
      where: { shipmentId: { in: shipmentIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    for (const link of links) {
      if (out.has(link.shipmentId)) continue;
      out.set(link.shipmentId, {
        state: handoverLinkState(link, statusOf.get(link.shipmentId) ?? 'ready', now),
        issuedAt: toBangkokIso(link.createdAt),
        expiresAt: toBangkokIso(link.expiresAt),
        openCount: link.openCount,
        lastOpenedAt: iso(link.lastOpenedAt),
        pickupConfirmedAt: iso(link.pickupConfirmedAt),
      });
    }
    return out;
  }

  /** Shipments with a waybill issued: a handover link that was not revoked, or a fallback-carrier booking. */
  async waybillIssued(rows: { id: bigint; carrierBookingRef: string | null }[]): Promise<Set<bigint>> {
    const issued = new Set(rows.filter((r) => r.carrierBookingRef).map((r) => r.id));
    const rest = rows.filter((r) => !issued.has(r.id)).map((r) => r.id);
    if (rest.length > 0) {
      const links = await this.prisma.shipmentHandoverLink.findMany({
        where: { shipmentId: { in: rest }, revokedAt: null },
        select: { shipmentId: true },
      });
      for (const l of links) issued.add(l.shipmentId);
    }
    return issued;
  }

  /** The carrier waybill PDF (full recipient) for staff — rendered on demand, never stored; audited. */
  async waybillPdf(
    actor: Actor,
    shipmentId: bigint,
    now = new Date(),
  ): Promise<{ fileName: string; body: Buffer }> {
    const doc = await this.waybillDocument(shipmentId, now);
    const body = await this.pdf.render(renderWaybillHtml(doc.waybill));
    await this.audit.recordStandalone({
      category: 'data_access',
      action: 'shipment.waybill_downloaded',
      resourceType: 'shipment',
      resourcePublicId: doc.publicId,
      entityId: doc.entityId,
      actor,
    });
    return { fileName: `${doc.waybill.shipmentNo}-waybill.pdf`, body };
  }

  // --- driver (anonymous, token only) ---------------------------------------------------------------------------

  /** The driver opens the link: recipient and trip. Unknown or revoked → 404; ended or expired → 410. Audited. */
  async resolve(token: string, now = new Date()): Promise<DriverHandoverView> {
    const link = await this.live(token, now, 'shipment.handover_opened');
    await this.prisma.withTx(async (tx) => {
      await tx.shipmentHandoverLink.update({
        where: { id: link.id },
        data: { openCount: { increment: 1 }, lastOpenedAt: now },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'shipment.handover_opened',
        resourceType: 'shipment',
        resourcePublicId: link.shipment.publicId,
        entityId: link.shipment.entityId,
        data: { linkId: link.publicId },
        actor: DRIVER,
      });
    });
    return this.view(link.shipmentId, link, now);
  }

  /**
   * The driver confirms pickup. Optional `scannedTokens` are carton-QR tracking tokens; each must belong to this
   * shipment. A packed own-fleet trip is picked up through the shipping gate (`shipments.dispatch`; a closed gate is
   * `handover.not_ready`); a booked carrier's pickup still comes from its callbacks. Repeating it is harmless.
   */
  async confirmPickup(
    token: string,
    scannedTokens: string[] = [],
    now = new Date(),
  ): Promise<DriverHandoverView> {
    const link = await this.live(token, now, 'shipment.handover_pickup_confirmed');
    if (scannedTokens.length > 0) {
      const matches = await this.prisma.trackingLink.count({
        where: {
          shipmentId: link.shipmentId,
          revokedAt: null,
          tokenHash: { in: scannedTokens.map((t) => hashToken(t)) },
        },
      });
      // Every carton QR of a shipment carries the same token; any one that is not this shipment's is refused.
      const distinct = new Set(scannedTokens).size;
      if (matches < distinct) throw new DomainException('handover.scan_mismatch');
    }
    if (!link.pickupConfirmedAt) {
      if (link.shipment.status === 'ready' && link.shipment.carrier.code === 'factory_fleet') {
        try {
          await this.shipments.dispatch(DRIVER, link.shipmentId, now);
        } catch (error) {
          if (
            error instanceof DomainException &&
            [
              'shipments.payment_pending',
              'shipments.inspection_pending',
              'shipments.invalid_status',
            ].includes(error.code)
          )
            throw new DomainException('handover.not_ready');
          throw error;
        }
      }
      await this.prisma.withTx(async (tx) => {
        await tx.shipmentHandoverLink.update({ where: { id: link.id }, data: { pickupConfirmedAt: now } });
        await this.audit.record(tx, {
          category: 'data_access',
          action: 'shipment.handover_pickup_confirmed',
          resourceType: 'shipment',
          resourcePublicId: link.shipment.publicId,
          entityId: link.shipment.entityId,
          data: { linkId: link.publicId, cartonsScanned: scannedTokens.length > 0 },
          actor: DRIVER,
        });
      });
    }
    return this.view(link.shipmentId, { ...link, pickupConfirmedAt: link.pickupConfirmedAt ?? now }, now);
  }

  // --- helpers ---------------------------------------------------------------------------------------------------

  url(token: string): string {
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.getpack.invalid';
    return `${web.replace(/\/$/, '')}/l/${token}`;
  }

  /** The link behind a token if it still works; a refused attempt on a known link is audited as denied. */
  private async live(token: string, now: Date, action: string) {
    if (!HANDOVER_TOKEN.test(token)) throw new DomainException('http.not_found');
    const link = await this.prisma.shipmentHandoverLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        shipment: {
          select: { publicId: true, entityId: true, status: true, carrier: { select: { code: true } } },
        },
      },
    });
    if (!link) throw new DomainException('http.not_found');
    const state = handoverLinkState(link, link.shipment.status, now);
    if (state === 'active') return link;
    await this.audit.recordStandalone({
      category: 'data_access',
      action,
      outcome: 'denied',
      resourceType: 'shipment',
      resourcePublicId: link.shipment.publicId,
      entityId: link.shipment.entityId,
      data: { linkId: link.publicId, state },
      actor: DRIVER,
    });
    // A revoked link is answered like an unknown one: it says nothing about the shipment.
    if (state === 'revoked') throw new DomainException('http.not_found');
    throw new DomainException('handover.expired');
  }

  private async view(
    shipmentId: bigint,
    link: Pick<ShipmentHandoverLink, 'expiresAt' | 'pickupConfirmedAt'>,
    now: Date,
  ): Promise<DriverHandoverView> {
    const s = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        province: { select: { nameTh: true, nameEn: true } },
        cartons: { orderBy: { seq: 'asc' }, select: { seq: true, labelCode: true } },
      },
    });
    return {
      shipmentNo: s.shipmentNo,
      status: s.status,
      statusLabelTh: statusLabels('ShipmentStatus', s.status).statusLabelTh,
      cartonsCount: s.cartonsCount,
      cartons: s.cartons,
      weightG: s.weightG,
      plannedShipOn: s.plannedShipOn?.toISOString().slice(0, 10) ?? null,
      recipient: {
        name: s.recipientName,
        phone: s.phone,
        line1: s.line1,
        line2: s.line2,
        postcode: s.postcode,
        province: s.province,
      },
      sender: await this.shipments.documentSender(s.entityId, now),
      expiresAt: toBangkokIso(link.expiresAt),
      pickupConfirmedAt: iso(link.pickupConfirmedAt),
      canConfirmPickup: link.pickupConfirmedAt === null && !HANDOVER_CLOSED.includes(s.status),
    };
  }

  private async waybillDocument(shipmentId: bigint, now: Date) {
    const s = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        province: { select: { nameTh: true } },
        items: { orderBy: { id: 'asc' }, select: { productionJob: { select: { jobNo: true } } } },
      },
    });
    const sender = await this.shipments.documentSender(s.entityId, now);
    const waybill: WaybillDocument = {
      shipmentNo: s.shipmentNo,
      sender: { ...sender, address: null },
      recipient: {
        name: s.recipientName,
        phone: s.phone,
        line1: s.line1,
        line2: s.line2,
        postcode: s.postcode,
        province: s.province.nameTh,
      },
      jobNos: [...new Set(s.items.map((i) => i.productionJob.jobNo))],
      cartonsCount: s.cartonsCount,
      totalWeightKg: (s.weightG / 1000).toFixed(2),
      plannedShipOn: s.plannedShipOn?.toISOString().slice(0, 10) ?? null,
    };
    return { publicId: s.publicId, entityId: s.entityId, waybill };
  }
}
