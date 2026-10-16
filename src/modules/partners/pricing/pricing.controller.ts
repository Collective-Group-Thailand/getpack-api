import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiAsync, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam, OmitType } from '@nestjs/swagger';

import { ReasonBodyDto } from '../factories/factories.dto';
import { staffOrPartner } from '../partner-actor';
import { ProposalEvidenceService } from '../self-service/proposal-evidence.service';
import {
  AddProposalEvidenceDto,
  PROPOSAL_EVIDENCE_EXAMPLE,
  ProposalEvidenceDto,
} from '../self-service/self-service.dto';
import { PriceListsService } from './price-lists.service';
import { PriceProposalsService } from './price-proposals.service';
import { PriceSimulationsService } from './price-simulations.service';
import { PriceSuggestionsService } from './price-suggestions.service';
import {
  AnswerCountersDto,
  CreatePriceProposalDto,
  DecideLinesDto,
  PRICE_COMPONENT_EXAMPLE,
  PRICE_LIST_EXAMPLE,
  PRICE_LIST_VERSION_EXAMPLE,
  PRICE_ROW_EXAMPLE,
  PriceComponentCountDto,
  PriceComponentDto,
  PriceListDto,
  PriceListVersionDto,
  PriceProposalDto,
  PriceProposalListQuery,
  PriceProposalSummaryDto,
  PriceRowDto,
  PriceRowsQuery,
  PriceSimulationDto,
  PriceSuggestionsDto,
  PRICING_IDS,
  PROPOSAL_EXAMPLE,
  PROPOSAL_LINE_EXAMPLE,
  PROPOSAL_SUMMARY_EXAMPLE,
  ReplaceProposalLinesDto,
  RespondToRateCardDto,
  SIMULATION_EXAMPLE,
  SUGGESTIONS_EXAMPLE,
} from './pricing.dto';

const GOVERNANCE = ['D-040', 'D-042', 'D-043', 'D-044'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const proposalParam = ApiParam({ name: 'proposalId', format: 'uuid' });
const versionParam = ApiParam({ name: 'versionId', format: 'uuid' });

const LINES_BODY = ApiBody({
  type: ReplaceProposalLinesDto,
  examples: {
    default: {
      value: {
        lines: [
          {
            component: 'material_prices',
            action: 'change',
            values: { materialId: PRICING_IDS.material, qtyFrom: 1000, qtyTo: 4999, rate: '12.5' },
          },
        ],
      },
    },
  },
});
const CREATE_BODY = ApiBody({
  type: CreatePriceProposalDto,
  examples: {
    default: {
      value: {
        productTypeId: PRICING_IDS.productType,
        proposedEffectiveFrom: '2026-10-01T00:00:00+07:00',
        comment: 'Paper prices from October',
      },
    },
  },
});
const REASON_BODY = ApiBody({
  type: ReasonBodyDto,
  examples: { default: { value: { reason: 'Raised by mistake' } } },
});
const DRAFT = { ...PROPOSAL_EXAMPLE, status: 'draft' as const, submittedAt: null, approvalRequestId: null };

class PartnerPriceProposalListQuery extends OmitType(PriceProposalListQuery, ['factoryId'] as const) {}

// --- admin -----------------------------------------------------------------------------------------------

@ApiSurface('admin', 'priceLists')
@Controller()
export class AdminPriceListsController {
  constructor(private readonly lists: PriceListsService) {}

  @Get('price-components')
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.priceLists.listComponents',
    summary: 'List the price components this build supports',
    description:
      'Component tables registered by the calculator ports (B2.3): their D-040 group and the dimension and value ' +
      'columns a price line carries. Empty until the first calculator ships (schema-design §7 A-13).',
    implements: ['D-040'],
  })
  @ApiSuccess(200, {
    description: 'Components',
    type: [PriceComponentDto],
    example: [PRICE_COMPONENT_EXAMPLE],
  })
  @ApiStandardErrors()
  components(): Promise<PriceComponentDto[]> {
    return this.lists.components();
  }

  @Get('factories/:factoryId/price-lists')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.priceLists.list',
    summary: 'List the price lists of a factory',
    description:
      'One list per product type with the version in force, scheduled versions and versions awaiting the factory ' +
      '(rate cards, assisted entry). Version metadata only — the lines need `factory_buy_prices.read` (D-044).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Price lists', type: [PriceListDto], example: [PRICE_LIST_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.lists.lists(actor, factoryId);
  }

  @Get('price-list-versions/:versionId/lines')
  @Can('partners.read', 'factory_buy_prices.read')
  @versionParam
  @ApiEndpoint({
    id: 'admin.priceLists.listLines',
    summary: 'Read the price lines of a factory price-list version',
    description:
      'Rows of one component, ordered by line key. Buy prices are confidential (D-044): every read is audited as ' +
      '`price.read_other_factory`.',
    implements: GOVERNANCE,
  })
  @ApiPaginated(PriceRowDto, { example: PRICE_ROW_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async lines(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query() query: PriceRowsQuery,
  ): Promise<Page<PriceRowDto>> {
    const { rows, total } = await this.lists.lines(actor, versionId, query);
    return paginated(rows, total, query);
  }
}

@ApiSurface('admin', 'priceProposals')
@Controller()
export class AdminPriceProposalsController {
  constructor(
    private readonly proposals: PriceProposalsService,
    private readonly evidence: ProposalEvidenceService,
  ) {}

  @Get('price-proposals')
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.priceProposals.list',
    summary: 'List price proposals (review queue)',
    description:
      'Factory proposals and platform rate cards with their status and line counts — no prices. Filter `status=submitted` ' +
      'for the review queue (D-040, D-042).',
    implements: GOVERNANCE,
  })
  @ApiPaginated(PriceProposalSummaryDto, { example: PROPOSAL_SUMMARY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: PriceProposalListQuery,
  ): Promise<Page<PriceProposalSummaryDto>> {
    const { rows, total } = await this.proposals.list(actor, query);
    return paginated(rows, total, query);
  }

  @Get('price-proposals/:proposalId')
  @Can('price_proposals.review', 'factory_buy_prices.read')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.get',
    summary: 'Get a price proposal with its lines',
    description:
      'Current, proposed and counter values per line. Buy prices are confidential: the read is audited as ' +
      '`price.read_other_factory` (D-044). Suggestions are served separately to `price_suggestions.read` holders.',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Proposal', type: PriceProposalDto, example: PROPOSAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.proposals.get(actor, proposalId, { side: 'staff' });
  }

  @Get('price-proposals/:proposalId/evidence')
  @Can('price_proposals.review')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.listEvidence',
    summary: 'Evidence attached to a price proposal',
    description:
      'Files the factory attached to support its proposal (supplier quotations, index prints) with its notes; ' +
      'download through the files API (U-B0.3, D-040).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, {
    description: 'Evidence',
    type: [ProposalEvidenceDto],
    example: [PROPOSAL_EVIDENCE_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  listEvidence(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.evidence.list(actor, proposalId);
  }

  @Post('factories/:factoryId/price-proposals')
  @Can('price_proposals.review')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.priceProposals.create',
    summary: 'Draft a rate card or an assisted price entry',
    description:
      'In `platform_rate_card` mode getpack drafts the rate card the factory will accept (D-042 a); in `factory_price_list` ' +
      'mode staff enter prices on the factory’s behalf, which it signs off before they apply (assisted entry, D-100 note). ' +
      'The type needs tier A or B (D-043); one open proposal per price list.',
    implements: [...GOVERNANCE, 'D-100'],
  })
  @CREATE_BODY
  @ApiSuccess(201, {
    description: 'Draft',
    type: PriceProposalDto,
    example: { ...DRAFT, direction: 'getpack_to_factory', origin: 'platform_rate_card', lines: [] },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.backdated',
    'partners.pricing_mode_missing',
    'partners.no_price_list_tier',
    'partners.proposal_open',
  )
  create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreatePriceProposalDto,
  ) {
    return this.proposals.create(staffOrPartner(actor), factoryId, body, 'staff');
  }

  @Put('price-proposals/:proposalId/lines')
  @Can('price_proposals.review')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.replaceLines',
    summary: 'Replace the lines of a staff draft',
    description:
      'Each line is `add`, `change` or `remove` of one component row, validated against the component columns and the ' +
      'base version (D-040). Only drafts getpack created (rate cards, assisted entry).',
    implements: GOVERNANCE,
  })
  @LINES_BODY
  @ApiSuccess(200, { description: 'Draft', type: PriceProposalDto, example: DRAFT })
  @ApiStandardErrors(...WRITE, 'partners.proposal_closed', 'partners.proposal_other_side')
  replaceLines(
    @CurrentActor() actor: Actor,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: ReplaceProposalLinesDto,
  ) {
    return this.proposals.replaceLines(staffOrPartner(actor), proposalId, body.lines, { side: 'staff' });
  }

  @Post('price-proposals/:proposalId/actions/submit')
  @HttpCode(200)
  @Idempotent()
  @Can('price_proposals.review')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.submit',
    summary: 'Submit a staff draft for approval',
    description:
      'Opens the `price_proposal` approval (Partner Manager; the drafter cannot approve, maker-checker). An approved rate ' +
      'card goes to the factory for acceptance (D-042).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Submitted', type: PriceProposalDto, example: PROPOSAL_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'partners.proposal_closed',
    'partners.proposal_other_side',
    'partners.proposal_empty',
    'approval.already_pending',
  )
  submit(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.proposals.submit(staffOrPartner(actor), proposalId, { side: 'staff' });
  }

  @Post('price-proposals/:proposalId/actions/withdraw')
  @HttpCode(200)
  @Can('price_proposals.review')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.withdraw',
    summary: 'Withdraw a staff proposal',
    description:
      'While open, or while a rate card awaits the factory (its pending version is withdrawn too). A pending approval is ' +
      'withdrawn in the same transaction (only its requester may).',
    implements: GOVERNANCE,
  })
  @REASON_BODY
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: PriceProposalDto,
    example: { ...PROPOSAL_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.proposal_closed',
    'partners.proposal_other_side',
    'approval.not_authorised',
  )
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: ReasonBodyDto,
  ) {
    return this.proposals.withdraw(staffOrPartner(actor), proposalId, body.reason, { side: 'staff' });
  }

  @Post('price-proposals/:proposalId/actions/decide')
  @HttpCode(200)
  @Can('price_proposals.review')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceProposals.decideLines',
    summary: 'Decide proposal lines',
    description:
      'Factory proposals: accept, reject or counter pending lines while the approval runs; lines not settled when it is ' +
      'approved do not apply. Rate cards: accept or reject the factory’s counters — by someone other than the drafter ' +
      '(D-042). The rate card applies once every line is settled.',
    implements: GOVERNANCE,
  })
  @ApiBody({
    type: DecideLinesDto,
    examples: {
      default: {
        value: {
          lines: [
            {
              lineId: PRICING_IDS.line,
              decision: 'counter',
              counterValues: { rate: '12.0' },
              comment: 'Market price is lower',
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Proposal',
    type: PriceProposalDto,
    example: {
      ...PROPOSAL_EXAMPLE,
      status: 'countered',
      lines: [{ ...PROPOSAL_LINE_EXAMPLE, decision: 'countered', counterValues: { rate: '12.000000' } }],
    },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.proposal_closed',
    'partners.line_not_decidable',
    'partners.maker_checker',
  )
  decide(
    @CurrentActor() actor: Actor,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: DecideLinesDto,
  ) {
    return this.proposals.decide(staffOrPartner(actor), proposalId, body);
  }
}

// --- partner ---------------------------------------------------------------------------------------------

@ApiSurface('partner', 'priceLists')
@Controller()
export class PartnerPriceListsController {
  constructor(private readonly lists: PriceListsService) {}

  @Get('price-components')
  @Can('factory_prices.read')
  @ApiEndpoint({
    id: 'partner.priceLists.listComponents',
    summary: 'List the price components a price line can belong to',
    description: 'Dimension and value columns per component (D-040); empty until the first calculator ships.',
    implements: ['D-040'],
  })
  @ApiSuccess(200, {
    description: 'Components',
    type: [PriceComponentDto],
    example: [PRICE_COMPONENT_EXAMPLE],
  })
  @ApiStandardErrors()
  components(): Promise<PriceComponentDto[]> {
    return this.lists.components();
  }

  @Get('factories/:factoryId/price-lists')
  @Can('factory_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.priceLists.list',
    summary: 'List my factory’s price lists',
    description: 'Own factory only; another factory is 404 (D-044).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Price lists', type: [PriceListDto], example: [PRICE_LIST_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.lists.lists(actor, factoryId);
  }

  @Get('factories/:factoryId/price-list-versions/:versionId/lines')
  @Can('factory_prices.read')
  @factoryParam
  @versionParam
  @ApiEndpoint({
    id: 'partner.priceLists.listLines',
    summary: 'Read the lines of one of my price-list versions',
    description: 'Rows of one component. Own factory only (D-044); getpack drafts are not visible.',
    implements: GOVERNANCE,
  })
  @ApiPaginated(PriceRowDto, { example: PRICE_ROW_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async lines(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query() query: PriceRowsQuery,
  ): Promise<Page<PriceRowDto>> {
    const { rows, total } = await this.lists.lines(actor, versionId, query, factoryId);
    return paginated(rows, total, query);
  }

  @Get('factories/:factoryId/price-list-versions/:versionId/component-counts')
  @Can('factory_prices.read')
  @factoryParam
  @versionParam
  @ApiEndpoint({
    id: 'partner.priceLists.componentCounts',
    summary: 'Count the lines of each component in one of my price-list versions',
    description: 'Every registered component with its line count (0 included), for the price screens (D-406). Own factory only (D-044).',
    implements: [...GOVERNANCE, 'D-406'],
  })
  @ApiSuccess(200, {
    description: 'Line counts per component',
    type: [PriceComponentCountDto],
    example: [{ component: 'material_prices', lines: 12 }, { component: 'print_prices', lines: 0 }],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  componentCounts(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.lists.componentCounts(actor, versionId, factoryId);
  }

  @Post('factories/:factoryId/price-list-versions/:versionId/actions/sign-off')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_prices.propose')
  @factoryParam
  @versionParam
  @ApiEndpoint({
    id: 'partner.priceLists.signOff',
    summary: 'Sign off prices getpack entered for my factory',
    description:
      'Assisted entry (D-100 note): the version applies only once the factory signs it off, from the later of its planned ' +
      'date and now.',
    implements: [...GOVERNANCE, 'D-100'],
  })
  @ApiSuccess(200, {
    description: 'Version',
    type: PriceListVersionDto,
    example: {
      ...PRICE_LIST_VERSION_EXAMPLE,
      origin: 'assisted_entry',
      factorySignedOffAt: '2026-09-26T10:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'partners.version_not_awaiting')
  signOff(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.lists.signOff(staffOrPartner(actor), factoryId, versionId);
  }
}

@ApiSurface('partner', 'priceProposals')
@Controller('factories/:factoryId/price-proposals')
export class PartnerPriceProposalsController {
  constructor(
    private readonly proposals: PriceProposalsService,
    private readonly evidence: ProposalEvidenceService,
  ) {}

  @Get(':proposalId/evidence')
  @Can('factory_prices.read')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.listEvidence',
    summary: 'Evidence on one of my proposals',
    description: 'Files my factory attached to support the proposal, with their notes (U-B0.3, D-040).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, {
    description: 'Evidence',
    type: [ProposalEvidenceDto],
    example: [PROPOSAL_EVIDENCE_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  listEvidence(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    return this.evidence.list(actor, proposalId, factoryId);
  }

  @Post(':proposalId/evidence')
  @Can('factory_prices.propose')
  @Idempotent()
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.addEvidence',
    summary: 'Attach evidence to one of my proposals',
    description:
      'A file I uploaded (purpose `document` or `evidence`, scan not infected) with a note of up to 500 characters, ' +
      'while the proposal is open; 409 `partners.proposal_closed` once decided. Audited, on the factory activity ' +
      '(U-B0.3, D-040). Requires `Idempotency-Key`.',
    implements: GOVERNANCE,
  })
  @ApiBody({
    type: AddProposalEvidenceDto,
    examples: { default: { value: { fileId: PRICING_IDS.factory, note: 'ใบเสนอราคากระดาษจากผู้ขาย' } } },
  })
  @ApiSuccess(201, {
    description: 'The proposal’s evidence',
    type: [ProposalEvidenceDto],
    example: [PROPOSAL_EVIDENCE_EXAMPLE],
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'http.conflict',
    'partners.proposal_closed',
    'artwork.file_not_usable',
  )
  addEvidence(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: AddProposalEvidenceDto,
  ) {
    return this.evidence.add(staffOrPartner(actor), factoryId, proposalId, body);
  }

  @Get()
  @Can('factory_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.priceProposals.list',
    summary: 'List my factory’s price proposals and rate cards',
    description:
      'Own proposals and the rate cards getpack sent (D-042). Never suggestions or benchmarks (D-044).',
    implements: GOVERNANCE,
  })
  @ApiPaginated(PriceProposalSummaryDto, { example: PROPOSAL_SUMMARY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: PartnerPriceProposalListQuery,
  ): Promise<Page<PriceProposalSummaryDto>> {
    const { rows, total } = await this.proposals.list(actor, query, factoryId);
    return paginated(rows, total, query);
  }

  @Get(':proposalId')
  @Can('factory_prices.read')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.get',
    summary: 'Get one of my proposals or rate cards',
    description: 'Lines with current, proposed and counter values. Own factory only (D-044).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Proposal', type: PriceProposalDto, example: PROPOSAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    return this.proposals.get(actor, proposalId, { side: 'partner', factoryPublicId: factoryId });
  }

  @Post()
  @Can('factory_prices.propose')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.priceProposals.create',
    summary: 'Draft a price proposal',
    description:
      'Factory price-list mode only (D-042 b), for a type with tier A or B (D-043). One open proposal per price list.',
    implements: GOVERNANCE,
  })
  @CREATE_BODY
  @ApiSuccess(201, { description: 'Draft', type: PriceProposalDto, example: { ...DRAFT, lines: [] } })
  @ApiStandardErrors(
    ...WRITE,
    'partners.backdated',
    'partners.pricing_mode_missing',
    'partners.wrong_pricing_mode',
    'partners.no_price_list_tier',
    'partners.proposal_open',
  )
  create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreatePriceProposalDto,
  ) {
    return this.proposals.create(staffOrPartner(actor), factoryId, body, 'partner');
  }

  @Put(':proposalId/lines')
  @Can('factory_prices.propose')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.replaceLines',
    summary: 'Replace the lines of my draft',
    description: 'Each line adds, changes or removes one component row of the current version (D-040).',
    implements: GOVERNANCE,
  })
  @LINES_BODY
  @ApiSuccess(200, { description: 'Draft', type: PriceProposalDto, example: DRAFT })
  @ApiStandardErrors(...WRITE, 'partners.proposal_closed', 'partners.proposal_other_side')
  replaceLines(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: ReplaceProposalLinesDto,
  ) {
    return this.proposals.replaceLines(staffOrPartner(actor), proposalId, body.lines, {
      side: 'partner',
      factoryPublicId: factoryId,
    });
  }

  @Post(':proposalId/actions/submit')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_prices.propose')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.submit',
    summary: 'Submit my proposal to getpack',
    description: 'Opens the `price_proposal` review by the Partner team (D-040).',
    implements: GOVERNANCE,
  })
  @ApiSuccess(200, { description: 'Submitted', type: PriceProposalDto, example: PROPOSAL_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'partners.proposal_closed',
    'partners.proposal_other_side',
    'partners.proposal_empty',
    'approval.already_pending',
  )
  submit(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    return this.proposals.submit(staffOrPartner(actor), proposalId, {
      side: 'partner',
      factoryPublicId: factoryId,
    });
  }

  @Post(':proposalId/actions/withdraw')
  @HttpCode(200)
  @Can('factory_prices.propose')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.withdraw',
    summary: 'Withdraw my proposal',
    description:
      'While it is open; the pending review is withdrawn with it (only by the person who submitted).',
    implements: GOVERNANCE,
  })
  @REASON_BODY
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: PriceProposalDto,
    example: { ...PROPOSAL_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.proposal_closed',
    'partners.proposal_other_side',
    'approval.not_authorised',
  )
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: ReasonBodyDto,
  ) {
    return this.proposals.withdraw(staffOrPartner(actor), proposalId, body.reason, {
      side: 'partner',
      factoryPublicId: factoryId,
    });
  }

  @Post(':proposalId/actions/answer-counters')
  @HttpCode(200)
  @Can('factory_prices.propose')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.answerCounters',
    summary: 'Accept or withdraw the lines getpack countered',
    description: 'An accepted counter becomes the line’s value; a withdrawn line does not apply (D-040).',
    implements: GOVERNANCE,
  })
  @ApiBody({
    type: AnswerCountersDto,
    examples: { default: { value: { lines: [{ lineId: PRICING_IDS.line, response: 'accept' }] } } },
  })
  @ApiSuccess(200, {
    description: 'Proposal',
    type: PriceProposalDto,
    example: { ...PROPOSAL_EXAMPLE, status: 'under_review' },
  })
  @ApiStandardErrors(...WRITE, 'partners.proposal_closed', 'partners.line_not_decidable')
  answerCounters(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: AnswerCountersDto,
  ) {
    return this.proposals.answerCounters(staffOrPartner(actor), factoryId, proposalId, body);
  }

  @Post(':proposalId/actions/respond')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_rate_card.accept')
  @factoryParam
  @proposalParam
  @ApiEndpoint({
    id: 'partner.priceProposals.respondToRateCard',
    summary: 'Accept or negotiate a getpack rate card',
    description:
      'Without `lines` the whole card is accepted; otherwise each listed line is accepted or countered (negotiated ' +
      'exception). The card applies to new orders once every line is settled (D-042 a).',
    implements: GOVERNANCE,
  })
  @ApiBody({
    type: RespondToRateCardDto,
    examples: {
      acceptAll: { value: {} },
      perLine: {
        value: {
          lines: [
            {
              lineId: PRICING_IDS.line,
              response: 'counter',
              counterValues: { rate: '13.0' },
              comment: 'Paper cost rose',
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Rate card',
    type: PriceProposalDto,
    example: {
      ...PROPOSAL_EXAMPLE,
      direction: 'getpack_to_factory',
      origin: 'platform_rate_card',
      status: 'accepted_by_factory',
    },
  })
  @ApiStandardErrors(...WRITE, 'partners.version_not_awaiting', 'partners.line_not_decidable')
  respond(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() body: RespondToRateCardDto,
  ) {
    return this.proposals.respondToRateCard(staffOrPartner(actor), factoryId, proposalId, body);
  }
}

// --- staff-only suggestions and simulations (D-040 note, D-044) -----------------------------------------

@ApiSurface('admin', 'priceSuggestions')
@Controller('price-proposals/:proposalId')
export class AdminPriceSuggestionsController {
  constructor(
    private readonly suggestions: PriceSuggestionsService,
    private readonly simulations: PriceSimulationsService,
  ) {}

  @Get('suggestions')
  @Can('price_suggestions.read')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceSuggestions.get',
    summary: 'Get the suggested values of a proposal',
    description:
      'Per line: suggested value, method and basis, deviation and flags (D-040 note). Staff only — never on the partner ' +
      'surface (D-044); peer figures only with ≥ `partners.peer_benchmark_min_factories` other factories. Audited.',
    implements: ['D-040', 'D-044', 'D-101', 'D-172'],
  })
  @ApiSuccess(200, { description: 'Suggestions', type: PriceSuggestionsDto, example: SUGGESTIONS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.suggestions.get(staffOrPartner(actor), proposalId);
  }

  @Post('suggestions/actions/recompute')
  @HttpCode(200)
  @Can('price_suggestions.read')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceSuggestions.recompute',
    summary: 'Recompute the suggested values of a proposal',
    description:
      'After new index values or peer versions. Suggestions are computed automatically when a proposal is submitted ' +
      '(D-040 note).',
    implements: ['D-040', 'D-044'],
  })
  @ApiSuccess(200, { description: 'Suggestions', type: PriceSuggestionsDto, example: SUGGESTIONS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  recompute(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.suggestions.recompute(staffOrPartner(actor), proposalId);
  }

  @Post('simulations')
  @HttpCode(202)
  @Can('price_suggestions.read')
  @proposalParam
  @ApiEndpoint({
    id: 'admin.priceSuggestions.simulate',
    summary: 'Start an impact simulation of a proposal',
    description:
      'Re-prices the factory’s quotes of the last `partners.impact_simulation_window_days` with the proposed values: ' +
      'price, margin and selection-share change (D-040 note). Runs in the worker; poll the returned simulation.',
    implements: ['D-040', 'D-044'],
  })
  @ApiAsync({ poll: 'admin.priceSuggestions.getSimulation' })
  @ApiSuccess(202, {
    description: 'Queued',
    type: PriceSimulationDto,
    example: { ...SIMULATION_EXAMPLE, status: 'queued', result: null, completedAt: null },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  simulate(@CurrentActor() actor: Actor, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.simulations.request(staffOrPartner(actor), proposalId);
  }

  @Get('simulations/:simulationId')
  @Can('price_suggestions.read')
  @proposalParam
  @ApiParam({ name: 'simulationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.priceSuggestions.getSimulation',
    summary: 'Get an impact simulation',
    description: 'Status and, once `succeeded`, the result (D-040 note).',
    implements: ['D-040'],
  })
  @ApiSuccess(200, { description: 'Simulation', type: PriceSimulationDto, example: SIMULATION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  simulation(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Param('simulationId', ParseUUIDPipe) simulationId: string,
  ) {
    return this.simulations.get(proposalId, simulationId);
  }
}
