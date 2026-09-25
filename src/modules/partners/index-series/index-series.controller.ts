import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { staffOrPartner } from '../partner-actor';
import {
  CreateIndexSeriesDto,
  INDEX_IDS,
  INDEX_POINT_EXAMPLE,
  INDEX_SERIES_EXAMPLE,
  IndexPointDto,
  IndexPointsQuery,
  IndexSeriesDto,
  IndexSeriesListQuery,
  PERIOD,
  SetIndexPointDto,
} from './index-series.dto';
import { IndexSeriesService } from './index-series.service';

const DECISIONS = ['D-040'];
const seriesParam = ApiParam({ name: 'seriesId', format: 'uuid' });

@ApiSurface('admin', 'indexSeries')
@Controller('index-series')
export class IndexSeriesController {
  constructor(private readonly series: IndexSeriesService) {}

  @Get()
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.indexSeries.list',
    summary: 'List index series',
    description:
      'Material price indices per material family (D-040 group 1) and cost-driver series (group 2) with their latest ' +
      'value. `q` searches code and names.',
    implements: DECISIONS,
  })
  @ApiPaginated(IndexSeriesDto, { example: INDEX_SERIES_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: IndexSeriesListQuery): Promise<Page<IndexSeriesDto>> {
    const { rows, total } = await this.series.list(query);
    return paginated(rows, total, query);
  }

  @Post()
  @Can('index_series.manage')
  @ApiEndpoint({
    id: 'admin.indexSeries.create',
    summary: 'Create an index series',
    description:
      'A `material` series names its material family; `feed` series name an available adapter, `manual` series are ' +
      'entered by the Partner team from mill and distributor price lists (D-040 note). Audited.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateIndexSeriesDto,
    examples: {
      default: {
        value: {
          code: 'paper.art_card',
          kind: 'material',
          materialFamilyId: INDEX_IDS.family,
          nameTh: 'ดัชนีราคากระดาษอาร์ตการ์ด',
          nameEn: 'Art card price index',
          unit: 'index (2026-01 = 100)',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Series',
    type: IndexSeriesDto,
    example: { ...INDEX_SERIES_EXAMPLE, latestPoint: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'catalog.code_taken')
  create(@CurrentActor() actor: Actor, @Body() body: CreateIndexSeriesDto) {
    return this.series.create(staffOrPartner(actor), body);
  }

  @Get(':seriesId')
  @Can('partners.read')
  @seriesParam
  @ApiEndpoint({
    id: 'admin.indexSeries.get',
    summary: 'Get an index series',
    description: 'With its latest value (D-040).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Series', type: IndexSeriesDto, example: INDEX_SERIES_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@Param('seriesId', ParseUUIDPipe) seriesId: string) {
    return this.series.get(seriesId);
  }

  @Get(':seriesId/points')
  @Can('partners.read')
  @seriesParam
  @ApiEndpoint({
    id: 'admin.indexSeries.listPoints',
    summary: 'List the monthly values of an index series',
    description: 'Oldest first, optionally between two months (D-040).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Values', type: [IndexPointDto], example: [INDEX_POINT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  points(@Param('seriesId', ParseUUIDPipe) seriesId: string, @Query() query: IndexPointsQuery) {
    return this.series.points(seriesId, query);
  }

  @Put(':seriesId/points/:period')
  @Can('index_series.manage')
  @seriesParam
  @ApiParam({ name: 'period', example: '2026-09', schema: { type: 'string', pattern: PERIOD.source } })
  @ApiEndpoint({
    id: 'admin.indexSeries.setPoint',
    summary: 'Record the value of an index series for a month',
    description:
      'Creates or corrects the month’s value (not for months that have not started). The previous value is kept in the ' +
      'audit trail (`index_series.point_recorded`).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SetIndexPointDto,
    examples: { default: { value: { value: '104.25', sourceRef: 'Mill price list 2026-09 (fake)' } } },
  })
  @ApiSuccess(200, { description: 'Value', type: IndexPointDto, example: INDEX_POINT_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  setPoint(
    @CurrentActor() actor: Actor,
    @Param('seriesId', ParseUUIDPipe) seriesId: string,
    @Param('period') period: string,
    @Body() body: SetIndexPointDto,
  ) {
    if (!PERIOD.test(period)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'period', code: 'pattern', message: 'period is a month, YYYY-MM' }],
      });
    }
    return this.series.setPoint(staffOrPartner(actor), seriesId, period, body);
  }
}
