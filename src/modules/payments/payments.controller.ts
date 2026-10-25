import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiPublic, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { type Prisma } from '@generated/prisma/client';
import { OrdersService } from '@modules/orders/orders.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { adminPaymentDto, paymentDto, slipQueueDto } from './payment-views';
import {
  ADMIN_PAYMENT_EXAMPLE,
  AdminPaymentDto,
  AdminPaymentQuery,
  AllocatePaymentDto,
  InitiatePaymentDto,
  PAYMENT_EXAMPLE,
  PaymentDto,
  ScbCallbackAckDto,
  SLIP_QUEUE_EXAMPLE,
  SlipQueueItemDto,
  SlipReviewDto,
  UploadSlipDto,
} from './payments.dto';
import { PaymentsService } from './payments.service';

const DECISIONS = ['D-061', 'D-020', 'D-176'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const groupParam = ApiParam({ name: 'groupId', format: 'uuid' });
const paymentParam = ApiParam({ name: 'paymentId', format: 'uuid' });
const INITIATE_ERRORS = [
  ...WRITE,
  'payments.method_unavailable',
  'payments.group_not_payable',
  'payments.nothing_to_pay',
  'promotions.payment_method_required',
  'provider.unavailable',
] as const;
const SLIP_ERRORS = [
  ...WRITE,
  'payments.not_a_slip_payment',
  'payments.not_awaiting_slip',
  'payments.slip_not_scanned',
] as const;
const SLIP_BODY = ApiBody({
  type: UploadSlipDto,
  examples: {
    default: {
      value: {
        fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
        declaredAmount: '7091.40',
        transferredAt: '2026-10-01T10:30:00+07:00',
      },
    },
  },
});

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'payments')
@Controller()
export class StorePaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Post('order-groups/:groupId/payments')
  @Idempotent()
  @groupParam
  @ApiEndpoint({
    id: 'store.payments.initiate',
    summary: 'Pay open instalments',
    description:
      'Starts a payment of the instalments due now (or those chosen): SCB QR returns the QR payload to render, ' +
      '2C2P a redirect URL, a bank transfer waits for its slip. Methods are enabled by feature flag once ' +
      'getpack’s merchant accounts exist (D-176). The amount is the cash after the expected withholding. ' +
      '`bank_transfer_slip` returns the accounts to pay into (`receiverAccounts`). After a 2C2P page the provider ' +
      'sends the customer back to the fixed storefront route `/payments/{paymentId}/return` (no client-supplied ' +
      'return URL); poll `store.payments.get` there. Past the group’s payment deadline the customer re-quotes ' +
      'first (`store.orders.requoteGroup`, D-436): `order.requote_required`. Requires `Idempotency-Key`.',
    implements: [...DECISIONS, 'D-436'],
  })
  @ApiBody({ type: InitiatePaymentDto, examples: { default: { value: { method: 'scb_qr' } } } })
  @ApiSuccess(201, { description: 'Payment started', type: PaymentDto, example: PAYMENT_EXAMPLE })
  @ApiStandardErrors(...INITIATE_ERRORS, 'order.requote_required')
  async initiate(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: InitiatePaymentDto,
  ): Promise<PaymentDto> {
    const user = customer(actor);
    return paymentDto(
      await this.payments.initiate(user, groupId, body, user.userId),
      await this.payments.slipReceiverAccounts(),
    );
  }

  @Get('order-groups/:groupId/payments')
  @groupParam
  @ApiEndpoint({
    id: 'store.payments.list',
    summary: 'List payments of my order group',
    description: 'Newest first, with their slips and verification state (D-061).',
    implements: DECISIONS,
  })
  @ApiPaginated(PaymentDto, { example: PAYMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() q: PageQuery,
  ) {
    const group = await this.orders.group(groupId, customer(actor).userId);
    const { rows, total } = await this.payments.list({ orderGroupId: group.id }, q.page, q.perPage);
    const receivers = await this.payments.slipReceiverAccounts();
    return {
      data: rows.map((p) => paymentDto(p, receivers)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('payments/:paymentId')
  @paymentParam
  @ApiEndpoint({
    id: 'store.payments.get',
    summary: 'Get one of my payments',
    description: 'Poll after a QR scan or a 2C2P redirect; `succeeded` once the provider confirmed it.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Payment', type: PaymentDto, example: PAYMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return paymentDto(
      await this.payments.payment(paymentId, customer(actor).userId),
      await this.payments.slipReceiverAccounts(),
    );
  }

  @Post('payments/:paymentId/slips')
  @Idempotent()
  @paymentParam
  @ApiEndpoint({
    id: 'store.payments.uploadSlip',
    summary: 'Send the slip of a bank transfer',
    description:
      'The slip (file uploaded with purpose `slip`, scanned clean) is verified automatically — receiver ' +
      'account, amount, date and duplicate transaction reference (D-061). A pass is accepted at once, a ' +
      'duplicate refused, anything else goes to Finance (4 business hours). Requires `Idempotency-Key`.',
    implements: DECISIONS,
  })
  @SLIP_BODY
  @ApiSuccess(201, { description: 'Payment with its slip', type: PaymentDto, example: PAYMENT_EXAMPLE })
  @ApiStandardErrors(...SLIP_ERRORS)
  async slip(
    @CurrentActor() actor: Actor,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: UploadSlipDto,
  ): Promise<PaymentDto> {
    const user = customer(actor);
    return paymentDto(
      await this.payments.uploadSlip(user, paymentId, body, 'web', user.userId),
      await this.payments.slipReceiverAccounts(),
    );
  }
}

@ApiSurface('admin', 'payments')
@Controller()
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  @Can('payments.read')
  @ApiEndpoint({
    id: 'admin.payments.list',
    summary: 'List payments',
    description:
      'Filter by status and method, by order group (`groupId`) or by an order of it (`orderId`); ' +
      '`unidentified=true` lists receipts that match no order group.',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminPaymentDto, { example: ADMIN_PAYMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: AdminPaymentQuery) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.unidentified ? { orderGroupId: null, status: 'succeeded' as const } : {}),
      ...(q.groupId && { orderGroup: { publicId: q.groupId } }),
      ...(q.orderId && { orderGroup: { orders: { some: { publicId: q.orderId } } } }),
    };
    const { rows, total } = await this.payments.list(where, q.page, q.perPage);
    return { data: rows.map(adminPaymentDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('payments/:paymentId')
  @Can('payments.read')
  @paymentParam
  @ApiEndpoint({
    id: 'admin.payments.get',
    summary: 'Get a payment',
    description: 'Provider reference, fee, refunds, slips and their checks.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Payment', type: AdminPaymentDto, example: ADMIN_PAYMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return adminPaymentDto(await this.payments.payment(paymentId));
  }

  @Post('order-groups/:groupId/payments')
  @Can('orders.manage')
  @Idempotent()
  @groupParam
  @ApiEndpoint({
    id: 'admin.payments.initiate',
    summary: 'Start a payment for a customer (CS)',
    description:
      'CS starts a payment on the customer’s behalf, e.g. a bank transfer whose slip CS then sends.',
    implements: DECISIONS,
  })
  @ApiBody({ type: InitiatePaymentDto, examples: { default: { value: { method: 'bank_transfer_slip' } } } })
  @ApiSuccess(201, { description: 'Payment started', type: AdminPaymentDto, example: ADMIN_PAYMENT_EXAMPLE })
  @ApiStandardErrors(...INITIATE_ERRORS)
  async initiate(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: InitiatePaymentDto,
  ) {
    return adminPaymentDto(await this.payments.initiate(staff(actor), groupId, body));
  }

  @Post('payments/:paymentId/slips')
  @Can('orders.manage')
  @Idempotent()
  @paymentParam
  @ApiEndpoint({
    id: 'admin.payments.uploadSlip',
    summary: 'Send a slip for a customer (CS)',
    description: 'Same checks as the customer’s own slip (D-061); recorded as uploaded by CS.',
    implements: DECISIONS,
  })
  @SLIP_BODY
  @ApiSuccess(201, {
    description: 'Payment with its slip',
    type: AdminPaymentDto,
    example: ADMIN_PAYMENT_EXAMPLE,
  })
  @ApiStandardErrors(...SLIP_ERRORS)
  async slip(
    @CurrentActor() actor: Actor,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: UploadSlipDto,
  ) {
    return adminPaymentDto(await this.payments.uploadSlip(staff(actor), paymentId, body, 'cs'));
  }

  @Get('slips')
  @Can('payments.verify_slip')
  @ApiEndpoint({
    id: 'admin.payments.slipQueue',
    summary: 'Slips waiting for Finance',
    description:
      'Slips that failed automatic verification, earliest SLA first (4 business hours, D-061 / D-175).',
    implements: ['D-061', 'D-175'],
  })
  @ApiPaginated(SlipQueueItemDto, { example: SLIP_QUEUE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async queue(@Query() q: PageQuery) {
    const { rows, total } = await this.payments.slipQueue(q.page, q.perPage);
    return { data: rows.map((s) => slipQueueDto(s)), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('slips/:slipId/actions/review')
  @HttpCode(200)
  @Can('payments.verify_slip')
  @Idempotent()
  @ApiParam({ name: 'slipId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payments.reviewSlip',
    summary: 'Approve or reject a slip',
    description:
      'Finance approves with the bank transaction reference (refused when already accepted, D-061) or rejects ' +
      'with a note; the uploader cannot review their own slip. Requires `Idempotency-Key`.',
    implements: ['D-061'],
  })
  @ApiBody({
    type: SlipReviewDto,
    examples: {
      default: {
        value: { approve: true, bankTransRef: '015073144041ATF00999', note: 'ตรวจกับ statement แล้ว' },
      },
    },
  })
  @ApiSuccess(200, { description: 'Payment', type: AdminPaymentDto, example: ADMIN_PAYMENT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'payments.slip_not_in_review', 'payments.slip_duplicate', 'iam.sod_conflict')
  async review(
    @CurrentActor() actor: Actor,
    @Param('slipId', ParseUUIDPipe) slipId: string,
    @Body() body: SlipReviewDto,
  ) {
    return adminPaymentDto(await this.payments.reviewSlip(staff(actor), slipId, body));
  }

  @Post('payments/:paymentId/actions/allocate')
  @HttpCode(200)
  @Can('payments.allocate')
  @Idempotent()
  @paymentParam
  @ApiEndpoint({
    id: 'admin.payments.allocate',
    summary: 'Attach an unidentified receipt to an order group',
    description:
      'The cash is applied to the group’s open instalments (FIFO, ADR-0008). Requires `Idempotency-Key`.',
    implements: ['D-061', 'D-020'],
  })
  @ApiBody({
    type: AllocatePaymentDto,
    examples: { default: { value: { groupId: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001' } } },
  })
  @ApiSuccess(200, { description: 'Payment', type: AdminPaymentDto, example: ADMIN_PAYMENT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'payments.not_unidentified', 'payments.group_not_payable')
  async allocate(
    @CurrentActor() actor: Actor,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: AllocatePaymentDto,
  ) {
    return adminPaymentDto(await this.payments.allocate(staff(actor), paymentId, body.groupId));
  }
}

/** Payment provider callbacks: stored once per provider event, confirmed before any payment is accepted. */
@ApiSurface('webhooks', 'payments')
@Controller({ version: VERSION_NEUTRAL })
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('scb/payment-confirmation')
  @HttpCode(200)
  @Public()
  @ApiPublic()
  @ApiEndpoint({
    id: 'webhooks.payments.scb',
    summary: 'SCB payment confirmation',
    description:
      'Sent by SCB for a paid QR 30 / QR CS. The callback carries no signature: it is confirmed by the SCB ' +
      'inquiry before the payment is accepted, stored once per `transactionId` (SCB retries 3 times) and ' +
      'answered with `{"resCode":"00"}` (D-061, D-176).',
    implements: ['D-061', 'D-176'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string' },
        amount: { type: 'string' },
        billPaymentRef1: { type: 'string' },
        transactionDateandTime: { type: 'string' },
      },
    },
    examples: {
      default: {
        value: {
          transactionId: '46a0e0c00f114482991414ef26654ace',
          amount: '7091.40',
          billPaymentRef1: 'PKAB23CD45EF67GH',
          transactionDateandTime: '2026-10-01T10:31:00.000+07:00',
          currencyCode: '764',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Acknowledged',
    type: ScbCallbackAckDto,
    example: { resCode: '00', resDesc: 'success', transactionId: '46a0e0c00f114482991414ef26654ace' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'provider.unavailable')
  scb(@Body() body: Record<string, unknown>) {
    return this.payments.scbCallback(body);
  }

  @Post('slip-verify')
  @HttpCode(204)
  @Public()
  @ApiPublic()
  @ApiEndpoint({
    id: 'webhooks.payments.slipVerify',
    summary: 'Asynchronous slip verification result',
    description:
      'Queue results of the slip-verification provider. Unsigned, so the result is re-fetched from the ' +
      'provider before it decides a slip still waiting in review; stored once per reference (D-061).',
    implements: ['D-061', 'D-176'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        data: { type: 'object', properties: { queueId: { type: 'string' } } },
      },
    },
    examples: {
      default: { value: { code: '200200', data: { queueId: '92887bd5-0000-4000-8000-000000000001' } } },
    },
  })
  @ApiSuccess(204, { description: 'Accepted' })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async slipVerify(@Body() body: Record<string, unknown>): Promise<void> {
    await this.payments.slipVerifyCallback(body);
  }

  @Post('2c2p/payment')
  @HttpCode(204)
  @Public()
  @ApiPublic()
  @ApiEndpoint({
    id: 'webhooks.payments.twoc2p',
    summary: '2C2P backend notification',
    description:
      '`{"payload":"<JWT HS256>"}` signed with getpack’s merchant secret; an invalid signature is 401. A ' +
      'success (`respCode 0000`) is confirmed by the 2C2P inquiry before the payment is accepted; replays ' +
      'are no-ops (D-061, D-176).',
    implements: ['D-061', 'D-176'],
  })
  @ApiBody({
    schema: { type: 'object', required: ['payload'], properties: { payload: { type: 'string' } } },
    examples: {
      default: {
        value: { payload: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpbnZvaWNlTm8iOiJQSy4uLiJ9.c2ln' },
      },
    },
  })
  @ApiSuccess(204, { description: 'Accepted' })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.unauthenticated',
    'provider.unavailable',
  )
  async twoc2p(@Body() body: Record<string, unknown>): Promise<void> {
    await this.payments.twoc2pNotification(body);
  }
}
