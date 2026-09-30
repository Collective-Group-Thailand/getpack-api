import { toBangkokIso } from '@common/time/bangkok';

import { type AdminClaimDto, type PartnerClaimDto, type StoreClaimDto } from './claims.dto';
import { type ClaimRow } from './claims.service';

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
type Photos = { product: string[]; carton: string[] };

export function storeClaimDto(c: ClaimRow, photos: Photos = { product: [], carton: [] }): StoreClaimDto {
  return {
    id: c.publicId,
    claimNo: c.claimNo,
    orderId: c.order.publicId,
    orderCode: c.order.orderCode,
    type: c.type,
    origin: c.origin,
    status: c.status,
    description: c.description,
    requestedResolution: c.requestedResolution,
    claimedQuantity: c.claimedQuantity,
    claimedAmount: c.claimedAmount?.toFixed(2) ?? null,
    receivedAt: toBangkokIso(c.receivedAt),
    windowEndsAt: toBangkokIso(c.windowEndsAt),
    submittedAt: toBangkokIso(c.submittedAt),
    infoRequest: c.infoRequest,
    decisionNote: c.decisionNote,
    photos,
    // The customer sees what was done for them, not which job made it (D-050) nor what Packio
    // recovers from the factory or the carrier (D-083, D-044).
    resolutions: c.resolutions.filter((r) => !INTERNAL_ACTIONS.has(r.action)).map(resolutionView),
  };
}

/** Recoveries between Packio and its suppliers: never on the customer's claim. */
const INTERNAL_ACTIONS: ReadonlySet<string> = new Set(['factory_deduction', 'carrier_recovery']);

type Resolution = ClaimRow['resolutions'][number];

function resolutionView(r: Resolution) {
  return {
    action: r.action,
    amount: r.amount?.toFixed(2) ?? null,
    quantity: r.quantity,
    jobNo: null,
    refundId: r.refund?.publicId ?? null,
    executedAt: toBangkokIso(r.executedAt),
  };
}

export function partnerClaimDto(c: ClaimRow, photos?: Photos): PartnerClaimDto {
  const base = storeClaimDto(c, photos);
  return {
    ...base,
    resolutions: c.resolutions.map((r) => ({
      ...resolutionView(r),
      jobNo: r.productionJob?.jobNo ?? null,
      refundId: null,
      amount: r.action === 'factory_deduction' ? (r.amount?.toFixed(2) ?? null) : null,
    })),
    jobId: c.productionJob?.publicId ?? null,
    jobNo: c.productionJob?.jobNo ?? null,
    liability: c.liability,
    factoryResponse: c.factoryResponse,
    factoryResponseNote: c.factoryResponseNote,
  };
}

export function adminClaimDto(c: ClaimRow, photos?: Photos): AdminClaimDto {
  const base = storeClaimDto(c, photos);
  return {
    ...base,
    resolutions: c.resolutions.map((r) => ({
      ...resolutionView(r),
      jobNo: r.productionJob?.jobNo ?? null,
    })),
    jobId: c.productionJob?.publicId ?? null,
    jobNo: c.productionJob?.jobNo ?? null,
    liability: c.liability,
    factoryResponse: c.factoryResponse,
    factoryResponseNote: c.factoryResponseNote,
    liabilityByRule: c.liabilityByRule,
    overrideReason: c.overrideReason,
    factoryId: c.factory?.publicId ?? null,
    factoryCode: c.factory?.code ?? null,
    shipmentId: c.shipment?.publicId ?? null,
    infoResponse: c.infoResponse,
    decidedAt: iso(c.decidedAt),
  };
}
