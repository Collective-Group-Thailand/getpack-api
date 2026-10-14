import { EnumField } from '@modules/catalog/crud/dto-fields';
import { DRAWING_FORMATS } from '@modules/designs/designs.dto';

/**
 * What a dieline download can come down as: the engine's three drawing formats, plus `ai` — the
 * designer PDF delivered as an Illustrator file (`.ai`, `application/illustrator`). Illustrator
 * opens a PDF-compatible file directly with every path editable and the spot swatches intact;
 * the engine draws nothing new for it. Free, like the rest (D-271) — the owner's answer to a
 * competitor that charges for the same file (2026-10-14).
 */
export const DIELINE_DOWNLOAD_FORMATS = [...DRAWING_FORMATS, 'ai'] as const;
export type DielineDownloadFormat = (typeof DIELINE_DOWNLOAD_FORMATS)[number];
import { MEASUREMENT_BASES } from '@modules/specs/dimension-conversion';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

import { STYLE_VARIANT_CODE } from './style-variant-field';

function Size(description: string, min: number) {
  return applyDecorators(
    ApiProperty({ example: 100, minimum: min, maximum: 5000, description }),
    Type(() => Number),
    IsNumber({ maxDecimalPlaces: 2 }),
    Min(min),
    Max(5000),
  );
}

export class DownloadDielineDto {
  @ApiProperty({
    example: 'PK-TE-01-K7QD',
    pattern: STYLE_VARIANT_CODE.source,
    description: 'A style variant code',
  })
  @IsString()
  @Matches(STYLE_VARIANT_CODE)
  variantCode!: string;

  @Size('Length, mm, in the basis given', 1)
  lengthMm!: number;

  @Size('Width, mm, in the basis given', 1)
  widthMm!: number;

  @Size('Height (depth), mm, in the basis given; 0 for a flat item', 0)
  heightMm!: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description:
      'Basis of the sizes (D-182), default internal. Outside or over-crease sizes are converted to inside sizes with ' +
      'the reference caliper of the material class before drawing',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({
    example: 'paperboard',
    description:
      'A material class of the style’s size ranges (`store.styles.get` → `sizeRanges[].materialClass`)',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,39}$/)
  materialClass!: string;

  @ApiProperty({
    enum: DIELINE_DOWNLOAD_FORMATS,
    enumName: 'DielineDownloadFormat',
    example: 'pdf',
    description: '`ai` is the designer PDF delivered as an Illustrator file (.ai) — same drawing, same layers and swatches',
  })
  @IsIn(DIELINE_DOWNLOAD_FORMATS)
  format!: DielineDownloadFormat;
}

export class DielineSizesDto {
  @ApiProperty({ example: 60 })
  lengthMm!: number;

  @ApiProperty({ example: 40 })
  widthMm!: number;

  @ApiProperty({ example: 120 })
  heightMm!: number;
}

/** D-267 quantities of a drawn dieline. */
export class DielineQuantitiesDto {
  @ApiProperty({ example: 231.4, description: 'Flat blank width, mm' })
  blankWidthMm!: number;

  @ApiProperty({ example: 187.2, description: 'Flat blank height, mm' })
  blankHeightMm!: number;

  @ApiProperty({ example: 31845.2, description: 'Blank area net of cut-outs, mm²' })
  blankAreaMm2!: number;

  @ApiProperty({ example: 1412.6 })
  cutMm!: number;

  @ApiProperty({ example: 902.3 })
  creaseMm!: number;

  @ApiProperty({ example: 0 })
  perforationMm!: number;

  @ApiProperty({ example: 0 })
  halfCutMm!: number;

  @ApiProperty({ example: 240 })
  glueOutlineMm!: number;

  @ApiProperty({ example: 0, description: 'Window and other cut-out area, mm²' })
  cutoutAreaMm2!: number;

  @ApiProperty({ example: 1 })
  pieces!: number;
}

export class DielineDownloadDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000d701',
    description: 'The download',
  })
  id!: string;

  @ApiProperty({ example: 'PK-TE-01-K7QD' })
  variantCode!: string;

  @ApiProperty({ enum: DIELINE_DOWNLOAD_FORMATS, enumName: 'DielineDownloadFormat', example: 'pdf' })
  format!: string;

  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiProperty({ enum: MEASUREMENT_BASES, enumName: 'MeasurementBasis', example: 'internal' })
  measurementBasis!: string;

  @ApiProperty({ type: DielineSizesDto, description: 'The sizes as entered, in `measurementBasis`' })
  entered!: DielineSizesDto;

  @ApiProperty({ type: DielineSizesDto, description: 'The inside sizes drawn (D-182)' })
  drawn!: DielineSizesDto;

  @ApiProperty({ example: 'PK-TE-01-K7QD-60x40x120-paperboard.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 18234 })
  sizeBytes!: number;

  @ApiProperty({
    example: 'https://files.example.invalid/signed',
    description: 'Short-lived signed URL of the file',
  })
  url!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T14:15:00+07:00' })
  expiresAt!: string;

  @ApiProperty({ type: DielineQuantitiesDto })
  quantities!: DielineQuantitiesDto;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Engine rules the size breaks (staff downloads may be outside the published ranges)',
  })
  violations!: string[];

  @ApiProperty({ example: 'fake-dieline@0' })
  engineVersion!: string;

  @ApiProperty({ example: false, description: 'Served from the render cache (D-270)' })
  cached!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 19,
    description: 'Downloads left today (Bangkok day) for a customer; null for staff (not limited)',
  })
  remainingToday!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T14:10:00+07:00' })
  createdAt!: string;
}

export const DOWNLOAD_EXAMPLE: DielineDownloadDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000d701',
  variantCode: 'PK-TE-01-K7QD',
  format: 'pdf',
  materialClass: 'paperboard',
  measurementBasis: 'internal',
  entered: { lengthMm: 60, widthMm: 40, heightMm: 120 },
  drawn: { lengthMm: 60, widthMm: 40, heightMm: 120 },
  fileName: 'PK-TE-01-K7QD-60x40x120-paperboard.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 18234,
  url: 'https://files.example.invalid/signed',
  expiresAt: '2026-10-03T14:15:00+07:00',
  quantities: {
    blankWidthMm: 231.4,
    blankHeightMm: 187.2,
    blankAreaMm2: 31845.2,
    cutMm: 1412.6,
    creaseMm: 902.3,
    perforationMm: 0,
    halfCutMm: 0,
    glueOutlineMm: 240,
    cutoutAreaMm2: 0,
    pieces: 1,
  },
  violations: [],
  engineVersion: 'fake-dieline@0',
  cached: false,
  remainingToday: 19,
  createdAt: '2026-10-03T14:10:00+07:00',
};

export const DOWNLOAD_BODY_EXAMPLE = {
  variantCode: 'PK-TE-01-K7QD',
  lengthMm: 60,
  widthMm: 40,
  heightMm: 120,
  measurementBasis: 'internal',
  materialClass: 'paperboard',
  format: 'pdf',
};
