import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { CartFigures } from '@modules/checkout/cart-figures.service';
import { CustomersService } from '@modules/customers/customers.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type Response } from 'express';

import {
  ADD_ITEM_EXAMPLE,
  AddCartItemDto,
  CART_EXAMPLE,
  CART_IDS,
  CartDto,
  CartShippingEstimateDto,
  ChangeQuantityDto,
  EstimateShippingDto,
  SetDestinationsDto,
  SHIPPING_ESTIMATE_EXAMPLE,
  UpdateCartItemDto,
} from './carts.dto';
import { type CartActor, cartEtag, type CartRow, CartsService } from './carts.service';

type CartSurface = 'store' | 'admin';
const DECISIONS = ['D-051', 'D-072', 'D-142', 'D-452'];
/** The estimate prices shipping like the checkout preview: 30 a minute per client (env `CART_ESTIMATE_THROTTLE_LIMIT`). */
const ESTIMATE_THROTTLE = {
  default: { limit: () => Number(process.env.CART_ESTIMATE_THROTTLE_LIMIT ?? 30), ttl: 60_000 },
};
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const named = <T>(cls: T, name: string): T => Object.defineProperty(cls, 'name', { value: name });
const itemParam = ApiParam({ name: 'itemId', format: 'uuid' });

/** The cart with its ETag, VAT, limits and tier hints (D-452, `CartFigures`). */
async function respond(cart: CartRow, res: Response, figures: CartFigures): Promise<CartDto> {
  res.setHeader('ETag', cartEtag(cart));
  return figures.view(cart);
}

/**
 * The cart on two surfaces: the customer's own (`/v1/store/cart`, channel `web`) and CS working a
 * customer's cart (`/v1/admin/customers/{customerId}/cart`, channel `cs`, `carts.manage_on_behalf`).
 */
function cartController(surface: CartSurface): Type<unknown> {
  const admin = surface === 'admin';
  const who = admin ? 'the customer’s CS cart' : 'my cart';
  const guard = () =>
    applyDecorators(
      ...(admin ? [Can('carts.manage_on_behalf'), ApiParam({ name: 'customerId', format: 'uuid' })] : []),
    );
  const id = (action: string) => `${surface}.cart.${action}`;

  @ApiSurface(surface, 'cart')
  @Controller(admin ? 'customers/:customerId/cart' : 'cart')
  class CartController {
    constructor(
      private readonly carts: CartsService,
      private readonly customers: CustomersService,
      private readonly figures: CartFigures,
    ) {}

    async who(actor: Actor, customerId: string | undefined): Promise<CartActor> {
      if (actor.type !== 'user') throw new DomainException('auth.forbidden');
      if (!admin) return { actor, customerUserId: actor.userId, channel: 'web', csUserId: null };
      const customerUserId = await this.customers.customerIdOf(customerId!);
      return { actor, customerUserId, channel: 'cs', csUserId: actor.userId };
    }

    @Get()
    @guard()
    @ApiEndpoint({
      id: id('get'),
      summary: admin ? 'Get a customer’s CS cart' : 'Get my cart',
      description:
        `The active cart (${who}), created on first use. Each item is a saved quotation option with its ` +
        'price lock (D-051); `priceLocked: false` means re-price and confirm before checkout. Shipping is ' +
        'priced per destination at checkout.',
      implements: DECISIONS,
    })
    @ApiEtag()
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async get(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(await this.carts.get(await this.who(actor, customerId)), res, this.figures);
    }

    @Post('items')
    @guard()
    @ApiEndpoint({
      id: id('addItem'),
      summary: 'Add a quotation option to the cart',
      description:
        'A live saved quotation of this customer (instant or accepted RFQ), one item per option. ' +
        '`hired_design` needs a quotation priced with the design fee; a mockup add-on (D-072) is refused ' +
        'until it can be priced. Destinations default to the default delivery address and must add up to ' +
        'the quantity.',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiBody({ type: AddCartItemDto, examples: { default: { value: ADD_ITEM_EXAMPLE } } })
    @ApiSuccess(201, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(
      ...WRITE,
      'quotes.not_live',
      'cart.item_exists',
      'cart.design_option_unavailable',
      'cart.mockup_price_unavailable',
      'designs.version_required',
    )
    async addItem(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: AddCartItemDto,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.addItem(await this.who(actor, customerId), ifMatch, body),
        res,
        this.figures,
      );
    }

    @Patch('items/:itemId')
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('updateItem'),
      summary: 'Change an item’s design or mockup option',
      description: 'Guarded by the cart’s `If-Match` (D-072).',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiBody({ type: UpdateCartItemDto, examples: { default: { value: { designNote: 'ใช้โลโก้เดิม' } } } })
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(...WRITE, 'cart.design_option_unavailable', 'cart.mockup_price_unavailable')
    async updateItem(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: UpdateCartItemDto,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.updateItem(await this.who(actor, customerId), itemId, ifMatch, body),
        res,
        this.figures,
      );
    }

    @Put('items/:itemId/destinations')
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('setDestinations'),
      summary: 'Split an item over delivery addresses',
      description:
        'Replaces the destinations; each is one of the customer’s delivery addresses (copied as a snapshot, ' +
        'D-142) and the quantities add up to the item quantity. Guarded by `If-Match`.',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiBody({
      type: SetDestinationsDto,
      examples: {
        default: {
          value: {
            destinations: [
              { addressId: CART_IDS.address, quantity: 600 },
              { addressId: '0192f3a0-7c1e-7d2a-9b1f-0000000c0012', quantity: 400 },
            ],
          },
        },
      },
    })
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(...WRITE)
    async setDestinations(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: SetDestinationsDto,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.setDestinations(
          await this.who(actor, customerId),
          itemId,
          ifMatch,
          body.destinations,
        ),
        res,
        this.figures,
      );
    }

    @Delete('items/:itemId')
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('removeItem'),
      summary: 'Remove an item',
      description: 'The quotation stays saved and can be added again while it is live (D-051).',
      implements: DECISIONS,
    })
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: { ...CART_EXAMPLE, items: [] } })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    @ApiConcurrency({ optional: true })
    async removeItem(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @IfMatch() ifMatch: string | undefined,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.removeItem(await this.who(actor, customerId), itemId, ifMatch),
        res,
        this.figures,
      );
    }

    @Post('items/:itemId/actions/reprice')
    @HttpCode(200)
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('repriceItem'),
      summary: 'Re-price an item whose price lock passed',
      description:
        'After the 15-day lock (D-051) the configuration is re-priced into a new quotation; the item shows ' +
        '`pendingReprice` with the difference until the client confirms it. A live lock is kept ' +
        '(`cart.price_locked`); RFQ quotations are not re-priced (ask for a new quotation).',
      implements: DECISIONS,
    })
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(
      'http.not_found',
      'validation.failed',
      'cart.price_locked',
      'cart.reprice_unavailable',
      'quotes.not_repriceable',
      'pricing.not_instant',
      'quotes.nothing_to_save',
    )
    async reprice(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(await this.carts.reprice(await this.who(actor, customerId), itemId), res, this.figures);
    }

    @Post('items/:itemId/actions/confirm-reprice')
    @HttpCode(200)
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('confirmReprice'),
      summary: 'Accept the re-priced item',
      description:
        'The item takes the new quotation, its price and a new lock (D-051). Guarded by `If-Match`.',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors('http.not_found', 'validation.failed', 'cart.no_pending_reprice')
    async confirmReprice(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @IfMatch() ifMatch: string | undefined,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.confirmReprice(await this.who(actor, customerId), itemId, ifMatch),
        res,
        this.figures,
      );
    }

    @Post('items/:itemId/actions/change-quantity')
    @HttpCode(200)
    @guard()
    @itemParam
    @ApiEndpoint({
      id: id('changeQuantity'),
      summary: 'Change an item’s quantity',
      description:
        'D-452: an instant item takes another quantity. When its locked quotation already has that quantity the ' +
        'item switches to it (same price lock); otherwise the configuration is priced again by the quote engine ' +
        'into a new saved quotation at today’s prices with a new lock (D-051) — the response shows the new unit ' +
        'price and lock. Within the product’s `quantityLimits`. One destination follows the new quantity; a split ' +
        'over several addresses is cleared and set again at checkout. RFQ quotations, Studio design pins (D-277), ' +
        'reorders (D-153) and items with a re-price waiting are refused (`cart.quantity_unavailable`). Guarded by ' +
        '`If-Match`.',
      implements: DECISIONS,
    })
    @ApiConcurrency()
    @ApiBody({ type: ChangeQuantityDto, examples: { default: { value: { quantity: 2000 } } } })
    @ApiSuccess(200, { description: 'Cart', type: CartDto, example: CART_EXAMPLE })
    @ApiStandardErrors(
      ...WRITE,
      'cart.quantity_unavailable',
      'cart.item_exists',
      'cart.design_option_unavailable',
      'pricing.not_instant',
    )
    async changeQuantity(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Param('itemId', ParseUUIDPipe) itemId: string,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: ChangeQuantityDto,
      @Res({ passthrough: true }) res: Response,
    ) {
      return respond(
        await this.carts.changeQuantity(await this.who(actor, customerId), itemId, ifMatch, body.quantity),
        res,
        this.figures,
      );
    }

    @Post('actions/estimate-shipping')
    @HttpCode(200)
    @guard()
    @Throttle(ESTIMATE_THROTTLE)
    @ApiEndpoint({
      id: id('estimateShipping'),
      summary: 'Estimate shipping of the cart to a postcode',
      description:
        'D-452: what shipping every item to one postcode would cost incl. VAT at the customer rate card (D-013) — ' +
        'the same destination shipping checkout prices — with the destination zone’s name, the latest ready date ' +
        'and the arrival window (`shipping.transit_days`). An estimate: nothing is saved and the cart does not ' +
        'change; checkout prices each destination again. An RFQ quotation ships only to its own postcode. ' +
        'Limited per client (30 a minute).',
      implements: ['D-452', 'D-013', 'D-436'],
    })
    @ApiBody({ type: EstimateShippingDto, examples: { default: { value: { postcode: '10110' } } } })
    @ApiSuccess(200, {
      description: 'Estimate',
      type: CartShippingEstimateDto,
      example: SHIPPING_ESTIMATE_EXAMPLE,
    })
    @ApiStandardErrors(...WRITE, 'http.too_many_requests')
    async estimateShipping(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Body() body: EstimateShippingDto,
    ): Promise<CartShippingEstimateDto> {
      const cart = await this.carts.get(await this.who(actor, customerId));
      return this.figures.estimateShipping(cart, body.postcode);
    }
  }

  return named(CartController, `${admin ? 'Admin' : 'Store'}CartController`);
}

export const StoreCartController = cartController('store');
export const AdminCartController = cartController('admin');
