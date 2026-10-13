import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { AMOUNT, DAY, ERP_RECORD_STATUSES, ERP_UNITS, ErpItemRefDto, ErpRefDto, ErpSettingsDto, QTY } from './erp.dto';
import { ERP_PAUSE_REASONS, ErpMaintenancePhotoDto } from './erp-e3.dto';

/**
 * Packio Factory ERP E5 (docs/prompts/E1-factory-erp.md §12, D-372 – D-383): quality checks and templates,
 * NCRs and certificates of analysis; machine rates, job costing and profitability; OEE; the owner's dashboard;
 * shifts, operator skills and the work log; Packio support's time-boxed access.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || (typeof value === 'string' && value.trim() === '') ? null : value;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MEASURE = /^-?\d{1,10}(\.\d{1,4})?$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const E5_IDS = {
  template: '0192f3a0-7c1e-7d2a-9b1f-00000000f501',
  check: '0192f3a0-7c1e-7d2a-9b1f-00000000f502',
  ncr: '0192f3a0-7c1e-7d2a-9b1f-00000000f503',
  machine: '0192f3a0-7c1e-7d2a-9b1f-00000000f504',
  shift: '0192f3a0-7c1e-7d2a-9b1f-00000000f505',
  skill: '0192f3a0-7c1e-7d2a-9b1f-00000000f506',
  operator: '0192f3a0-7c1e-7d2a-9b1f-00000000f507',
  grant: '0192f3a0-7c1e-7d2a-9b1f-00000000f508',
  productionOrder: '0192f3a0-7c1e-7d2a-9b1f-00000000f509',
  goodsReceipt: '0192f3a0-7c1e-7d2a-9b1f-00000000f510',
  supplier: '0192f3a0-7c1e-7d2a-9b1f-00000000f511',
  item: '0192f3a0-7c1e-7d2a-9b1f-00000000f512',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000f513',
  inspector: '0192f3a0-7c1e-7d2a-9b1f-00000000f514',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f515',
  operation: '0192f3a0-7c1e-7d2a-9b1f-00000000f516',
  customer: '0192f3a0-7c1e-7d2a-9b1f-00000000f517',
  salesOrder: '0192f3a0-7c1e-7d2a-9b1f-00000000f518',
} as const;

export const ERP_CHECK_KINDS = ['incoming', 'in_process', 'final', 'other'] as const;
export const ERP_CHECK_RESULTS = ['pending', 'pass', 'fail', 'conditional'] as const;
export const ERP_CHECKPOINT_TYPES = ['pass_fail', 'measurement', 'note'] as const;
export const ERP_CHECKPOINT_OUTCOMES = ['pass', 'fail', 'na'] as const;
export const ERP_NCR_SOURCES = [
  'quality_check',
  'goods_receipt',
  'production_order',
  'customer_complaint',
  'internal',
] as const;
export const ERP_NCR_SEVERITIES = ['minor', 'major', 'critical'] as const;
export const ERP_NCR_DISPOSITIONS = ['rework', 'scrap', 'return_to_supplier', 'use_as_is', 'hold'] as const;
export const ERP_NCR_STATUSES = ['open', 'in_progress', 'verified', 'closed', 'cancelled'] as const;
export const ERP_SKILL_LEVELS = ['learner', 'competent', 'expert'] as const;
export const ERP_PROFIT_BY = ['sales_order', 'customer', 'item'] as const;

/** A machine by id and name (the same shape as a person reference, so one schema). */
export const ErpMachineRefDto = PersonRefDto;
export type ErpMachineRefDto = PersonRefDto;

/** A document of the factory by id and number (a production order, a goods receipt, a check). */
export class ErpDocRefDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.productionOrder })
  id!: string;

  @ApiProperty({ example: 'MO-2610-0007' })
  number!: string;
}

// ===================================================================================== templates

export class ErpCheckpointInput {
  @ApiProperty({ example: 'ความหนาบอร์ด', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ERP_CHECKPOINT_TYPES, enumName: 'ErpCheckpointType', example: 'measurement' })
  @IsIn(ERP_CHECKPOINT_TYPES)
  type!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'mm', maxLength: 20 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2.9', pattern: MEASURE.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(MEASURE)
  minValue?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '3.3', pattern: MEASURE.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(MEASURE)
  maxValue?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '3.1', pattern: MEASURE.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(MEASURE)
  targetValue?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'วัด 5 จุดด้วยไมโครมิเตอร์', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  instruction?: string | null;
}

export class ErpCheckpointSpecDto {
  @ApiProperty({ example: 1 })
  seq!: number;

  @ApiProperty({ example: 'ความหนาบอร์ด' })
  name!: string;

  @ApiProperty({ enum: ERP_CHECKPOINT_TYPES, enumName: 'ErpCheckpointType', example: 'measurement' })
  type!: string;

  @ApiProperty({ type: String, nullable: true, example: 'mm' })
  unit!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2.9000' })
  minValue!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3.3000' })
  maxValue!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3.1000' })
  targetValue!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'วัด 5 จุดด้วยไมโครมิเตอร์' })
  instruction!: string | null;
}

export class ErpSaveInspectionTemplateDto {
  @ApiProperty({ example: 'ตรวจรับกระดาษลูกฟูก', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind', example: 'incoming' })
  @IsIn(ERP_CHECK_KINDS)
  kind!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'Only for this item' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  itemId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สุ่ม 5 แผ่นต่อพาเลท', maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  sampleSizeHint?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;

  @ApiProperty({ type: [ErpCheckpointInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpCheckpointInput)
  checkpoints!: ErpCheckpointInput[];
}

export class ErpInspectionTemplateDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.template })
  id!: string;

  @ApiProperty({ example: 'ตรวจรับกระดาษลูกฟูก' })
  name!: string;

  @ApiProperty({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind', example: 'incoming' })
  kind!: string;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'สุ่ม 5 แผ่นต่อพาเลท' })
  sampleSizeHint!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: [ErpCheckpointSpecDto] })
  checkpoints!: ErpCheckpointSpecDto[];

  @ApiProperty({ example: 4, description: 'Checks made from it' })
  checks!: number;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpTemplateListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind' })
  @IsOptional()
  @IsIn(ERP_CHECK_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', default: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'For this item (and those for any item)' })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

// ======================================================================================== checks

export class ErpCheckpointResultInput {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seq!: number;

  @ApiPropertyOptional({
    enum: ERP_CHECKPOINT_OUTCOMES,
    enumName: 'ErpCheckpointOutcome',
    nullable: true,
    description: 'For pass / fail points (a measurement is judged from its reading); null clears it',
  })
  @IsOptional()
  @IsIn([...ERP_CHECKPOINT_OUTCOMES, null])
  outcome?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '3.05', pattern: MEASURE.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(MEASURE)
  measured?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpCreateQualityCheckDto {
  @ApiProperty({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind', example: 'final' })
  @IsIn(ERP_CHECK_KINDS)
  kind!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Copy its checkpoints (else give `checkpoints`)' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Incoming: the goods receipt (with `lineNo`)' })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lineNo?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'In-process: the operation checked' })
  @IsOptional()
  @IsUUID()
  operationId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Final (or in-process): the production order' })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The item, when no document gives it' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'LOT-2610-07', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lotNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '13', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  sampleSize?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '5000', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  inspectedQty?: string | null;

  @ApiPropertyOptional({ format: 'date-time', description: 'Default: now' })
  @IsOptional()
  @IsISO8601()
  inspectedAt?: string;

  @ApiPropertyOptional({ type: [ErpCheckpointInput], description: 'Points of a check without a template' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpCheckpointInput)
  checkpoints?: ErpCheckpointInput[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  remarks?: string | null;
}

export class ErpRecordQualityCheckDto {
  @ApiPropertyOptional({ type: [ErpCheckpointResultInput] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpCheckpointResultInput)
  points?: ErpCheckpointResultInput[];

  @ApiPropertyOptional({ type: String, nullable: true, example: '13', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  sampleSize?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '5000', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  inspectedQty?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '4980', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  acceptedQty?: string | null;

  @ApiPropertyOptional({ example: '20', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  rejectedQty?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'LOT-2610-07', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lotNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  remarks?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Uploaded photos of this factory' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class ErpOverrideCheckDto {
  @ApiProperty({ enum: ['pass', 'fail', 'conditional'], enumName: 'QcResult', example: 'conditional' })
  @IsIn(['pass', 'fail', 'conditional'])
  result!: string;

  @ApiProperty({ example: 'ลูกค้ายอมรับสีเพี้ยนเล็กน้อย', maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ErpCheckpointResultDto extends ErpCheckpointSpecDto {
  @ApiProperty({ type: String, nullable: true, example: '3.0500' })
  measured!: string | null;

  @ApiProperty({ enum: ERP_CHECKPOINT_OUTCOMES, enumName: 'ErpCheckpointOutcome', nullable: true, example: 'pass' })
  outcome!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;
}

export class ErpNcrRefDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.ncr })
  id!: string;

  @ApiProperty({ example: 'NCR-2610-0001' })
  ncrNo!: string;

  @ApiProperty({ enum: ERP_NCR_STATUSES, enumName: 'ErpNcrStatus', example: 'open' })
  status!: string;
}

export class ErpQualityCheckDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.check })
  id!: string;

  @ApiProperty({ example: 'QC-2610-0004' })
  qcNo!: string;

  @ApiProperty({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind', example: 'final' })
  kind!: string;

  @ApiProperty({ enum: ERP_CHECK_RESULTS, enumName: 'ErpCheckResult', example: 'pass' })
  result!: string;

  @ApiProperty({ example: false, description: 'Set by someone with quality.manage, not from the points' })
  resultOverridden!: boolean;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The template (code = kind)' })
  template!: ErpRefDto | null;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ type: ErpDocRefDto, nullable: true, description: 'Incoming: the goods receipt' })
  goodsReceipt!: ErpDocRefDto | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  lineNo!: number | null;

  @ApiProperty({ type: ErpDocRefDto, nullable: true, description: 'The production order' })
  productionOrder!: ErpDocRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'In-process: the operation’s name' })
  operation!: string | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  supplier!: ErpRefDto | null;

  @ApiProperty({ type: PersonRefDto })
  inspector!: PersonRefDto;

  @ApiProperty({ type: String, nullable: true, example: 'LOT-2610-07' })
  lotNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '13.000' })
  sampleSize!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '5000.000' })
  inspectedQty!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '5000.000' })
  acceptedQty!: string | null;

  @ApiProperty({ example: '0.000' })
  rejectedQty!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  remarks!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T14:20:00+07:00' })
  inspectedAt!: string;

  @ApiProperty({ type: [ErpCheckpointResultDto] })
  checkpoints!: ErpCheckpointResultDto[];

  @ApiProperty({ type: [ErpMaintenancePhotoDto] })
  photos!: ErpMaintenancePhotoDto[];

  @ApiProperty({ type: [ErpNcrRefDto] })
  ncrs!: ErpNcrRefDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 2 })
  version!: number;
}

export class ErpQualityCheckListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_CHECK_KINDS, enumName: 'ErpCheckKind' })
  @IsOptional()
  @IsIn(ERP_CHECK_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: ERP_CHECK_RESULTS, enumName: 'ErpCheckResult' })
  @IsOptional()
  @IsIn(ERP_CHECK_RESULTS)
  result?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

// ========================================================================================== NCRs

export class ErpCreateNcrDto {
  @ApiProperty({ enum: ERP_NCR_SOURCES, enumName: 'ErpNcrSource', example: 'customer_complaint' })
  @IsIn(ERP_NCR_SOURCES)
  source!: string;

  @ApiPropertyOptional({ enum: ERP_NCR_SEVERITIES, enumName: 'DefectSeverity', default: 'minor' })
  @IsOptional()
  @IsIn(ERP_NCR_SEVERITIES)
  severity?: string;

  @ApiProperty({ example: 'กล่องพิมพ์สีเพี้ยน ล็อต 2610-07', maxLength: 160 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ example: 'ลูกค้าแจ้งสีแดงอ่อนกว่าตัวอย่างที่อนุมัติ', maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  checkId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Where the nonconforming stock is (for a scrap)' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '200', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  quantity?: string | null;

  @ApiPropertyOptional({ enum: ERP_UNITS, enumName: 'ErpUnit', nullable: true })
  @IsOptional()
  @IsIn([...ERP_UNITS, null])
  unit?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Who owns the corrective action (default: the caller)' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Matches(DAY)
  actionDueOn?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class ErpUpdateNcrDto {
  @ApiPropertyOptional({ enum: ERP_NCR_SEVERITIES, enumName: 'DefectSeverity' })
  @IsOptional()
  @IsIn(ERP_NCR_SEVERITIES)
  severity?: string;

  @ApiPropertyOptional({ example: 'กล่องพิมพ์สีเพี้ยน ล็อต 2610-07', maxLength: 160 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ผสมหมึกผิดสูตร', maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  rootCause?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'พิมพ์ใหม่ 200 ใบ', maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  correctiveAction?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'เทียบสีกับแผ่นมาตรฐานทุกล็อต', maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  actionDueOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '200', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  quantity?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  warehouseId?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class ErpDisposeNcrDto {
  @ApiProperty({ enum: ERP_NCR_DISPOSITIONS, enumName: 'ErpNcrDisposition', example: 'scrap' })
  @IsIn(ERP_NCR_DISPOSITIONS)
  disposition!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ทำลาย 200 ใบ', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ErpVerifyNcrDto {
  @ApiProperty({ example: 'ล็อตถัดไปสีตรงมาตรฐาน', maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class ErpNcrDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.ncr })
  id!: string;

  @ApiProperty({ example: 'NCR-2610-0001' })
  ncrNo!: string;

  @ApiProperty({ enum: ERP_NCR_SOURCES, enumName: 'ErpNcrSource', example: 'quality_check' })
  source!: string;

  @ApiProperty({ enum: ERP_NCR_SEVERITIES, enumName: 'DefectSeverity', example: 'major' })
  severity!: string;

  @ApiProperty({ enum: ERP_NCR_STATUSES, enumName: 'ErpNcrStatus', example: 'in_progress' })
  status!: string;

  @ApiProperty({ example: 'QC-2610-0004 ไม่ผ่าน — กล่องลูกฟูก RSC' })
  title!: string;

  @ApiProperty({ example: 'ความหนาบอร์ดต่ำกว่าเกณฑ์ 2 จุดจาก 5' })
  description!: string;

  @ApiProperty({ type: ErpDocRefDto, nullable: true, description: 'The quality check it came from' })
  check!: ErpDocRefDto | null;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  supplier!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  customer!: ErpRefDto | null;

  @ApiProperty({ type: ErpMachineRefDto, nullable: true })
  machine!: ErpMachineRefDto | null;

  @ApiProperty({ type: ErpDocRefDto, nullable: true })
  productionOrder!: ErpDocRefDto | null;

  @ApiProperty({ type: ErpDocRefDto, nullable: true })
  goodsReceipt!: ErpDocRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  warehouse!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: '200.000' })
  quantity!: string | null;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', nullable: true, example: 'pcs' })
  unit!: string | null;

  @ApiProperty({ enum: ERP_NCR_DISPOSITIONS, enumName: 'ErpNcrDisposition', nullable: true, example: 'rework' })
  disposition!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  dispositionNote!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  dispositionAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ผสมหมึกผิดสูตร' })
  rootCause!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'พิมพ์ใหม่ 200 ใบ' })
  correctiveAction!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  preventiveAction!: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  owner!: PersonRefDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  actionDueOn!: string | null;

  @ApiProperty({ example: false, description: 'Still open after the action due date' })
  overdue!: boolean;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  verifiedBy!: PersonRefDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  verifiedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  verificationNote!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  closedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: [ErpMaintenancePhotoDto] })
  photos!: ErpMaintenancePhotoDto[];

  @ApiProperty({ example: 'ฝ่าย QC ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T14:25:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 2 })
  version!: number;
}

export class ErpNcrListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_NCR_STATUSES, 'active'],
    enumName: 'ErpNcrStatusFilter',
    description: '`active` = open, in progress or verified',
  })
  @IsOptional()
  @IsIn([...ERP_NCR_STATUSES, 'active'])
  status?: string;

  @ApiPropertyOptional({ enum: ERP_NCR_SEVERITIES, enumName: 'DefectSeverity' })
  @IsOptional()
  @IsIn(ERP_NCR_SEVERITIES)
  severity?: string;

  @ApiPropertyOptional({ enum: ERP_NCR_SOURCES, enumName: 'ErpNcrSource' })
  @IsOptional()
  @IsIn(ERP_NCR_SOURCES)
  source?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: true, description: 'Only those past their action date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}

// ===================================================================================== costing

export class ErpMachineRateDto {
  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ type: String, nullable: true, example: '850.00', description: 'Per run hour; null = not set' })
  hourlyRate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ค่าเสื่อม + ไฟ + ซ่อมบำรุง' })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  updatedAt!: string | null;
}

export class ErpSaveMachineRateDto {
  @ApiProperty({ example: '850', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  hourlyRate!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpOperationCostDto {
  @ApiProperty({ example: 1 })
  seq!: number;

  @ApiProperty({ example: 'พิมพ์ 2 สี' })
  name!: string;

  @ApiProperty({ type: ErpMachineRefDto, nullable: true })
  machine!: ErpMachineRefDto | null;

  @ApiProperty({ example: 180 })
  plannedMinutes!: number;

  @ApiProperty({ example: 205, description: 'Running time from the floor’s events, pauses excluded' })
  runMinutes!: number;

  @ApiProperty({ type: String, nullable: true, example: '850.00' })
  machineRate!: string | null;

  @ApiProperty({ example: '2904.17' })
  machineCost!: string;
}

export class ErpJobCostDto {
  @ApiProperty({ type: ErpDocRefDto })
  productionOrder!: ErpDocRefDto;

  @ApiProperty({ example: 'กล่องลูกฟูก RSC 30×20×15 — 5,000 ใบ' })
  title!: string;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ example: 'completed' })
  status!: string;

  @ApiProperty({ example: '4950.000' })
  goodQty!: string;

  @ApiProperty({ example: '50.000' })
  scrapQty!: string;

  @ApiProperty({ example: '31250.00', description: 'Materials issued less returned' })
  material!: string;

  @ApiProperty({ example: '4250.00', description: 'Run minutes × each machine’s hourly rate' })
  machine!: string;

  @ApiProperty({ example: '600.00', description: 'Run minutes × the labour rate' })
  labour!: string;

  @ApiProperty({ example: '5415.00', description: 'Overhead % of materials + machine + labour' })
  overhead!: string;

  @ApiProperty({ example: '41515.00' })
  total!: string;

  @ApiProperty({ type: String, nullable: true, example: '8.386869', description: 'Total ÷ good quantity' })
  unitCost!: string | null;

  @ApiProperty({ example: 300 })
  plannedMinutes!: number;

  @ApiProperty({ example: 300 })
  runMinutes!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-12T17:30:00+07:00' })
  completedAt!: string | null;

  @ApiProperty({ type: [ErpOperationCostDto] })
  operations!: ErpOperationCostDto[];
}

export class ErpCostTotalsDto {
  @ApiProperty({ example: 12 })
  orders!: number;

  @ApiProperty({ example: '310500.00' })
  material!: string;

  @ApiProperty({ example: '42300.00' })
  machine!: string;

  @ApiProperty({ example: '6200.00' })
  labour!: string;

  @ApiProperty({ example: '53850.00' })
  overhead!: string;

  @ApiProperty({ example: '412850.00' })
  total!: string;
}

export class ErpCostReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: [ErpJobCostDto], description: 'Orders completed in the month (operations omitted)' })
  orders!: ErpJobCostDto[];

  @ApiProperty({ type: ErpCostTotalsDto })
  totals!: ErpCostTotalsDto;
}

export class ErpProfitQuery {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  month!: string;

  @ApiPropertyOptional({ enum: ERP_PROFIT_BY, enumName: 'ErpProfitBy', default: 'customer' })
  @IsOptional()
  @IsIn(ERP_PROFIT_BY)
  by?: string;
}

export class ErpProfitRowDto {
  @ApiProperty({ type: ErpRefDto, description: 'The sales order (code = number), customer or item (code = SKU)' })
  key!: ErpRefDto;

  @ApiProperty({ example: '62500.00', description: 'Net invoiced (issued, not voided) in the month' })
  revenue!: string;

  @ApiProperty({ example: '41515.00', description: 'Cost of what those invoices delivered' })
  cost!: string;

  @ApiProperty({ example: '20985.00' })
  grossProfit!: string;

  @ApiProperty({ type: String, nullable: true, example: '33.6' })
  grossProfitPct!: string | null;
}

export class ErpProfitReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ enum: ERP_PROFIT_BY, enumName: 'ErpProfitBy', example: 'customer' })
  by!: string;

  @ApiProperty({ type: [ErpProfitRowDto] })
  rows!: ErpProfitRowDto[];

  @ApiProperty({ example: '245000.00' })
  revenue!: string;

  @ApiProperty({ example: '171500.00' })
  cost!: string;

  @ApiProperty({ example: '73500.00' })
  grossProfit!: string;

  @ApiProperty({ type: String, nullable: true, example: '30.0' })
  grossProfitPct!: string | null;
}

// ========================================================================================== OEE

export class ErpOeeQuery {
  @ApiProperty({ format: 'date', example: '2026-10-06' })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12', description: 'At most 31 days after `from`' })
  @Matches(DAY)
  to!: string;
}

export class ErpOeeDayDto {
  @ApiProperty({ format: 'date', example: '2026-10-12' })
  day!: string;

  @ApiProperty({ example: 480 })
  plannedMinutes!: number;

  @ApiProperty({ example: 395 })
  runMinutes!: number;

  @ApiProperty({ example: '82.3' })
  availabilityPct!: string;

  @ApiProperty({ example: '91.0' })
  performancePct!: string;

  @ApiProperty({ example: '99.0' })
  qualityPct!: string;

  @ApiProperty({ example: '74.1' })
  oeePct!: string;
}

export class ErpOeeLossDto {
  @ApiProperty({ enum: ERP_PAUSE_REASONS, enumName: 'ErpPauseReason', example: 'setup' })
  reason!: string;

  @ApiProperty({ example: 45 })
  minutes!: number;
}

export class ErpOeeMachineDto {
  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ example: 3360 })
  plannedMinutes!: number;

  @ApiProperty({ example: 2650 })
  runMinutes!: number;

  @ApiProperty({ example: '30500.000' })
  good!: string;

  @ApiProperty({ example: '320.000' })
  scrap!: string;

  @ApiProperty({ example: '78.9' })
  availabilityPct!: string;

  @ApiProperty({ example: '88.4' })
  performancePct!: string;

  @ApiProperty({ example: '99.0' })
  qualityPct!: string;

  @ApiProperty({ example: '69.0' })
  oeePct!: string;

  @ApiProperty({ type: [ErpOeeDayDto] })
  days!: ErpOeeDayDto[];

  @ApiProperty({ type: [ErpOeeLossDto], description: 'Paused minutes by reason, largest first' })
  losses!: ErpOeeLossDto[];
}

export class ErpOeeReportDto {
  @ApiProperty({ format: 'date', example: '2026-10-06' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  to!: string;

  @ApiProperty({ type: String, nullable: true, example: '69.0', description: 'Over all machines, run-weighted' })
  oeePct!: string | null;

  @ApiProperty({ type: [ErpOeeMachineDto] })
  machines!: ErpOeeMachineDto[];
}

// ==================================================================================== dashboard

export class ErpDashSalesDto {
  @ApiProperty({ example: '245000.00', description: 'Net invoiced this month' })
  invoicedNet!: string;

  @ApiProperty({ example: '300000.00', description: 'Sum of this month’s targets' })
  target!: string;

  @ApiProperty({ type: String, nullable: true, example: '81.7' })
  achievementPct!: string | null;

  @ApiProperty({ example: 12 })
  invoices!: number;
}

export class ErpDashReceivablesDto {
  @ApiProperty({ example: '182000.00' })
  open!: string;

  @ApiProperty({ example: '42000.00' })
  overdue!: string;

  @ApiProperty({ example: 3 })
  overdueInvoices!: number;
}

export class ErpDashPayablesDto {
  @ApiProperty({ example: '56000.00', description: 'Supplier invoices due within 7 days' })
  dueThisWeek!: string;

  @ApiProperty({ example: 4 })
  dueThisWeekCount!: number;

  @ApiProperty({ example: '0.00' })
  overdueAmount!: string;
}

export class ErpLowStockDto {
  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '120.000' })
  available!: string;

  @ApiProperty({ example: '500.000' })
  reorderPoint!: string;
}

export class ErpDashStockDto {
  @ApiProperty({ example: '845000.00' })
  value!: string;

  @ApiProperty({ example: 3 })
  lowItems!: number;

  @ApiProperty({ type: [ErpLowStockDto], description: 'Up to 5, furthest under their reorder point first' })
  low!: ErpLowStockDto[];
}

export class ErpDashLateOrderDto {
  @ApiProperty({ type: ErpDocRefDto })
  order!: ErpDocRefDto;

  @ApiProperty({ example: 'กล่องลูกฟูก RSC 30×20×15' })
  title!: string;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  dueOn!: string;

  @ApiProperty({ example: 'in_progress' })
  status!: string;
}

export class ErpDashProductionDto {
  @ApiProperty({ example: 5 })
  inProgress!: number;

  @ApiProperty({ example: 2, description: 'Open orders past their due date' })
  late!: number;

  @ApiProperty({ example: 14 })
  completedThisMonth!: number;

  @ApiProperty({ type: [ErpDashLateOrderDto], description: 'Up to 5, most overdue first' })
  lateOrders!: ErpDashLateOrderDto[];
}

export class ErpDashMachinesDto {
  @ApiProperty({ example: 6 })
  total!: number;

  @ApiProperty({ example: 1, description: 'With an open breakdown' })
  down!: number;

  @ApiProperty({ type: String, nullable: true, example: '68.4', description: 'Yesterday, all machines' })
  oeeYesterdayPct!: string | null;
}

export class ErpDashQualityDto {
  @ApiProperty({ example: 3 })
  openNcrs!: number;

  @ApiProperty({ example: 1 })
  overdueNcrs!: number;

  @ApiProperty({ example: 42 })
  checksThisMonth!: number;

  @ApiProperty({ type: String, nullable: true, example: '95.2', description: 'Decided checks that passed, %' })
  passRatePct!: string | null;
}

export class ErpDashFollowUpsDto {
  @ApiProperty({ example: 4, description: 'Open CRM activities due today' })
  dueToday!: number;

  @ApiProperty({ example: 2 })
  overdue!: number;

  @ApiProperty({ example: 5, description: 'Open ERP alerts' })
  alerts!: number;
}

export class ErpDashboardDto {
  @ApiProperty({ format: 'date', example: '2026-10-13' })
  asOf!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: ErpDashSalesDto })
  sales!: ErpDashSalesDto;

  @ApiProperty({ type: ErpDashReceivablesDto })
  receivables!: ErpDashReceivablesDto;

  @ApiProperty({ type: ErpDashPayablesDto })
  payables!: ErpDashPayablesDto;

  @ApiProperty({ type: ErpDashStockDto })
  stock!: ErpDashStockDto;

  @ApiProperty({ type: ErpDashProductionDto })
  production!: ErpDashProductionDto;

  @ApiProperty({ type: ErpDashMachinesDto })
  machines!: ErpDashMachinesDto;

  @ApiProperty({ type: ErpDashQualityDto })
  quality!: ErpDashQualityDto;

  @ApiProperty({ type: ErpDashFollowUpsDto })
  followUps!: ErpDashFollowUpsDto;
}

// ======================================================================================== people

export class ErpSaveShiftDto {
  @ApiProperty({ example: 'กะเช้า', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: '08:00', pattern: HHMM.source })
  @Matches(HHMM)
  startTime!: string;

  @ApiProperty({ example: '17:00', pattern: HHMM.source, description: 'At or before the start = past midnight' })
  @Matches(HHMM)
  endTime!: string;

  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5, 6], description: 'Days of the week, 0 = Sunday' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpShiftDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.shift })
  id!: string;

  @ApiProperty({ example: 'กะเช้า' })
  name!: string;

  @ApiProperty({ example: '08:00' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  endTime!: string;

  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5, 6] })
  days!: number[];

  @ApiProperty({ example: 540 })
  minutes!: number;

  @ApiProperty({ type: String, nullable: true, example: 'พัก 12:00–13:00' })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveSkillDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.operator })
  @IsUUID()
  userId!: string;

  @ApiProperty({ format: 'uuid', example: E5_IDS.machine })
  @IsUUID()
  machineId!: string;

  @ApiProperty({ enum: ERP_SKILL_LEVELS, enumName: 'ErpSkillLevel', example: 'competent' })
  @IsIn(ERP_SKILL_LEVELS)
  level!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-09-15' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  certifiedOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpOperatorSkillDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.skill })
  id!: string;

  @ApiProperty({ type: PersonRefDto })
  user!: PersonRefDto;

  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ enum: ERP_SKILL_LEVELS, enumName: 'ErpSkillLevel', example: 'competent' })
  level!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-09-15' })
  certifiedOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSkillListQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  machineId?: string;
}

export class ErpWorkLogQuery {
  @ApiProperty({ format: 'date', example: '2026-10-06' })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12', description: 'At most 31 days after `from`' })
  @Matches(DAY)
  to!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class ErpWorkLogRowDto {
  @ApiProperty({ type: PersonRefDto })
  user!: PersonRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  day!: string;

  @ApiProperty({ example: 3, description: 'Operations they started, resumed or finished' })
  operations!: number;

  @ApiProperty({ example: 410, description: 'Running time they opened (start / resume to pause / finish)' })
  runMinutes!: number;

  @ApiProperty({ example: '9800.000', description: 'Good quantity they reported at finish' })
  good!: string;

  @ApiProperty({ example: '120.000' })
  scrap!: string;

  @ApiProperty({ type: [String], example: ['เครื่องพิมพ์ออฟเซ็ท 4 สี (ทดสอบ)'] })
  machines!: string[];
}

export class ErpWorkLogDto {
  @ApiProperty({ format: 'date', example: '2026-10-06' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  to!: string;

  @ApiProperty({ type: [ErpWorkLogRowDto] })
  rows!: ErpWorkLogRowDto[];
}

// ======================================================================================= support

export class ErpGrantSupportDto {
  @ApiProperty({ example: 'ให้ทีม Packio ช่วยตรวจตัวเลขต้นทุน', maxLength: 300 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  @ApiProperty({ example: 3, minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  days!: number;
}

export class ErpSupportViewLogDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-13T10:12:00+07:00' })
  at!: string;

  @ApiProperty({ example: 'ทีมพาร์ทเนอร์ Packio (ทดสอบ)' })
  staff!: string;

  @ApiProperty({ example: 'dashboard', description: 'What was read' })
  what!: string;
}

export class ErpSupportGrantDto {
  @ApiProperty({ format: 'uuid', example: E5_IDS.grant })
  id!: string;

  @ApiProperty({ example: 'ให้ทีม Packio ช่วยตรวจตัวเลขต้นทุน' })
  reason!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-16T10:00:00+07:00' })
  expiresAt!: string;

  @ApiProperty({ example: true, description: 'Not revoked and not expired' })
  active!: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  revokedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  revokedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  revokeReason!: string | null;

  @ApiProperty({ example: 2 })
  viewCount!: number;

  @ApiProperty({ example: 'เจ้าของโรงงาน ทดสอบ' })
  grantedBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [ErpSupportViewLogDto], description: 'Latest reads first, up to 50' })
  views!: ErpSupportViewLogDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpSupportViewDto {
  @ApiProperty({ type: ErpRefDto, description: 'The factory (code = its public code)' })
  factory!: ErpRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-16T10:00:00+07:00', description: 'Access ends' })
  expiresAt!: string;

  @ApiProperty({ example: 'ให้ทีม Packio ช่วยตรวจตัวเลขต้นทุน' })
  reason!: string;

  @ApiProperty({ type: ErpDashboardDto })
  dashboard!: ErpDashboardDto;

  @ApiProperty({ type: ErpSettingsDto })
  settings!: ErpSettingsDto;
}
