import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { resolveLanguage } from '@common/i18n/language';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  type PipeTransform,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SettingsService } from '@platform/settings/settings.service';

import { HERO_PREVIEW_EXAMPLE, HeroPreviewDto, HeroPreviewRequestDto } from './hero-presets.dto';
import { HeroPresetsService } from './hero-presets.service';

/** UX r2 A2: the hero preview is anonymous; 30 a minute per client (env `HERO_PREVIEW_THROTTLE_LIMIT`). */
const HERO_PREVIEW_THROTTLE = {
  default: { limit: () => Number(process.env.HERO_PREVIEW_THROTTLE_LIMIT ?? 30), ttl: 60_000 },
};
import {
  CORRUGATE_CONFIGURATION_EXAMPLE,
  CorrugateConfigurationDto,
  CsCorrugateConfigurationDto,
} from './corrugate.dto';
import { CorrugateInputDataService } from './corrugate-input-data.service';
import { CsServicePricingService } from './cs-service-pricing.service';
import { FoldingInputDataService } from './folding-input-data.service';
import { LABEL_CONFIGURATION_EXAMPLE, LabelConfigurationDto } from './label.dto';
import { LabelInputDataService } from './label-input-data.service';
import { POUCH_CONFIGURATION_EXAMPLE, PouchConfigurationDto } from './pouch.dto';
import { PouchInputDataService } from './pouch-input-data.service';
import {
  ADMIN_CALCULATION_EXAMPLE,
  AdminQuoteCalculationDto,
  CalculateQuoteDto,
  CONFIGURATION_EXAMPLE,
  FoldingConfigurationDto,
  QuoteCalculationDto,
  STORE_CALCULATION_EXAMPLE,
} from './quote.dto';
import {
  CALCULATE_BATCH_EXAMPLE,
  CalculateQuoteBatchDto,
  QuoteBatchCalculationDto,
  STORE_CALCULATION_BATCH_EXAMPLE,
} from './quote-batch.dto';
import { QuoteBatchService } from './quote-batch.service';
import { QuoteEngineService, type QuoteView } from './quote-engine.service';
import {
  CORRUGATE_INPUT_DATA_EXAMPLE,
  CorrugateInputDataDto,
  FACTORY_QUOTE_EXAMPLE,
  FactoryQuoteDto,
  FoldingInputDataDto,
  INPUT_DATA_EXAMPLE,
  LABEL_INPUT_DATA_EXAMPLE,
  LabelInputDataDto,
  POUCH_INPUT_DATA_EXAMPLE,
  PouchInputDataDto,
  SERVICE_INPUT_DATA_EXAMPLE,
  ServiceInputDataDto,
  STANDARD_PRODUCT_INPUT_DATA_EXAMPLE,
  StandardProductInputDataDto,
  TAG_SLEEVE_INPUT_DATA_EXAMPLE,
} from './quotes.io.dto';
import {
  CS_SERVICE_PRICE_EXAMPLE,
  CS_SERVICE_PRICE_RESULT_EXAMPLE,
  CsServicePriceDto,
  CsServicePriceResultDto,
  SERVICE_CONFIGURATION_EXAMPLE,
  ServiceConfigurationDto,
} from './service.dto';
import { resolveServiceAmount } from './service-amount';
import { ServiceInputDataService } from './service-input-data.service';
import {
  STANDARD_PRODUCT_CONFIGURATION_EXAMPLE,
  StandardProductConfigurationDto,
} from './standard-product.dto';
import { StandardProductInputDataService } from './standard-product-input-data.service';
import { StorePricingService } from './store-pricing.service';
import { storeStepFields } from './store-step-fields';
import { TAG_SLEEVE_CONFIGURATION_EXAMPLE, TagSleeveConfigurationDto } from './tag-sleeve.dto';
import { toolingView } from './tooling-view';

/** The batch prices up to 24 variants a request, so it is stricter than `calculate`: 20 a minute per client (env `CALCULATE_BATCH_THROTTLE_LIMIT`). */
const CALCULATE_BATCH_THROTTLE = {
  default: { limit: () => Number(process.env.CALCULATE_BATCH_THROTTLE_LIMIT ?? 20), ttl: 60_000 },
};
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

/** The staff view with buy prices only for `factory_buy_prices.read` and margins only for `margin.read` (D-141). */
async function adminView(
  view: QuoteView,
  actor: Actor,
  permissions: PermissionResolver,
): Promise<AdminQuoteCalculationDto> {
  const granted =
    actor.type === 'user' ? (await permissions.forUser(actor.userId)).permissions : new Set<string>();
  const cost = granted.has('factory_buy_prices.read');
  const margin = granted.has('margin.read');
  const extra = storeStepFields(view);
  return {
    calculatorVersion: view.calculatorVersion,
    options: view.options,
    dimensions: view.dimensions,
    steps: view.steps.map((s, i) => ({
      ...s,
      ...extra[i]!,
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
        tooling: s.internal.tooling
          ? {
              charged: toolingView(s.internal.tooling.charged, cost),
              waived: toolingView(s.internal.tooling.waived, cost),
            }
          : null,
      },
    })),
  };
}

@ApiTags('store.quotes')
@ApiExtraModels(
  FoldingConfigurationDto,
  CorrugateConfigurationDto,
  LabelConfigurationDto,
  TagSleeveConfigurationDto,
  PouchConfigurationDto,
  StandardProductConfigurationDto,
  ServiceConfigurationDto,
)
@Controller('quotes')
export class StoreQuotesController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly prisma: PrismaService,
    private readonly hero: HeroPresetsService,
    private readonly settings: SettingsService,
    private readonly storePricing: StorePricingService,
    private readonly batch: QuoteBatchService,
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
      '(folding, corrugate, label, tag & sleeve, pouch, standard product, service). Nothing is saved (quotes are saved with B2.5, D-051); no factory data is returned ' +
      '(D-050). Works signed in or anonymously. With `targetPricePerUnit` the response gives each instant ' +
      'quantity’s gap against it (D-247); the target is not stored here. `specs` and `specLabel` say which spec the ' +
      'price is for, built by the same helper as quotations, carts, orders and the "starting from" basis (size as ' +
      'ยาว × กว้าง × สูง, mm); every store surface prices through this one path (D-441). A print combination the ' +
      'product’s print model in force or `catalog.print_limits` does not offer (D-443) is not an error: every ' +
      'quantity answers `instant: false` with `reason: rfq_required` (the quote path, B-API-6).',
    implements: [...CALCULATION, 'D-247', 'D-441', 'D-443'],
  })
  @ApiBody({
    type: CalculateQuoteDto,
    examples: {
      folding: { value: { productTypeCode: 'folding_carton', configuration: CONFIGURATION_EXAMPLE } },
      corrugate: { value: { productTypeCode: 'corrugated', configuration: CORRUGATE_CONFIGURATION_EXAMPLE } },
      tagSleeve: {
        value: { productTypeCode: 'tag_sleeve', configuration: TAG_SLEEVE_CONFIGURATION_EXAMPLE },
      },
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
    'specs.unit_not_accepted',
  )
  calculate(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: CalculateQuoteDto,
  ): Promise<QuoteCalculationDto> {
    return this.priceForStore(actor, body);
  }

  @Post('actions/calculate-batch')
  @HttpCode(200)
  @Public()
  @Throttle(CALCULATE_BATCH_THROTTLE)
  @ApiEndpoint({
    id: 'store.quotes.calculateBatch',
    summary: 'Calculate instant prices for up to 24 option variants',
    description:
      'The configurator’s option cards (sizes, materials, print choices, quantities) priced in ONE request instead ' +
      'of one `store.quotes.calculate` per card (D-441, D-043). Each variant is a full configuration of the product ' +
      'type’s calculator and goes through the very path `calculate` uses (no formula of its own); `quantities`, when ' +
      'sent, replaces `configuration.quantities` of every variant. `results` follow the request order, keyed by the ' +
      'client `key` (unique, 1 to 64 characters, 1 to 24 variants). A variant that fails (for example ' +
      '`validation.failed`, `pricing.print_combination_invalid`) does not fail the batch: its entry has ' +
      '`calculation: null` and a `problem` with the code `calculate` would raise. Variants are priced at most four at a ' +
      'time. Writes what `calculate` writes per priced variant (one calculate log row and its `quote.calculated` ' +
      'event) and nothing else: no quote, cart, order or customer. Anonymous, 20 requests per minute per client. ' +
      'No factory data (D-050). 422 `validation.failed` for more than 24 variants, a duplicate key or a malformed body, ' +
      '`pricing.not_instant` when the product type has no instant price.',
    implements: [...CALCULATION, 'D-441', 'D-043'],
  })
  @ApiBody({
    type: CalculateQuoteBatchDto,
    examples: { folding: { value: CALCULATE_BATCH_EXAMPLE } },
  })
  @ApiSuccess(200, {
    description: 'One result per variant, in request order',
    type: QuoteBatchCalculationDto,
    example: STORE_CALCULATION_BATCH_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'pricing.not_instant')
  calculateBatch(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: CalculateQuoteBatchDto,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<QuoteBatchCalculationDto> {
    return this.batch.calculate(actor, body, resolveLanguage(acceptLanguage));
  }

  @Post('actions/preview')
  @HttpCode(200)
  @Public()
  @Throttle(HERO_PREVIEW_THROTTLE)
  @ApiEndpoint({
    id: 'store.quotes.preview',
    summary: 'Price a homepage Studio hero choice',
    description:
      'The hero’s shape, board, print, inside size (mm, D-182) and quantity, mapped by `catalog.hero_presets` to the ' +
      'catalogue product and options (`store.catalog.getHeroPresets`), priced by the very `store.quotes.calculate` ' +
      'path `/configure` uses — no formula of its own (D-310, D-043); `calculation` is the body it priced. Anonymous, ' +
      '30 requests per minute per client. 409 `quotes.preview_unavailable` when the presets do not offer the choice, ' +
      '`pricing.not_instant` when the quantity has no instant price. No factory data (D-050).',
    implements: ['D-310', 'D-043', 'D-051', 'D-050'],
  })
  @ApiBody({
    type: HeroPreviewRequestDto,
    examples: {
      default: {
        value: {
          shape: 'mailer',
          lengthMm: 200,
          widthMm: 150,
          heightMm: 80,
          material: 'kraft350',
          print: 'one',
          qty: 1000,
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Hero price', type: HeroPreviewDto, example: HERO_PREVIEW_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'quotes.preview_unavailable',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
  )
  async preview(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: HeroPreviewRequestDto,
  ): Promise<HeroPreviewDto> {
    const { body: calculation, presetId } = await this.hero.body(body);
    const view = await this.priceForStore(actor, calculation);
    const step = view.steps[0];
    if (!step?.instant || step.unitPrice === null || step.grossAmount === null)
      throw new DomainException('pricing.not_instant');
    const validity = await this.settings.at('quotes.validity_days');
    return {
      unitPrice: step.unitPrice,
      total: step.grossAmount,
      currency: 'THB',
      vatIncluded: true,
      leadTimeBusinessDays: { min: step.leadTimeDays ?? 0, max: step.leadTimeDays ?? 0 },
      priceLockUntil: toBangkokIso(new Date(Date.now() + Number(validity.value) * 86_400_000)),
      presetId,
      calculation: calculation as unknown as Record<string, unknown>,
    };
  }

  /** The store's instant price of a calculator configuration — the one path `/configure` and the hero share. */
  private async priceForStore(
    actor: Actor | undefined,
    body: CalculateQuoteDto,
  ): Promise<QuoteCalculationDto> {
    const calculatorKey = await this.storePricing.calculatorKeyOf(body.productTypeCode);
    // D-441: the one store pricing path (validation, store rules, engine, spec lines).
    const priced = await this.storePricing.price(
      calculatorKey,
      body.configuration,
      {
        actorUserId: actor?.type === 'user' ? actor.userId : undefined,
        ip: RequestContext.current()?.ip,
        deliveryPostcode: body.deliveryPostcode,
      },
      body.targetPricePerUnit,
    );
    return priced.calculation;
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
      'margin-floor flag (D-012) and each option’s reason when it has no price. Buy prices need `factory_buy_prices.read`, the ' +
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
    'specs.basis_not_accepted',
    'specs.unit_not_accepted',
    'specs.caliper_missing',
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
      'time, per print type. Never getpack’s sell price or another factory (D-044, D-042); another factory is 404. ' +
      'Engine B print types are priced here before they are released to quotes, for checking (D-233).',
    implements: ['D-044', 'D-042', 'D-040', 'D-233'],
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
    // Engine B options are priced before their release so the factory can check its B price list (D-233).
    return this.engine.priceForFactory('folding', body, factory, new Date(), { preview: true });
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
      'need `factory_buy_prices.read`, the margin `margin.read` (D-141). CS may price digital print on its coverage. Works ' +
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
    'specs.basis_not_accepted',
    'specs.caliper_missing',
    'specs.unit_not_accepted',
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
      'included), layouts, sheets, lead time, per print type. Never getpack’s sell price or another factory (D-044, ' +
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

@ApiSurface('admin', 'csLabel')
@Controller('cs/label')
export class AdminCsLabelController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: LabelInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csLabel.inputData',
    summary: 'Catalogue choices of the CS label calculator',
    description:
      'Active label stocks, ink colours, coatings, die-cut types, difficulty levels and the label catalogue products ' +
      '(legacy `cs/label/get-input-data`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, { description: 'Input data', type: LabelInputDataDto, example: LABEL_INPUT_DATA_EXAMPLE })
  @ApiStandardErrors()
  get(): Promise<LabelInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csLabel.calculate',
    summary: 'Price a label configuration for a customer (CS)',
    description:
      'The store calculation plus the staff view (selected factory and print type, price-list version, margin-floor ' +
      'flag, each option’s reason when it has no price). Labels are priced on their W × L bounding box on the ' +
      'factory’s sheets and rolls; offset label printing is not priced (U-B6 label, quirk L2). Buy prices need ' +
      '`factory_buy_prices.read`, the margin `margin.read` (D-141). Works before the type is switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({ type: LabelConfigurationDto, examples: { default: { value: LABEL_CONFIGURATION_EXAMPLE } } })
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
    'specs.basis_not_accepted',
    'specs.unit_not_accepted',
  )
  @ApiQuery({
    name: 'deliveryPostcode',
    required: false,
    schema: { type: 'string', pattern: '^[0-9]{5}$', example: '10110' },
    description: 'Prices shipping on the customer rate card (D-013)',
  })
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: LabelConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('label', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingLabel')
@Controller('factories/:factoryId/pricing/label')
export class PartnerLabelPricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingLabel.calculate',
    summary: 'Price a label configuration on my own price list',
    description:
      'The buy side only, on the factory’s own price list in force: cost, buy price, lay-out, sheets (or metres of ' +
      'roll), lead time, per print type (legacy factory tool `POST /api/calculate/label`). Never getpack’s sell price or ' +
      'another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({ type: LabelConfigurationDto, examples: { default: { value: LABEL_CONFIGURATION_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Buy side per print type',
    type: FactoryQuoteDto,
    example: FACTORY_QUOTE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async calculate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: LabelConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('label', body, factory);
  }
}

@ApiSurface('admin', 'csTagSleeve')
@Controller('cs/tag-sleeve')
export class AdminCsTagSleeveController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: FoldingInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csTagSleeve.inputData',
    summary: 'Catalogue choices of the CS tag & sleeve calculator',
    description:
      'Active tag & sleeve patterns (flat blanks), papers, ink colours, finishes 1 and 2, die-cuts, assemblies (hole, ' +
      'corner cut, string…), difficulty levels and the tag catalogue products (legacy `cs/tag/get-input-data`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, {
    description: 'Input data',
    type: FoldingInputDataDto,
    example: TAG_SLEEVE_INPUT_DATA_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<FoldingInputDataDto> {
    return this.inputData.get('tag_sleeve');
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csTagSleeve.calculate',
    summary: 'Price a tag & sleeve configuration for a customer (CS)',
    description:
      'The store calculation plus the staff view (selected factory and print type, price-list version, production ' +
      'run, margin-floor flag, each option’s reason when it has no price). A tag or sleeve is a flat blank priced on ' +
      'the folding engine with the factory’s tag & sleeve price list; finish 2 is offset only (U-B6 tag & sleeve, ' +
      'quirk T9). Buy prices need `factory_buy_prices.read`, the margin `margin.read` (D-141). Works before the type is ' +
      'switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({
    type: TagSleeveConfigurationDto,
    examples: { default: { value: TAG_SLEEVE_CONFIGURATION_EXAMPLE } },
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
    'specs.basis_not_accepted',
    'specs.caliper_missing',
    'specs.unit_not_accepted',
  )
  @ApiQuery({
    name: 'deliveryPostcode',
    required: false,
    schema: { type: 'string', pattern: '^[0-9]{5}$', example: '10110' },
    description: 'Prices shipping on the customer rate card (D-013)',
  })
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: TagSleeveConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('tag_sleeve', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingTagSleeve')
@Controller('factories/:factoryId/pricing/tag-sleeve')
export class PartnerTagSleevePricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingTagSleeve.calculate',
    summary: 'Price a tag & sleeve configuration on my own price list',
    description:
      'The buy side only, on the factory’s own tag & sleeve price list in force: cost, buy price, lay-out, sheets, lead ' +
      'time, per print type. Never getpack’s sell price or another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({
    type: TagSleeveConfigurationDto,
    examples: { default: { value: TAG_SLEEVE_CONFIGURATION_EXAMPLE } },
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
    @Body() body: TagSleeveConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('tag_sleeve', body, factory);
  }
}

@ApiSurface('admin', 'csPouch')
@Controller('cs/pouch')
export class AdminCsPouchController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: PouchInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csPouch.inputData',
    summary: 'Catalogue choices of the CS pouch calculator',
    description:
      'Active pouch patterns with their shape and gusset limits, laminated films, print colour sets, options (zipper, ' +
      'valve, spout, tear notch, white base…) and the pouch catalogue products (legacy `cs/pouch/get-input-data`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, { description: 'Input data', type: PouchInputDataDto, example: POUCH_INPUT_DATA_EXAMPLE })
  @ApiStandardErrors()
  get(): Promise<PouchInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csPouch.calculate',
    summary: 'Price a pouch configuration for a customer (CS)',
    description:
      'The store calculation plus the staff view (selected factory and print type, price-list version, margin-floor ' +
      'flag, each option’s reason when it has no price). A pouch is priced on the film it takes on the factory’s web, ' +
      'its print, lamination, making and options (legacy `PouchCalculator`); a quantity below the factory’s minimum is ' +
      'refused, never raised (U-B6 pouch). Buy prices need `factory_buy_prices.read`, the margin `margin.read` (D-141). Works ' +
      'before the type is switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({ type: PouchConfigurationDto, examples: { default: { value: POUCH_CONFIGURATION_EXAMPLE } } })
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
    'specs.basis_not_accepted',
    'specs.unit_not_accepted',
  )
  @ApiQuery({
    name: 'deliveryPostcode',
    required: false,
    schema: { type: 'string', pattern: '^[0-9]{5}$', example: '10110' },
    description: 'Prices shipping on the customer rate card (D-013)',
  })
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: PouchConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('pouch', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingPouch')
@Controller('factories/:factoryId/pricing/pouch')
export class PartnerPouchPricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingPouch.calculate',
    summary: 'Price a pouch configuration on my own price list',
    description:
      'The buy side only, on the factory’s own pouch price list in force: cost, buy price, metres of film, lead time, ' +
      'per print type. Never getpack’s sell price or another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({ type: PouchConfigurationDto, examples: { default: { value: POUCH_CONFIGURATION_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Buy side per print type',
    type: FactoryQuoteDto,
    example: FACTORY_QUOTE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async calculate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: PouchConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('pouch', body, factory);
  }
}

@ApiSurface('admin', 'csStandardProduct')
@Controller('cs/standard-product')
export class AdminCsStandardProductController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: StandardProductInputDataService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csStandardProduct.inputData',
    summary: 'Catalogue choices of the CS standard-product calculator',
    description:
      'Active standard products (stock products) with their unit, minimum order and weight (legacy ' +
      '`cs/standard-products/get-products`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, {
    description: 'Input data',
    type: StandardProductInputDataDto,
    example: STANDARD_PRODUCT_INPUT_DATA_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<StandardProductInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csStandardProduct.calculate',
    summary: 'Price a standard product for a customer (CS)',
    description:
      'The store calculation plus the staff view (selected factory and print type, price-list version, margin-floor ' +
      'flag, each option’s reason when it has no price). A standard product is priced from the factory’s buy-price ' +
      'tiers with getpack’s margin and VAT (legacy `CalculatePrice`); delivery is its own line (D-013). Buy prices need ' +
      '`factory_buy_prices.read`, the margin `margin.read` (D-141). Works before the type is switched to instant, for checks.',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({
    type: StandardProductConfigurationDto,
    examples: { default: { value: STANDARD_PRODUCT_CONFIGURATION_EXAMPLE } },
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
    @Body() body: StandardProductConfigurationDto,
    @Query('deliveryPostcode', new ParseOptionalPostcodePipe()) deliveryPostcode?: string,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('standard_product', body, {
      deliveryPostcode,
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }
}

@ApiSurface('partner', 'pricingStandardProduct')
@Controller('factories/:factoryId/pricing/standard-product')
export class PartnerStandardProductPricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingStandardProduct.calculate',
    summary: 'Price a standard product on my own price list',
    description:
      'The buy side only, on the factory’s own standard-product price list in force: buy price per quantity, lead ' +
      'time, per print type. Never getpack’s sell price or another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({
    type: StandardProductConfigurationDto,
    examples: { default: { value: STANDARD_PRODUCT_CONFIGURATION_EXAMPLE } },
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
    @Body() body: StandardProductConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('standard_product', body, factory);
  }
}

@ApiSurface('admin', 'csService')
@Controller('cs/service')
export class AdminCsServiceController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly inputData: ServiceInputDataService,
    private readonly pricing: CsServicePricingService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('input-data')
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csService.inputData',
    summary: 'Service items of the CS service calculator',
    description:
      'Active service items — catalogue products of type `service` (plates, die blocks, molds, mockups, design, ' +
      'delivery…) — and the CS discount limit (legacy `cs/service/get-input-data`, D-100).',
    implements: ['D-100'],
  })
  @ApiSuccess(200, {
    description: 'Input data',
    type: ServiceInputDataDto,
    example: SERVICE_INPUT_DATA_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<ServiceInputDataDto> {
    return this.inputData.get();
  }

  @Post('calculate')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csService.calculate',
    summary: 'Price a service item from the factories’ service price lines (CS)',
    description:
      'The store calculation plus the staff view, from the factories’ `service` price lines (net cost per unit, ' +
      'getpack’s margin, VAT). A service ships nothing, so there is no shipping line. Without a line the item has no ' +
      'instant price: CS prices it from an amount (`admin.csService.price`). Buy prices need `factory_buy_prices.read`, the ' +
      'margin `margin.read` (D-141).',
    implements: [...CALCULATION, 'D-012', 'D-141'],
  })
  @ApiBody({ type: ServiceConfigurationDto, examples: { default: { value: SERVICE_CONFIGURATION_EXAMPLE } } })
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
  async calculate(
    @CurrentActor() actor: Actor,
    @Body() body: ServiceConfigurationDto,
  ): Promise<AdminQuoteCalculationDto> {
    const view = await this.engine.price('service', body, {
      channel: 'cs',
      actorUserId: actor.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    });
    return adminView(view, actor, this.permissions);
  }

  @Post('actions/price')
  @HttpCode(200)
  @Can('quotes.calculate')
  @ApiEndpoint({
    id: 'admin.csService.price',
    summary: 'Price a service from the amount CS enters',
    description:
      'Legacy `cs/service` maths, computed on the server (D-194: the price is entered by CS, no new formula): from a ' +
      'net buy price, getpack’s `service` margin and the dated VAT give the net and gross sell price; from a ' +
      'VAT-inclusive sell price (design), the net and the buy price — each rounded as legacy’s page did — and, for a ' +
      'hired freelancer, the payable (legacy `design_cost`). Nothing is saved. A buy price CS did not enter needs ' +
      '`factory_buy_prices.read`, the margin `margin.read` (D-141). The amount is `unitAmount` (money string); the numeric ' +
      '`amount` and the basis `buy_cost_net` are deprecated spellings, still accepted (D-042).',
    implements: ['D-194', 'D-100', 'D-063', 'D-141'],
  })
  @ApiBody({ type: CsServicePriceDto, examples: { default: { value: CS_SERVICE_PRICE_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Net, VAT and gross per unit and for the quantity',
    type: CsServicePriceResultDto,
    example: CS_SERVICE_PRICE_RESULT_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.vat_rate_missing',
  )
  async price(
    @CurrentActor() actor: Actor,
    @Body() body: CsServicePriceDto,
  ): Promise<CsServicePriceResultDto> {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    const { basis, amount } = resolveServiceAmount(body, 'admin.csService.price');
    return this.pricing.price(
      { ...body, basis, amount, basisAsSent: body.basis },
      {
        cost: granted.has('factory_buy_prices.read'),
        margin: granted.has('margin.read'),
      },
    );
  }
}

@ApiSurface('partner', 'pricingService')
@Controller('factories/:factoryId/pricing/service')
export class PartnerServicePricingController {
  constructor(
    private readonly engine: QuoteEngineService,
    private readonly access: FactoryAccess,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @Can('factory_prices.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.pricingService.calculate',
    summary: 'Price a service item on my own price list',
    description:
      'The buy side only, on the factory’s own service price lines in force: buy price per quantity, lead time, per ' +
      'print type. Never getpack’s sell price or another factory (D-044, D-042); another factory is 404.',
    implements: ['D-044', 'D-042', 'D-040'],
  })
  @ApiBody({ type: ServiceConfigurationDto, examples: { default: { value: SERVICE_CONFIGURATION_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Buy side per print type',
    type: FactoryQuoteDto,
    example: FACTORY_QUOTE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async calculate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ServiceConfigurationDto,
  ): Promise<FactoryQuoteDto> {
    const factory = await this.access.factory(actor, factoryId);
    return this.engine.priceForFactory('service', body, factory);
  }
}
