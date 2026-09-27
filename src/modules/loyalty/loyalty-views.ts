import { toBangkokIso } from '@common/time/bangkok';

import { type LoyaltySummaryDto, type PointsEntryDto } from './loyalty.dto';
import { type LedgerRow, type LoyaltyService } from './loyalty.service';

export function summaryDto(s: Awaited<ReturnType<LoyaltyService['summary']>>): LoyaltySummaryDto {
  return {
    ...s,
    expiringSoon: s.expiringSoon.map((e) => ({ points: e.points, expiresAt: toBangkokIso(e.expiresAt) })),
    currency: 'THB',
  };
}

export function entryDto(e: LedgerRow): PointsEntryDto {
  return {
    id: e.publicId,
    entryType: e.entryType,
    points: e.points,
    bahtValue: e.bahtValue.toFixed(2),
    status: e.status,
    availableAt: e.availableAt ? toBangkokIso(e.availableAt) : null,
    expiresAt: e.expiresAt ? toBangkokIso(e.expiresAt) : null,
    orderCode: e.order?.orderCode ?? null,
    groupCode: e.orderGroup?.groupCode ?? null,
    reason: e.reason,
    createdAt: toBangkokIso(e.createdAt),
  };
}
