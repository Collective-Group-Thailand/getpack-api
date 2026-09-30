import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import { PromotionCodes } from './promotion-codes.service';
import { CheckCodeDto, CodeCheckDto, OFFER_EXAMPLE, PromotionOfferDto } from './store-promotions.dto';

const DECISIONS = ['D-053', 'D-181'];

/** `/v1/store/promotions`: check a code before the cart, and the codes I hold (U-B0.1). */
@ApiSurface('store', 'promotions')
@Controller('promotions')
export class StorePromotionsController {
  constructor(private readonly codes: PromotionCodes) {}

  @Post('actions/check')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'store.promotions.checkCode',
    summary: 'Check a promotion code before adding it to the cart',
    description:
      'The same rules as entering it on the cart — status, dates, whom it is for, uses left — and, when given, the ' +
      "product type and quantity conditions (D-053). Nothing is saved. Another customer's code says `not_yours` and " +
      'shows nothing of it. Attempts count against the hourly limits per customer, IP and device ' +
      '(`promotions.code_attempt_limits`, 429 with `Retry-After`). The amount is worked out on the cart.',
    implements: DECISIONS,
  })
  @ApiBody({ type: CheckCodeDto, examples: { default: { value: { code: 'WELCOME10', productTypeCode: 'folding_carton' } } } })
  @ApiSuccess(200, {
    description: 'Check result',
    type: CodeCheckDto,
    example: { code: 'WELCOME10', valid: true, reason: null, offer: OFFER_EXAMPLE },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'promotions.too_many_attempts')
  check(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: CheckCodeDto,
    @Ip() ip: string,
    @Headers('x-device-id') deviceId: string | undefined,
  ): Promise<CodeCheckDto> {
    const customer = actor?.type === 'user' && actor.audience === 'customer' ? actor.userId : null;
    return this.codes.check(customer, body, { ip, deviceId: deviceId?.slice(0, 128) }) as Promise<CodeCheckDto>;
  }

  @Get('mine')
  @ApiEndpoint({
    id: 'store.promotions.listMine',
    summary: 'List the promotion codes I hold',
    description:
      'Codes assigned to me (e.g. referral rewards) and codes I saved, with their benefit, main conditions, validity ' +
      'and whether each can be used now (D-053).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'My codes', type: [PromotionOfferDto], example: [OFFER_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  mine(@CurrentActor() actor: Actor): Promise<PromotionOfferDto[]> {
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    return this.codes.mine(actor.userId) as Promise<PromotionOfferDto[]>;
  }
}
