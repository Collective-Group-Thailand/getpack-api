import { MoneyDecimal } from '@common/money/money';
import { nextActions, NO_PERMISSIONS } from '@common/next-actions/next-actions';
import { toBangkokIso } from '@common/time/bangkok';

import { ADMIN_CLAIM_ACTIONS, PARTNER_CLAIM_ACTIONS, STORE_CLAIM_ACTIONS } from './claim-actions';
import { type AdminClaimDto, type PartnerClaimDto, type StoreClaimDto } from './claims.dto';
import { type ClaimRow } from './claims.service';
import { liabilityRule } from './liability';

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const userRef = (u: { publicId: string; displayName: string } | null) =>
  u ? { id: u.publicId, displayName: u.displayName } : null;
type Photos = { product: string[]; carton: string[]; factory?: string[] };

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
    photos: { product: photos.product, carton: photos.carton },
    tolerance: {
      shortagePct: c.order.toleranceShortagePct?.toFixed(4) ?? null,
      overagePct: c.order.toleranceOveragePct?.toFixed(4) ?? null,
      dimensionalMm: c.order.toleranceDimensionalMm?.toFixed(2) ?? null,
      colourDeltaE: c.order.toleranceColourDeltaE?.toFixed(2) ?? null,
    },
    // The customer sees what was done for them, not which job made it (D-050) nor what Packio
    // recovers from the factory or the carrier (D-083, D-044).
    resolutions: c.resolutions.filter((r) => !INTERNAL_ACTIONS.has(r.action)).map(resolutionView),
    nextActions: nextActions(c, STORE_CLAIM_ACTIONS, NO_PERMISSIONS),
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

export function partnerClaimDto(
  c: ClaimRow,
  photos?: Photos,
  perms: ReadonlySet<string> = NO_PERMISSIONS,
): PartnerClaimDto {
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
    ...factoryFields(c, photos),
    nextActions: nextActions(c, PARTNER_CLAIM_ACTIONS, perms),
  };
}

/** The factory's side of a claim (U-B0.3): its response, evidence, the shipment and what is recovered from it. */
function factoryFields(c: ClaimRow, photos?: Photos) {
  const deductions = c.vendorDeductions.map((d) => ({
    id: d.publicId,
    amount: d.amount.toFixed(2),
    status: d.status,
    offsetAgainst: d.offsetAgainst,
    recordedAt: toBangkokIso(d.recordedAt),
  }));
  return {
    factoryRespondedAt: iso(c.factoryRespondedAt),
    factoryEvidenceFileIds: photos?.factory ?? [],
    shipmentNo: c.shipment?.shipmentNo ?? null,
    deductionAmount: c.vendorDeductions
      .filter((d) => d.status !== 'cancelled')
      .reduce((a, d) => a.add(d.amount.toString()), new MoneyDecimal(0))
      .toFixed(2),
    deductions,
  };
}

export function adminClaimDto(
  c: ClaimRow,
  photos?: Photos,
  perms: ReadonlySet<string> = NO_PERMISSIONS,
): AdminClaimDto {
  const base = storeClaimDto(c, photos);
  const proof = c.order.proofs[0];
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
    ...factoryFields(c, photos),
    nextActions: nextActions(c, ADMIN_CLAIM_ACTIONS, perms),
    liabilityByRule: c.liabilityByRule,
    overrideReason: c.overrideReason,
    factoryId: c.factory?.publicId ?? null,
    factoryCode: c.factory?.code ?? null,
    shipmentId: c.shipment?.publicId ?? null,
    infoResponse: c.infoResponse,
    decidedAt: iso(c.decidedAt),
    customer: {
      id: c.customer.publicId,
      customerCode: c.customer.customerProfile?.customerCode ?? null,
      displayName: c.customer.displayName,
      companyName: c.order.orderGroup.company?.legalName ?? null,
    },
    shipmentNo: c.shipment?.shipmentNo ?? null,
    liabilityRule: liabilityRule(c.type, c.liabilityByRule),
    liabilityOverriddenBy: userRef(c.liabilityOverriddenBy),
    decidedBy: userRef(c.decidedBy),
    approvedProof: proof
      ? {
          id: proof.publicId,
          versionNo: proof.versionNo,
          approvedAt: iso(proof.decidedAt),
          channel: proof.decisionChannel,
          approvedFileId: proof.approvedFile?.publicId ?? null,
        }
      : null,
  };
}
