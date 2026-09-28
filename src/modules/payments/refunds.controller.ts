import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { refundDto } from './payment-views';
import {
  CompleteRefundDto,
  REFUND_EXAMPLE,
  RefundDto,
  RefundListQuery,
  RequestRefundDto,
} from './payments.dto';
import { RefundsService } from './refunds.service';

const DECISIONS = ['D-169', 'D-061'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'refunds')
@Controller()
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('payments/:paymentId/refunds')
  @Can('refunds.request')
  @Idempotent()
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.refunds.request',
    summary: 'Request a refund',
    description:
      'Only money the schedule no longer needs: a cancelled / completed group, an unidentified receipt or ' +
      'the payment’s unallocated cash. Routed to the Finance Manager (policy `refund`, maker-checker, D-169); ' +
      'executed through 2C2P or recorded by Finance as a bank transfer once approved. Requires `Idempotency-Key`.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RequestRefundDto,
    examples: {
      default: {
        value: {
          amount: '7091.40',
          reasonNote: 'ยกเลิกคำสั่งซื้อก่อนผลิต',
          cancelReasonCode: 'customer_changed_mind',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Refund awaiting approval', type: RefundDto, example: REFUND_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'refunds.not_refundable',
    'refunds.channel_unavailable',
    'approval.no_matching_step',
  )
  async request(
    @CurrentActor() actor: Actor,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: RequestRefundDto,
  ): Promise<RefundDto> {
    return refundDto(await this.refunds.request(staff(actor), paymentId, body));
  }

  @Get('refunds')
  @Can('payments.read')
  @ApiEndpoint({
    id: 'admin.refunds.list',
    summary: 'List refunds',
    description: 'Newest first; filter by status.',
    implements: DECISIONS,
  })
  @ApiPaginated(RefundDto, { example: REFUND_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: RefundListQuery) {
    const { rows, total } = await this.refunds.list(q.status ? { status: q.status } : {}, q.page, q.perPage);
    return { data: rows.map(refundDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('refunds/:refundId')
  @Can('payments.read')
  @ApiParam({ name: 'refundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.refunds.get',
    summary: 'Get a refund',
    description: 'With its approval request and execution state.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Refund', type: RefundDto, example: REFUND_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('refundId', ParseUUIDPipe) refundId: string) {
    return refundDto(await this.refunds.refund(refundId));
  }

  @Post('refunds/:refundId/actions/complete')
  @HttpCode(200)
  @Can('refunds.complete')
  @Idempotent()
  @ApiParam({ name: 'refundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.refunds.complete',
    summary: 'Record a refund as paid out',
    description:
      'Finance records the bank reference of an approved bank-transfer refund (or confirms a pending gateway ' +
      'one); the requester cannot complete their own refund. Publishes `refund.succeeded` (ledger P22). ' +
      'Requires `Idempotency-Key`.',
    implements: DECISIONS,
  })
  @ApiBody({ type: CompleteRefundDto, examples: { default: { value: { providerRef: 'TRF20261001-0001' } } } })
  @ApiSuccess(200, {
    description: 'Refund',
    type: RefundDto,
    example: { ...REFUND_EXAMPLE, status: 'succeeded' },
  })
  @ApiStandardErrors(...WRITE, 'refunds.not_approved', 'iam.sod_conflict')
  async complete(
    @CurrentActor() actor: Actor,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() body: CompleteRefundDto,
  ) {
    return refundDto(await this.refunds.markCompleted(staff(actor), refundId, body.providerRef));
  }
}
