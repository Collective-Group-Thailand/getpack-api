import { FactoryRefDto } from '@common/dto/factory-ref.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { DecimalField, IdField, RefField, TextField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsUUID, Max } from 'class-validator';

/** Board strength sheets (U2.2, D-236): a partner's signed data sheet per factory × corrugated board. */

export const BOARD_SHEET_IDS = {
  sheet: '0192f3a0-7c1e-7d2a-9b1f-0000000ad001',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000ad002',
  material: '0192f3a0-7c1e-7d2a-9b1f-0000000ad003',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000ad004',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000ad005',
};

export class BoardSheetFluteDto {
  @ApiProperty({ example: 'B' })
  code!: string;

  @ApiProperty({
    type: 'integer',
    example: 3,
    description: 'Paper layers: 3 single wall, 5 double wall, 7 triple wall',
  })
  layers!: number;
}

export class BoardSheetMaterialDto {
  @IdField(BOARD_SHEET_IDS.material)
  id!: string;

  @ApiProperty({ example: 'ka125-b' })
  code!: string;

  @ApiProperty({ example: 'กระดาษลัง KA125 ลอน B' })
  nameTh!: string;

  @ApiProperty({ example: 'Kraft board KA125 B-flute' })
  nameEn!: string;

  @ApiProperty({ type: BoardSheetFluteDto, nullable: true })
  flute!: BoardSheetFluteDto | null;
}

export class BoardStrengthSheetDto {
  @IdField(BOARD_SHEET_IDS.sheet)
  id!: string;

  @ApiProperty({ type: FactoryRefDto })
  factory!: FactoryRefDto;

  @ApiProperty({ type: BoardSheetMaterialDto })
  material!: BoardSheetMaterialDto;

  @ApiProperty({ type: 'integer', example: 1, description: 'Per factory × board, from 1' })
  versionNo!: number;

  @ApiProperty({ example: 7.2, description: 'Edge crush test (ECT). Unit: kN/m.' })
  ectKnPerM!: number;

  @ApiProperty({ example: 3.1, description: 'Board caliper. Unit: mm.' })
  caliperMm!: number;

  @ApiProperty({ example: 560, description: 'Board grammage. Unit: g/m².' })
  grammageGsm!: number;

  @ApiProperty({ example: 'ISO 3037', description: 'The test standard the sheet states' })
  testMethod!: string;

  @ApiProperty({ format: 'uuid', example: BOARD_SHEET_IDS.file, description: 'The signed data sheet' })
  dataSheetFileId!: string;

  @ApiProperty({ format: 'date', example: '2026-09-28', description: 'When the partner signed the sheet' })
  signedOn!: string;

  @TimestampField('2026-10-03T00:00:00+07:00')
  effectiveFrom!: string;

  @ApiProperty({
    example: true,
    description: 'The version the advisor reads now for this factory × board (later ones supersede it)',
  })
  current!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @TimestampField()
  createdAt!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: BOARD_SHEET_IDS.user })
  createdById!: string | null;
}

export class CreateBoardStrengthSheetDto {
  @RefField({ example: BOARD_SHEET_IDS.factory })
  factoryId!: string;

  @RefField({
    example: BOARD_SHEET_IDS.material,
    description: 'A corrugated board (material kind `corrugated_board`)',
  })
  materialId!: string;

  @DecimalField({
    example: 7.2,
    positive: true,
    scale: 3,
    unit: 'kN/m',
    description: 'Edge crush test (ECT)',
  })
  @Max(100)
  ectKnPerM!: number;

  @DecimalField({ example: 3.1, positive: true, scale: 3, unit: 'mm', description: 'Board caliper' })
  @Max(50)
  caliperMm!: number;

  @DecimalField({ example: 560, positive: true, scale: 2, unit: 'g/m²', description: 'Board grammage' })
  @Max(5000)
  grammageGsm!: number;

  @TextField({ example: 'ISO 3037', max: 120, description: 'The test standard the sheet states' })
  testMethod!: string;

  @RefField({
    example: BOARD_SHEET_IDS.file,
    description: 'The signed sheet, uploaded with purpose `document`',
  })
  dataSheetFileId!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-09-28',
    description: 'When the partner signed it',
  })
  @Type(() => Date)
  @IsDate()
  signedOn!: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-03T00:00:00+07:00',
    description: 'Defaults to now; never in the past (D-236)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;

  @TextField({ example: 'ใบรับรองจากโรงงานรอบเดือนกันยายน', optional: true, max: 1000 })
  note?: string;
}

export class BoardStrengthSheetQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid', example: BOARD_SHEET_IDS.factory })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: BOARD_SHEET_IDS.material })
  @IsOptional()
  @IsUUID()
  materialId?: string;

  @ApiPropertyOptional({ example: true, description: 'Only the version in force now per factory × board' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  currentOnly?: boolean;
}

export const BOARD_SHEET_EXAMPLE: BoardStrengthSheetDto = {
  id: BOARD_SHEET_IDS.sheet,
  factory: { id: BOARD_SHEET_IDS.factory, code: 'F0001', name: 'โรงงานตัวอย่าง จำกัด' },
  material: {
    id: BOARD_SHEET_IDS.material,
    code: 'ka125-b',
    nameTh: 'กระดาษลัง KA125 ลอน B',
    nameEn: 'Kraft board KA125 B-flute',
    flute: { code: 'B', layers: 3 },
  },
  versionNo: 1,
  ectKnPerM: 7.2,
  caliperMm: 3.1,
  grammageGsm: 560,
  testMethod: 'ISO 3037',
  dataSheetFileId: BOARD_SHEET_IDS.file,
  signedOn: '2026-09-28',
  effectiveFrom: '2026-10-03T00:00:00+07:00',
  current: true,
  note: null,
  createdAt: '2026-10-03T09:00:00+07:00',
  createdById: BOARD_SHEET_IDS.user,
};

export const CREATE_BOARD_SHEET_EXAMPLE = {
  factoryId: BOARD_SHEET_IDS.factory,
  materialId: BOARD_SHEET_IDS.material,
  ectKnPerM: 7.2,
  caliperMm: 3.1,
  grammageGsm: 560,
  testMethod: 'ISO 3037',
  dataSheetFileId: BOARD_SHEET_IDS.file,
  signedOn: '2026-09-28',
};
