import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { cartDto } from '@modules/carts/cart-views';
import { CART_EXAMPLE, CartDto } from '@modules/carts/carts.dto';
import { cartEtag } from '@modules/carts/carts.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  CALL_OFF_EXAMPLE,
  CALL_OFF_IDS,
  CallOffAgreementDto,
  CallOffQuery,
  PARTNER_CALL_OFF_EXAMPLE,
  PENDING_EXAMPLE,
  ReleaseCallOffDto,
  RequestCallOffDto,
} from './call-offs.dto';
import { CallOffsService } from './call-offs.service';

const DECISIONS = ['D-290', 'D-206'];
const agreementParam = ApiParam({ name: 'agreementId', format: 'uuid' });
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const HOW =
  'A call-off locks the unit price of a saved quotation option for its quantity for up to `calloff.max_months`, once ' +
  'the quotation’s factory accepts. Each release (≥ the factory’s minimum order, ≤ what is left) is a quotation at ' +
  'the locked unit price — product only, shipping priced at checkout; the first release carries the quotation’s ' +
  'one-off amounts — and a normal order with the normal payment schedule (D-020). No deposit, no stock; what is not ' +
  'released lapses at expiry without charge (D-290).';

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}
function partner(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'partner') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'callOffs')
@Controller('call-off-agreements')
export class StoreCallOffsController {
  constructor(private readonly callOffs: CallOffsService) {}

  @Post()
  @Idempotent()
  @ApiBody({
    type: RequestCallOffDto,
    examples: {
      default: { value: { quoteId: CALL_OFF_IDS.quote, quoteOptionId: CALL_OFF_IDS.option, months: 6 } },
    },
  })
  @ApiEndpoint({
    id: 'store.callOffs.request',
    summary: 'Ask for a call-off agreement',
    description: `Ask the factory of my saved quotation to lock its option’s unit price. ${HOW}`,
    implements: DECISIONS,
  })
  @ApiSuccess(201, { description: 'Requested', type: CallOffAgreementDto, example: PENDING_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'call_offs.quote_not_eligible',
    'call_offs.already_requested',
  )
  request(@CurrentActor() actor: Actor, @Body() body: RequestCallOffDto) {
    return this.callOffs.request(customer(actor), body);
  }

  @Get()
  @ApiEndpoint({
    id: 'store.callOffs.list',
    summary: 'List my call-off agreements',
    description: `Newest first, with their releases. ${HOW}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Agreements', type: [CallOffAgreementDto], example: [CALL_OFF_EXAMPLE] })
  @ApiStandardErrors()
  list(@CurrentActor() actor: Actor) {
    return this.callOffs.mine(customer(actor));
  }

  @Get(':agreementId')
  @agreementParam
  @ApiEndpoint({
    id: 'store.callOffs.get',
    summary: 'Get my call-off agreement',
    description: `The agreement, what is left and its releases (D-290).`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Agreement', type: CallOffAgreementDto, example: CALL_OFF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('agreementId', ParseUUIDPipe) id: string) {
    return this.callOffs.getMine(customer(actor), id);
  }

  @Post(':agreementId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @agreementParam
  @ApiEndpoint({
    id: 'store.callOffs.cancel',
    summary: 'Withdraw a call-off request',
    description: 'Only while the factory has not answered (D-290).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: CallOffAgreementDto,
    example: { ...PENDING_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'call_offs.invalid_status')
  cancel(@CurrentActor() actor: Actor, @Param('agreementId', ParseUUIDPipe) id: string) {
    return this.callOffs.cancel(customer(actor), id);
  }

  @Post(':agreementId/releases')
  @Idempotent()
  @agreementParam
  @ApiBody({ type: ReleaseCallOffDto, examples: { default: { value: { quantity: 2000 } } } })
  @ApiEndpoint({
    id: 'store.callOffs.release',
    summary: 'Release part of a call-off agreement',
    description:
      'A quotation at the locked unit price for `quantity` is added to my cart; checkout prices the shipping per ' +
      'destination and places a normal order (D-290, D-020). A release not ordered before its quotation expires ' +
      'lapses and its quantity is free again.',
    implements: [...DECISIONS, 'D-020'],
  })
  @ApiSuccess(201, {
    description: 'Cart with the release',
    type: CartDto,
    example: CART_EXAMPLE,
    headers: ['ETag'],
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'call_offs.invalid_status',
    'call_offs.release_quantity',
    'cart.item_exists',
  )
  async release(
    @CurrentActor() actor: Actor,
    @Param('agreementId', ParseUUIDPipe) id: string,
    @Body() body: ReleaseCallOffDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cart = await this.callOffs.release(customer(actor), id, body.quantity);
    res.setHeader('ETag', cartEtag(cart));
    return cartDto(cart);
  }
}

@ApiSurface('partner', 'callOffs')
@Controller()
export class PartnerCallOffsController {
  constructor(private readonly callOffs: CallOffsService) {}

  @Get('factories/:factoryId/call-off-agreements')
  @Can('factory_jobs.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.callOffs.list',
    summary: 'List call-off requests and agreements',
    description: `My factory’s call-offs (own factory only, D-044) with my locked buy price per unit. ${HOW}`,
    implements: [...DECISIONS, 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Agreements',
    type: [CallOffAgreementDto],
    example: [PARTNER_CALL_OFF_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.callOffs.listForFactory(actor, factoryId);
  }

  @Post('call-off-agreements/:agreementId/actions/accept')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_jobs.respond')
  @agreementParam
  @ApiEndpoint({
    id: 'partner.callOffs.accept',
    summary: 'Accept a call-off agreement',
    description:
      'The factory holds its buy price for the committed quantity for the agreed months; the lock starts now (D-290). ' +
      'No deposit and no stock are involved.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Active', type: CallOffAgreementDto, example: PARTNER_CALL_OFF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'call_offs.invalid_status')
  accept(@CurrentActor() actor: Actor, @Param('agreementId', ParseUUIDPipe) id: string) {
    return this.callOffs.respond(partner(actor), id, { accept: true });
  }

  @Post('call-off-agreements/:agreementId/actions/decline')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_jobs.respond')
  @agreementParam
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'Board price is moving; cannot hold it six months' } } },
  })
  @ApiEndpoint({
    id: 'partner.callOffs.decline',
    summary: 'Decline a call-off agreement',
    description: 'With a reason the customer sees (D-290).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: CallOffAgreementDto,
    example: {
      ...PARTNER_CALL_OFF_EXAMPLE,
      status: 'declined',
      declineReason: 'Board price is moving; cannot hold it six months',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'call_offs.invalid_status',
  )
  decline(
    @CurrentActor() actor: Actor,
    @Param('agreementId', ParseUUIDPipe) id: string,
    @Body() body: ReasonBodyDto,
  ) {
    return this.callOffs.respond(partner(actor), id, { accept: false, reason: body.reason });
  }
}

@ApiSurface('admin', 'callOffs')
@Controller('call-off-agreements')
export class AdminCallOffsController {
  constructor(
    private readonly callOffs: CallOffsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.callOffs.list',
    summary: 'List call-off agreements',
    description: `Every call-off, newest first; filter by status. Buy prices need \`factory_cost.read\` (D-141). ${HOW}`,
    implements: [...DECISIONS, 'D-141'],
  })
  @ApiPaginated(CallOffAgreementDto, {
    example: { ...CALL_OFF_EXAMPLE, factory: PARTNER_CALL_OFF_EXAMPLE.factory, buyUnitPrice: '10.123450' },
  })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: CallOffQuery) {
    const { rows, total } = await this.callOffs.list(query);
    const cost =
      actor.type === 'user' &&
      (await this.permissions.forUser(actor.userId)).permissions.has('factory_cost.read');
    return {
      data: cost ? rows : rows.map((r) => ({ ...r, buyUnitPrice: null })),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }
}
