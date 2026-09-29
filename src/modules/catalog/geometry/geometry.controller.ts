import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { type Response } from 'express';

import { staffActor } from '../crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { type CrudRow } from '../crud/catalog-resource';
import {
  GEOMETRY_IDS,
  GeometryBandTableDto,
  PATTERN_GEOMETRY_EXAMPLE,
  PatternGeometryDto,
  ReplaceGeometryBandsDto,
  ReplacePatternConditionsDto,
  ReplaceStandardBlanksDto,
} from './geometry.dto';
import { geometryBandTables } from './geometry.resources';
import { GeometryService } from './geometry.service';

const COLLECTION_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
] as const;
const IMPLEMENTS = ['D-100', 'D-005'];

@ApiSurface('admin', 'catalogGeometryBandTables')
@Controller('catalog/geometry-band-tables')
export class GeometryBandTableActionsController {
  constructor(
    private readonly service: GeometryService,
    private readonly crud: CatalogCrudService,
  ) {}

  @Put(':id/bands')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogGeometryBandTables.replaceBands',
    summary: 'Replace the bands of a geometry band table',
    description:
      'Legacy `conditions` rows of one table: bounds inclusive (`lower ≤ v ≤ upper`), never overlapping (422 ' +
      '`overlap` on the band), read in the order given. The whole set is replaced in one transaction; guarded by ' +
      'the table ETag; audited and published as `catalog.geometry_band_table.updated`. Applies to the next quote.',
    implements: IMPLEMENTS,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceGeometryBandsDto,
    examples: {
      default: {
        value: {
          bands: [
            { lower: 0, upper: 100, value: 12.5 },
            { lower: 100.01, upper: 300, value: 15 },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The band table',
    type: GeometryBandTableDto,
    example: geometryBandTables.example,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replaceBands(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceGeometryBandsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const row: CrudRow = await this.service.replaceBands(staffActor(actor), id, ifMatch, body);
    res.setHeader('ETag', rowEtag(row));
    const [dto] = await this.crud.toDtos(geometryBandTables, [row]);
    return dto!;
  }
}

@ApiSurface('admin', 'catalogPatterns')
@Controller('catalog/patterns')
export class PatternGeometryController {
  constructor(private readonly service: GeometryService) {}

  @Get(':id/geometry')
  @Can('catalog.read')
  @ApiEndpoint({
    id: 'admin.catalogPatterns.getGeometry',
    summary: 'Get the geometry of a pattern',
    description:
      'The condition slots of the pattern and its parts (legacy `pattern.condition_*`) and its standard blanks ' +
      '(legacy `pattern_rel_standard_sizes`), with the pattern ETag for a later replace.',
    implements: IMPLEMENTS,
  })
  @ApiEtag()
  @ApiSuccess(200, {
    description: 'The pattern geometry',
    type: PatternGeometryDto,
    example: PATTERN_GEOMETRY_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getGeometry(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PatternGeometryDto> {
    const { row, dto } = await this.service.patternGeometry(id);
    res.setHeader('ETag', rowEtag(row));
    return dto;
  }

  @Put(':id/geometry-conditions')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogPatterns.replaceGeometryConditions',
    summary: 'Replace the condition slots of a pattern',
    description:
      'Which geometry condition each slot reads, for the pattern and its parts. A folding type takes the slots ' +
      '`dw dl nd nl nw aux_f aux_f10` read by `w l d x c`; a corrugate type the pattern slots `i k m` read by W ' +
      'and `j` by W ÷ L (U-B6, port map §6.1). Archived conditions are refused. The whole set is replaced in one ' +
      'transaction; guarded by the pattern ETag; audited and published as `catalog.pattern.updated`.',
    implements: IMPLEMENTS,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplacePatternConditionsDto,
    examples: {
      default: { value: { conditions: [{ slot: 'dw', seq: 1, conditionId: GEOMETRY_IDS.condition }] } },
    },
  })
  @ApiSuccess(200, {
    description: 'The pattern geometry',
    type: PatternGeometryDto,
    example: PATTERN_GEOMETRY_EXAMPLE,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replaceGeometryConditions(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplacePatternConditionsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PatternGeometryDto> {
    const { row, dto } = await this.service.replacePatternConditions(staffActor(actor), id, ifMatch, body);
    res.setHeader('ETag', rowEtag(row));
    return dto;
  }

  @Put(':id/standard-blanks')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogPatterns.replaceStandardBlanks',
    summary: 'Replace the standard blanks of a pattern',
    description:
      'The die-cut blank (DW × DL) of the pattern at each standard size, read by the folding formula ' +
      '`standard_blank`. One blank per standard size. The whole set is replaced in one transaction; guarded by ' +
      'the pattern ETag; audited and published as `catalog.pattern.updated`.',
    implements: IMPLEMENTS,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceStandardBlanksDto,
    examples: {
      default: {
        value: { standardBlanks: [{ standardSizeId: GEOMETRY_IDS.standardSize, dwMm: 210, dlMm: 320 }] },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The pattern geometry',
    type: PatternGeometryDto,
    example: PATTERN_GEOMETRY_EXAMPLE,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replaceStandardBlanks(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceStandardBlanksDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PatternGeometryDto> {
    const { row, dto } = await this.service.replaceStandardBlanks(staffActor(actor), id, ifMatch, body);
    res.setHeader('ETag', rowEtag(row));
    return dto;
  }
}
