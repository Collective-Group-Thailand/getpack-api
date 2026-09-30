import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PRICE_HINT_EXAMPLE, PriceHintDto, PriceHintQuery } from './price-hints.dto';
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
}
