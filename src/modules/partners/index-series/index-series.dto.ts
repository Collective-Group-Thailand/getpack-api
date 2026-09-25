import { PageQuery } from '@common/pagination/pagination.dto';
import { EnumField, IdField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const INDEX_KINDS = ['material', 'cost_driver'] as const;
export const INDEX_SOURCES = ['manual', 'feed'] as const;
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

const IDS = {
  series: '0192f3a0-7c1e-7d2a-9b1f-00000000f701',
  family: '0192f3a0-7c1e-7d2a-9b1f-00000000c020',
};
export const INDEX_IDS = IDS;
const TS = '2026-09-26T10:00:00+07:00';

export class IndexPointDto {
  @ApiProperty({ example: '2026-09', description: 'Month (Asia/Bangkok)' })
  period!: string;

  @ApiProperty({ example: '104.250000' })
  value!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Mill price list 2026-09 (fake)' })
  sourceRef!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  updatedAt!: string;
}

export class IndexSeriesDto {
  @IdField(IDS.series)
  id!: string;

  @ApiProperty({ example: 'paper.art_card' })
  code!: string;

  @ApiProperty({
    enum: INDEX_KINDS,
    enumName: 'IndexKind',
    example: 'material',
    description:
      '`material` = group 1 index per material family; `cost_driver` = wage, electricity Ft, PPI (group 2)',
  })
  kind!: (typeof INDEX_KINDS)[number];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.family })
  materialFamilyId!: string | null;

  @ApiProperty({ example: 'ดัชนีราคากระดาษอาร์ตการ์ด' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card price index' })
  nameEn!: string;

  @ApiProperty({ example: 'index (2026-01 = 100)' })
  unit!: string;

  @ApiProperty({ enum: INDEX_SOURCES, enumName: 'IndexSource', example: 'manual' })
  source!: (typeof INDEX_SOURCES)[number];

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Feed adapter (`feed` only)' })
  adapterKey!: string | null;

  @ApiProperty({ type: IndexPointDto, nullable: true })
  latestPoint!: IndexPointDto | null;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;
}

export class CreateIndexSeriesDto {
  @ApiProperty({ example: 'paper.art_card', pattern: '^[a-z][a-z0-9_.-]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_.-]*$/)
  code!: string;

  @EnumField(INDEX_KINDS, 'IndexKind', { example: 'material' })
  kind!: (typeof INDEX_KINDS)[number];

  @RefField({ example: IDS.family, nullable: true, description: 'Required for `material` series' })
  materialFamilyId?: string | null;

  @TextField({ example: 'ดัชนีราคากระดาษอาร์ตการ์ด', max: 200 })
  nameTh!: string;

  @TextField({ example: 'Art card price index', max: 200 })
  nameEn!: string;

  @TextField({ example: 'index (2026-01 = 100)', max: 64 })
  unit!: string;

  @EnumField(INDEX_SOURCES, 'IndexSource', { example: 'manual', optional: true })
  source?: (typeof INDEX_SOURCES)[number];

  @TextField({ example: null, nullable: true, max: 64 })
  adapterKey?: string | null;
}

export class SetIndexPointDto {
  @ApiProperty({ example: '104.25', pattern: DECIMAL.source, description: 'Greater than 0' })
  @IsString()
  @Matches(DECIMAL)
  value!: string;

  @TextField({ example: 'Mill price list 2026-09 (fake)', nullable: true, max: 500 })
  sourceRef?: string | null;
}

export class IndexSeriesListQuery extends PageQuery {
  @EnumField(INDEX_KINDS, 'IndexKind', { example: 'material', optional: true })
  kind?: (typeof INDEX_KINDS)[number];
}

export class IndexPointsQuery {
  @ApiPropertyOptional({ example: '2026-01', pattern: PERIOD.source })
  @IsOptional()
  @Matches(PERIOD)
  from?: string;

  @ApiPropertyOptional({ example: '2026-12', pattern: PERIOD.source })
  @IsOptional()
  @Matches(PERIOD)
  to?: string;
}

export const INDEX_POINT_EXAMPLE: IndexPointDto = {
  period: '2026-09',
  value: '104.250000',
  sourceRef: 'Mill price list 2026-09 (fake)',
  updatedAt: TS,
};

export const INDEX_SERIES_EXAMPLE: IndexSeriesDto = {
  id: IDS.series,
  code: 'paper.art_card',
  kind: 'material',
  materialFamilyId: IDS.family,
  nameTh: 'ดัชนีราคากระดาษอาร์ตการ์ด',
  nameEn: 'Art card price index',
  unit: 'index (2026-01 = 100)',
  source: 'manual',
  adapterKey: null,
  latestPoint: INDEX_POINT_EXAMPLE,
  createdAt: TS,
};
