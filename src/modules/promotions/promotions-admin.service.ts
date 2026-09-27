import { randomBytes, randomUUID } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Campaign,
  type CampaignStatus,
  type CouponKind,
  type Prisma,
  type Promotion,
  type PromotionStatus,
} from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { csvCell } from '@platform/audit/audit-query.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

import { assertPromotionShape } from './promotion-schemas';

export const campaignEtag = (c: Campaign) => etagOf(c.publicId, c.rowVersion);
export const promotionEtag = (p: Promotion) => etagOf(p.publicId, p.rowVersion);

export const PROMOTION_INCLUDE = { campaign: true } as const satisfies Prisma.PromotionInclude;
export type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof PROMOTION_INCLUDE }>;

export interface CampaignInput {
  code: string;
  name: string;
  startsAt: string;
  endsAt?: string | null;
  budgetAmount?: string | null;
  goals?: Record<string, unknown>;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  campaignId?: string | null;
  kind: 'coupon' | 'automatic';
  priority: number;
  stacking: 'exclusive' | 'stackable' | 'best_of';
  stackGroup?: string | null;
  startsAt: string;
  endsAt?: string | null;
  conditions: Record<string, unknown>;
  benefit: Record<string, unknown>;
  usageLimitTotal?: number | null;
  usageLimitPerCustomer?: number | null;
  budgetAmount?: string | null;
}

export interface CouponInput {
  kind: CouponKind;
  /** `single`: the code; `bulk_unique`: `count` codes with `prefix`; `per_customer`: one per customer. */
  code?: string;
  count?: number;
  prefix?: string;
  customerIds?: string[];
  usageLimit?: number | null;
}

const CAMPAIGN_ACTIONS: Record<
  string,
  { from: CampaignStatus[]; to: (c: Campaign, now: Date) => CampaignStatus }
> = {
  activate: {
    from: ['draft', 'paused', 'scheduled'],
    to: (c, now) => (c.startsAt > now ? 'scheduled' : 'active'),
  },
  pause: { from: ['active', 'scheduled'], to: () => 'paused' },
  end: { from: ['draft', 'scheduled', 'active', 'paused', 'exhausted'], to: () => 'ended' },
};
const PROMOTION_ACTIONS: Record<string, { from: PromotionStatus[]; to: PromotionStatus }> = {
  activate: { from: ['draft', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  end: { from: ['draft', 'active', 'paused'], to: 'ended' },
};

const EXPORT_URL_TTL_SECONDS = 5 * 60;

function invalid(path: string, message: string): never {
  throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
}

/** Unambiguous code alphabet (no 0/O, 1/I). */
function randomCode(prefix: string, length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return prefix + [...randomBytes(length)].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Marketing's promotions admin (D-053, D-154): campaigns with THB budgets, promotions with validated
 * conditions and benefits, coupon codes (single, bulk-unique, per-customer) and a redemption report.
 * Every change is audited as an activity and published as an event.
 */
@Injectable()
export class PromotionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly entities: EntitiesService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- campaigns ----------------------------------------------------------------------------------------

  listCampaigns(where: Prisma.CampaignWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.campaign.count({ where }),
    ]);
  }

  async campaign(publicId: string, db: Tx = this.prisma): Promise<Campaign> {
    const row = await db.campaign.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createCampaign(actor: UserActor, input: CampaignInput): Promise<Campaign> {
    this.window(input.startsAt, input.endsAt ?? null);
    const alert = await this.settings.at('campaigns.budget_alert_pct');
    return this.prisma.withTx(async (tx) => {
      if (await tx.campaign.findUnique({ where: { code: input.code } }))
        throw new DomainException('promotions.code_taken', { params: { code: input.code } });
      const row = await tx.campaign.create({
        data: {
          entityId: await this.entities.defaultEntityId(),
          code: input.code,
          name: input.name,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          budgetAmount: input.budgetAmount ?? null,
          alertThresholdPct: String(alert.value),
          goals: (input.goals ?? {}) as Prisma.InputJsonValue,
          ownerUserId: actor.userId,
          createdById: actor.userId,
        },
      });
      await this.record(
        tx,
        'campaign',
        row.publicId,
        'campaign.created',
        { code: row.code, budgetAmount: input.budgetAmount ?? null },
        actor,
      );
      return row;
    });
  }

  async updateCampaign(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: Partial<Omit<CampaignInput, 'code'>>,
  ): Promise<Campaign> {
    return this.prisma.withTx(async (tx) => {
      const current = await this.campaign(publicId, tx);
      assertIfMatch(ifMatch, campaignEtag(current));
      if (current.status === 'ended') throw new DomainException('promotions.ended');
      const startsAt = input.startsAt ?? current.startsAt.toISOString();
      const endsAt = input.endsAt === undefined ? (current.endsAt?.toISOString() ?? null) : input.endsAt;
      this.window(startsAt, endsAt);
      if (
        input.budgetAmount !== undefined &&
        input.budgetAmount !== null &&
        new MoneyDecimal(input.budgetAmount).lt(current.spentAmount.toString())
      )
        invalid('budgetAmount', `must cover what is already spent (${current.spentAmount.toFixed(2)})`);
      const row = await tx.campaign.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          startsAt: new Date(startsAt),
          endsAt: endsAt ? new Date(endsAt) : null,
          ...(input.budgetAmount !== undefined && { budgetAmount: input.budgetAmount }),
          ...(input.goals !== undefined && { goals: input.goals as Prisma.InputJsonValue }),
          // A raised budget reopens an exhausted campaign (D-154).
          ...(current.status === 'exhausted' &&
            input.budgetAmount !== undefined && { status: 'active', alertedAt: null }),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        'campaign',
        row.publicId,
        'campaign.updated',
        { fields: Object.keys(input) },
        actor,
      );
      return row;
    });
  }

  async campaignAction(
    actor: UserActor,
    publicId: string,
    action: string,
    ifMatch: string | undefined,
  ): Promise<Campaign> {
    const rule = CAMPAIGN_ACTIONS[action];
    if (!rule) throw new DomainException('http.not_found');
    return this.prisma.withTx(async (tx) => {
      const current = await this.campaign(publicId, tx);
      assertIfMatch(ifMatch, campaignEtag(current), { required: false });
      if (!rule.from.includes(current.status))
        throw new DomainException('promotions.invalid_transition', {
          params: { from: current.status, action },
        });
      const to = rule.to(current, new Date());
      const row = await tx.campaign.update({
        where: { id: current.id },
        data: { status: to, rowVersion: { increment: 1 } },
      });
      await this.record(tx, 'campaign', row.publicId, `campaign.${to}`, { from: current.status }, actor);
      return row;
    });
  }

  // --- promotions ---------------------------------------------------------------------------------------

  listPromotions(where: Prisma.PromotionWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: PROMOTION_INCLUDE,
        orderBy: [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.promotion.count({ where }),
    ]);
  }

  async promotion(publicId: string, db: Tx = this.prisma): Promise<PromotionRow> {
    const row = await db.promotion.findUnique({ where: { publicId }, include: PROMOTION_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createPromotion(actor: UserActor, input: PromotionInput): Promise<PromotionRow> {
    assertPromotionShape(input.conditions, input.benefit);
    this.window(input.startsAt, input.endsAt ?? null);
    return this.prisma.withTx(async (tx) => {
      const campaign = input.campaignId ? await this.campaign(input.campaignId, tx) : null;
      const row = await tx.promotion.create({
        data: {
          entityId: await this.entities.defaultEntityId(),
          campaignId: campaign?.id ?? null,
          name: input.name,
          description: input.description ?? null,
          kind: input.kind,
          priority: input.priority,
          stacking: input.stacking,
          stackGroup: input.stackGroup ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          conditions: input.conditions as Prisma.InputJsonValue,
          benefit: input.benefit as Prisma.InputJsonValue,
          usageLimitTotal: input.usageLimitTotal ?? null,
          usageLimitPerCustomer: input.usageLimitPerCustomer ?? null,
          budgetAmount: input.budgetAmount ?? null,
          createdById: actor.userId,
        },
      });
      await this.record(
        tx,
        'promotion',
        row.publicId,
        'promotion.created',
        { kind: row.kind, campaignId: campaign?.publicId ?? null },
        actor,
      );
      return this.promotion(row.publicId, tx);
    });
  }

  /** Edits a promotion that has not ended; orders already placed keep their redemption snapshot. */
  async updatePromotion(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: Partial<Omit<PromotionInput, 'kind' | 'campaignId'>>,
  ): Promise<PromotionRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await this.promotion(publicId, tx);
      assertIfMatch(ifMatch, promotionEtag(current));
      if (current.kind === 'referral') throw new DomainException('promotions.system_managed');
      if (current.status === 'ended') throw new DomainException('promotions.ended');
      const conditions = input.conditions ?? (current.conditions as Record<string, unknown>);
      const benefit = input.benefit ?? (current.benefit as Record<string, unknown>);
      assertPromotionShape(conditions, benefit);
      const startsAt = input.startsAt ?? current.startsAt.toISOString();
      const endsAt = input.endsAt === undefined ? (current.endsAt?.toISOString() ?? null) : input.endsAt;
      this.window(startsAt, endsAt);
      await tx.promotion.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.stacking !== undefined && { stacking: input.stacking }),
          ...(input.stackGroup !== undefined && { stackGroup: input.stackGroup }),
          ...(input.usageLimitTotal !== undefined && { usageLimitTotal: input.usageLimitTotal }),
          ...(input.usageLimitPerCustomer !== undefined && {
            usageLimitPerCustomer: input.usageLimitPerCustomer,
          }),
          ...(input.budgetAmount !== undefined && { budgetAmount: input.budgetAmount }),
          startsAt: new Date(startsAt),
          endsAt: endsAt ? new Date(endsAt) : null,
          conditions: conditions as Prisma.InputJsonValue,
          benefit: benefit as Prisma.InputJsonValue,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        'promotion',
        current.publicId,
        'promotion.updated',
        { fields: Object.keys(input) },
        actor,
      );
      return this.promotion(current.publicId, tx);
    });
  }

  async promotionAction(actor: UserActor, publicId: string, action: string, ifMatch: string | undefined) {
    const rule = PROMOTION_ACTIONS[action];
    if (!rule) throw new DomainException('http.not_found');
    return this.prisma.withTx(async (tx) => {
      const current = await this.promotion(publicId, tx);
      assertIfMatch(ifMatch, promotionEtag(current), { required: false });
      if (current.kind === 'referral') throw new DomainException('promotions.system_managed');
      if (!rule.from.includes(current.status))
        throw new DomainException('promotions.invalid_transition', {
          params: { from: current.status, action },
        });
      if (
        action === 'activate' &&
        current.kind === 'coupon' &&
        (await tx.couponCode.count({ where: { promotionId: current.id } })) === 0
      )
        throw new DomainException('promotions.no_codes');
      await tx.promotion.update({
        where: { id: current.id },
        data: { status: rule.to, updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        'promotion',
        current.publicId,
        `promotion.${rule.to}`,
        { from: current.status },
        actor,
      );
      return this.promotion(current.publicId, tx);
    });
  }

  // --- coupon codes ------------------------------------------------------------------------------------

  async generateCoupons(actor: UserActor, promotionPublicId: string, input: CouponInput) {
    return this.prisma.withTx(async (tx) => {
      const promotion = await this.promotion(promotionPublicId, tx);
      if (promotion.kind !== 'coupon') throw new DomainException('promotions.not_a_coupon');
      if (promotion.status === 'ended') throw new DomainException('promotions.ended');
      const rows: { code: string; assignedUserId: bigint | null }[] = [];
      if (input.kind === 'single') {
        if (!input.code) invalid('code', 'a single coupon needs its code');
        rows.push({ code: input.code, assignedUserId: null });
      } else if (input.kind === 'bulk_unique') {
        const count = input.count ?? 0;
        if (count < 1 || count > 10_000) invalid('count', 'between 1 and 10,000');
        const prefix = (input.prefix ?? '').toUpperCase();
        const seen = new Set<string>();
        while (seen.size < count) seen.add(randomCode(prefix));
        for (const code of seen) rows.push({ code, assignedUserId: null });
      } else {
        const ids = input.customerIds ?? [];
        if (ids.length === 0 || ids.length > 5_000) invalid('customerIds', 'between 1 and 5,000 customers');
        const users = await tx.user.findMany({
          where: { publicId: { in: ids }, kind: 'customer' },
          select: { id: true },
        });
        if (users.length !== new Set(ids).size) invalid('customerIds', 'unknown customer');
        const prefix = (input.prefix ?? '').toUpperCase();
        for (const u of users) rows.push({ code: randomCode(prefix), assignedUserId: u.id });
      }
      const clash = await tx.couponCode.findFirst({
        where: { code: { in: rows.map((r) => r.code), mode: 'insensitive' } },
      });
      if (clash) throw new DomainException('promotions.code_taken', { params: { code: clash.code } });
      const batch = await tx.couponBatch.create({
        data: {
          promotionId: promotion.id,
          kind: input.kind,
          count: rows.length,
          prefix: input.prefix ? input.prefix.toUpperCase() : null,
          createdById: actor.userId,
        },
      });
      await tx.couponCode.createMany({
        data: rows.map((r) => ({
          promotionId: promotion.id,
          batchId: batch.id,
          code: r.code,
          assignedUserId: r.assignedUserId,
          usageLimit: input.kind === 'single' ? (input.usageLimit ?? null) : (input.usageLimit ?? 1),
        })),
      });
      await this.record(
        tx,
        'promotion',
        promotion.publicId,
        'promotion.coupons_generated',
        { kind: input.kind, count: rows.length },
        actor,
      );
      return { batchId: batch.publicId, count: rows.length };
    });
  }

  coupons(promotionId: bigint, page: number, perPage: number) {
    return Promise.all([
      this.prisma.couponCode.findMany({
        where: { promotionId },
        include: { assignedUser: true },
        orderBy: { id: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.couponCode.count({ where: { promotionId } }),
    ]);
  }

  async setCouponStatus(
    actor: UserActor,
    promotionPublicId: string,
    couponPublicId: string,
    disabled: boolean,
  ) {
    return this.prisma.withTx(async (tx) => {
      const promotion = await this.promotion(promotionPublicId, tx);
      const code = await tx.couponCode.findFirst({
        where: { publicId: couponPublicId, promotionId: promotion.id },
      });
      if (!code) throw new DomainException('http.not_found');
      const row = await tx.couponCode.update({
        where: { id: code.id },
        data: {
          status: disabled
            ? 'disabled'
            : code.usageLimit !== null && code.usedCount >= code.usageLimit
              ? 'used_up'
              : 'active',
        },
      });
      await this.record(
        tx,
        'promotion',
        promotion.publicId,
        disabled ? 'promotion.coupon_disabled' : 'promotion.coupon_enabled',
        { code: row.code },
        actor,
      );
      return row;
    });
  }

  /**
   * CSV of a promotion's codes (optionally one batch) for Marketing to distribute, as a transient file
   * behind a 5-minute signed URL. Codes are bearer values: the export is audited (`export.generated`).
   */
  async exportCoupons(actor: UserActor, promotionPublicId: string, batchPublicId?: string) {
    const promotion = await this.promotion(promotionPublicId);
    if (promotion.kind !== 'coupon') throw new DomainException('promotions.not_a_coupon');
    const batch = batchPublicId
      ? await this.prisma.couponBatch.findFirst({
          where: { publicId: batchPublicId, promotionId: promotion.id },
        })
      : null;
    if (batchPublicId && !batch) throw new DomainException('http.not_found');
    const codes = await this.prisma.couponCode.findMany({
      where: { promotionId: promotion.id, ...(batch && { batchId: batch.id }) },
      include: { assignedUser: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
    const lines = codes.map((c) =>
      [c.code, c.status, c.usageLimit ?? '', c.usedCount, c.assignedUser?.publicId ?? '']
        .map(csvCell)
        .join(','),
    );
    const csv = ['code,status,usage_limit,used_count,assigned_customer_id', ...lines].join('\r\n') + '\r\n';
    const body = Buffer.from(`\uFEFF${csv}`, 'utf8');
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: `coupons-${now.toISOString().slice(0, 10)}.csv`,
        mimeType: 'text/csv',
        sizeBytes: BigInt(body.length),
        uploadStatus: 'uploaded',
        // Generated by the system from its own data: nothing to scan.
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: 'transient',
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `transient/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, body, 'text/csv; charset=utf-8');
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: 'promotion',
      resourcePublicId: promotion.publicId,
      data: { codes: codes.length, batchId: batch?.publicId ?? null, fileId: file.publicId },
    });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: EXPORT_URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: 'text/csv',
    });
    return {
      fileId: file.publicId,
      url,
      codes: codes.length,
      expiresAt: new Date(now.getTime() + EXPORT_URL_TTL_SECONDS * 1000),
    };
  }

  // --- report (D-053 "reports") ------------------------------------------------------------------------

  async report(where: Prisma.PromotionRedemptionWhereInput) {
    const redemptions = await this.prisma.promotionRedemption.findMany({
      where: { ...where, status: { in: ['reserved', 'applied'] } },
      include: { orderGroup: true },
    });
    const sum = (f: (r: (typeof redemptions)[number]) => string) =>
      formatMoney(redemptions.reduce((a, r) => a.add(f(r)), new MoneyDecimal(0)));
    const groups = new Map(redemptions.map((r) => [r.orderGroupId, r.orderGroup]));
    const applied = redemptions.filter((r) => r.status === 'applied');
    return {
      redemptions: redemptions.length,
      appliedRedemptions: applied.length,
      discountAmount: sum((r) => r.amount.toFixed(2)),
      cappedAmount: sum((r) => r.cappedAmount.toFixed(2)),
      orderGroups: groups.size,
      grossAmount: formatMoney(
        [...groups.values()].reduce((a, g) => a.add(g.grossAmount.toString()), new MoneyDecimal(0)),
      ),
      customers: new Set(redemptions.map((r) => r.customerUserId.toString())).size,
    };
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private window(startsAt: string, endsAt: string | null) {
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) invalid('endsAt', 'must be after startsAt');
  }

  private async record(
    tx: Tx,
    aggregateType: 'campaign' | 'promotion',
    publicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const key = aggregateType === 'campaign' ? 'campaignId' : 'promotionId';
    const event = await this.events.record(
      tx,
      { type, aggregateType, aggregateId: publicId, payload: { [key]: publicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType,
      aggregatePublicId: publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }
}
