import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { type Response } from 'express';

import { orderEtag } from './order-operations.service';
import { OrderRequoteService } from './order-requote.service';
import {
  adminOrderDto,
  adminOrderGroupDto,
  type CostGrants,
  orderDto,
  orderGroupDto,
  orderViewContext,
} from './order-views';
import {
  ADMIN_ORDER_GROUP_EXAMPLE,
  AdminOrderDto,
  AdminOrderGroupDto,
  CancelOrderDto,
  ConfirmRequoteDto,
  ORDER_EXAMPLE,
  ORDER_GROUP_EXAMPLE,
  OrderDto,
  OrderGroupDto,
  OrderGroupListQuery,
  REQUOTE_PREVIEW_EXAMPLE,
  RequotePreviewDto,
} from './orders.dto';
import { groupEtag, OrdersService } from './orders.service';

const DECISIONS = ['D-060', 'D-073', 'D-142', 'D-050', 'D-436', 'D-437', 'D-438', 'D-439'];
const groupParam = ApiParam({ name: 'groupId', format: 'uuid' });
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const CANCEL_EXAMPLE = { reasonCode: 'customer_request', note: 'ลูกค้าเปลี่ยนแบบ' };

function customerId(actor: Actor): bigint {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor.userId;
}

@ApiSurface('store', 'orders')
@Controller()
export class StoreOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
    private readonly requotes: OrderRequoteService,
  ) {}

  private ctx() {
    return orderViewContext(this.settings);
  }

  @Get('order-groups')
  @ApiEndpoint({
    id: 'store.orders.listGroups',
    summary: 'List my order groups',
    description:
      'Newest first; each group holds one order per configuration. The payment deadline is shown while unpaid ' +
      '(D-060) and an overdue group is re-quoted, never cancelled (`paymentOverdue`, D-436).',
    implements: DECISIONS,
  })
  @ApiPaginated(OrderGroupDto, { example: ORDER_GROUP_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: OrderGroupListQuery) {
    const { rows, total } = await this.orders.groups(
      { customerUserId: customerId(actor), ...(q.status ? { status: q.status } : {}) },
      q.page,
      q.perPage,
    );
    const ctx = await this.ctx();
    return {
      data: rows.map((g) => orderGroupDto(g, ctx)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('order-groups/:groupId')
  @groupParam
  @ApiEndpoint({
    id: 'store.orders.getGroup',
    summary: 'Get one of my order groups',
    description: 'The owner only; no factory data (D-050).',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Order group', type: OrderGroupDto, example: ORDER_GROUP_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const group = await this.orders.group(groupId, customerId(actor));
    res.setHeader('ETag', groupEtag(group));
    return orderGroupDto(group, await this.ctx());
  }

  @Post('order-groups/:groupId/actions/cancel')
  @HttpCode(200)
  @groupParam
  @ApiEndpoint({
    id: 'store.orders.cancelGroup',
    summary: 'Cancel my unpaid order group',
    description:
      'Only while it waits for payment and nothing is paid; after a payment CS cancels it (refund / credit ' +
      'note, B3.2 / B5). Releases reserved promotions and points.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: CancelOrderDto, examples: { default: { value: CANCEL_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: OrderGroupDto,
    example: { ...ORDER_GROUP_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'order.cancel_not_allowed',
    'order.invalid_transition',
  )
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: CancelOrderDto,
  ) {
    return orderGroupDto(
      await this.orders.cancelGroup(actor, groupId, body, { customerUserId: customerId(actor), ifMatch }),
      await this.ctx(),
    );
  }

  @Post('order-groups/:groupId/actions/requote')
  @HttpCode(200)
  @groupParam
  @ApiEndpoint({
    id: 'store.orders.requoteGroup',
    summary: 'Re-check the price of my overdue order group',
    description:
      '"ตรวจราคาใหม่และชำระ" (D-436): for an unpaid group past its payment deadline (`paymentOverdue`) — never ' +
      'cancelled for it — every order is priced again through the pricing service at today’s price, lead time ' +
      'and ship date (a new instant quotation of the same configuration, quantity and delivery postcode). ' +
      'Answers the old and new totals and the difference; nothing on the order changes until ' +
      '`store.orders.confirmRequote`. Not offered online (`order.requote_unavailable`, the team quotes): an RFQ ' +
      'or sample quotation, a reorder, discounts or add-on charges, a payment being verified or part-paid.',
    implements: ['D-436', 'D-051', 'D-060'],
  })
  @ApiSuccess(200, {
    description: 'Today’s price',
    type: RequotePreviewDto,
    example: REQUOTE_PREVIEW_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'order.requote_not_due',
    'order.requote_unavailable',
  )
  async requote(@CurrentActor() actor: Actor, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.requotes.preview(customerId(actor), groupId);
  }

  @Post('order-groups/:groupId/actions/confirm-requote')
  @HttpCode(200)
  @groupParam
  @Idempotent()
  @ApiEndpoint({
    id: 'store.orders.confirmRequote',
    summary: 'Accept today’s price of my overdue order group',
    description:
      'Writes the re-quote shown by `store.orders.requoteGroup` (D-436): every order of the group that is not ' +
      'cancelled with the quotation of the preview, and `expectedGrossAmount` = the preview’s `newGrossAmount` ' +
      '(else `order.requote_changed` — re-check again). Each order keeps its previous pricing as a revision and ' +
      'publishes `order.repriced` (the payment schedule follows, ADR-0008); the group gets a new payment deadline ' +
      '(`orders.unpaid_expiry_days`) and publishes `order_group.requoted`. Then pay with `store.payments.initiate`. ' +
      'Requires `Idempotency-Key`; a replay returns the same group.',
    implements: ['D-436', 'D-051', 'D-060'],
  })
  @ApiBody({
    type: ConfirmRequoteDto,
    examples: {
      default: {
        value: {
          orders: REQUOTE_PREVIEW_EXAMPLE.orders.map((o) => ({
            orderId: o.orderId,
            quoteId: o.quoteId,
            quoteOptionId: o.quoteOptionId,
          })),
          expectedGrossAmount: REQUOTE_PREVIEW_EXAMPLE.newGrossAmount,
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Re-quoted; pay now',
    type: OrderGroupDto,
    example: { ...ORDER_GROUP_EXAMPLE, expiresAt: REQUOTE_PREVIEW_EXAMPLE.paymentDueAt },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'order.requote_not_due',
    'order.requote_unavailable',
    'order.requote_changed',
    'order.reprice_below_paid',
    'concurrency.stale',
  )
  async confirmRequote(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: ConfirmRequoteDto,
  ) {
    customerId(actor);
    const group = await this.requotes.confirm(actor as UserActor, groupId, body);
    return orderGroupDto(group, await this.ctx());
  }

  @Get('orders/by-code/:orderCode')
  @ApiParam({ name: 'orderCode', schema: { type: 'string', pattern: '^[A-Z0-9-]{3,40}$' } })
  @ApiEndpoint({
    id: 'store.orders.getByCode',
    summary: 'Get one of my orders by its code',
    description: 'For links in e-mails and LINE (contract §3 exception); the owner only.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Order', type: OrderDto, example: ORDER_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async byCode(@CurrentActor() actor: Actor, @Param('orderCode') orderCode: string) {
    return orderDto(await this.orders.order({ orderCode }, customerId(actor)), await this.ctx());
  }

  @Get('orders/:orderId')
  @orderParam
  @ApiEndpoint({
    id: 'store.orders.get',
    summary: 'Get one of my orders',
    description:
      'Lines, destinations and the status driven by payment, artwork, production and shipping facts; ' +
      '`customerStatus` is the one status to show the customer (D-437), with who acts next and the artwork ' +
      'step owner (D-438), this order’s share of the group payment and the delivery-date basis (D-439).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Order', type: OrderDto, example: ORDER_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getOrder(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return orderDto(await this.orders.order({ publicId: orderId }, customerId(actor)), await this.ctx());
  }
}

@ApiSurface('admin', 'orders')
@Controller()
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async grants(actor: Actor): Promise<CostGrants> {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    return {
      cost: granted.has('factory_buy_prices.read'),
      margin: granted.has('margin.read'),
      perms: granted,
    };
  }

  @Get('order-groups')
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.orders.listGroups',
    summary: 'List order groups',
    description: 'Filter by status; `q` matches a group or order code, or the customer code.',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminOrderGroupDto, { example: ADMIN_ORDER_GROUP_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: OrderGroupListQuery) {
    const where: Prisma.OrderGroupWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q && {
        OR: [
          { groupCode: { equals: q.q, mode: 'insensitive' as const } },
          { orders: { some: { orderCode: { equals: q.q, mode: 'insensitive' as const } } } },
          { customer: { customerProfile: { customerCode: { equals: q.q, mode: 'insensitive' as const } } } },
        ],
      }),
    };
    const { rows, total } = await this.orders.groups(where, q.page, q.perPage);
    const grants = await this.grants(actor);
    return {
      data: rows.map((g) => adminOrderGroupDto(g, grants)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('order-groups/:groupId')
  @Can('orders.read')
  @groupParam
  @ApiEndpoint({
    id: 'admin.orders.getGroup',
    summary: 'Get an order group',
    description:
      'Staff view with CS remarks; factory cost and margin need `factory_buy_prices.read` / `margin.read` (D-141).',
    implements: [...DECISIONS, 'D-141'],
  })
  @ApiEtag()
  @ApiSuccess(200, {
    description: 'Order group',
    type: AdminOrderGroupDto,
    example: ADMIN_ORDER_GROUP_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const group = await this.orders.group(groupId);
    res.setHeader('ETag', groupEtag(group));
    return adminOrderGroupDto(group, await this.grants(actor));
  }

  @Get('orders/:orderId')
  @Can('orders.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orders.get',
    summary: 'Get an order',
    description: 'Staff view of one order (D-141 masking).',
    implements: [...DECISIONS, 'D-141'],
  })
  @ApiEtag()
  @ApiSuccess(200, {
    description: 'Order',
    type: AdminOrderDto,
    example: ADMIN_ORDER_GROUP_EXAMPLE.orders[0],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getOrder(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.orders.order({ publicId: orderId });
    res.setHeader('ETag', orderEtag(row));
    return adminOrderDto(row, await this.grants(actor));
  }

  @Post('order-groups/:groupId/actions/cancel')
  @HttpCode(200)
  @Can('orders.cancel')
  @Idempotent({ optional: true })
  @groupParam
  @ApiEndpoint({
    id: 'admin.orders.cancelGroup',
    summary: 'Cancel an order group',
    description:
      'Cancels every order that has not started production, with a reason. A paid group publishes ' +
      '`order_group.cancelled` with `refundRequired` (refund B3.2, credit note B5).',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: CancelOrderDto, examples: { default: { value: { reasonCode: 'duplicate_order' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: AdminOrderGroupDto,
    example: { ...ADMIN_ORDER_GROUP_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'order.invalid_transition',
    'concurrency.stale',
  )
  async cancelGroup(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: CancelOrderDto,
  ) {
    return adminOrderGroupDto(
      await this.orders.cancelGroup(actor, groupId, body, { ifMatch }),
      await this.grants(actor),
    );
  }

  @Post('orders/:orderId/actions/cancel')
  @HttpCode(200)
  @Can('orders.cancel')
  @Idempotent({ optional: true })
  @orderParam
  @ApiEndpoint({
    id: 'admin.orders.cancel',
    summary: 'Cancel one order of a group',
    description: 'Before production only (afterwards: claims, B4.5); the group follows its orders.',
    implements: DECISIONS,
  })
  @ApiBody({ type: CancelOrderDto, examples: { default: { value: { reasonCode: 'cannot_produce' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: AdminOrderDto,
    example: { ...ADMIN_ORDER_GROUP_EXAMPLE.orders[0], status: 'cancelled' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'order.invalid_transition',
  )
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: CancelOrderDto,
  ) {
    return adminOrderDto(await this.orders.cancelOrder(actor, orderId, body), await this.grants(actor));
  }
}
