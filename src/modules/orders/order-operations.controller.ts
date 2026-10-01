import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { orderEtag, OrderOperationsService, type QueueKey } from './order-operations.service';
import { adminOrderDto, adminOrderGroupDto, type CostGrants } from './order-views';
import {
  AddOrderNoteDto,
  ADMIN_ORDER_GROUP_EXAMPLE,
  AdminOrderDto,
  AdminOrderGroupDto,
  ChangeCustomerDto,
  ORDER_IDS,
  ORDER_QUEUES,
  OrderNoteDto,
  OrderQueueItemDto,
  OrderQueueQuery,
  QUEUE_ITEM_EXAMPLE,
  RepriceOrderDto,
  UpdateOrderGroupDto,
} from './orders.dto';
import { groupEtag, OrdersService } from './orders.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const groupParam = ApiParam({ name: 'groupId', format: 'uuid' });
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const NOTE_EXAMPLE: OrderNoteDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000d0005',
  body: 'โทรยืนยันกับลูกค้าแล้ว',
  author: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001', displayName: 'Dev CS' },
  mentions: [{ id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0002', displayName: 'Dev Prepress' }],
  createdAt: '2026-10-01T10:00:00+07:00',
};

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'orderOperations')
@Controller()
export class AdminOrderOperationsController {
  constructor(
    private readonly ops: OrderOperationsService,
    private readonly orders: OrdersService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async grants(actor: Actor): Promise<CostGrants> {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    return { cost: granted.has('factory_cost.read'), margin: granted.has('margin.read'), perms: granted };
  }

  @Post('orders/:orderId/actions/reprice')
  @HttpCode(200)
  @Can('orders.reprice')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orderOperations.reprice',
    summary: 'Edit & re-price an order before production',
    description:
      'CS replaces the order’s configuration with a live quotation of the same customer and product type ' +
      '(re-saved with the change); shipping is re-priced per destination and the previous pricing is kept ' +
      'as a revision. Refused once production started, when the order carries discounts, or when the ' +
      'group’s new total is below what was already paid (credit note, B5). Publishes `order.repriced` ' +
      '(the payment schedule rebalances unpaid instalments, B3.2). Guarded by the order’s `If-Match`.',
    implements: ['D-051', 'D-013', 'D-073'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: RepriceOrderDto,
    examples: {
      default: {
        value: {
          quoteId: ORDER_IDS.quote,
          quoteOptionId: '0192f3a0-7c1e-7d2a-9b1f-0000000ca005',
          reason: 'ลูกค้าขอเปลี่ยนจำนวน',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Re-priced order',
    type: AdminOrderDto,
    example: ADMIN_ORDER_GROUP_EXAMPLE.orders[0],
  })
  @ApiStandardErrors(
    ...WRITE,
    'quotes.not_live',
    'order.invalid_transition',
    'order.reprice_has_discounts',
    'order.reprice_below_paid',
    'cart.design_option_unavailable',
    'checkout.shipping_unavailable',
    'checkout.rfq_destination_fixed',
    'concurrency.stale',
  )
  async reprice(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: RepriceOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.ops.reprice(staff(actor), orderId, ifMatch, body);
    res.setHeader('ETag', orderEtag(row));
    return adminOrderDto(row, await this.grants(actor));
  }

  @Post('order-groups/:groupId/actions/change-customer')
  @HttpCode(200)
  @Can('orders.manage')
  @groupParam
  @ApiEndpoint({
    id: 'admin.orderOperations.changeCustomer',
    summary: 'Move an unpaid order group to another customer',
    description:
      'Only while nothing is paid. The tax-invoice buyer is cleared (choose it again); destinations keep ' +
      'their snapshot (D-142). Guarded by `If-Match`.',
    implements: ['D-142'],
  })
  @ApiConcurrency()
  @ApiBody({ type: ChangeCustomerDto, examples: { default: { value: { customerId: ORDER_IDS.customer } } } })
  @ApiSuccess(200, {
    description: 'Updated group',
    type: AdminOrderGroupDto,
    example: ADMIN_ORDER_GROUP_EXAMPLE,
  })
  @ApiStandardErrors(...WRITE, 'order.invalid_transition')
  async changeCustomer(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ChangeCustomerDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const group = await this.ops.changeCustomer(staff(actor), groupId, ifMatch, body.customerId);
    res.setHeader('ETag', groupEtag(group));
    return adminOrderGroupDto(group, await this.grants(actor));
  }

  @Patch('order-groups/:groupId')
  @Can('orders.manage')
  @groupParam
  @ApiEndpoint({
    id: 'admin.orderOperations.updateGroup',
    summary: 'Update CS remarks, cc e-mails or the PO number',
    description:
      'Remarks are internal; cc e-mails receive copies of order messages (D-143). Guarded by `If-Match`.',
    implements: ['D-125', 'D-143'],
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateOrderGroupDto, examples: { default: { value: { csRemarks: 'ลูกค้าขอส่งด่วน' } } } })
  @ApiSuccess(200, {
    description: 'Updated group',
    type: AdminOrderGroupDto,
    example: ADMIN_ORDER_GROUP_EXAMPLE,
  })
  @ApiStandardErrors(...WRITE)
  async updateGroup(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateOrderGroupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const group = await this.ops.updateGroup(staff(actor), groupId, ifMatch, body);
    res.setHeader('ETag', groupEtag(group));
    return adminOrderGroupDto(group, await this.grants(actor));
  }

  @Get('orders/:orderId/notes')
  @Can('orders.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orderOperations.listNotes',
    summary: 'List internal notes of an order',
    description: 'Newest first; never shown to the customer or the factory.',
    implements: ['D-142'],
  })
  @ApiPaginated(OrderNoteDto, { example: NOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async notes(@Param('orderId', ParseUUIDPipe) orderId: string, @Query() q: PageQuery) {
    const order = await this.orders.order({ publicId: orderId });
    const [rows, total] = await this.ops.notes(order.id, q.page, q.perPage);
    return {
      data: rows.map((n) => ({
        id: n.publicId,
        body: n.body,
        author: { id: n.author.publicId, displayName: n.author.displayName },
        mentions: n.mentioned,
        createdAt: toBangkokIso(n.createdAt),
      })),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post('orders/:orderId/notes')
  @Can('orders.manage')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orderOperations.addNote',
    summary: 'Add an internal note',
    description:
      'Append-only; mentioned staff are listed on the `order.note_added` event (B4.4 notifies them).',
    implements: ['D-143'],
  })
  @ApiBody({ type: AddOrderNoteDto, examples: { default: { value: { body: 'โทรยืนยันกับลูกค้าแล้ว' } } } })
  @ApiSuccess(201, { description: 'Note added', type: OrderNoteDto, example: NOTE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async addNote(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: AddOrderNoteDto,
  ): Promise<OrderNoteDto> {
    const note = await this.ops.addNote(staff(actor), orderId, body.body, body.mentions ?? []);
    const people = await this.ops.mentioned(note.mentions);
    return {
      id: note.publicId,
      body: note.body,
      author: { id: note.author.publicId, displayName: note.author.displayName },
      mentions: note.mentions.map((id) => people.get(id)!).filter(Boolean),
      createdAt: toBangkokIso(note.createdAt),
    };
  }

  @Get('order-queues/:queue')
  @Can('orders.read')
  @ApiParam({ name: 'queue', enum: ORDER_QUEUES, enumName: 'OrderQueue' })
  @ApiEndpoint({
    id: 'admin.orderOperations.queue',
    summary: 'Work queue of orders',
    description:
      '`waiting_payment` (รอชำระ, oldest first), `artwork_review` (รอตรวจไฟล์: uploaded / in review), ' +
      '`waiting_production` (รอเริ่มผลิต: paid, not started), `due_soon` (ใกล้ครบกำหนดส่ง: promised ship date ' +
      'within `withinDays`, not shipped), `late` (ล่าช้า: promised ship date passed, not shipped).',
    implements: ['D-060', 'D-073'],
  })
  @ApiPaginated(OrderQueueItemDto, { example: QUEUE_ITEM_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async queue(@Param('queue') queue: string, @Query() q: OrderQueueQuery) {
    if (!(ORDER_QUEUES as readonly string[]).includes(queue))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'queue', code: 'enum', message: `one of ${ORDER_QUEUES.join(', ')}` }],
      });
    const { rows, total } = await this.ops.queue(queue as QueueKey, q.page, q.perPage, q.withinDays ?? 3);
    return {
      data: rows.map((o): OrderQueueItemDto => ({
        orderId: o.publicId,
        orderCode: o.orderCode,
        groupId: o.orderGroup.publicId,
        groupCode: o.orderGroup.groupCode,
        customerName: o.orderGroup.customer.displayName,
        status: o.status,
        artworkStatus: o.artworkStatus,
        productTypeCode: o.productType.code,
        promisedShipDate: o.promisedShipDate ? bangkokDate(o.promisedShipDate) : null,
        grossAmount: o.grossAmount.toFixed(2),
        placedAt: toBangkokIso(o.orderGroup.placedAt),
        groupExpiresAt: o.orderGroup.expiresAt ? toBangkokIso(o.orderGroup.expiresAt) : null,
      })),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }
}
