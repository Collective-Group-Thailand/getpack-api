import {
  BoolField,
  DecimalField,
  EnumField,
  IdField,
  IntField,
  RefField,
  TextField,
} from '@modules/catalog/crud/dto-fields';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

export const CAPABILITY_STATUSES = ['active', 'inactive'] as const;
export const CAPABILITY_ITEM_KINDS = [
  'material',
  'finish',
  'coating',
  'ink_colour',
  'diecut',
  'assembly',
  'print_type',
  'pattern',
] as const;

const IDS = {
  capability: '0192f3a0-7c1e-7d2a-9b1f-00000000f401',
  machine: '0192f3a0-7c1e-7d2a-9b1f-00000000f402',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
  printType: '0192f3a0-7c1e-7d2a-9b1f-00000000c003',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000c010',
  zone: '0192f3a0-7c1e-7d2a-9b1f-00000000f403',
};
export const CAPABILITY_IDS = IDS;

export class CapabilityDto {
  @IdField(IDS.capability)
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.printType })
  printTypeId!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 720, description: 'Unit: mm.' })
  maxSheetWidthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1020, description: 'Unit: mm.' })
  maxSheetLengthMm!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 500 })
  minOrderQty!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  maxOrderQty!: number | null;

  @ApiProperty({ enum: CAPABILITY_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: (typeof CAPABILITY_STATUSES)[number];
}

export class CreateCapabilityDto {
  @RefField({ example: IDS.productType })
  productTypeId!: string;

  @RefField({ example: IDS.printType, nullable: true })
  printTypeId?: string | null;

  @DecimalField({ example: 720, nullable: true, positive: true, unit: 'mm' })
  maxSheetWidthMm?: number | null;

  @DecimalField({ example: 1020, nullable: true, positive: true, unit: 'mm' })
  maxSheetLengthMm?: number | null;

  @IntField({ example: 500, nullable: true, min: 1, max: 100_000_000 })
  minOrderQty?: number | null;

  @IntField({ example: null, nullable: true, min: 1, max: 100_000_000 })
  maxOrderQty?: number | null;

  @EnumField(CAPABILITY_STATUSES, 'CapabilityStatus', { example: 'active', optional: true })
  status?: (typeof CAPABILITY_STATUSES)[number];
}

/** The product and print type identify the capability. */
export class UpdateCapabilityDto extends PartialType(
  OmitType(CreateCapabilityDto, ['productTypeId', 'printTypeId'] as const),
) {}

export class CapabilityItemInput {
  @EnumField(CAPABILITY_ITEM_KINDS, 'OfferableOptionKind', { example: 'material' })
  kind!: (typeof CAPABILITY_ITEM_KINDS)[number];

  @RefField({ example: IDS.material })
  itemId!: string;
}

export class ReplaceCapabilityItemsDto {
  @ApiProperty({ type: [CapabilityItemInput] })
  @ValidateNested({ each: true })
  @Type(() => CapabilityItemInput)
  items!: CapabilityItemInput[];
}

export class CapabilityItemDto {
  @ApiProperty({ enum: CAPABILITY_ITEM_KINDS, enumName: 'OfferableOptionKind', example: 'material' })
  kind!: string;

  @ApiProperty({ format: 'uuid', example: IDS.material })
  itemId!: string;

  @ApiProperty({ example: 'art-card-350', description: 'Code of the catalogue row' })
  code!: string;
}

export class CapabilityItemsDto {
  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ type: [CapabilityItemDto] })
  items!: CapabilityItemDto[];
}

export class MachineDto {
  @IdField(IDS.machine)
  id!: string;

  @ApiProperty({ example: 'Heidelberg 5 สี' })
  name!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.printType })
  printTypeId!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 720, description: 'Unit: mm.' })
  maxWidthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1020, description: 'Unit: mm.' })
  maxLengthMm!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'เครื่องพิมพ์ออฟเซ็ท 5 สี + เคลือบ' })
  details!: string | null;

  @ApiProperty({ enum: CAPABILITY_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: (typeof CAPABILITY_STATUSES)[number];
}

export class CreateMachineDto {
  @TextField({ example: 'Heidelberg 5 สี', max: 200 })
  name!: string;

  @RefField({ example: IDS.printType, nullable: true })
  printTypeId?: string | null;

  @DecimalField({ example: 720, nullable: true, positive: true, unit: 'mm' })
  maxWidthMm?: number | null;

  @DecimalField({ example: 1020, nullable: true, positive: true, unit: 'mm' })
  maxLengthMm?: number | null;

  @TextField({ example: 'เครื่องพิมพ์ออฟเซ็ท 5 สี + เคลือบ', nullable: true, max: 2000 })
  details?: string | null;

  @EnumField(CAPABILITY_STATUSES, 'CapabilityStatus', { example: 'active', optional: true })
  status?: (typeof CAPABILITY_STATUSES)[number];
}

export class UpdateMachineDto extends PartialType(CreateMachineDto) {}

export class DeliveryZoneInput {
  @RefField({ example: IDS.zone })
  zoneId!: string;

  @BoolField({
    example: true,
    optional: true,
    description: 'false = the fleet does not serve it (carrier fallback, D-114)',
  })
  serves?: boolean;

  @IntField({ example: 1, optional: true, min: 0, max: 60 })
  extraLeadDays?: number;
}

export class ReplaceDeliveryZonesDto {
  @ApiProperty({ type: [DeliveryZoneInput] })
  @ValidateNested({ each: true })
  @Type(() => DeliveryZoneInput)
  zones!: DeliveryZoneInput[];
}

export class DeliveryZoneDto {
  @ApiProperty({ format: 'uuid', example: IDS.zone })
  zoneId!: string;

  @ApiProperty({ example: 'BKK' })
  zoneCode!: string;

  @ApiProperty({ example: 'customer_default' })
  schemeCode!: string;

  @ApiProperty({ example: true })
  serves!: boolean;

  @ApiProperty({ type: 'integer', example: 1 })
  extraLeadDays!: number;
}
