import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { TRACKING_THROTTLE } from '@modules/timeline/timeline.controller';
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
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ConfigurationDraftDto,
  ConvertDraftToQuoteDto,
  ConvertDraftToRfqDto,
  CreateConfigurationDraftDto,
  DRAFT_EXAMPLE,
  DraftListQuery,
  DraftQuoteResultDto,
  DraftRfqResultDto,
  ShareConfigurationDraftResultDto,
  SHARED_DRAFT_EXAMPLE,
  SharedConfigurationDraftDto,
  UpdateConfigurationDraftDto,
} from './configuration-drafts.dto';
import { ConfigurationDraftsService } from './configuration-drafts.service';
import { QUOTE_EXAMPLE } from './quotes.dto';

const DECISIONS = ['D-185', 'D-182', 'D-183'];
const draftParam = ApiParam({ name: 'draftId', format: 'uuid' });

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'configurations')
@Controller()
export class StoreConfigurationDraftsController {
  constructor(private readonly drafts: ConfigurationDraftsService) {}

  @Post('configurations')
  @ApiEndpoint({
    id: 'store.configurations.create',
    summary: 'Keep a draft configuration',
    description:
      'Saves the configurator state so far — incomplete is fine — with its completeness: the share of the ' +
      'calculator’s required fields given, the missing ones and the values the calculator refuses. Kept ' +
      '`configurations.draft_retention_days` (90) after the last change, then deleted (D-185). Millimetres only (D-183).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateConfigurationDraftDto,
    examples: {
      default: {
        value: {
          productTypeCode: 'folding_carton',
          title: 'กล่องครีม 50 มล.',
          configuration: DRAFT_EXAMPLE.configuration,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Draft kept', type: ConfigurationDraftDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'specs.unit_not_accepted',
  )
  create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateConfigurationDraftDto,
  ): Promise<ConfigurationDraftDto> {
    return this.drafts.create(customer(actor).userId, body);
  }

  @Get('configurations')
  @ApiEndpoint({
    id: 'store.configurations.list',
    summary: 'List my draft configurations',
    description: 'Open drafts, most recently changed first, each with its completeness (D-185).',
    implements: DECISIONS,
  })
  @ApiPaginated(ConfigurationDraftDto, { example: DRAFT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: DraftListQuery) {
    const { data, total } = await this.drafts.list(customer(actor).userId, q.page, q.perPage);
    return { data, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('configurations/:draftId')
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.get',
    summary: 'Resume a draft configuration',
    description: 'One of my drafts with its completeness (D-185); another customer’s draft is 404.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Draft', type: ConfigurationDraftDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
  ): Promise<ConfigurationDraftDto> {
    return this.drafts.get(customer(actor).userId, id);
  }

  @Patch('configurations/:draftId')
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.update',
    summary: 'Change a draft configuration',
    description:
      'Replaces the title and / or the configuration; the completeness is re-assessed and the 90-day retention ' +
      'restarts (D-185). A converted draft is 409.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateConfigurationDraftDto,
    examples: { default: { value: { configuration: DRAFT_EXAMPLE.configuration } } },
  })
  @ApiSuccess(200, { description: 'Draft', type: ConfigurationDraftDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'configurations.converted',
    'specs.unit_not_accepted',
  )
  update(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
    @Body() body: UpdateConfigurationDraftDto,
  ): Promise<ConfigurationDraftDto> {
    return this.drafts.update(customer(actor).userId, id, body);
  }

  @Delete('configurations/:draftId')
  @HttpCode(204)
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.delete',
    summary: 'Delete a draft configuration',
    description: 'Deletes the draft at once; its share link stops opening (D-185).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async remove(@CurrentActor() actor: Actor, @Param('draftId', ParseUUIDPipe) id: string): Promise<void> {
    await this.drafts.remove(customer(actor).userId, id);
  }

  @Post('configurations/:draftId/actions/share')
  @HttpCode(200)
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.share',
    summary: 'Share a draft configuration',
    description:
      'A new link (the previous one stops opening), valid `configurations.share_link_days` (15); the token is shown ' +
      'once and only its hash is kept. The link shows the configuration, never its owner (D-185).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Shared',
    type: ShareConfigurationDraftResultDto,
    example: {
      draft: DRAFT_EXAMPLE,
      shareToken: 'bX2k…',
      sharePath: '/v1/store/shared-configurations/bX2k…',
      expiresAt: '2026-10-17T10:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'configurations.converted')
  share(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
  ): Promise<ShareConfigurationDraftResultDto> {
    return this.drafts.share(customer(actor).userId, id);
  }

  @Delete('configurations/:draftId/share')
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.unshare',
    summary: 'Stop sharing a draft configuration',
    description: 'Revokes the link at once (D-185).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Draft', type: ConfigurationDraftDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  unshare(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
  ): Promise<ConfigurationDraftDto> {
    return this.drafts.unshare(customer(actor).userId, id);
  }

  @Get('shared-configurations/:token')
  @Public()
  @Throttle(TRACKING_THROTTLE)
  @ApiParam({ name: 'token', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } })
  @ApiEndpoint({
    id: 'store.configurations.getShared',
    summary: 'Open a shared draft configuration',
    description:
      'Anyone with the link sees the configuration and its completeness, never its owner, while the link is live ' +
      'and the draft open; 404 once expired, revoked, replaced, deleted or converted (D-185).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Draft', type: SharedConfigurationDraftDto, example: SHARED_DRAFT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'http.too_many_requests')
  shared(@Param('token') token: string): Promise<SharedConfigurationDraftDto> {
    return this.drafts.shared(token);
  }

  @Post('configurations/:draftId/actions/convert-to-quote')
  @HttpCode(200)
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.convertToQuote',
    summary: 'Turn a draft into a quotation',
    description:
      'A complete draft is priced and saved as a quotation (15-day price lock, D-051); the draft is converted and ' +
      'can no longer change. An incomplete draft is 422 `configurations.incomplete` naming the missing fields (D-185).',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiBody({ type: ConvertDraftToQuoteDto, examples: { default: { value: { deliveryPostcode: '10110' } } } })
  @ApiSuccess(200, {
    description: 'Quotation saved',
    type: DraftQuoteResultDto,
    example: { draft: { ...DRAFT_EXAMPLE, status: 'converted', complete: true }, quote: QUOTE_EXAMPLE },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'configurations.incomplete',
    'configurations.converted',
    'pricing.not_instant',
    'quotes.nothing_to_save',
  )
  convertToQuote(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
    @Body() body: ConvertDraftToQuoteDto,
  ): Promise<DraftQuoteResultDto> {
    return this.drafts.convertToQuote(customer(actor).userId, id, body);
  }

  @Post('configurations/:draftId/actions/convert-to-rfq')
  @HttpCode(200)
  @draftParam
  @ApiEndpoint({
    id: 'store.configurations.convertToRfq',
    summary: 'Turn a draft into a request for quote',
    description:
      'Submits an RFQ pre-filled with the draft’s sizes, measurement basis and quantities (D-185, D-100, D-182); the ' +
      'customer adds the delivery postcode and the type’s RFQ spec fields. The draft is converted.',
    implements: [...DECISIONS, 'D-100'],
  })
  @ApiBody({
    type: ConvertDraftToRfqDto,
    examples: {
      default: { value: { deliveryPostcode: '10110', spec: { material: 'อาร์ตการ์ด 350 แกรม' } } },
    },
  })
  @ApiSuccess(200, {
    description: 'RFQ submitted',
    type: DraftRfqResultDto,
    example: {
      draft: { ...DRAFT_EXAMPLE, status: 'converted' },
      rfqId: '0192f3a0-7c1e-7d2a-9b1f-00000000cd04',
      rfqCode: 'RFQ-2026-000101',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'configurations.converted',
    'specs.unit_not_accepted',
    'numbering.series_missing',
  )
  convertToRfq(
    @CurrentActor() actor: Actor,
    @Param('draftId', ParseUUIDPipe) id: string,
    @Body() body: ConvertDraftToRfqDto,
  ): Promise<DraftRfqResultDto> {
    return this.drafts.convertToRfq(customer(actor).userId, id, body);
  }
}
