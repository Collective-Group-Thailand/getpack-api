import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { cartDto } from '@modules/carts/cart-views';
import { CART_EXAMPLE, CartDto } from '@modules/carts/carts.dto';
import { type CartActor, cartEtag } from '@modules/carts/carts.service';
import { CustomersService } from '@modules/customers/customers.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiParam, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { type Response } from 'express';

import { PromotionCodes } from './promotion-codes.service';

export class ApplyCodeDto {
  @ApiProperty({ example: 'WELCOME10', pattern: '^[A-Za-z0-9-]{3,40}$', description: 'Case does not matter' })
  @IsString()
  @MaxLength(60)
  code!: string;
}

const named = <T>(cls: T, name: string): T => Object.defineProperty(cls, 'name', { value: name });
const DECISIONS = ['D-053'];

/** Coupon codes on the customer's cart and on CS's cart for a customer (D-053). */
function cartCodesController(surface: 'store' | 'admin'): Type<unknown> {
  const admin = surface === 'admin';
  const guard = () =>
    applyDecorators(
      ...(admin ? [Can('carts.manage_on_behalf'), ApiParam({ name: 'customerId', format: 'uuid' })] : []),
    );

  @ApiSurface(surface, 'cart')
  @Controller(admin ? 'customers/:customerId/cart/codes' : 'cart/codes')
  class CartCodesController {
    constructor(
      private readonly codes: PromotionCodes,
      private readonly customers: CustomersService,
    ) {}

    async who(actor: Actor, customerId: string | undefined): Promise<CartActor> {
      if (actor.type !== 'user') throw new DomainException('auth.forbidden');
      if (!admin) return { actor, customerUserId: actor.userId, channel: 'web', csUserId: null };
      return {
        actor,
        customerUserId: await this.customers.customerIdOf(customerId!),
        channel: 'cs',
        csUserId: actor.userId,
      };
    }

    @Post()
    @guard()
    @ApiHeader({
      name: 'X-Device-Id',
      required: false,
      description: 'App or browser install id; feeds per-device limits (D-053)',
    })
    @ApiEndpoint({
      id: `${surface}.cart.applyCode`,
      summary: 'Enter a coupon code',
      description:
        'Checks the code now (status, window, assignment to this customer, uses left) and keeps it on the cart; ' +
        'the checkout preview evaluates its conditions against the cart and shows the discount or why it does not ' +
        'apply (D-053). Attempts are limited per customer, IP and device each hour (`promotions.code_attempt_limits`). ' +
        'Entering a code already on the cart changes nothing.',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiBody({ type: ApplyCodeDto, examples: { default: { value: { code: 'WELCOME10' } } } })
    @ApiSuccess(201, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'validation.failed',
      'promotions.code_invalid',
      'promotions.too_many_attempts',
    )
    async apply(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: ApplyCodeDto,
      @Ip() ip: string,
      @Headers('x-device-id') deviceId: string | undefined,
      @Res({ passthrough: true }) res: Response,
    ): Promise<CartDto> {
      const cart = await this.codes.apply(await this.who(actor, customerId), ifMatch, body.code, {
        ip,
        deviceId: deviceId?.slice(0, 128),
      });
      res.setHeader('ETag', cartEtag(cart));
      return cartDto(cart);
    }

    @Delete(':code')
    @guard()
    @ApiParam({ name: 'code', schema: { type: 'string', pattern: '^[A-Za-z0-9-]{3,40}$' } })
    @ApiEndpoint({
      id: `${surface}.cart.removeCode`,
      summary: 'Remove a coupon code',
      description:
        'Takes the code off the cart; nothing was reserved yet (usage is reserved at checkout, D-053).',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async remove(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('code') code: string,
      @IfMatch() ifMatch: string | undefined,
      @Res({ passthrough: true }) res: Response,
    ): Promise<CartDto> {
      const cart = await this.codes.remove(await this.who(actor, customerId), ifMatch, code);
      res.setHeader('ETag', cartEtag(cart));
      return cartDto(cart);
    }
  }
  return named(CartCodesController, admin ? 'AdminCartCodesController' : 'StoreCartCodesController');
}

export const StoreCartCodesController = cartCodesController('store');
export const AdminCartCodesController = cartCodesController('admin');
