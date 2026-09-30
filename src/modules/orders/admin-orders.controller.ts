import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PaymentRemindersService } from '@modules/payment-schedules/payment-reminders.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_ORDER_ROW_EXAMPLE,
  AdminOrderListItemDto,
  AdminOrderListQuery,
  BulkPaymentReminderDto,
  CancelReasonDto,
  CancelReasonQuery,
  PaymentReminderResultDto,
} from './admin-orders.dto';
import { AdminOrdersService } from './admin-orders.service';
import { ORDER_IDS } from './orders.dto';

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'orders')
@Controller()
export class AdminOrderListController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly reminders: PaymentRemindersService,
  ) {}

  @Get('orders')
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.orders.list',
    summary: 'List orders',
    description:
      'Every order, newest placed first, for the customer and company screens: filter by status, artwork status, ' +
      'channel, product type, factory, customer, company and placement dates (Bangkok); `q` is a prefix of the ' +
      'order or group code. Rows carry the customer and factory refs, the next unpaid instalment and a slip ' +
      'waiting for Finance with its review due time (D-061, D-175). No costs or margins (D-141).',
    implements: ['D-060', 'D-061', 'D-141', 'D-175'],
  })
  @ApiPaginated(AdminOrderListItemDto, { example: ADMIN_ORDER_ROW_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: AdminOrderListQuery) {
    const { rows, total } = await this.orders.list(q);
    return { data: rows, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('order-cancel-reasons')
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.orders.listCancelReasons',
    summary: 'List the order cancel reasons',
    description:
      'The active reasons a cancellation takes (`reasonCode`), whom each applies to and whether a paid order ' +
      'cancelled for it needs a credit note (D-060).',
    implements: ['D-060'],
  })
  @ApiSuccess(200, {
    description: 'Cancel reasons',
    type: [CancelReasonDto],
    example: [
      {
        code: 'duplicate_order',
        nameTh: 'สั่งซ้ำ',
        nameEn: 'Duplicate order',
        appliesTo: 'staff',
        requiresCreditNote: false,
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  cancelReasons(@Query() q: CancelReasonQuery): Promise<CancelReasonDto[]> {
    return this.orders.cancelReasons(q.appliesTo);
  }

  @Post('orders/:orderId/actions/send-payment-reminder')
  @HttpCode(204)
  @Can('orders.manage')
  @Idempotent({ optional: true })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.orders.sendPaymentReminder',
    summary: 'Remind the customer of the instalment due',
    description:
      'Sends the reminder of the group’s first unpaid due instalment through the notification matrix (event ' +
      '`instalment.reminder`: e-mail, LINE — D-143). 409 `payments.nothing_due` when nothing is due, ' +
      '`payments.reminder_recent` within an hour of the last one.',
    implements: ['D-143', 'D-020'],
  })
  @ApiSuccess(204, { description: 'Reminder sent' })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'payments.nothing_due',
    'payments.reminder_recent',
  )
  async remind(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<void> {
    await this.reminders.remind(staff(actor), orderId);
  }

  @Post('orders/actions/send-payment-reminders')
  @HttpCode(200)
  @Can('orders.manage')
  @Idempotent({ optional: true })
  @ApiEndpoint({
    id: 'admin.orders.sendPaymentReminders',
    summary: 'Remind several customers of their instalments due',
    description:
      'As `admin.orders.sendPaymentReminder` for up to 100 orders; the refused ones are listed with the reason.',
    implements: ['D-143', 'D-020'],
  })
  @ApiBody({
    type: BulkPaymentReminderDto,
    examples: { default: { value: { orderIds: [ORDER_IDS.order] } } },
  })
  @ApiSuccess(200, {
    description: 'What was sent',
    type: PaymentReminderResultDto,
    example: { sent: 1, skipped: [{ orderId: ORDER_IDS.order, reason: 'payments.nothing_due' }] },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  remindMany(
    @CurrentActor() actor: Actor,
    @Body() body: BulkPaymentReminderDto,
  ): Promise<PaymentReminderResultDto> {
    return this.reminders.remindMany(staff(actor), body.orderIds);
  }
}
