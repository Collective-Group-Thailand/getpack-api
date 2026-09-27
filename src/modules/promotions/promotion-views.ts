import { toBangkokIso } from '@common/time/bangkok';
import { type Campaign, type CouponCode, type User } from '@generated/prisma/client';

import { type CampaignDto, type CouponCodeDto, type PromotionDto } from './promotions.dto';
import { type PromotionRow } from './promotions-admin.service';

export function campaignDto(c: Campaign): CampaignDto {
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
  };
}

export function promotionDto(p: PromotionRow): PromotionDto {
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
  };
}

export function couponDto(c: CouponCode & { assignedUser?: User | null }): CouponCodeDto {
  return {
    id: c.publicId,
    code: c.code,
    status: c.status,
    usageLimit: c.usageLimit,
    usedCount: c.usedCount,
    assignedCustomerId: c.assignedUser?.publicId ?? null,
  };
}
