import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { OrdersService } from '@modules/orders/orders.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  OrderProgressDto,
  PROGRESS_EXAMPLE,
  PublicTrackingDto,
  STAFF_TIMELINE_ENTRY_EXAMPLE,
  StaffTimelineEntryDto,
  TIMELINE_ENTRY_EXAMPLE,
  TimelineEntryDto,
  TimelineQuery,
  TRACKING_EXAMPLE,
  TrackingLinkDto,
} from './timeline.dto';
import { TimelineService } from './timeline.service';

const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });

/**
 * Public tracking is anonymous: a tighter per-client limit than the API default guards the token space
 * (technical limit, overridable by environment like the login throttle).
 */
export const TRACKING_THROTTLE = {
  default: { limit: () => Number(process.env.TRACKING_THROTTLE_LIMIT ?? 30), ttl: 60_000 },
};

function customerId(actor: Actor): bigint {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor.userId;
}

@ApiSurface('store', 'timeline')
@Controller()
export class StoreTimelineController {
  constructor(
    private readonly timeline: TimelineService,
    private readonly orders: OrdersService,
  ) {}

  @Get('orders/:orderId/timeline')
  @orderParam
  @ApiEndpoint({
    id: 'store.timeline.get',
    summary: 'My order’s timeline',
    description:
      'Chronological, cursor-paged: ordered → paid instalments → artwork and proofs → production steps with ' +
      'their labels and shared photos → shipments and carrier steps → proof of delivery → completed. No factory ' +
      'identity or costs (D-050).',
    implements: ['D-050', 'D-075', 'D-143'],
  })
  @ApiCursorPaginated(TimelineEntryDto, { example: TIMELINE_ENTRY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() q: TimelineQuery,
  ) {
    const order = await this.orders.order({ publicId: orderId }, customerId(actor));
    return this.timeline.customer(order, q.cursor, q.limit);
  }

  @Get('orders/:orderId/progress')
  @orderParam
  @ApiEndpoint({
    id: 'store.timeline.progress',
    summary: 'Promised vs actual for my order',
    description: 'The promised ship date against the actual facts and the customer-visible production steps.',
    implements: ['D-075', 'D-081'],
  })
  @ApiSuccess(200, { description: 'Progress', type: OrderProgressDto, example: PROGRESS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async progress(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.timeline.progress(await this.orders.order({ publicId: orderId }, customerId(actor)));
  }

  @Post('orders/:orderId/tracking-links')
  @Idempotent()
  @orderParam
  @ApiEndpoint({
    id: 'store.timeline.createTrackingLink',
    summary: 'Create a shareable tracking link',
    description:
      'A link anyone can open without signing in; it shows progress and shipment steps but no personal data. ' +
      'The token is shown once (only its hash is kept).',
    implements: ['D-143'],
  })
  @ApiSuccess(201, {
    description: 'Created',
    type: TrackingLinkDto,
    example: {
      url: 'https://www.getpack.example/track/q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh',
      token: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async createLink(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.timeline.createLink(actor, await this.orders.order({ publicId: orderId }, customerId(actor)));
  }
}

@ApiSurface('store', 'tracking')
@Controller()
export class PublicTrackingController {
  constructor(private readonly timeline: TimelineService) {}

  @Get('track/:token')
  @Public()
  @Throttle(TRACKING_THROTTLE)
  @ApiParam({ name: 'token', example: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh' })
  @ApiEndpoint({
    id: 'store.tracking.get',
    summary: 'Track an order or a shipment',
    description:
      'From a carton label QR or a shared link. Status, promised and actual dates, production steps and ' +
      'shipment steps only — no names, addresses, phones, locations or photos. Unknown, revoked or expired ' +
      'tokens are 404. Rate-limited per client.',
    implements: ['D-143', 'D-142'],
  })
  @ApiSuccess(200, { description: 'Tracking', type: PublicTrackingDto, example: TRACKING_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'http.too_many_requests')
  track(@Param('token') token: string) {
    return this.timeline.track(token);
  }
}

@ApiSurface('admin', 'timeline')
@Controller()
export class AdminTimelineController {
  constructor(
    private readonly timeline: TimelineService,
    private readonly orders: OrdersService,
  ) {}

  @Get('orders/:orderId/timeline')
  @Can('orders.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.timeline.get',
    summary: 'An order’s full timeline',
    description:
      'Everything that happened to the order, its group, its production jobs and shipments (internal and ' +
      'factory steps included), with internal notes and their @mentions. Chronological, cursor-paged.',
    implements: ['D-143', 'D-075'],
  })
  @ApiCursorPaginated(StaffTimelineEntryDto, { example: STAFF_TIMELINE_ENTRY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('orderId', ParseUUIDPipe) orderId: string, @Query() q: TimelineQuery) {
    return this.timeline.staff(await this.orders.order({ publicId: orderId }), q.cursor, q.limit);
  }

  @Get('orders/:orderId/progress')
  @Can('orders.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.timeline.progress',
    summary: 'Promised vs actual for an order',
    description: 'The promised ship date against the actual facts and the customer-visible production steps.',
    implements: ['D-075', 'D-081'],
  })
  @ApiSuccess(200, { description: 'Progress', type: OrderProgressDto, example: PROGRESS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async progress(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.timeline.progress(await this.orders.order({ publicId: orderId }));
  }
}
