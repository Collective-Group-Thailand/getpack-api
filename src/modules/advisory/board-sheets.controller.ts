import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  BOARD_SHEET_EXAMPLE,
  BoardStrengthSheetDto,
  BoardStrengthSheetQuery,
  CREATE_BOARD_SHEET_EXAMPLE,
  CreateBoardStrengthSheetDto,
} from './board-sheets.dto';
import { BoardSheetsService } from './board-sheets.service';

const DECISIONS = ['D-188', 'D-236'];

@ApiSurface('admin', 'boardStrengthSheets')
@Controller('board-strength-sheets')
export class AdminBoardStrengthSheetsController {
  constructor(private readonly sheets: BoardSheetsService) {}

  @Get()
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.boardStrengthSheets.list',
    summary: 'List board strength sheets',
    description:
      'Partners’ signed board data sheets (ECT, caliper, grammage) per factory × corrugated board, newest version ' +
      'first; `current` marks the version the Structure Advisor reads now (D-188, D-236). `currentOnly` keeps one ' +
      'per factory × board.',
    implements: DECISIONS,
  })
  @ApiPaginated(BoardStrengthSheetDto, { example: BOARD_SHEET_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: BoardStrengthSheetQuery) {
    const { rows, total } = await this.sheets.list(actor, query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get(':sheetId')
  @Can('partners.read')
  @ApiParam({ name: 'sheetId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.boardStrengthSheets.get',
    summary: 'Get a board strength sheet',
    description: 'One version of a partner’s signed board data sheet (D-236).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The sheet', type: BoardStrengthSheetDto, example: BOARD_SHEET_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('sheetId', ParseUUIDPipe) sheetId: string) {
    return this.sheets.get(actor, sheetId);
  }

  @Post()
  @Can('partners.manage')
  @ApiEndpoint({
    id: 'admin.boardStrengthSheets.create',
    summary: 'Record a board strength sheet',
    description:
      'Keys in a partner’s **signed** board data sheet for one factory × corrugated board as a new version (D-236): ' +
      'ECT (kN/m), caliper (mm), grammage (g/m²), the test method and the signed file (upload purpose `document`). ' +
      'It takes effect at `effectiveFrom` (default now, never in the past) and supersedes the earlier version from ' +
      'then; nothing is edited. A board without a sheet in force is never recommended by the Structure Advisor ' +
      '(D-188). No approval step; audited and published as `factory.board_strength_sheet_recorded`.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateBoardStrengthSheetDto,
    examples: { default: { value: CREATE_BOARD_SHEET_EXAMPLE } },
  })
  @ApiSuccess(201, { description: 'Recorded', type: BoardStrengthSheetDto, example: BOARD_SHEET_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'partners.backdated',
    'advisory.material_not_board',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateBoardStrengthSheetDto) {
    return this.sheets.create(staffOrPartner(actor), body);
  }
}

@ApiSurface('partner', 'boardStrengthSheets')
@Controller('board-strength-sheets')
export class PartnerBoardStrengthSheetsController {
  constructor(private readonly sheets: BoardSheetsService) {}

  @Get()
  @Can('factory_profile.read')
  @ApiEndpoint({
    id: 'partner.boardStrengthSheets.list',
    summary: 'List my factory’s board strength sheets',
    description:
      'The signed board data sheets getpack keeps for the factory’s boards (D-236), own factory only (D-044); ' +
      '`current` marks the version in force. To change one, send getpack a new signed sheet.',
    implements: [...DECISIONS, 'D-044'],
  })
  @ApiPaginated(BoardStrengthSheetDto, { example: BOARD_SHEET_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: BoardStrengthSheetQuery) {
    const { rows, total } = await this.sheets.list(actor, query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get(':sheetId')
  @Can('factory_profile.read')
  @ApiParam({ name: 'sheetId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.boardStrengthSheets.get',
    summary: 'Get one of my factory’s board strength sheets',
    description: 'One version of a signed board data sheet of the factory (D-236), own factory only (D-044).',
    implements: [...DECISIONS, 'D-044'],
  })
  @ApiSuccess(200, { description: 'The sheet', type: BoardStrengthSheetDto, example: BOARD_SHEET_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('sheetId', ParseUUIDPipe) sheetId: string) {
    return this.sheets.get(actor, sheetId);
  }
}
