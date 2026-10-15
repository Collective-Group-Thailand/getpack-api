import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';

import {
  CARD_EXAMPLE,
  CompareQuery,
  DETAIL_EXAMPLE,
  LIST_EXAMPLE,
  StyleDetailDto,
  StyleFavouriteDto,
  StyleListDto,
  StyleListQuery,
  StyleVariantListDto,
  StyleVariantListQuery,
  VARIANT_LIST_EXAMPLE,
} from './styles-store.dto';
import { StylesStoreService } from './styles-store.service';

const DECISIONS = ['D-245', 'D-246', 'D-243', 'D-050'];
const codeParam = ApiParam({
  name: 'code',
  example: 'PK-TE-01',
  description: 'The public style code (D-184)',
});

const customerOf = (actor: Actor | undefined): bigint | null =>
  actor?.type === 'user' && actor.audience === 'customer' ? actor.userId : null;

@ApiSurface('store', 'styles')
@Controller('styles')
export class StoreStylesController {
  constructor(private readonly styles: StylesStoreService) {}

  @Get()
  @Public()
  @ApiEndpoint({
    id: 'store.styles.list',
    summary: 'Browse the style library',
    description:
      'Published styles only — every listed style has at least one variant that is priced (instant or RFQ) and ' +
      'makeable by a partner (D-243). Facets with counts over the matching styles (category, family, closure, ' +
      'feature, use case, material class, price path), Thai / English search over names, codes and synonyms with ' +
      'typo tolerance, sorts `relevance` (with `q`), `popular`, `new`, `instant_first`, `name`, cursor pages (D-245). ' +
      '`favourite` is filled for a signed-in customer. No factory identity (D-050).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'A page of styles with facets', type: StyleListDto, example: LIST_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(
    @OptionalActor() actor: Actor | undefined,
    @Query() query: StyleListQuery,
  ): Promise<StyleListDto> {
    return this.styles.list(query, customerOf(actor));
  }

  @Get('compare')
  @Public()
  @ApiEndpoint({
    id: 'store.styles.compare',
    summary: 'Compare up to three styles',
    description: 'The detail of up to 3 published styles side by side, in the order asked (D-246).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The styles', type: [StyleDetailDto], example: [DETAIL_EXAMPLE] })
  @ApiStandardErrors('validation.failed', 'styles.variant_not_found')
  async compare(
    @OptionalActor() actor: Actor | undefined,
    @Query() query: CompareQuery,
  ): Promise<StyleDetailDto[]> {
    return this.styles.compare(query.codes, customerOf(actor));
  }

  @Get('variants')
  @Public()
  @ApiEndpoint({
    id: 'store.styles.listVariants',
    summary: 'Browse every variant of the library',
    description:
      'Every shown variant of the published styles as a card (D-410) — the grid behind "every variant": the style\'s ' +
      "filters (search, category, family, use case, material class) or one style (`style`), with the variant's price path and its options " +
      "(`option=axis:value`, repeated or comma-separated: one axis's values are alternatives, different axes all " +
      "apply). Option facets with counts are disjunctive (an axis's own filter is left out of its counts, `none` " +
      'included); `meta.total` counts the matches, `libraryTotal` / `libraryStyles` the whole shown library (the ' +
      "storefront's headline count). Sorts `popular` (search relevance first with `q`), `instant_first`, `name`; " +
      'cursor pages. A variant is a card, never its own page: it opens its style with the variant chosen.',
    implements: ['D-410', 'D-245', 'D-243', 'D-050'],
  })
  @ApiSuccess(200, {
    description: 'A page of variants with facets',
    type: StyleVariantListDto,
    example: VARIANT_LIST_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed')
  async listVariants(
    @OptionalActor() actor: Actor | undefined,
    @Query() query: StyleVariantListQuery,
  ): Promise<StyleVariantListDto> {
    return this.styles.listVariants(query, customerOf(actor));
  }

  @Get(':code')
  @Public()
  @codeParam
  @ApiEndpoint({
    id: 'store.styles.get',
    summary: 'Get a style',
    description:
      'A published style by its public code (D-184, D-245): construction, the publishable variants and their option ' +
      'combinations, size ranges per material class (the recipe’s solver, else the linked pattern’s rules — `source`), ' +
      'the starting price and the quantity it assumes (D-220, none without a hint), the lead-time band, the number ' +
      'of partners able to make it only with ≥ 3 active factories (D-201), use cases and assets. A verified ' +
      'reference code only (D-211).',
    implements: [...DECISIONS, 'D-201', 'D-220', 'D-211'],
  })
  @ApiSuccess(200, { description: 'The style', type: StyleDetailDto, example: DETAIL_EXAMPLE })
  @ApiStandardErrors('styles.variant_not_found')
  async get(@OptionalActor() actor: Actor | undefined, @Param('code') code: string): Promise<StyleDetailDto> {
    return this.styles.get(code, customerOf(actor));
  }
}

@ApiSurface('store', 'styleFavourites')
@Controller('style-favourites')
export class StoreStyleFavouritesController {
  constructor(private readonly styles: StylesStoreService) {}

  private customer(actor: Actor): bigint {
    const id = customerOf(actor);
    if (id === null) throw new DomainException('auth.forbidden');
    return id;
  }

  @Get()
  @ApiEndpoint({
    id: 'store.styleFavourites.list',
    summary: 'List my favourite styles',
    description: 'The signed-in customer’s favourite styles that are still published, newest first (D-246).',
    implements: ['D-246'],
  })
  @ApiSuccess(200, {
    description: 'Favourites',
    type: [StyleFavouriteDto],
    example: [{ style: { ...CARD_EXAMPLE, favourite: true }, addedAt: '2026-10-03T10:00:00+07:00' }],
  })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor): Promise<StyleFavouriteDto[]> {
    return this.styles.favourites(this.customer(actor));
  }

  @Put(':code')
  @HttpCode(204)
  @codeParam
  @ApiEndpoint({
    id: 'store.styleFavourites.add',
    summary: 'Add a style to my favourites',
    description: 'Idempotent: adding a favourite twice keeps one (D-246). Published styles only.',
    implements: ['D-246'],
  })
  @ApiSuccess(204, { description: 'Added' })
  @ApiStandardErrors('styles.variant_not_found')
  async add(@CurrentActor() actor: Actor, @Param('code') code: string): Promise<void> {
    await this.styles.addFavourite(this.customer(actor), code);
  }

  @Delete(':code')
  @HttpCode(204)
  @codeParam
  @ApiEndpoint({
    id: 'store.styleFavourites.remove',
    summary: 'Remove a style from my favourites',
    description: 'Idempotent (D-246).',
    implements: ['D-246'],
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('validation.failed')
  async remove(@CurrentActor() actor: Actor, @Param('code') code: string): Promise<void> {
    await this.styles.removeFavourite(this.customer(actor), code);
  }
}
