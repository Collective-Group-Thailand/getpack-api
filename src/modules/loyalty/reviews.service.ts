import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type OrderReview, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { LoyaltyService } from './loyalty.service';

export const REVIEW_INCLUDE = {
  order: { select: { publicId: true, orderCode: true } },
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
      const review = await tx.orderReview.create({
        data: {
          orderId: order.id,
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
