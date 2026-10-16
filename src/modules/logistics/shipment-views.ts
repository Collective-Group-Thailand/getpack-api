import { statusLabels } from '@common/labels/status-labels';
import { nextActions, NO_PERMISSIONS } from '@common/next-actions/next-actions';
import { toBangkokIso } from '@common/time/bangkok';
import { type DeliveryReconciliation, type Prisma } from '@generated/prisma/client';

import {
  type AdminShipmentDto,
  type DeliveryReconciliationDto,
  type PartnerShipmentDto,
  type ProofOfDeliveryDto,
  type StoreShipmentDto,
} from './logistics.dto';
import { ADMIN_SHIPMENT_ACTIONS, PARTNER_SHIPMENT_ACTIONS, type ShipmentFacts } from './shipment-actions';

export const SHIPMENT_INCLUDE = {
  factory: { select: { publicId: true, code: true } },
  carrier: { select: { code: true } },
  labelFile: { select: { publicId: true } },
  packingListFile: { select: { publicId: true } },
  items: {
    orderBy: { id: 'asc' },
    include: {
      order: {
        select: { publicId: true, orderCode: true, deliveryReconciliation: { select: { outcome: true } } },
      },
      orderDestination: { select: { publicId: true } },
      productionJob: { select: { publicId: true, jobNo: true } },
    },
  },
  events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
  proofOfDelivery: {
    include: {
      signatureFile: { select: { publicId: true } },
      reviews: {
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        include: { reviewedBy: { select: { publicId: true, displayName: true } } },
      },
    },
  },
  province: { select: { publicId: true, nameTh: true, nameEn: true } },
  cartons: { orderBy: { seq: 'asc' } },
  splitFrom: { select: { publicId: true, shipmentNo: true } },
  exceptionResolvedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.ShipmentInclude;
export type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const province = (row: ShipmentRow) => ({
  id: row.province.publicId,
  nameTh: row.province.nameTh,
  nameEn: row.province.nameEn,
});
const userRef = (u: { publicId: string; displayName: string } | null) =>
  u ? { id: u.publicId, displayName: u.displayName } : null;

function exceptionDto(row: ShipmentRow): AdminShipmentDto['exception'] {
  if (row.status !== 'failed' && row.status !== 'returned') return null;
  const event = [...row.events].reverse().find((e) => e.status === row.status);
  return {
    status: row.status,
    note: event?.note ?? null,
    occurredAt: toBangkokIso(event?.occurredAt ?? row.statusChangedAt),
    resolution: row.exceptionResolution,
    resolutionNote: row.exceptionNote,
    resolvedAt: iso(row.exceptionResolvedAt),
    resolvedBy: userRef(row.exceptionResolvedBy),
  };
}
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function podDto(row: ShipmentRow, photos: string[]): ProofOfDeliveryDto | null {
  const pod = row.proofOfDelivery;
  if (!pod) return null;
  return {
    kind: pod.kind,
    receiverName: pod.receiverName,
    deliveredQuantity: pod.deliveredQuantity,
    capturedAt: toBangkokIso(pod.capturedAt),
    signatureFileId: pod.signatureFile?.publicId ?? null,
    photoFileIds: photos,
    carrierPodRef: pod.carrierPodRef,
  };
}

/** The factory's projection (D-142): where to deliver and what, no price. */
const shipmentFacts = (row: ShipmentRow, blockedByPayment: boolean): ShipmentFacts => ({
  status: row.status,
  carrier: row.carrier.code,
  carrierRequested: row.carrierRequestedAt !== null,
  blockedByPayment,
  podReview: row.proofOfDelivery ? (row.proofOfDelivery.reviews[0]?.decision ?? 'pending') : null,
  exceptionResolved: row.exceptionResolvedAt !== null,
});

export function partnerShipmentDto(
  row: ShipmentRow,
  podPhotos: string[] = [],
  blockedByPayment = false,
  perms: ReadonlySet<string> = NO_PERMISSIONS,
): PartnerShipmentDto {
  return {
    id: row.publicId,
    shipmentNo: row.shipmentNo,
    status: row.status,
    ...statusLabels('ShipmentStatus', row.status),
    carrier: row.carrier.code,
    trackingNo: row.trackingNo,
    destination: {
      recipientName: row.recipientName,
      phone: row.phone,
      line1: row.line1,
      line2: row.line2,
      postcode: row.postcode,
      province: province(row),
    },
    cartonsCount: row.cartonsCount,
    weightG: row.weightG,
    volumeCm3: row.volumeCm3 === null ? null : Number(row.volumeCm3),
    plannedShipOn: day(row.plannedShipOn),
    readyAt: iso(row.readyAt),
    pickedUpAt: iso(row.pickedUpAt),
    deliveredAt: iso(row.deliveredAt),
    labelFileId: row.labelFile?.publicId ?? null,
    packingListFileId: row.packingListFile?.publicId ?? null,
    items: row.items.map((i) => ({
      destinationId: i.orderDestination.publicId,
      jobId: i.productionJob.publicId,
      jobNo: i.productionJob.jobNo,
      orderCode: i.order.orderCode,
      quantity: i.quantity,
      deliveredQuantity: i.deliveredQuantity,
      toleranceOutcome: i.order.deliveryReconciliation?.outcome ?? null,
    })),
    events: row.events.map((e) => ({
      occurredAt: toBangkokIso(e.occurredAt),
      status: e.status,
      ...statusLabels('ShipmentStatus', e.status),
      source: e.source,
      location: e.location,
      note: e.note,
    })),
    proofOfDelivery: podDto(row, podPhotos),
    note: row.note,
    cartons: row.cartons.map((c) => ({ seq: c.seq, labelCode: c.labelCode, weightG: c.weightG })),
    blockedByPayment,
    carrierRequest:
      row.carrierRequestedAt && row.carrierRequestReason
        ? { requestedAt: toBangkokIso(row.carrierRequestedAt), reason: row.carrierRequestReason }
        : null,
    nextActions: nextActions(shipmentFacts(row, blockedByPayment), PARTNER_SHIPMENT_ACTIONS, perms),
  };
}

export function adminShipmentDto(
  row: ShipmentRow,
  grants: { cost: boolean },
  podPhotos: string[] = [],
  blockedByPayment = false,
  perms: ReadonlySet<string> = NO_PERMISSIONS,
): AdminShipmentDto {
  const review = row.proofOfDelivery?.reviews[0];
  return {
    ...partnerShipmentDto(row, podPhotos, blockedByPayment),
    factoryId: row.factory.publicId,
    factoryCode: row.factory.code,
    carrierBookingRef: row.carrierBookingRef,
    trackingUrl: row.trackingUrl,
    payoutAmount: grants.cost ? (row.payoutAmount?.toFixed(2) ?? null) : null,
    carrierCostAmount: grants.cost ? (row.carrierCostAmount?.toFixed(2) ?? null) : null,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    exception: exceptionDto(row),
    podReview: row.proofOfDelivery
      ? {
          state: review?.decision ?? 'pending',
          note: review?.note ?? null,
          reviewedAt: iso(review?.reviewedAt ?? null),
          reviewedBy: userRef(review?.reviewedBy ?? null),
        }
      : null,
    splitFrom: row.splitFrom ? { id: row.splitFrom.publicId, shipmentNo: row.splitFrom.shipmentNo } : null,
    nextActions: nextActions(shipmentFacts(row, blockedByPayment), ADMIN_SHIPMENT_ACTIONS, perms),
  };
}

/** The customer's view of the shipments carrying one of their orders (D-050: no factory, no costs). */
export function storeShipmentDto(
  row: ShipmentRow,
  orderId: bigint,
  podPhotos: string[] = [],
): StoreShipmentDto {
  const pod = row.proofOfDelivery;
  return {
    id: row.publicId,
    shipmentNo: row.shipmentNo,
    status: row.status,
    ...statusLabels('ShipmentStatus', row.status),
    carrier: row.carrier.code === 'factory_fleet' ? 'getpack' : row.carrier.code,
    trackingNo: row.trackingNo,
    trackingUrl: row.trackingUrl,
    destination: {
      recipientName: row.recipientName,
      phone: row.phone,
      line1: row.line1,
      line2: row.line2,
      postcode: row.postcode,
      province: province(row),
    },
    cartonsCount: row.cartonsCount,
    pickedUpAt: iso(row.pickedUpAt),
    deliveredAt: iso(row.deliveredAt),
    items: row.items
      .filter((i) => i.orderId === orderId)
      .map((i) => ({
        orderCode: i.order.orderCode,
        quantity: i.quantity,
        deliveredQuantity: i.deliveredQuantity,
      })),
    events: row.events
      .filter((e) => e.status !== 'draft')
      .map((e) => ({
        occurredAt: toBangkokIso(e.occurredAt),
        status: e.status,
        ...statusLabels('ShipmentStatus', e.status),
        location: e.location,
      })),
    proofOfDelivery: pod
      ? { receiverName: pod.receiverName, capturedAt: toBangkokIso(pod.capturedAt), photoFileIds: podPhotos }
      : null,
  };
}

export function reconciliationDto(r: DeliveryReconciliation): DeliveryReconciliationDto {
  return {
    outcome: r.outcome,
    orderedQuantity: r.orderedQuantity,
    deliveredQuantity: r.deliveredQuantity,
    payableQuantity: r.payableQuantity,
    deviationPct: r.deviationPct.toFixed(4),
    toleranceShortagePct: r.toleranceShortagePct.toFixed(4),
    toleranceOveragePct: r.toleranceOveragePct.toFixed(4),
    creditNetAmount: r.creditNetAmount?.toFixed(2) ?? null,
    creditVatAmount: r.creditVatAmount?.toFixed(2) ?? null,
    creditAmount: r.creditAmount?.toFixed(2) ?? null,
    evaluatedAt: toBangkokIso(r.evaluatedAt),
  };
}
