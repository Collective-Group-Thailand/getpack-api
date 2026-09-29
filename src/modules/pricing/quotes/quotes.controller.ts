import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  type PipeTransform,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { validateConfiguration } from './configurations';
import {
  CORRUGATE_CONFIGURATION_EXAMPLE,
  CorrugateConfigurationDto,
  CsCorrugateConfigurationDto,
} from './corrugate.dto';
import { CorrugateInputDataService } from './corrugate-input-data.service';
import { FoldingInputDataService } from './folding-input-data.service';
import {
  ADMIN_CALCULATION_EXAMPLE,
  AdminQuoteCalculationDto,
  CalculateQuoteDto,
  CONFIGURATION_EXAMPLE,
  FoldingConfigurationDto,
  QuoteCalculationDto,
  STORE_CALCULATION_EXAMPLE,
} from './quote.dto';
import { QuoteEngineService, type QuoteView } from './quote-engine.service';
import {
  CORRUGATE_INPUT_DATA_EXAMPLE,
  CorrugateInputDataDto,
  FACTORY_QUOTE_EXAMPLE,
  FactoryQuoteDto,
  FoldingInputDataDto,
  INPUT_DATA_EXAMPLE,
} from './quotes.io.dto';

const CALCULATION = ['D-100', 'D-043', 'D-050', 'D-051', 'D-101'];

/** The customer view: the staff-only part never leaves the store surface (D-050). */
/** Optional 5-digit postcode query parameter. */
class ParseOptionalPostcodePipe implements PipeTransform<unknown, string | undefined> {
  transform(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^[0-9]{5}$/.test(value)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'deliveryPostcode', code: 'pattern', message: 'deliveryPostcode must be 5 digits' }],
      });
    }
    return value;
  }
}

const storeView = (view: QuoteView): QuoteCalculationDto => ({
  calculatorVersion: view.calculatorVersion,
  steps: view.steps.map(({ internal: _internal, ...step }) => step),
});

/** The staff view with buy prices only for `factory_cost.read` and margins only for `margin.read` (D-141). */
async function adminView(
  view: QuoteView,
  actor: Actor,
  permissions: PermissionResolver,
): Promise<AdminQuoteCalculationDto> {
  const granted =
    actor.type === 'user' ? (await permissions.forUser(actor.userId)).permissions : new Set<string>();
  const cost = granted.has('factory_cost.read');
  const margin = granted.has('margin.read');
  return {
    calculatorVersion: view.calculatorVersion,
    options: view.options,
    steps: view.steps.map((s) => ({
      ...s,
      internal: s.internal && {
        ...s.internal,
        buyPrice: cost ? s.internal.buyPrice : null,
        marginPct: margin ? s.internal.marginPct : null,
        parts: s.internal.parts.map((p) => ({ ...p, buyPrice: cost ? p.buyPrice : null })),
        shipping: s.internal.shipping && {
          ...s.internal.shipping,
          costAmount: cost ? s.internal.shipping.costAmount : null,
          marginAmount: margin ? s.internal.shipping.marginAmount : null,
        },
      },
    })),
  };
}

@ApiTags('store.quotes')
@ApiExtraModels(FoldingConfigurationDto, CorrugateConfigurationDto)
@Controller('quotes')
export class StoreQuotesController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('actions/calculate')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'store.quotes.calculate',
    summary: 'Calculate an instant price for a configuration',
    description:
      'Prices each quantity from the active factories that hold an instant price path (D-043, D-100): price incl. VAT, ' +
      'lead time and earliest ship date within capacity (D-101), quantity tolerance (D-021). A quantity without an ' +
      'instant price carries the reason and routes to RFQ. The configuration is the one of the type’s calculator ' +
      '(folding, corrugate). Nothing is saved (quotes are saved with B2.5, D-051); no factory data is returned ' +
      '(D-050). Works signed in or anonymously.',
    implements: CALCULATION,
  })
  @ApiBody({
    type: CalculateQuoteDto,
    examples: {
      folding: { value: { productTypeCode: 'folding_carton', configuration: CONFIGURATION_EXAMPLE } },
      corrugate: { value: { productTypeCode: 'corrugated', configuration: CORRUGATE_CONFIGURATION_EXAMPLE } },
    },
  })
  @ApiSuccess(200, {
    description: 'Prices per quantity',
    type: QuoteCalculationDto,
    example: STORE_CALCULATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
  )
  async calculate(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: CalculateQuoteDto,
  ): Promise<QuoteCalculationDto> {
    const type = await this.prisma.productType.findFirst({
      where: { code: body.productTypeCode, status: 'active' },
    });
    if (
      !type?.calculatorKey ||
      type.quoteMode !== 'instant' ||
      !this.engine.hasCalculator(type.calculatorKey)
    )
      throw new DomainException('pricing.not_instant');
    const configuration = await validateConfiguration(type.calculatorKey, body.configuration, {
      staff: false,
    });
    const view = await this.engine.price(type.calculatorKey, configuration, {
      channel: 'web',
      actorUserId: actor?.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
      deliveryPostcode: body.deliveryPostcode,
    });
    return storeView(view);
  }
}

@ApiSurface('admin', 'csFolding')
@Controller('cs/folding')
export class AdminCsFoldingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: FoldingInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csFolding.inputData',
    summary: 'Catalogue choices of the CS folding calculator',
    description:
      'Active folding patterns with their parts, papers, ink colours, finishes 1 and 2, die-cuts, assemblies and difficulty levels (D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, { description: 'Input data', type: FoldingInputDataDto, example: INPUT_DATA_EXAMPLE })
  @ApiStandardErrors()
  get(): Promise<FoldingInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csFolding.calculate',
    summary: 'Price a folding configuration for a customer (CS)',
    description:
      'The store calculation plus the staff view: selected factory and print type, price-list version, production run, ' +
      'margin-floor flag (D-012) and each option’s reason when it has no price. Buy prices need `factory_cost.read`, the ' +
      'margin `margin.read` (D-141); they are null otherwise. Works before the type is switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({ type: FoldingConfigurationDto, examples: { default: { value: CONFIGURATION_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Prices per quantity with the staff view',
    type: AdminQuoteCalculationDto,
    example: ADMIN_CALCULATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.vat_rate_missing',
  )
  @ApiQuery({
    name: 'deliveryPostcode',
    required: false,
    schema: { type: 'string', pattern: '^[0-9]{5}$', example: '10110' },
    description: 'Prices shipping on the customer rate card (D-013)',
  })
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: FoldingConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('folding', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingFolding')
@Controller('factories/:factoryId/pricing/folding')
export class PartnerFoldingPricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingFolding.calculate',
    summary: 'Price a folding configuration on my own price list',
    description:
      'The buy side only, on the factory’s own price list in force: cost, buy price per part, layouts, sheets, lead ' +
      'time, per print type. Never Packio’s sell price or another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({ type: FoldingConfigurationDto, examples: { default: { value: CONFIGURATION_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Buy side per print type',
    type: FactoryQuoteDto,
    example: FACTORY_QUOTE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async calculate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: FoldingConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('folding', body, factory);
  }
}

@ApiSurface('admin', 'csCorrugate')
@Controller('cs/corrugate')
export class AdminCsCorrugateController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: CorrugateInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csCorrugate.inputData',
    summary: 'Catalogue choices of the CS corrugate calculator',
    description:
      'Active corrugate patterns with their parts and blank formulas, corrugated boards with their flute, ink colours, ' +
      'coatings, assemblies (the automatic packing is added by the calculator), difficulty levels and print areas ' +
      '(legacy `cs/corrugate`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, {
    description: 'Input data',
    type: CorrugateInputDataDto,
    example: CORRUGATE_INPUT_DATA_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<CorrugateInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csCorrugate.calculate',
    summary: 'Price a corrugate configuration for a customer (CS)',
    description:
      'The store calculation plus the staff view (selected factory and print type, price-list version, margin-floor ' +
      'flag, each option’s reason when it has no price). Plates and die blocks are their own tooling line. Buy prices ' +
      'need `factory_cost.read`, the margin `margin.read` (D-141). CS may price digital print on its coverage. Works ' +
      'before the type is switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({
    type: CsCorrugateConfigurationDto,
    examples: { default: { value: CORRUGATE_CONFIGURATION_EXAMPLE } },
  })
  @ApiSuccess(200, {
    description: 'Prices per quantity with the staff view',
    type: AdminQuoteCalculationDto,
    example: ADMIN_CALCULATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.vat_rate_missing',
  )
  @ApiQuery({
    name: 'deliveryPostcode',
    required: false,
    schema: { type: 'string', pattern: '^[0-9]{5}$', example: '10110' },
    description: 'Prices shipping on the customer rate card (D-013)',
  })
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: CsCorrugateConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('corrugate', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingCorrugate')
@Controller('factories/:factoryId/pricing/corrugate')
export class PartnerCorrugatePricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingCorrugate.calculate',
    summary: 'Price a corrugate configuration on my own price list',
    description:
      'The buy side only, on the factory’s own price list in force: cost, buy price per part (plates and die blocks ' +
      'included), layouts, sheets, lead time, per print type. Never Packio’s sell price or another factory (D-044, ' +
      'D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({
    type: CorrugateConfigurationDto,
    examples: { default: { value: CORRUGATE_CONFIGURATION_EXAMPLE } },
  })
  @ApiSuccess(200, {
    description: 'Buy side per print type',
    type: FactoryQuoteDto,
    example: FACTORY_QUOTE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async calculate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CorrugateConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('corrugate', body, factory);
  }
}
