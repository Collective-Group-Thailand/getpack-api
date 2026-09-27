import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { CustomersService } from '@modules/customers/customers.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AdjustPointsDto,
  ADMIN_REVIEW_EXAMPLE,
  AdminReviewDto,
  ENTRY_EXAMPLE,
  LoyaltySummaryDto,
  PointsEntryDto,
  REVIEW_EXAMPLE,
  ReviewDto,
  ReviewListQuery,
  SubmitReviewDto,
  SUMMARY_EXAMPLE,
} from './loyalty.dto';
import { LoyaltyService } from './loyalty.service';
import { adminReviewDto, entryDto, reviewDto, summaryDto } from './loyalty-views';
import { ReviewsService } from './reviews.service';

const DECISIONS = ['D-130', 'D-131', 'D-132', 'D-133', 'D-134'];

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'loyalty')
@Controller('loyalty')
export class StoreLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.loyalty.get',
    summary: 'Get my points and tier',
    description:
      'Available points (redeemable at checkout with `redeemPoints`, D-133), pending points from completed ' +
      'orders (credited after the claim window, D-132), points expiring within 30 days, the point value ' +
      '(D-131) and my tier from 12-month spend (D-134).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Points and tier', type: LoyaltySummaryDto, example: SUMMARY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async summary(@CurrentActor() actor: Actor): Promise<LoyaltySummaryDto> {
    return summaryDto(await this.loyalty.summary(customer(actor).userId));
  }

  @Get('ledger')
  @ApiEndpoint({
    id: 'store.loyalty.ledger',
    summary: 'List my points history',
    description: 'Every earning, redemption, reversal and expiry, newest first (D-130…D-133).',
    implements: DECISIONS,
  })
  @ApiPaginated(PointsEntryDto, { example: ENTRY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async ledger(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const [rows, total] = await this.loyalty.ledger(customer(actor).userId, q.page, q.perPage);
    return { data: rows.map(entryDto), meta: { page: q.page, perPage: q.perPage, total } };
  }
}

const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });

@ApiSurface('store', 'reviews')
@Controller('orders/:orderId/review')
export class StoreReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @orderParam
  @ApiEndpoint({
    id: 'store.reviews.submit',
    summary: 'Review my delivered order',
    description:
      'Once per order, after delivery; earns the review reward (D-135: THB 10 in points at the point value, ' +
      'credited at once).',
    implements: ['D-135', 'D-131'],
  })
  @ApiBody({ type: SubmitReviewDto, examples: { default: { value: { rating: 5, comment: 'กล่องสวย ส่งตรงเวลา' } } } })
  @ApiSuccess(201, { description: 'Review', type: ReviewDto, example: REVIEW_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed', 'reviews.not_delivered', 'reviews.exists')
  async submit(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitReviewDto,
  ): Promise<ReviewDto> {
    return reviewDto(await this.reviews.submit(customer(actor), orderId, body));
  }

  @Get()
  @orderParam
  @ApiEndpoint({ id: 'store.reviews.get', summary: 'Get my review of an order', description: 'With the points it earned (D-135).', implements: ['D-135'] })
  @ApiSuccess(200, { description: 'Review', type: ReviewDto, example: REVIEW_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<ReviewDto> {
    return reviewDto(await this.reviews.forOrder(customer(actor).userId, orderId));
  }
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

const customerParam = ApiParam({ name: 'customerId', format: 'uuid' });

@ApiSurface('admin', 'loyalty')
@Controller('customers/:customerId/loyalty')
export class AdminLoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly customers: CustomersService,
  ) {}

  @Get()
  @Can('loyalty.read')
  @customerParam
  @ApiEndpoint({
    id: 'admin.loyalty.get',
    summary: 'Get a customer’s points and tier',
    description: 'Available, pending and expiring points, point value and tier (D-130…D-134).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Points and tier', type: LoyaltySummaryDto, example: SUMMARY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async summary(@Param('customerId', ParseUUIDPipe) customerId: string): Promise<LoyaltySummaryDto> {
    return summaryDto(await this.loyalty.summary(await this.customers.customerIdOf(customerId)));
  }

  @Get('ledger')
  @Can('loyalty.read')
  @customerParam
  @ApiEndpoint({ id: 'admin.loyalty.ledger', summary: 'List a customer’s points history', description: 'Newest first, with staff adjustments and their reasons.', implements: DECISIONS })
  @ApiPaginated(PointsEntryDto, { example: ENTRY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async ledger(@Param('customerId', ParseUUIDPipe) customerId: string, @Query() q: PageQuery) {
    const [rows, total] = await this.loyalty.ledger(await this.customers.customerIdOf(customerId), q.page, q.perPage);
    return { data: rows.map(entryDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('adjustments')
  @Can('loyalty.adjust')
  @Idempotent()
  @customerParam
  @ApiEndpoint({
    id: 'admin.loyalty.adjust',
    summary: 'Adjust a customer’s points',
    description:
      'Adds points (a lot expiring after `loyalty.points_expiry`) or removes them (FIFO from the lots, never ' +
      'below zero) with a reason; audited as a finance action. Needs `Idempotency-Key`.',
    implements: ['D-131', 'D-132'],
  })
  @ApiBody({ type: AdjustPointsDto, examples: { default: { value: { points: 40, reason: 'ชดเชยงานล่าช้า' } } } })
  @ApiSuccess(201, { description: 'Ledger entry', type: PointsEntryDto, example: { ...ENTRY_EXAMPLE, entryType: 'adjust', points: 40, bahtValue: '100.00', status: 'available', availableAt: null, orderCode: null, groupCode: null, reason: 'ชดเชยงานล่าช้า' } })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed', 'loyalty.insufficient_points')
  async adjust(
    @CurrentActor() actor: Actor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: AdjustPointsDto,
  ): Promise<PointsEntryDto> {
    const entry = await this.loyalty.adjust(staff(actor), await this.customers.customerIdOf(customerId), body.points, body.reason);
    return entryDto({ ...entry, order: null, orderGroup: null });
  }
}

@ApiSurface('admin', 'reviews')
@Controller('reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @Can('orders.read')
  @ApiEndpoint({ id: 'admin.reviews.list', summary: 'List order reviews', description: 'Newest first; filter by status (D-135).', implements: ['D-135'] })
  @ApiPaginated(AdminReviewDto, { example: ADMIN_REVIEW_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: ReviewListQuery) {
    const [rows, total] = await this.reviews.list(q.status ? { status: q.status } : {}, q.page, q.perPage);
    return { data: rows.map(adminReviewDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post(':reviewId/actions/:action')
  @HttpCode(200)
  @Can('reviews.moderate')
  @ApiParam({ name: 'reviewId', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['hide', 'publish'], enumName: 'ReviewAction' })
  @ApiEndpoint({
    id: 'admin.reviews.moderate',
    summary: 'Hide or re-publish a review',
    description: 'CS moderation; the customer keeps the review reward (D-135).',
    implements: ['D-135'],
  })
  @ApiSuccess(200, { description: 'Review', type: AdminReviewDto, example: ADMIN_REVIEW_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async moderate(
    @CurrentActor() actor: Actor,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('action') action: string,
  ): Promise<AdminReviewDto> {
    if (action !== 'hide' && action !== 'publish') throw new DomainException('http.not_found');
    return adminReviewDto(await this.reviews.moderate(staff(actor), reviewId, action));
  }
}
