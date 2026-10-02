import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_STYLE_DETAIL_EXAMPLE,
  ADMIN_STYLE_EXAMPLE,
  ADMIN_VARIANT_EXAMPLE,
  AdminStyleBaseDetailDto,
  AdminStyleBaseDto,
  AdminStyleQuery,
  AdminStyleVariantDto,
  AdminStyleVariantQuery,
  ApproveNamesDto,
  IMPORT_RUN_EXAMPLE,
  StyleImportRunDto,
  UpdateStyleDto,
  VerifyReferenceDto,
} from './styles-admin.dto';
import { StylesAdminService } from './styles-admin.service';

const DECISIONS = ['D-241', 'D-242', 'D-243'];
const styleParam = ApiParam({ name: 'styleId', format: 'uuid' });

@ApiSurface('admin', 'styles')
@Controller('styles')
export class AdminStylesController {
  constructor(private readonly styles: StylesAdminService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styles.list',
    summary: 'List style-library bases',
    description:
      'Base structures of the style library (D-241) with their variant counts (total, active, publishable), name ' +
      'approvals (D-212), reference verification (D-211) and recipe state; filter by category, status, published.',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminStyleBaseDto, { example: ADMIN_STYLE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: AdminStyleQuery) {
    const { rows, total } = await this.styles.list(query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get(':styleId')
  @Can('styles.read')
  @styleParam
  @ApiEndpoint({
    id: 'admin.styles.get',
    summary: 'Get a style-library base',
    description:
      'A base with its construction, axes, recipes (newest first), synonyms, use cases and why its active variants ' +
      'are not publishable (reason counts, D-243).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'The base',
    type: AdminStyleBaseDetailDto,
    example: ADMIN_STYLE_DETAIL_EXAMPLE,
  })
  @UseEtag((b: AdminStyleBaseDetailDto) => etagOf(b.id, b.version))
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('styleId', ParseUUIDPipe) id: string) {
    return this.styles.get(id);
  }

  @Patch(':styleId')
  @Can('styles.curate')
  @styleParam
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.styles.update',
    summary: 'Curate a style-library base',
    description:
      'Marketing / Admin curation (D-246): featured, hidden (never published, D-243), order, Thai / English names and ' +
      'descriptions, the Packio product type, search synonyms and use cases. Changing a name clears both name ' +
      'approvals (D-212). Needs `If-Match` from `admin.styles.get`. Audited; publishability recomputed.',
    implements: [...DECISIONS, 'D-246', 'D-212'],
  })
  @ApiBody({
    type: UpdateStyleDto,
    examples: { default: { value: { featured: true, sort: 10, useCases: ['cosmetics'] } } },
  })
  @UseEtag((b: AdminStyleBaseDetailDto) => etagOf(b.id, b.version))
  @ApiSuccess(200, {
    description: 'The base',
    type: AdminStyleBaseDetailDto,
    example: ADMIN_STYLE_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async update(
    @CurrentActor() actor: Actor,
    @Param('styleId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateStyleDto,
  ) {
    return this.styles.update(staffOrPartner(actor), id, ifMatch, body);
  }

  @Get(':styleId/variants')
  @Can('styles.read')
  @styleParam
  @ApiEndpoint({
    id: 'admin.styles.listVariants',
    summary: 'List the variants of a base',
    description:
      'Generated structural variants (D-241) with their code, option key, publishability and reasons (D-243).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminStyleVariantDto, { example: ADMIN_VARIANT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async variants(@Param('styleId', ParseUUIDPipe) id: string, @Query() query: AdminStyleVariantQuery) {
    const { rows, total } = await this.styles.variants(id, query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Post(':styleId/recipes/:recipeId/actions/approve')
  @HttpCode(200)
  @Can('styles.approve_recipe')
  @styleParam
  @ApiParam({ name: 'recipeId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.styles.approveRecipe',
    summary: 'Approve a recipe version',
    description:
      'Prepress approves an imported recipe version (D-243) — never the person who imported it (maker ≠ checker). ' +
      'The latest approved version is the base’s recipe; publishability is recomputed. Audited.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'The base',
    type: AdminStyleBaseDetailDto,
    example: ADMIN_STYLE_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'styles.recipe_approved', 'styles.maker_checker')
  async approveRecipe(
    @CurrentActor() actor: Actor,
    @Param('styleId', ParseUUIDPipe) id: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.styles.approveRecipe(staffOrPartner(actor), id, recipeId);
  }

  @Post(':styleId/actions/approve-names')
  @HttpCode(200)
  @Can('styles.approve_names')
  @styleParam
  @ApiEndpoint({
    id: 'admin.styles.approveNames',
    summary: 'Approve the names of a base',
    description:
      'Marketing approves the wording and Prepress the technical terms of the Thai / English names (D-212); both are ' +
      'needed to publish (D-243). The caller must hold the role named in `as`. A later name change clears both.',
    implements: [...DECISIONS, 'D-212'],
  })
  @ApiBody({ type: ApproveNamesDto, examples: { default: { value: { as: 'marketing' } } } })
  @ApiSuccess(200, {
    description: 'The base',
    type: AdminStyleBaseDetailDto,
    example: ADMIN_STYLE_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'styles.role_required',
  )
  async approveNames(
    @CurrentActor() actor: Actor,
    @Param('styleId', ParseUUIDPipe) id: string,
    @Body() body: ApproveNamesDto,
  ) {
    return this.styles.approveNames(staffOrPartner(actor), id, body.as);
  }

  @Post(':styleId/actions/verify-reference')
  @HttpCode(200)
  @Can('styles.verify_reference')
  @styleParam
  @ApiEndpoint({
    id: 'admin.styles.verifyReference',
    summary: 'Verify the industry reference code of a base',
    description:
      'Prepress confirms the FEFCO / ECMA reference against the edition Packio holds (D-211); unverified codes are ' +
      'never shown to customers. The body repeats the current code, so a stale screen cannot verify a changed one.',
    implements: [...DECISIONS, 'D-211'],
  })
  @ApiBody({ type: VerifyReferenceDto, examples: { default: { value: { referenceCode: 'FEFCO 0201' } } } })
  @ApiSuccess(200, {
    description: 'The base',
    type: AdminStyleBaseDetailDto,
    example: ADMIN_STYLE_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'styles.reference_mismatch',
  )
  async verifyReference(
    @CurrentActor() actor: Actor,
    @Param('styleId', ParseUUIDPipe) id: string,
    @Body() body: VerifyReferenceDto,
  ) {
    return this.styles.verifyReference(staffOrPartner(actor), id, body.referenceCode);
  }
}

@ApiSurface('admin', 'styleImports')
@Controller('style-imports')
export class AdminStyleImportsController {
  constructor(private readonly styles: StylesAdminService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styleImports.list',
    summary: 'List style imports',
    description:
      'Every confirmed `pnpm styles:import` run (D-242), newest first: kind, file, checksum, status (applied, held for ' +
      'the `style_library_change` approval, rejected) and its diff.',
    implements: ['D-242'],
  })
  @ApiPaginated(StyleImportRunDto, { example: IMPORT_RUN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: PageQuery) {
    const { rows, total } = await this.styles.runs(query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get(':runId')
  @Can('styles.read')
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.styleImports.get',
    summary: 'Get a style import',
    description: 'One import run with its diff and approval request (D-242).',
    implements: ['D-242'],
  })
  @ApiSuccess(200, { description: 'The run', type: StyleImportRunDto, example: IMPORT_RUN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('runId', ParseUUIDPipe) id: string) {
    return this.styles.run(id);
  }
}
