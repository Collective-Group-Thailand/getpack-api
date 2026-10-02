import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ADMIN_RECOMMENDATION_EXAMPLE,
  AdminAdvisoryRecommendationDto,
  AdvisoryListQuery,
  AdvisoryMethodDto,
  AdvisoryRecommendationDto,
  AnonymousQuery,
  CHOOSE_EXAMPLE,
  ChooseBoardDto,
  METHOD_EXAMPLE,
  RECOMMEND_EXAMPLE,
  RECOMMENDATION_EXAMPLE,
  RecommendDto,
  ReplayResultDto,
  StoreRecommendDto,
} from './advisory.dto';
import { type AdvisoryOwner, AdvisoryService } from './advisory.service';

const DECISIONS = ['D-188', 'D-189', 'D-235', 'D-236', 'D-237', 'D-238', 'D-239', 'D-240'];
/** Each recommendation prices up to 12 boards: a tighter limit than a plain calculation. */
const RECOMMEND_THROTTLE = { default: { limit: 20, ttl: 60_000 } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A signed-in customer, or the anonymous configurator session (like saved quotes). */
function storeOwner(actor: Actor | undefined, anonymousId?: string): AdvisoryOwner {
  if (actor?.type === 'user' && actor.audience === 'customer')
    return { kind: 'customer', userId: actor.userId };
  if (anonymousId && UUID.test(anonymousId)) return { kind: 'anonymous', anonymousId };
  throw new DomainException('validation.failed', {
    errors: [{ path: 'anonymousId', code: 'required', message: 'sign in or send anonymousId' }],
  });
}

const CHECKED = 'Reason codes and numbers only; the fixed notice `advisory.indicative` applies (D-189).';

@ApiSurface('store', 'advisory')
@Controller('advisory')
export class StoreAdvisoryController {
  constructor(private readonly advisory: AdvisoryService) {}

  @Get('method')
  @Public()
  @ApiEndpoint({
    id: 'store.advisory.getMethod',
    summary: 'How the Structure Advisor decides',
    description:
      'The rule set in force (D-237) — McKee constant, uncertainty band, eligible styles, thin-margin threshold and ' +
      'the retained-strength factor of every band — read from the same setting the engine uses, and whether the ' +
      'advisor is open to customers. `available: false` and `ruleSet: null` until a Superadmin sets it.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The method', type: AdvisoryMethodDto, example: METHOD_EXAMPLE })
  @ApiStandardErrors()
  async method(): Promise<AdvisoryMethodDto> {
    return this.advisory.method();
  }

  @Post('recommendations')
  @Public()
  @Throttle(RECOMMEND_THROTTLE)
  @ApiEndpoint({
    id: 'store.advisory.recommend',
    summary: 'Recommend a corrugated board',
    description:
      'For a corrugate configuration and its load (product weight, units per box, boxes stacked high, pallet, ' +
      'fragility, transport, humidity, storage time — D-238) the advisor prices every compatible board that has a ' +
      'partner’s signed board data sheet (D-188) through the real quote engine and recommends the cheapest one ' +
      'whose **low** estimated BCT meets the requirement, with cheapest / strongest / fastest alternatives and ' +
      'their price and lead-time differences (D-239). BCT is a range (simplified McKee ± the rule set’s band), ' +
      'never a promise. Logged for replay (D-240). Corrugated boxes of the listed styles only ' +
      '(`advisory.not_supported`, D-235); answers `advisory.disabled` until the flag is on and ' +
      `\`advisory.not_configured\` until a rule set is in force (D-237). Signed in or with \`anonymousId\`. ${CHECKED}`,
    implements: DECISIONS,
  })
  @ApiBody({ type: StoreRecommendDto, examples: { default: { value: RECOMMEND_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'The recommendation',
    type: AdvisoryRecommendationDto,
    example: RECOMMENDATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.not_instant',
    'specs.unit_not_accepted',
    'advisory.not_supported',
    'advisory.not_configured',
    'advisory.disabled',
  )
  async recommend(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: StoreRecommendDto,
  ): Promise<AdvisoryRecommendationDto> {
    const row = await this.advisory.recommend(storeOwner(actor, body.anonymousId), 'web', body);
    return this.advisory.storeView(row);
  }

  @Get('recommendations/:recommendationId')
  @Public()
  @ApiParam({ name: 'recommendationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.advisory.get',
    summary: 'Get one of my recommendations',
    description: `A recommendation of the signed-in customer or of the same \`anonymousId\` (D-240). ${CHECKED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'The recommendation',
    type: AdvisoryRecommendationDto,
    example: RECOMMENDATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @OptionalActor() actor: Actor | undefined,
    @Param('recommendationId', ParseUUIDPipe) id: string,
    @Query() query: AnonymousQuery,
  ): Promise<AdvisoryRecommendationDto> {
    return this.advisory.storeView(await this.advisory.getOwned(storeOwner(actor, query.anonymousId), id));
  }

  @Post('recommendations/:recommendationId/actions/choose')
  @HttpCode(200)
  @Public()
  @ApiParam({ name: 'recommendationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.advisory.choose',
    summary: 'Choose a board from a recommendation',
    description:
      'Records the board chosen — the recommended one or any listed option, even one with a structural warning — ' +
      'with every warning code of that board acknowledged on record (who, when, codes; D-189). A later choice ' +
      'replaces it; the history is kept. Save the quotation with `advisoryRecommendationId` to store the choice on ' +
      'it (D-240).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ChooseBoardDto, examples: { default: { value: CHOOSE_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'The recommendation with the choice',
    type: AdvisoryRecommendationDto,
    example: RECOMMENDATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'advisory.option_unknown',
    'advisory.acknowledgement_required',
  )
  async choose(
    @OptionalActor() actor: Actor | undefined,
    @Param('recommendationId', ParseUUIDPipe) id: string,
    @Body() body: ChooseBoardDto,
  ): Promise<AdvisoryRecommendationDto> {
    const row = await this.advisory.choose(storeOwner(actor, body.anonymousId), id, body);
    return this.advisory.storeView(row);
  }
}

@ApiSurface('admin', 'advisory')
@Controller('advisory')
export class AdminAdvisoryController {
  constructor(private readonly advisory: AdvisoryService) {}

  @Post('actions/evaluate')
  @HttpCode(200)
  @Can('advisory.evaluate')
  @ApiEndpoint({
    id: 'admin.advisory.evaluate',
    summary: 'Run the Structure Advisor for a configuration',
    description:
      'Staff run the advisor as customers would (D-239), also while the flag is off — for validation and CS ' +
      'advice. Needs a rule set in force (D-237). The run is logged with the staff member (channel `cs`, D-240). ' +
      'The staff view adds the board data used and the boards excluded for missing data (D-236).',
    implements: DECISIONS,
  })
  @ApiBody({ type: RecommendDto, examples: { default: { value: RECOMMEND_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'The recommendation',
    type: AdminAdvisoryRecommendationDto,
    example: ADMIN_RECOMMENDATION_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.not_instant',
    'specs.unit_not_accepted',
    'advisory.not_supported',
    'advisory.not_configured',
  )
  async evaluate(
    @CurrentActor() actor: Actor,
    @Body() body: RecommendDto,
  ): Promise<AdminAdvisoryRecommendationDto> {
    const staff = staffOrPartner(actor);
    const row = await this.advisory.recommend({ kind: 'staff', userId: staff.userId }, 'cs', body);
    return this.advisory.adminView(row);
  }

  @Get('recommendations')
  @Can('advisory.read')
  @ApiEndpoint({
    id: 'admin.advisory.listRecommendations',
    summary: 'List Structure Advisor recommendations',
    description: 'The recommendation log, newest first (D-240), filtered by outcome or customer.',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAdvisoryRecommendationDto, { example: ADMIN_RECOMMENDATION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: AdvisoryListQuery) {
    const { rows, total } = await this.advisory.list(query);
    const data = [];
    for (const row of rows) data.push(await this.advisory.adminView(row));
    return { data, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get('recommendations/:recommendationId')
  @Can('advisory.read')
  @ApiParam({ name: 'recommendationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.advisory.getRecommendation',
    summary: 'Get a Structure Advisor recommendation',
    description:
      'Inputs, rule-set version and value, board data used (whose sheet), output, choices and the quotations saved ' +
      'from it (D-240).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'The recommendation',
    type: AdminAdvisoryRecommendationDto,
    example: ADMIN_RECOMMENDATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('recommendationId', ParseUUIDPipe) id: string): Promise<AdminAdvisoryRecommendationDto> {
    return this.advisory.adminView(await this.advisory.get(id));
  }

  @Post('recommendations/:recommendationId/actions/replay')
  @HttpCode(200)
  @Can('advisory.read')
  @ApiParam({ name: 'recommendationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.advisory.replayRecommendation',
    summary: 'Replay a Structure Advisor recommendation',
    description:
      'Re-runs the engine on the logged inputs, board data and rule-set value and compares the result with the ' +
      'logged output (D-240): `identical` must be true; `differences` lists the JSON paths that changed (e.g. after ' +
      'an engine version change). Nothing is written.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'The comparison',
    type: ReplayResultDto,
    example: { identical: true, differences: [], engineVersion: '1.0.0' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async replay(@Param('recommendationId', ParseUUIDPipe) id: string): Promise<ReplayResultDto> {
    return this.advisory.replay(id);
  }
}
