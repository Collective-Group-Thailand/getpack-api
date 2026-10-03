import { toBangkokIso } from '@common/time/bangkok';

import {
  type AdminReviewDto,
  type LoyaltySummaryDto,
  type PointsEntryDto,
  type PublicReviewDto,
  type ReviewDto,
} from './loyalty.dto';
import { type LedgerRow, type LoyaltyService } from './loyalty.service';
import { type ReviewRow } from './reviews.service';

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
    orderId: e.order?.publicId ?? null,
    orderCode: e.order?.orderCode ?? null,
    groupCode: e.orderGroup?.groupCode ?? null,
    reason: e.reason,
    createdAt: toBangkokIso(e.createdAt),
  };
}

export function reviewDto(r: ReviewRow): ReviewDto {
  return {
    id: r.publicId,
    orderId: r.order.publicId,
    orderCode: r.order.orderCode,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    rewardPoints: r.pointsEntries.reduce((a, e) => a + e.points, 0),
    productTypeCode: r.order.productType.code,
    reply: replyOf(r),
    createdAt: toBangkokIso(r.createdAt),
  };
}

function replyOf(r: ReviewRow) {
  return r.replyBody && r.repliedAt ? { body: r.replyBody, repliedAt: toBangkokIso(r.repliedAt) } : null;
}

/** D-265: first name and the initial of the last name ("สมหญิง ท."); one word stays as it is. */
export function abbreviatedName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0]!;
  return `${words[0]} ${[...words.at(-1)!][0]}.`;
}

export function publicReviewDto(r: ReviewRow): PublicReviewDto {
  return {
    id: r.publicId,
    rating: r.rating,
    comment: r.comment,
    reviewerName: abbreviatedName(r.user.displayName),
    productTypeCode: r.order.productType.code,
    productTypeNameTh: r.order.productType.nameTh,
    productTypeNameEn: r.order.productType.nameEn,
    reply: replyOf(r),
    createdAt: toBangkokIso(r.createdAt),
  };
}

export function adminReviewDto(r: ReviewRow): AdminReviewDto {
  return { ...reviewDto(r), customer: { id: r.user.publicId, displayName: r.user.displayName } };
}
