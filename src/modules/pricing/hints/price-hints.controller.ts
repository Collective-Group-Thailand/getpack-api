import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';

import {
  PRICE_HINT_EXAMPLE,
  PRICE_TIERS_EXAMPLE,
  PriceHintDto,
  PriceHintQuery,
  PriceTiersDto,
} from './price-hints.dto';
import { PriceHintsService } from './price-hints.service';

/** `/v1/store/catalog/price-hints`: "starting from" prices for product cards and pages (D-220, D-181). */
@ApiTags('store.catalog')
@Controller('catalog/price-hints')
export class StorePriceHintsController {
  constructor(private readonly hints: PriceHintsService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiEndpoint({
    id: 'store.catalog.listPriceHints',
    summary: 'Get "starting from" prices',
    description:
      'Per catalogue product: its reference configuration (kept by catalogue admins) priced by the ported calculator ' +
      'through the quote path — the cheapest instant path, no factory named (D-220, D-043, D-050) — rounded up to ' +
      'the satang, with the basis it assumes (quantity, VAT, no delivery, the reference spec) and the lead time. ' +
      '`startingFromPerPiece` is null when nothing can price it (the product is RFQ); never an estimate (D-181). ' +
      'Refreshed when prices, quote modes or the product change, and hourly.',
    implements: ['D-220', 'D-181', 'D-043', 'D-050'],
  })
  @ApiSuccess(200, { description: 'Price hints', type: [PriceHintDto], example: [PRICE_HINT_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  list(@Query() query: PriceHintQuery): Promise<PriceHintDto[]> {
    return this.hints.list(query);
  }

  @Get(':slug/tiers')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiParam({ name: 'slug', example: 'tuck-end-box', description: 'Catalogue product slug' })
  @ApiEndpoint({
    id: 'store.catalog.getPriceTiers',
    summary: "Get the tier table of a product's default spec",
    description:
      "C1-API-2 (products R2, DECISIONS-STAGE-A §4): the product's default spec (D-441, the reference configuration " +
      'the configurator opens on) priced at every quantity preset of its configurator (ascending, ≤ 10) through the ' +
      'one store pricing path — each tier exactly as `store.quotes.calculate` answers it for that configuration with no ' +
      'delivery postcode (shipping pending), including `netAmount` and `vatRate`. Pure calculation: no calculate log, ' +
      'no quote, cart or customer record. Reused for 60 s. `tiers` is empty (and `basis` null) when the product has no ' +
      'instant default spec — the page then offers the quotation route, never an estimate (D-181). No factory named ' +
      '(D-050).',
    implements: ['D-441', 'D-220', 'D-181', 'D-050'],
  })
  @ApiSuccess(200, { description: 'Tier table', type: PriceTiersDto, example: PRICE_TIERS_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  tiers(@Param('slug') slug: string): Promise<PriceTiersDto> {
    return this.hints.tiers(slug);
  }
}
