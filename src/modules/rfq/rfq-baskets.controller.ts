import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
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
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AcceptBasketItemsDto,
  ACCEPTED_EXAMPLE,
  AcceptedBasketDto,
  AddBasketProductDto,
  BASKET_EXAMPLE,
  RfqBasketDto,
  RfqBasketItemInputDto,
  SetBasketDetailsDto,
} from './rfq-baskets.dto';
import { RfqBasketsService } from './rfq-baskets.service';

const DECISIONS = ['D-301', 'D-100', 'D-183'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const ITEM_EXAMPLE = {
  productTypeCode: 'paper_bag',
  spec: { material: 'kraft 150 gsm (fake)', handles: 'twisted paper', print: '1 colour one side' },
  lengthMm: 250,
  widthMm: 120,
  heightMm: 320,
  measurementBasis: 'internal',
  quantities: [500, 1000],
};
const itemParam = ApiParam({ name: 'itemId', format: 'uuid' });
const basketParam = ApiParam({ name: 'basketId', format: 'uuid' });

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

/** D-301 multi-item requests for quote. */
@ApiSurface('store', 'rfqs')
@Controller('rfq-baskets')
export class StoreRfqBasketsController {
  constructor(private readonly baskets: RfqBasketsService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.rfqBaskets.list',
    summary: 'My RFQ baskets',
    description: 'Newest first (up to 50); discarded drafts left out (D-301).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Baskets', type: [RfqBasketDto], example: [BASKET_EXAMPLE] })
  @ApiStandardErrors()
  list(@CurrentActor() actor: Actor) {
    return this.baskets.list(customer(actor));
  }

  @Get('draft')
  @ApiEndpoint({
    id: 'store.rfqBaskets.getDraft',
    summary: 'My draft RFQ basket',
    description: 'One per customer, created on first use (D-301).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Draft', type: RfqBasketDto, example: BASKET_EXAMPLE })
  @ApiStandardErrors()
  draft(@CurrentActor() actor: Actor) {
    return this.baskets.draft(customer(actor));
  }

  @Patch('draft')
  @ApiEndpoint({
    id: 'store.rfqBaskets.setDetails',
    summary: 'Set the basket’s delivery and notes',
    description:
      'Delivery postcode (required to submit), target date and notes shared by every item (D-301).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SetBasketDetailsDto,
    examples: { default: { value: { deliveryPostcode: '10110', targetDate: '2026-11-15' } } },
  })
  @ApiSuccess(200, { description: 'Draft', type: RfqBasketDto, example: BASKET_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  setDetails(@CurrentActor() actor: Actor, @Body() body: SetBasketDetailsDto) {
    return this.baskets.setDetails(customer(actor), body);
  }

  @Post('draft/items')
  @Idempotent()
  @ApiEndpoint({
    id: 'store.rfqBaskets.addItem',
    summary: 'Add an item to my basket',
    description:
      'The store RFQ form of a product type (`store.rfqs.getForm`: spec fields checked against its schema, sizes in ' +
      'mm, up to 10 quantities, my files, a published style, a target price) and optionally one of my design ' +
      'versions; up to 20 items (D-301, D-183).',
    implements: DECISIONS,
  })
  @ApiBody({ type: RfqBasketItemInputDto, examples: { default: { value: ITEM_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Draft', type: RfqBasketDto, example: BASKET_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'specs.unit_not_accepted')
  addItem(@CurrentActor() actor: Actor, @Body() body: RfqBasketItemInputDto) {
    return this.baskets.addItem(customer(actor), body);
  }

  @Post('draft/products')
  @Idempotent()
  @ApiEndpoint({
    id: 'store.rfqBaskets.addProduct',
    summary: 'Put a product in my basket before filling its form',
    description:
      "C1b (owner 2026-10-28, DECISIONS-STAGE-A §10.9): the storefront's quote tray when I am signed in — an active " +
      'catalogue or stock product goes into my draft basket as a line with `formPending: true` (its product type and ' +
      'reference only), so the tray follows my account across devices; a guest tray is merged the same way at sign-in. ' +
      'A product already waiting is not added twice. Filled by `store.rfqBaskets.addItem` with the same product (or ' +
      '`updateItem`); the basket cannot be submitted while a line is pending. Up to 20 lines (D-301).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddBasketProductDto,
    examples: { default: { value: { catalogProductSlug: 'mailer-box-b' } } },
  })
  @ApiSuccess(201, {
    description: 'Draft',
    type: RfqBasketDto,
    example: {
      ...BASKET_EXAMPLE,
      items: [
        {
          ...BASKET_EXAMPLE.items[0]!,
          specification: { productTypeCode: 'paper_bag', catalogProductSlug: 'mailer-box-b' },
          formPending: true,
        },
      ],
    },
  })
  @ApiStandardErrors(...WRITE)
  addProduct(@CurrentActor() actor: Actor, @Body() body: AddBasketProductDto) {
    return this.baskets.addProduct(customer(actor), body);
  }

  @Put('draft/items/:itemId')
  @itemParam
  @ApiEndpoint({
    id: 'store.rfqBaskets.updateItem',
    summary: 'Change an item of my basket',
    description: 'Replaces the item, checked like adding it (D-301).',
    implements: DECISIONS,
  })
  @ApiBody({ type: RfqBasketItemInputDto, examples: { default: { value: ITEM_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Draft', type: RfqBasketDto, example: BASKET_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'specs.unit_not_accepted')
  updateItem(
    @CurrentActor() actor: Actor,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: RfqBasketItemInputDto,
  ) {
    return this.baskets.updateItem(customer(actor), itemId, body);
  }

  @Delete('draft/items/:itemId')
  @itemParam
  @ApiEndpoint({
    id: 'store.rfqBaskets.removeItem',
    summary: 'Remove an item from my basket',
    description: 'Only while the basket is a draft (D-301).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Draft', type: RfqBasketDto, example: { ...BASKET_EXAMPLE, items: [] } })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  removeItem(@CurrentActor() actor: Actor, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.baskets.removeItem(customer(actor), itemId);
  }

  @Post('draft/actions/submit')
  @HttpCode(200)
  @Idempotent()
  @ApiEndpoint({
    id: 'store.rfqBaskets.submit',
    summary: 'Submit my basket',
    description:
      'Every item is checked again (errors under `items[i]`), then in one transaction the basket is numbered, one RFQ ' +
      'per item is created with the basket’s delivery, target date and notes, and one conversation opens for the ' +
      'basket (D-301). CS then quotes each item like a single RFQ.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Submitted',
    type: RfqBasketDto,
    example: { ...BASKET_EXAMPLE, status: 'submitted', basketCode: 'RB-2610-00001' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'rfq_baskets.changed',
    'numbering.series_missing',
    'specs.unit_not_accepted',
  )
  submit(@CurrentActor() actor: Actor) {
    return this.baskets.submit(customer(actor));
  }

  @Post('draft/actions/discard')
  @HttpCode(204)
  @ApiEndpoint({
    id: 'store.rfqBaskets.discard',
    summary: 'Discard my draft basket',
    description: 'The next item starts a new draft (D-301).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Discarded' })
  @ApiStandardErrors('http.not_found')
  async discard(@CurrentActor() actor: Actor): Promise<void> {
    await this.baskets.discard(customer(actor));
  }

  @Get(':basketId')
  @basketParam
  @ApiEndpoint({
    id: 'store.rfqBaskets.get',
    summary: 'One of my RFQ baskets',
    description:
      'With each item’s RFQ, getpack’s quotations per quantity and its acceptance; others’ → 404 (D-301).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Basket', type: RfqBasketDto, example: BASKET_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('basketId', ParseUUIDPipe) id: string) {
    return this.baskets.get(customer(actor), id);
  }

  @Post(':basketId/actions/accept-items')
  @HttpCode(200)
  @Idempotent()
  @basketParam
  @ApiEndpoint({
    id: 'store.rfqBaskets.acceptItems',
    summary: 'Accept quoted items into my cart',
    description:
      'For each chosen item: one quantity of its sent, valid quotation. Every choice is checked first; then each ' +
      'becomes a quotation (as `store.rfqs.accept`) and a cart line at the quoted price, locked until the ' +
      'quotation’s validity, delivered to my default address (D-301, D-051).',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiBody({
    type: AcceptBasketItemsDto,
    examples: {
      default: {
        value: {
          items: [
            {
              itemId: '0192f3a0-7c1e-7d2a-9b1f-0000000e7402',
              rfqQuoteId: '0192f3a0-7c1e-7d2a-9b1f-0000000e7406',
              quantity: 1000,
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Accepted', type: AcceptedBasketDto, example: ACCEPTED_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'rfq_baskets.not_submitted',
    'rfq.quote_not_open',
    'cart.item_exists',
  )
  acceptItems(
    @CurrentActor() actor: Actor,
    @Param('basketId', ParseUUIDPipe) id: string,
    @Body() body: AcceptBasketItemsDto,
  ) {
    return this.baskets.acceptItems(customer(actor), id, body.items);
  }
}
