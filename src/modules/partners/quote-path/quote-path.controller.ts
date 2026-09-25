import { Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';

import {
  COVERAGE_EXAMPLE,
  CoverageQuery,
  ProductTypeCoverageDto,
  QuotePathDto,
  QuotePathRequestDto,
} from './quote-path.dto';
import { QuotePathService } from './quote-path.service';

@ApiTags('store.catalog')
@Controller('catalog')
export class StoreQuotePathController {
  constructor(private readonly quotePath: QuotePathService) {}

  @Post('quote-path')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'store.catalog.resolveQuotePath',
    summary: 'Tell whether a configuration can be priced instantly',
    description:
      'Instant only when the type is quoted instantly and an active factory prices it: tier A, or tier B whose lines ' +
      'cover the configuration; otherwise the configurator routes to RFQ (D-043, D-100). Carries no factory data (D-050).',
    implements: ['D-043', 'D-100', 'D-050'],
  })
  @ApiBody({
    type: QuotePathRequestDto,
    examples: {
      default: {
        value: {
          productTypeCode: 'folding_carton',
          configuration: {
            patternCode: 'tuck-end',
            widthMm: 60,
            lengthMm: 40,
            heightMm: 120,
            quantity: 1000,
          },
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Quote path',
    type: QuotePathDto,
    example: { productTypeCode: 'folding_carton', mode: 'rfq', reason: 'type_rfq_only' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  resolve(@Body() body: QuotePathRequestDto): Promise<QuotePathDto> {
    return this.quotePath.resolveByCode(body.productTypeCode, body.configuration ?? {});
  }
}

@ApiSurface('admin', 'partnerCoverage')
@Controller('partners')
export class AdminCoverageController {
  constructor(private readonly quotePath: QuotePathService) {}

  @Get('coverage')
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.partnerCoverage.get',
    summary: 'Coverage map: which factories cover each product type',
    description:
      'Per active type: quote mode, whether an instant path exists, and every factory with a capability for it — status, ' +
      'tier, price-list version and weekly capacity in force (D-043, D-100, D-101).',
    implements: ['D-043', 'D-100', 'D-101'],
  })
  @ApiSuccess(200, { description: 'Coverage', type: [ProductTypeCoverageDto], example: [COVERAGE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  coverage(@Query() query: CoverageQuery): Promise<ProductTypeCoverageDto[]> {
    return this.quotePath.coverage(query.productTypeId);
  }
}
