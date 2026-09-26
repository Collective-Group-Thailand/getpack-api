import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  CREATE_VERSION_EXAMPLE,
  CreateSellMarginTableDto,
  CreateSellMarginVersionDto,
  SellMarginTableDto,
  SellMarginVersionDto,
  TABLE_EXAMPLE,
  VERSION_EXAMPLE,
} from './sell-margins.dto';
import { SellMarginsService } from './sell-margins.service';

const DECISIONS = ['D-063', 'D-012'];

@ApiSurface('admin', 'sellMarginTables')
@Controller('sell-margin-tables')
export class SellMarginTablesController {
  constructor(private readonly service: SellMarginsService) {}

  @Get()
  @Can('margin.read')
  @ApiEndpoint({
    id: 'admin.sellMarginTables.list',
    summary: 'List Packio’s sell-margin tables',
    description:
      'Margin tiers, fix costs and design fees per product type / print type, with the version in force (D-063).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Tables', type: [SellMarginTableDto], example: [TABLE_EXAMPLE] })
  @ApiStandardErrors()
  list(): Promise<SellMarginTableDto[]> {
    return this.service.list();
  }

  @Post()
  @Can('sell_margins.manage')
  @ApiEndpoint({
    id: 'admin.sellMarginTables.create',
    summary: 'Create a sell-margin table',
    description: 'One per product type, print type (or every print type) and kind; audited (D-063).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateSellMarginTableDto,
    examples: {
      default: {
        value: {
          productTypeId: TABLE_EXAMPLE.productTypeId,
          printTypeId: null,
          kind: 'margin',
          description: TABLE_EXAMPLE.description,
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Created',
    type: SellMarginTableDto,
    example: { ...TABLE_EXAMPLE, current: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'catalog.code_taken')
  create(@CurrentActor() actor: Actor, @Body() body: CreateSellMarginTableDto): Promise<SellMarginTableDto> {
    return this.service.create(actor as UserActor, body);
  }

  @Get(':tableId/versions')
  @Can('margin.read')
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.sellMarginTables.listVersions',
    summary: 'List the versions of a sell-margin table',
    description: 'Every version, newest first, with its lines (effective-dated, ADR-0005).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [SellMarginVersionDto], example: [VERSION_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  versions(@Param('tableId', ParseUUIDPipe) tableId: string): Promise<SellMarginVersionDto[]> {
    return this.service.versions(tableId);
  }

  @Post(':tableId/versions')
  @Can('sell_margins.manage')
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.sellMarginTables.createVersion',
    summary: 'Draft a new version of a sell-margin table',
    description:
      'A complete set of lines (copy-on-write): run bands inclusive, price bands half-open, no overlap; one of a ' +
      'percentage or an amount per line; the fallback applies when no line matches (A-23, D-063).',
    implements: DECISIONS,
  })
  @ApiBody({ type: CreateSellMarginVersionDto, examples: { default: { value: CREATE_VERSION_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Draft',
    type: SellMarginVersionDto,
    example: { ...VERSION_EXAMPLE, status: 'draft' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  createVersion(
    @CurrentActor() actor: Actor,
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() body: CreateSellMarginVersionDto,
  ): Promise<SellMarginVersionDto> {
    return this.service.createVersion(actor as UserActor, tableId, body);
  }

  @Post('versions/:versionId/actions/approve')
  @HttpCode(200)
  @Can('sell_margins.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.sellMarginTables.approveVersion',
    summary: 'Approve a draft sell-margin version',
    description:
      'Freezes its lines; it applies from its effective date, or from now when that date has passed (never ' +
      'retroactively). Superadmin / C-Level (D-063); audited, event `sell_margin_table.version_approved`.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Approved', type: SellMarginVersionDto, example: VERSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'partners.proposal_closed')
  approve(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<SellMarginVersionDto> {
    return this.service.approve(actor as UserActor, versionId);
  }
}
