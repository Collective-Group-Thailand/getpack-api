import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { quoteDto } from '@modules/quotes/quote-views';
import { QUOTE_EXAMPLE, SavedQuoteDto } from '@modules/quotes/quotes.dto';
import { rfqDto } from '@modules/rfq/rfq-views';
import { RFQ_EXAMPLE } from '@modules/rfq/rfqs.controller';
import { RfqDto } from '@modules/rfq/rfqs.dto';
import { RfqsService } from '@modules/rfq/rfqs.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  SaveStudioQuoteDto,
  STUDIO_QUOTE_EXAMPLE,
  StudioQuoteDto,
  StudioQuoteRequestDto,
  StudioRfqDto,
} from './studio.dto';
import { StudioQuotesService } from './studio-quotes.service';

const DECISIONS = ['D-277', 'D-275', 'D-051'];
const designParam = ApiParam({ name: 'designId', format: 'uuid', description: 'My studio design' });
const PRICE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'designs.version_required',
  'studio.spec_missing',
  'studio.spec_mismatch',
  'pricing.vat_rate_missing',
  'specs.unit_not_accepted',
] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'studio')
@Controller('studio')
export class StoreStudioController {
  constructor(
    private readonly studio: StudioQuotesService,
    private readonly rfqs: RfqsService,
  ) {}

  @Post(':designId/quote')
  @HttpCode(200)
  @designParam
  @ApiEndpoint({
    id: 'store.studio.quote',
    summary: 'Price my studio design',
    description:
      'Prices a version of my design (default: the current one) from its calculator spec — checked against its box: ' +
      'style, sizes and basis, material, print sides — through the same engine and rules as `store.quotes.calculate`, ' +
      'and answers the same calculation object with a `specHash`. The same hash is served from its snapshot for ' +
      '5 minutes. With `previousSpecHash` the answer explains the change (reason codes and unit prices before / now). ' +
      'A type without an instant price answers `mode: rfq` — ask for a quotation instead. Limited to 60 a minute ' +
      '(D-277).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StudioQuoteRequestDto,
    examples: { default: { value: { quantities: [1000, 3000], deliveryPostcode: '10110' } } },
  })
  @ApiSuccess(200, { description: 'Studio quote', type: StudioQuoteDto, example: STUDIO_QUOTE_EXAMPLE })
  @ApiStandardErrors(...PRICE_ERRORS, 'studio.rate_limited')
  async quote(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioQuoteRequestDto,
  ): Promise<StudioQuoteDto> {
    return this.studio.quote(customer(actor), designId, body);
  }

  @Post(':designId/quote/actions/save')
  @Idempotent()
  @designParam
  @ApiEndpoint({
    id: 'store.studio.saveQuote',
    summary: 'Save the quotation of my studio design',
    description:
      'Saves the quotation of the studio quote — the same input, priced on save like every quotation (D-051) — ' +
      'with the design version and `specHash`; added to the cart with the same design version, checkout charges ' +
      'exactly this quotation (D-277, spec §1).',
    implements: DECISIONS,
  })
  @ApiBody({ type: SaveStudioQuoteDto, examples: { default: { value: { quantities: [1000] } } } })
  @ApiSuccess(201, { description: 'Saved quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors(...PRICE_ERRORS, 'pricing.not_instant', 'quotes.nothing_to_save')
  async save(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: SaveStudioQuoteDto,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.studio.save(customer(actor), designId, body));
  }

  @Post(':designId/rfq')
  @Idempotent()
  @designParam
  @ApiEndpoint({
    id: 'store.studio.requestQuote',
    summary: 'Ask for a quotation of my studio design',
    description:
      'For a type without an instant price: an RFQ that names the design version, with the sizes, basis and style ' +
      'variant taken from it and the form answers the studio pre-filled (D-277, D-269).',
    implements: [...DECISIONS, 'D-269', 'D-100'],
  })
  @ApiBody({
    type: StudioRfqDto,
    examples: { default: { value: { quantities: [1000], deliveryPostcode: '10110', spec: {} } } },
  })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: RfqDto,
    example: {
      ...RFQ_EXAMPLE,
      status: 'submitted',
      messages: [],
      quotations: [],
      design: { designId: '0192f3a0-7c1e-7d2a-9b1f-00000000d101', versionNo: 3 },
    },
  })
  @ApiStandardErrors(...PRICE_ERRORS, 'numbering.series_missing')
  async requestQuote(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) designId: string,
    @Body() body: StudioRfqDto,
  ): Promise<RfqDto> {
    const row = await this.studio.requestQuote(customer(actor), designId, body);
    return rfqDto(row, await this.rfqs.attachments(row));
  }
}
