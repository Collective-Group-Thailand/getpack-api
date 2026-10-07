import { statusLabels } from '@common/labels/status-labels';
import { toBangkokIso } from '@common/time/bangkok';

import {
  type AdminSampleDto,
  type PartnerSampleDto,
  type SampleDto,
  type SampleEvidenceViewDto,
} from './samples.dto';
import { type SamplePhoto, type SampleRow } from './samples.service';

const DAY_MS = 86_400_000;
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const mm = (v: { toFixed(n: number): string } | null) => v?.toFixed(2) ?? null;

function evidence(s: SampleRow, photos: SamplePhoto[]): SampleEvidenceViewDto {
  return {
    lengthMm: mm(s.measuredLengthMm),
    widthMm: mm(s.measuredWidthMm),
    depthMm: mm(s.measuredDepthMm),
    basis: s.measuredBasis,
    materialUsed: s.materialUsed,
    photos,
    recordedAt: iso(s.evidenceRecordedAt),
  };
}

/** The customer view (no buy amount, no factory — D-050, D-141). */
export function sampleDto(s: SampleRow, photos: SamplePhoto[], creditWindowDays: number): SampleDto {
  return {
    id: s.publicId,
    kind: s.kind,
    status: s.status,
    ...statusLabels('SampleStatus', s.status),
    statusChangedAt: toBangkokIso(s.statusChangedAt),
    productTypeCode: s.productType.code,
    configuration: s.configuration as Record<string, unknown>,
    mockupOption: s.mockupOption as SampleDto['mockupOption'],
    quantity: s.quantity,
    deliveryPostcode: s.deliveryPostcode,
    customerNote: s.customerNote,
    orderId: s.order?.publicId ?? null,
    orderCode: s.order?.orderCode ?? null,
    quotation:
      s.quote && s.quote.options[0]
        ? { quoteId: s.quote.publicId, optionId: s.quote.options[0].publicId, status: s.quote.status }
        : null,
    sellNetAmount: s.sellNetAmount?.toFixed(2) ?? null,
    sellGrossAmount: s.sellGrossAmount?.toFixed(2) ?? null,
    leadTimeDays: s.leadTimeDays,
    validUntil: iso(s.validUntil),
    evidence: evidence(s, photos),
    decision: s.decidedAt
      ? {
          decidedAt: toBangkokIso(s.decidedAt),
          note: s.decisionNote,
          evidencePhotoSha256: s.evidencePhotoSha256,
        }
      : null,
    approvedProofId: s.approvedProof?.publicId ?? null,
    previousSampleId: s.previousSample?.publicId ?? null,
    credit:
      s.kind === 'standalone'
        ? {
            bulkQuoteId: s.bulkQuote?.publicId ?? null,
            creditOrderId: s.creditOrder?.publicId ?? null,
            creditAmount: s.creditAmount?.toFixed(2) ?? null,
            availableUntil:
              s.status === 'approved' && s.decidedAt
                ? toBangkokIso(new Date(s.decidedAt.getTime() + creditWindowDays * DAY_MS))
                : null,
          }
        : null,
    shippedAt: iso(s.shippedAt),
    deliveredAt: iso(s.deliveredAt),
    createdAt: toBangkokIso(s.createdAt),
  };
}

/** The staff view; the buy amount needs `factory_buy_prices.read` (D-141). */
export function adminSampleDto(
  s: SampleRow,
  photos: SamplePhoto[],
  creditWindowDays: number,
  grants: { cost: boolean },
): AdminSampleDto {
  return {
    ...sampleDto(s, photos, creditWindowDays),
    buyNetAmount: grants.cost ? (s.buyNetAmount?.toFixed(2) ?? null) : null,
    parcelWeightG: s.parcelWeightG,
    productionJobId: s.productionJob?.publicId ?? null,
    customerId: s.customer.publicId,
    customerName: s.customer.displayName,
    decisionIp: s.decisionIp,
    decisionUserAgent: s.decisionUserAgent,
    cancelReason: s.cancelReason,
  };
}

/** The factory view: what to make and its evidence (D-142, D-050). */
export function partnerSampleDto(s: SampleRow, photos: SamplePhoto[]): PartnerSampleDto {
  return {
    id: s.publicId,
    status: s.status,
    ...statusLabels('SampleStatus', s.status),
    productTypeCode: s.productType.code,
    configuration: s.configuration as Record<string, unknown>,
    mockupOption: s.mockupOption as PartnerSampleDto['mockupOption'],
    quantity: s.quantity,
    productionJobId: s.productionJob?.publicId ?? null,
    jobNo: s.productionJob?.jobNo ?? null,
    evidence: evidence(s, photos),
  };
}
