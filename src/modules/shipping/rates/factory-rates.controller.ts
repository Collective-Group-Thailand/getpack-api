import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
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
  Post,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AnswerShippingCountersDto,
  CreateFactoryRateVersionDto,
  FACTORY_CARD_EXAMPLE,
  FACTORY_DRAFT_EXAMPLE,
  FACTORY_PENDING_EXAMPLE,
  FACTORY_RATE_INPUT_EXAMPLE,
  FACTORY_SUMMARY_EXAMPLE,
  FACTORY_VERSION_EXAMPLE,
  FactoryRateCardDto,
  FactoryRateVersionDto,
  FactoryRateVersionSummaryDto,
  ReplaceFactoryRatesDto,
  RespondToShippingCardDto,
  ShippingPayoutSuggestionDto,
  SUGGESTION_EXAMPLE,
} from './factory-rates.dto';
import { FactoryRatesService } from './factory-rates.service';

const DECISIONS = ['D-013', 'D-042', 'D-044'];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const versionParam = ApiParam({ name: 'versionId', format: 'uuid' });
const params = applyDecorators(factoryParam, versionParam);
const admin = { side: 'admin' } as const;
const partner = { side: 'partner' } as const;
const COUNTER_EXAMPLE = {
  ...FACTORY_PENDING_EXAMPLE,
  rates: FACTORY_PENDING_EXAMPLE.rates.map((r) => ({
    ...r,
    acceptance: 'countered',
    counterAmount: '105.00',
    counterNote: 'Fuel costs (fake)',
  })),
};

/** Packio's side of a factory's shipping payout card: buy prices, D-141 roles only, reads audited. */
@ApiSurface('admin', 'factoryShippingRates')
@Controller('factories/:factoryId/shipping-rate-card')
export class AdminFactoryShippingRatesController {
  constructor(private readonly service: FactoryRatesService) {}

  @Get()
  @Can('partners.read', 'factory_buy_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.get',
    summary: 'Get a factory’s shipping payout card',
    description:
      'The version in force, the next scheduled one and the open draft or version awaiting the factory. ' +
      'Buy prices: D-141 roles only; every read is audited (D-044, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Card', type: FactoryRateCardDto, example: FACTORY_CARD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  card(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<FactoryRateCardDto> {
    return this.service.card(actor as UserActor, factoryId, admin);
  }

  @Get('versions')
  @Can('partners.read', 'factory_buy_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.listVersions',
    summary: 'List the versions of a factory’s payout card',
    description: 'Every version, newest first, without rates (effective-dated, ADR-0005); audited (D-044).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Versions',
    type: [FactoryRateVersionSummaryDto],
    example: [FACTORY_SUMMARY_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  versions(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.service.versions(actor as UserActor, factoryId, admin);
  }

  @Get('versions/:versionId')
  @Can('partners.read', 'factory_buy_prices.read')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.getVersion',
    summary: 'Get a payout-card version with its lines',
    description: 'Lines with the factory’s answer per line (accepted / countered); audited (D-044, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Version', type: FactoryRateVersionDto, example: FACTORY_VERSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  version(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<FactoryRateVersionDto> {
    return this.service.version(actor as UserActor, factoryId, versionId, admin);
  }

  @Post('versions')
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.createVersion',
    summary: 'Draft a new payout-card version',
    description:
      'A complete set of payout lines over the `customer_default` zones (copy-on-write). One draft or ' +
      'version awaiting the factory at a time; not back-dated (D-013, D-042).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateFactoryRateVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-10-15T00:00:00+07:00',
          reason: 'Initial payout card (fake)',
          rates: [FACTORY_RATE_INPUT_EXAMPLE],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Draft', type: FactoryRateVersionDto, example: FACTORY_DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'partners.backdated',
    'shipping.version_open',
  )
  createVersion(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateFactoryRateVersionDto,
  ): Promise<FactoryRateVersionDto> {
    return this.service.createVersion(actor as UserActor, factoryId, body);
  }

  @Put('versions/:versionId/rates')
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.replaceRates',
    summary: 'Replace the lines of a draft',
    description: 'Drafts only; a sent version changes only through the factory’s answers (D-042, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ReplaceFactoryRatesDto,
    examples: { default: { value: { rates: [FACTORY_RATE_INPUT_EXAMPLE] } } },
  })
  @ApiSuccess(200, { description: 'Draft', type: FactoryRateVersionDto, example: FACTORY_DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
  )
  replaceRates(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ReplaceFactoryRatesDto,
  ): Promise<FactoryRateVersionDto> {
    return this.service.replaceRates(actor as UserActor, factoryId, versionId, body.rates);
  }

  @Delete('versions/:versionId')
  @HttpCode(204)
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.deleteDraft',
    summary: 'Delete a draft payout-card version',
    description: 'Drafts only; sent and decided versions are kept (ADR-0005, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'shipping.version_not_draft')
  async deleteDraft(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<void> {
    await this.service.deleteDraft(actor as UserActor, factoryId, versionId);
  }

  @Post('versions/:versionId/actions/send')
  @HttpCode(200)
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.sendVersion',
    summary: 'Send a draft to the factory for acceptance',
    description:
      'The version becomes `pending_acceptance` and visible to the factory, which accepts the whole card ' +
      'or answers per line; it applies only once every line is accepted (D-042, D-013). Event ' +
      '`factory_shipping_rate_card.version_sent`.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Awaiting the factory',
    type: FactoryRateVersionDto,
    example: FACTORY_PENDING_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
    'shipping.rates_empty',
  )
  send(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<FactoryRateVersionDto> {
    return this.service.send(actor as UserActor, factoryId, versionId);
  }

  @Post('versions/:versionId/actions/answer-counters')
  @HttpCode(200)
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.answerCounters',
    summary: 'Answer the factory’s counters',
    description:
      '`accept_counter` takes the factory’s values for the line; `keep` returns Packio’s value to the factory ' +
      'for a new answer. The version applies once every line is accepted (D-042, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AnswerShippingCountersDto,
    examples: {
      default: {
        value: { lines: [{ rateId: FACTORY_VERSION_EXAMPLE.rates[0]!.id, decision: 'accept_counter' }] },
      },
    },
  })
  @ApiSuccess(200, { description: 'Version', type: FactoryRateVersionDto, example: FACTORY_VERSION_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_awaiting',
  )
  answerCounters(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: AnswerShippingCountersDto,
  ): Promise<FactoryRateVersionDto> {
    return this.service.answerCounters(actor as UserActor, factoryId, versionId, body);
  }

  @Post('versions/:versionId/actions/withdraw')
  @HttpCode(200)
  @Can('partners.read', 'factory_buy_prices.read', 'factory_shipping_rates.manage')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.withdrawVersion',
    summary: 'Withdraw a version awaiting the factory',
    description: 'The version is closed without applying; the card in force stays (D-042, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonBodyDto, examples: { default: { value: { reason: 'Zones changed (fake)' } } } })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: FactoryRateVersionDto,
    example: { ...FACTORY_PENDING_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_awaiting',
  )
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ReasonBodyDto,
  ): Promise<FactoryRateVersionDto> {
    return this.service.withdraw(actor as UserActor, factoryId, versionId, body.reason);
  }

  @Get('versions/:versionId/suggestions')
  @Can('partners.read', 'factory_buy_prices.read', 'price_suggestions.read')
  @params
  @ApiEndpoint({
    id: 'admin.factoryShippingRates.suggestions',
    summary: 'Staff-only payout suggestions for a version',
    description:
      'Per line: the customer rate of the same band less the target shipping margin (D-040 group 5; the ' +
      'setting `shipping.target_margin_pct` has no value until the business sets it) and the peer median ' +
      'only with ≥ `partners.peer_benchmark_min_factories` other active factories (D-101). Never shown to ' +
      'factories (D-044); audited.',
    implements: ['D-040', 'D-044', 'D-101', 'D-013'],
  })
  @ApiSuccess(200, {
    description: 'Suggestions',
    type: [ShippingPayoutSuggestionDto],
    example: [SUGGESTION_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  suggestions(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<ShippingPayoutSuggestionDto[]> {
    return this.service.suggestions(actor as UserActor, factoryId, versionId);
  }
}

/** The factory's side: its own card only, never Packio's drafts (D-044, D-042). */
@ApiSurface('partner', 'shippingRates')
@Controller('factories/:factoryId/shipping-rate-card')
export class PartnerShippingRatesController {
  constructor(private readonly service: FactoryRatesService) {}

  @Get()
  @Can('factory_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.shippingRates.get',
    summary: 'Get the own shipping payout card',
    description:
      'What Packio pays the factory for delivering with its own fleet: in force, scheduled, awaiting an answer (D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Card', type: FactoryRateCardDto, example: FACTORY_CARD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  card(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<FactoryRateCardDto> {
    return this.service.card(actor as UserActor, factoryId, partner);
  }

  @Get('versions')
  @Can('factory_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.shippingRates.listVersions',
    summary: 'List the own payout-card versions',
    description: 'Every version sent to the factory, newest first (D-013, D-042).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Versions',
    type: [FactoryRateVersionSummaryDto],
    example: [FACTORY_SUMMARY_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  versions(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.service.versions(actor as UserActor, factoryId, partner);
  }

  @Get('versions/:versionId')
  @Can('factory_prices.read')
  @params
  @ApiEndpoint({
    id: 'partner.shippingRates.getVersion',
    summary: 'Get an own payout-card version',
    description: 'Lines and the factory’s answers; drafts are not visible before Packio sends them (D-042).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Version', type: FactoryRateVersionDto, example: FACTORY_PENDING_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  version(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<FactoryRateVersionDto> {
    return this.service.version(actor as UserActor, factoryId, versionId, partner);
  }

  @Post('versions/:versionId/actions/respond')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_rate_card.accept')
  @params
  @ApiEndpoint({
    id: 'partner.shippingRates.respond',
    summary: 'Accept or counter a payout card',
    description:
      'Without `lines` every pending line is accepted (the whole card); otherwise each named line is ' +
      'accepted or countered with an amount. The card applies once every line is accepted, from its ' +
      'effective date or now (D-042, D-013). A replay with the same `Idempotency-Key` within 24 h returns ' +
      'the original response.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RespondToShippingCardDto,
    examples: {
      whole: { value: {} },
      counter: {
        value: {
          lines: [
            {
              rateId: FACTORY_VERSION_EXAMPLE.rates[0]!.id,
              decision: 'counter',
              counterAmount: '105.00',
              note: 'Fuel costs (fake)',
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Version', type: FactoryRateVersionDto, example: COUNTER_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_awaiting',
  )
  respond(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: RespondToShippingCardDto,
  ): Promise<FactoryRateVersionDto> {
    return this.service.respond(actor as UserActor, factoryId, versionId, body);
  }
}
