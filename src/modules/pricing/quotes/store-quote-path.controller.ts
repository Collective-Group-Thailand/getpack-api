import { Public } from '@common/auth/auth.decorators';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { type EnvelopeFacts } from '@modules/partners/configuration/tier-b-envelope';
import {
  AVAILABILITY_EXAMPLE,
  ProductTypeAvailabilityDto,
  QuotePathDto,
  QuotePathRequestDto,
} from '@modules/partners/quote-path/quote-path.dto';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam, ApiTags } from '@nestjs/swagger';

import { validateConfiguration } from './configurations';
import { QuoteEngineService } from './quote-engine.service';

/**
 * The store's quote-path answers (D-043, D-100, D-234): whether a configuration, or a product type, has an instant
 * price path. They carry no factory data (D-050, D-044).
 */
@ApiTags('store.catalog')
@Controller('catalog')
export class StoreQuotePathController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotePath: QuotePathService,
    private readonly engine: QuoteEngineService,
  ) {}

  @Post('quote-path')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'store.catalog.resolveQuotePath',
    summary: 'Tell whether a configuration can be priced instantly',
    description:
      'Instant only when the type is quoted instantly and an active factory prices it: tier A, or tier B whose envelope ' +
      'covers the configuration (D-234); otherwise the configurator routes to RFQ (D-043, D-100). A tier-B envelope is ' +
      'matched only on a complete configuration of the type’s calculator (the body of `store.quotes.calculate`); a ' +
      'partial configurator state cannot be matched yet. The price itself decides per quantity. Carries no factory data ' +
      '(D-050).',
    implements: ['D-043', 'D-234', 'D-100', 'D-050'],
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
  async resolve(@Body() body: QuotePathRequestDto): Promise<QuotePathDto> {
    const type = await this.prisma.productType.findFirst({
      where: { code: body.productTypeCode, status: 'active' },
    });
    if (!type) throw new DomainException('http.not_found');
    let facts: EnvelopeFacts | null = null;
    let quantities: readonly number[] | null = null;
    if (type.calculatorKey && this.engine.hasCalculator(type.calculatorKey) && body.configuration) {
      try {
        const configuration = await validateConfiguration(type.calculatorKey, body.configuration, {
          staff: false,
        });
        ({ facts, quantities } = await this.engine.envelopeFacts(type.calculatorKey, configuration));
      } catch (error) {
        // Not a complete calculator configuration: a tier-B envelope cannot be matched (fail closed).
        if (!(error instanceof DomainException)) throw error;
      }
    }
    const reason = await this.quotePath.resolve(type, facts, quantities);
    return { productTypeCode: type.code, mode: reason === 'instant_available' ? 'instant' : 'rfq', reason };
  }

  @Get('types/:typeId/availability')
  @Public()
  @ApiParam({ name: 'typeId', format: 'uuid', description: 'Product type' })
  @ApiEndpoint({
    id: 'store.catalog.getTypeAvailability',
    summary: 'Tell how a product type can be priced: instant, partial or RFQ',
    description:
      '`instant`: an active factory holds a full (tier A) price path; `partial`: only tier-B paths — instant inside the ' +
      'summarised envelope, RFQ outside it; `rfq`: no instant path or the type is quoted on request (D-043, D-234, ' +
      'D-100). Never names a factory (D-050, D-044).',
    implements: ['D-043', 'D-234', 'D-100', 'D-050'],
  })
  @ApiSuccess(200, {
    description: 'Availability of the type',
    type: ProductTypeAvailabilityDto,
    example: AVAILABILITY_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.not_found', 'validation.failed')
  availability(@Param('typeId', ParseUUIDPipe) typeId: string): Promise<ProductTypeAvailabilityDto> {
    return this.quotePath.availability(typeId);
  }
}
