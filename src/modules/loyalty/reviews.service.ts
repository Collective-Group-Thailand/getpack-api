import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type OrderReview, Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { LoyaltyService } from './loyalty.service';

export const REVIEW_INCLUDE = {
  order: {
    select: {
      publicId: true,
      orderCode: true,
      productType: { select: { code: true, nameTh: true, nameEn: true } },
    },
  },
  user: { select: { publicId: true, displayName: true } },
  pointsEntries: { select: { points: true } },
} as const satisfies Prisma.OrderReviewInclude;
export type ReviewRow = Prisma.OrderReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

/**
 * Order reviews (D-135): the customer reviews a delivered order once and gets the review reward (THB 10 in
 * points, credited at once); CS hides or re-publishes reviews. Hiding keeps the reward.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    actor: UserActor,
    orderPublicId: string,
    input: { rating: number; comment?: string | null },
  ): Promise<ReviewRow> {
    return this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({ where: { publicId: orderPublicId } });
      if (!order || order.customerUserId !== actor.userId) throw new DomainException('http.not_found');
      if (!order.deliveredAt) throw new DomainException('reviews.not_delivered');
      if (await tx.orderReview.findUnique({ where: { orderId: order.id } }))
        throw new DomainException('reviews.exists');
      // D-265: the review is of the order's product line (an order has one).
      const line = await tx.orderLine.findFirst({
        where: { orderId: order.id, lineType: 'product' },
        orderBy: { lineNo: 'asc' },
        select: { id: true },
      });
      const review = await tx.orderReview.create({
        data: {
          orderId: order.id,
          orderLineId: line?.id ?? null,
          userId: actor.userId,
          rating: input.rating,
          comment: input.comment?.trim() || null,
        },
      });
      const rewards = await this.settings.at('loyalty.activity_rewards', { tx });
      await this.loyalty.reward(
        tx,
        actor.userId,
        'earn_review',
        rewards.value.reviewBaht,
        { reviewId: review.id, orderId: order.id },
        actor,
      );
      await this.record(tx, review, order.publicId, 'review.submitted', { rating: review.rating }, actor);
      return this.get(review.publicId, tx);
    });
  }

  async forOrder(userId: bigint, orderPublicId: string): Promise<ReviewRow> {
    const review = await this.prisma.orderReview.findFirst({
      where: { order: { publicId: orderPublicId, customerUserId: userId } },
      include: REVIEW_INCLUDE,
    });
    if (!review) throw new DomainException('http.not_found');
    return review;
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<ReviewRow> {
    const row = await db.orderReview.findUnique({ where: { publicId }, include: REVIEW_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  list(where: Prisma.OrderReviewWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.orderReview.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.orderReview.count({ where }),
    ]);
  }

  async moderate(actor: UserActor, publicId: string, action: 'hide' | 'publish'): Promise<ReviewRow> {
    return this.prisma.withTx(async (tx) => {
      const review = await tx.orderReview.findUnique({ where: { publicId }, include: { order: true } });
      if (!review) throw new DomainException('http.not_found');
      const status = action === 'hide' ? 'hidden' : 'published';
      if (review.status !== status) {
        const row = await tx.orderReview.update({
          where: { id: review.id },
          data: {
            status,
            moderatedById: actor.userId,
            moderatedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await this.record(tx, row, review.order.publicId, `review.${status}`, { from: review.status }, actor);
      }
      return this.get(publicId, tx);
    });
  }

  /** D-265: CS writes the one reply to a review, or edits it (an edit is audited). */
  async reply(actor: UserActor, publicId: string, body: string): Promise<ReviewRow> {
    return this.prisma.withTx(async (tx) => {
      const review = await tx.orderReview.findUnique({ where: { publicId }, include: { order: true } });
      if (!review) throw new DomainException('http.not_found');
      const row = await tx.orderReview.update({
        where: { id: review.id },
        data: {
          replyBody: body.trim(),
          repliedAt: new Date(),
          repliedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (review.replyBody !== null)
        await this.audit.record(tx, {
          category: 'data_access',
          action: 'review.reply_edited',
          actor,
          resourceType: 'order_review',
          resourcePublicId: review.publicId,
          data: { previous: review.replyBody, next: body.trim() },
        });
      await this.record(
        tx,
        row,
        review.order.publicId,
        'review.replied',
        { edited: review.replyBody !== null },
        actor,
      );
      return this.get(publicId, tx);
    });
  }

  /** D-265: published reviews for the public, newest first, optionally of one product type. */
  listPublic(productTypeCode: string | undefined, page: number, perPage: number) {
    return this.list(
      {
        status: 'published',
        ...(productTypeCode ? { order: { productType: { code: productTypeCode } } } : {}),
      },
      page,
      perPage,
    );
  }

  /** D-265: count, average and distribution of published reviews, overall and per product type. */
  async summary(productTypeCode?: string) {
    const rows = await this.prisma.$queryRaw<{ code: string; rating: number; n: bigint }[]>`
      SELECT pt.code, r.rating, count(*) AS n FROM order_reviews r
        JOIN orders o ON o.id = r.order_id JOIN product_types pt ON pt.id = o.product_type_id
       WHERE r.status = 'published' ${productTypeCode ? Prisma.sql`AND pt.code = ${productTypeCode}` : Prisma.empty}
       GROUP BY pt.code, r.rating`;
    const stats = (list: typeof rows) => {
      const count = list.reduce((a, r) => a + Number(r.n), 0);
      const sum = list.reduce((a, r) => a + r.rating * Number(r.n), 0);
      return { count, averageRating: count ? (sum / count).toFixed(2) : null };
    };
    const codes = [...new Set(rows.map((r) => r.code))].sort();
    return {
      ...stats(rows),
      distribution: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: rows.filter((r) => r.rating === rating).reduce((a, r) => a + Number(r.n), 0),
      })),
      byProductType: codes.map((code) => ({
        productTypeCode: code,
        ...stats(rows.filter((r) => r.code === code)),
      })),
    };
  }

  private async record(
    tx: Tx,
    review: OrderReview,
    orderPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'order',
        aggregateId: orderPublicId,
        payload: { orderId: orderPublicId, reviewId: review.publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: orderPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
