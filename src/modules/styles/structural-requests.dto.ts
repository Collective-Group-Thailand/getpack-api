import { EnumField, TextField } from '@modules/catalog/crud/dto-fields';
import { MEASUREMENT_BASES } from '@modules/specs/dimension-conversion';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { AttachedFileDto } from '@platform/files/files.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const STRUCTURAL_REQUEST_STATUSES = [
  'submitted',
  'assigned',
  'quoted',
  'delivered',
  'approved',
  'published',
  'declined',
  'cancelled',
] as const;

const IDS = {
  request: '0192f3a0-7c1e-7d2a-9b1f-00000000ea01',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000fa01',
  rfq: '0192f3a0-7c1e-7d2a-9b1f-00000000ea02',
  designer: '0192f3a0-7c1e-7d2a-9b1f-00000000e605',
};

function Size(description: string, min: number) {
  return applyDecorators(
    ApiPropertyOptional({ example: 120, minimum: min, maximum: 5000, description }),
    IsOptional(),
    Type(() => Number),
    IsNumber({ maxDecimalPlaces: 2 }),
    Min(min),
    Max(5000),
  );
}

export class CreateStructuralRequestDto {
  @ApiProperty({ example: 'folding_carton', description: 'The product type the structure is for' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  productTypeCode!: string;

  @TextField({
    example: 'กล่องใส่ขวดน้ำหอม 2 ขวด มีช่องแบ่งตรงกลาง เปิดด้านบน',
    max: 4000,
    description: 'What the structure must do',
  })
  description!: string;

  @Size('Length, mm, in `measurementBasis`', 1)
  lengthMm?: number;

  @Size('Width, mm, in `measurementBasis`', 1)
  widthMm?: number;

  @Size('Height, mm, in `measurementBasis`', 0)
  heightMm?: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description: 'Basis of the sizes (D-182); required with any size',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiPropertyOptional({ type: 'integer', example: 3000, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  quantity?: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [IDS.file],
    description: 'Up to 10 of my uploaded reference files (photos, sketches, an existing dieline)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class AssignStructuralRequestDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.designer,
    description: 'A structural designer (staff holding `structural_requests.design`)',
  })
  @IsUUID()
  assigneeId!: string;
}

export class LinkServiceRfqDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.rfq,
    description: 'The service RFQ (product type `service`) of the same customer that quotes the design fee',
  })
  @IsUUID()
  rfqId!: string;
}

export class DeliverStructuralDesignDto {
  @ApiProperty({ format: 'uuid', example: IDS.file, description: 'The dieline (file purpose `dieline`)' })
  @IsUUID()
  dielineFileId!: string;
}

export class PublishStructuralDesignDto {
  @ApiProperty({ example: 'PK-TE-07', description: 'The published style base the design became' })
  @IsString()
  @Matches(/^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/)
  baseCode!: string;
}

export class StructuralRequestQuery {
  @EnumField(STRUCTURAL_REQUEST_STATUSES, 'StructuralRequestStatus', { example: 'submitted', optional: true })
  status?: (typeof STRUCTURAL_REQUEST_STATUSES)[number];
}

export class StructuralSizesDto {
  @ApiProperty({ type: Number, nullable: true, example: 120 })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60 })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 180 })
  heightMm!: number | null;

  @ApiProperty({ enum: MEASUREMENT_BASES, enumName: 'MeasurementBasis', example: 'internal' })
  measurementBasis!: string;
}

export class StructuralRequestDto {
  @ApiProperty({ format: 'uuid', example: IDS.request })
  id!: string;

  @ApiProperty({
    enum: STRUCTURAL_REQUEST_STATUSES,
    enumName: 'StructuralRequestStatus',
    example: 'submitted',
  })
  status!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องใส่ขวดน้ำหอม 2 ขวด มีช่องแบ่งตรงกลาง เปิดด้านบน' })
  description!: string;

  @ApiProperty({ type: StructuralSizesDto, nullable: true })
  sizes!: StructuralSizesDto | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 3000 })
  quantity!: number | null;

  @ApiProperty({ type: [AttachedFileDto] })
  files!: AttachedFileDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  assignedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The service RFQ quoting the design fee (`store.rfqs.get`)',
  })
  serviceRfqId!: string | null;

  @ApiProperty({
    type: AttachedFileDto,
    nullable: true,
    description: 'The delivered dieline — shown to the customer once Prepress approved it',
  })
  deliveredFile!: AttachedFileDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  approvedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The style base it was published as',
  })
  publishedBaseCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  closedReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  closedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  updatedAt!: string;
}

export class AdminStructuralRequestDto extends StructuralRequestDto {
  @ApiProperty({ type: UserRefDto })
  customer!: UserRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  assignedTo!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  approvedBy!: UserRefDto | null;
}

export const REQUEST_EXAMPLE: StructuralRequestDto = {
  id: IDS.request,
  status: 'submitted',
  productTypeCode: 'folding_carton',
  description: 'กล่องใส่ขวดน้ำหอม 2 ขวด มีช่องแบ่งตรงกลาง เปิดด้านบน',
  sizes: { lengthMm: 120, widthMm: 60, heightMm: 180, measurementBasis: 'internal' },
  quantity: 3000,
  files: [{ id: IDS.file, originalName: 'sketch.jpg', mimeType: 'image/jpeg', sizeBytes: 182044 }],
  assignedAt: null,
  serviceRfqId: null,
  deliveredFile: null,
  approvedAt: null,
  publishedBaseCode: null,
  closedReason: null,
  closedAt: null,
  createdAt: '2026-10-03T10:00:00+07:00',
  updatedAt: '2026-10-03T10:00:00+07:00',
};

export const ADMIN_REQUEST_EXAMPLE: AdminStructuralRequestDto = {
  ...REQUEST_EXAMPLE,
  customer: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000c001', displayName: 'Fake Customer' },
  assignedTo: null,
  approvedBy: null,
};

export const CREATE_EXAMPLE = {
  productTypeCode: 'folding_carton',
  description: REQUEST_EXAMPLE.description,
  lengthMm: 120,
  widthMm: 60,
  heightMm: 180,
  measurementBasis: 'internal',
  quantity: 3000,
  fileIds: [IDS.file],
};
