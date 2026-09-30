import { MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { type Campaign, type CouponCode, type User } from '@generated/prisma/client';

import { benefitSummary } from './benefit-summary';
import { type CampaignDto, type CouponCodeDto, type PromotionDto } from './promotions.dto';
import { type PromotionRow } from './promotions-admin.service';

export function campaignDto(
  c: Campaign,
  extras?: { owner: { publicId: string; displayName: string } | null; promotionsCount: number },
): CampaignDto {
  const spentPct =
    c.budgetAmount && !c.budgetAmount.isZero()
      ? new MoneyDecimal(c.spentAmount.toString()).div(c.budgetAmount.toString()).mul(100).toFixed(2)
      : null;
  return {
    id: c.publicId,
    code: c.code,
    name: c.name,
    status: c.status,
    startsAt: toBangkokIso(c.startsAt),
    endsAt: c.endsAt ? toBangkokIso(c.endsAt) : null,
    budgetAmount: c.budgetAmount?.toFixed(2) ?? null,
    spentAmount: c.spentAmount.toFixed(2),
    alertThresholdPct: c.alertThresholdPct.toFixed(4),
    alertedAt: c.alertedAt ? toBangkokIso(c.alertedAt) : null,
    goals: c.goals as Record<string, unknown>,
    currency: 'THB',
    owner: extras?.owner ? { id: extras.owner.publicId, displayName: extras.owner.displayName } : null,
    spentPct,
    promotionsCount: extras?.promotionsCount ?? 0,
    createdAt: toBangkokIso(c.createdAt),
  };
}

export function promotionDto(
  p: PromotionRow,
  usage?: { redemptions: number; discountAmount: string; cappedAmount: string },
): PromotionDto {
  const summary = benefitSummary(p.benefit);
  return {
    id: p.publicId,
    name: p.name,
    description: p.description,
    campaignId: p.campaign?.publicId ?? null,
    kind: p.kind,
    priority: p.priority,
    stacking: p.stacking,
    stackGroup: p.stackGroup,
    status: p.status,
    startsAt: toBangkokIso(p.startsAt),
    endsAt: p.endsAt ? toBangkokIso(p.endsAt) : null,
    conditions: p.conditions as Record<string, unknown>,
    benefit: p.benefit as Record<string, unknown>,
    usageLimitTotal: p.usageLimitTotal,
    usageLimitPerCustomer: p.usageLimitPerCustomer,
    budgetAmount: p.budgetAmount?.toFixed(2) ?? null,
    spentAmount: p.spentAmount.toFixed(2),
    benefitSummaryTh: summary.th,
    benefitSummaryEn: summary.en,
    usage: usage ?? { redemptions: 0, discountAmount: '0.00', cappedAmount: '0.00' },
    campaign: p.campaign ? { id: p.campaign.publicId, code: p.campaign.code, name: p.campaign.name } : null,
    updatedAt: toBangkokIso(p.updatedAt),
  };
}

export function couponDto(
  c: CouponCode & { assignedUser?: User | null; batch?: { publicId: string } | null },
): CouponCodeDto {
  return {
    id: c.publicId,
    code: c.code,
    status: c.status,
    usageLimit: c.usageLimit,
    usedCount: c.usedCount,
    assignedCustomerId: c.assignedUser?.publicId ?? null,
    assignedCustomer: c.assignedUser ? { id: c.assignedUser.publicId, displayName: c.assignedUser.displayName } : null,
    batchId: c.batch?.publicId ?? null,
  };
}
