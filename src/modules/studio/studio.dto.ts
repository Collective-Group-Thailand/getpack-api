import { DestinationInputDto } from '@modules/carts/carts.dto';
import { QuoteCalculationDto, STORE_CALCULATION_EXAMPLE } from '@modules/pricing/quotes/quote.dto';
import { TargetPriceField } from '@modules/pricing/quotes/target-price';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PRICE_CHANGE_REASONS } from './studio-spec';

const POSTCODE = /^[0-9]{5}$/;

export class StudioQuoteRequestDto {
  @ApiProperty({
    type: [Number],
    example: [1000, 3000],
    description: 'Quantities to price (1–10, different)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({ example: '10110', description: 'Delivery postcode (prices shipping)' })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode?: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 3,
    description: 'A saved version; absent: the current one',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @TargetPriceField()
  targetPricePerUnit?: string;

  @ApiPropertyOptional({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'The `specHash` of the quote shown before this change: the answer explains the difference',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  previousSpecHash?: string;
}

export class SaveStudioQuoteDto {
  @ApiProperty({ type: [Number], example: [1000, 3000] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({ example: '10110' })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode?: string;

  @ApiPropertyOptional({ type: 'integer', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @TargetPriceField()
  targetPricePerUnit?: string;
}

export class StudioRfqDto {
  @ApiProperty({ type: [Number], example: [1000, 3000] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiProperty({ example: '10110' })
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode!: string;

  @ApiPropertyOptional({ type: 'integer', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { printing: 'cmyk' },
    description: 'The product type’s RFQ form answers (`store.rfqs.getForm`); the studio pre-fills them',
  })
  @IsObject()
  spec!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'ขอราคาแบบพิมพ์ด้านใน', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-11-15', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  targetDate?: string | null;

  @ApiPropertyOptional({ type: [String], example: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds?: string[];

  @TargetPriceField()
  targetPricePerUnit?: string;
}

export class UnitPriceChangeDto {
  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '12.96' })
  previousUnitPrice!: string;

  @ApiProperty({ example: '13.38' })
  unitPrice!: string;
}

export class StudioQuoteDto {
  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'sha256 of the canonical (product type, configuration, quantities, postcode) — D-277',
  })
  specHash!: string;

  @ApiProperty({ type: 'integer', example: 3, description: 'The design version priced' })
  versionNo!: number;

  @ApiProperty({
    enum: ['instant', 'rfq'],
    enumName: 'QuoteMode',
    example: 'instant',
    description: '`rfq`: the type has no instant price — ask for a quotation (`store.studio.requestQuote`)',
  })
  mode!: string;

  @ApiProperty({
    type: QuoteCalculationDto,
    nullable: true,
    description: 'The same object `store.quotes.calculate` answers; null for `rfq`',
  })
  calculation!: QuoteCalculationDto | null;

  @ApiProperty({ example: false, description: 'Served from the snapshot of the same `specHash`' })
  cached!: boolean;

  @ApiProperty({
    enum: PRICE_CHANGE_REASONS,
    enumName: 'PriceChangeReason',
    isArray: true,
    example: ['print_changed'],
    description: 'Why the price differs from the quote of `previousSpecHash`',
  })
  reasons!: string[];

  @ApiProperty({ type: String, nullable: true, example: null })
  previousSpecHash!: string | null;

  @ApiProperty({ type: [UnitPriceChangeDto], description: 'Unit price before and now, per quantity in both' })
  changes!: UnitPriceChangeDto[];
}

export const STUDIO_QUOTE_EXAMPLE: StudioQuoteDto = {
  specHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  versionNo: 3,
  mode: 'instant',
  calculation: STORE_CALCULATION_EXAMPLE,
  cached: false,
  reasons: ['print_changed'],
  previousSpecHash: 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  changes: [{ quantity: 1000, previousUnitPrice: '12.96', unitPrice: '13.38' }],
};

// --- Print checks (U4.B3, D-278) ------------------------------------------------------------------------

export class PrintRuleDto {
  @ApiProperty({
    example: 'image_resolution',
    description: 'Rule id shared by the web, the server and preflight',
  })
  id!: string;

  @ApiProperty({ enum: ['block', 'warn', 'info'], enumName: 'PreflightSeverity', example: 'warn' })
  severity!: string;

  @ApiProperty({
    enum: ['document', 'web', 'pdf'],
    enumName: 'PrintRuleSurface',
    isArray: true,
    example: ['document', 'web', 'pdf'],
  })
  evaluatedOn!: string[];

  @ApiProperty({ type: [String], nullable: true, example: null, description: 'Print methods; null = all' })
  printMethods!: string[] | null;

  @ApiProperty({ type: [String], nullable: true, example: null, description: 'Material classes; null = all' })
  materialClasses!: string[] | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
    nullable: true,
    example: { warnBelowPpi: 300, blockBelowPpi: 150 },
    description: 'null: the rule is off until Prepress sets it',
  })
  thresholds!: Record<string, number | string> | null;
}

export class LocalisedLabelDto {
  @ApiProperty({ example: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่แบบตัวอย่างสำหรับอนุมัติพิมพ์' })
  th!: string;

  @ApiProperty({ example: 'Preview, not a contract proof' })
  en!: string;
}

export class SoftProofProfileDto {
  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiPropertyOptional({ example: 'กระดาษอาร์ตการ์ด' })
  label?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
    example: { multiply: '#f2efe8' },
  })
  transform!: Record<string, number | string>;
}

export class SoftProofDto {
  @ApiProperty({ type: LocalisedLabelDto, description: 'Shown with every soft proof (D-215)' })
  label!: LocalisedLabelDto;

  @ApiProperty({ type: [SoftProofProfileDto], description: 'Empty until Prepress sets them (D-279)' })
  profiles!: SoftProofProfileDto[];
}

export class StudioRulesDto {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'The catalogue version (stored with every check run)',
  })
  version!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ type: [PrintRuleDto] })
  rules!: PrintRuleDto[];

  @ApiProperty({ type: SoftProofDto })
  softProof!: SoftProofDto;
}

export class CheckCountsDto {
  @ApiProperty({ type: 'integer', example: 0 })
  block!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  warn!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  info!: number;
}

export class CheckFindingDto {
  @ApiProperty({ example: 'image_resolution' })
  ruleId!: string;

  @ApiProperty({ enum: ['block', 'warn', 'info'], enumName: 'PreflightSeverity', example: 'warn' })
  severity!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'el-7',
    description: 'The document element; null for the design',
  })
  elementId!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { ppi: 212 } })
  details!: Record<string, unknown>;

  @ApiProperty({ example: false })
  acknowledged!: boolean;
}

export class CheckRunDto {
  @ApiProperty({ type: 'integer', example: 3 })
  versionNo!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  rulesVersion!: number;

  @ApiProperty({ enum: ['document', 'pdf'], enumName: 'DesignCheckSource', example: 'document' })
  source!: string;

  @ApiProperty({ type: CheckCountsDto })
  counts!: CheckCountsDto;

  @ApiProperty({ type: [CheckFindingDto] })
  findings!: CheckFindingDto[];

  @ApiProperty({
    example: false,
    description: 'No block and every warning acknowledged: the version may be ordered',
  })
  ready!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  evaluatedAt!: string;
}

export class RunChecksDto {
  @ApiPropertyOptional({
    type: 'integer',
    example: 3,
    description: 'A saved version; absent: the current one',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;
}

export class AcknowledgeCheckDto extends RunChecksDto {
  @ApiProperty({ example: 'image_resolution' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  ruleId!: string;

  @ApiPropertyOptional({
    example: 'el-7',
    description: 'The element of the finding; absent for a design-wide one',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  elementId?: string;
}

export const RULES_EXAMPLE: StudioRulesDto = {
  version: 1,
  effectiveFrom: '2026-10-03T00:00:00+07:00',
  rules: [
    {
      id: 'image_resolution',
      severity: 'warn',
      evaluatedOn: ['document', 'web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: { warnBelowPpi: 300, blockBelowPpi: 150 },
    },
  ],
  softProof: {
    label: {
      th: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่แบบตัวอย่างสำหรับอนุมัติพิมพ์',
      en: 'Preview, not a contract proof',
    },
    profiles: [],
  },
};

export const CHECK_RUN_EXAMPLE: CheckRunDto = {
  versionNo: 3,
  rulesVersion: 1,
  source: 'document',
  counts: { block: 0, warn: 1, info: 0 },
  findings: [
    {
      ruleId: 'image_resolution',
      severity: 'warn',
      elementId: 'el-7',
      details: { ppi: 212 },
      acknowledged: false,
    },
  ],
  ready: false,
  evaluatedAt: '2026-10-03T10:00:00+07:00',
};

// --- Print file and order hand-off (U4.B4, D-280, D-281) ----------------------------------------------------

export class AddRenderDto {
  @ApiProperty({ enum: ['outside', 'inside'], enumName: 'RenderSide', example: 'outside' })
  @IsIn(['outside', 'inside'])
  side!: 'outside' | 'inside';

  @ApiProperty({
    enum: ['tile', 'finish_mask'],
    enumName: 'DesignRenderKind',
    example: 'tile',
    description: '`tile`: 300 dpi JPEG of the artwork; `finish_mask`: PNG of a finish area',
  })
  @IsIn(['tile', 'finish_mask'])
  kind!: 'tile' | 'finish_mask';

  @ApiPropertyOptional({
    example: 'Foil',
    description: 'For a finish mask: its separation (Foil, SpotUV, Emboss, Window)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,31}$/)
  separation?: string;

  @ApiProperty({ example: 0, description: 'mm from the dieline’s left' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(5000)
  xMm!: number;

  @ApiProperty({ example: 0, description: 'mm from the dieline’s top' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(5000)
  yMm!: number;

  @ApiProperty({ example: 340.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  widthMm!: number;

  @ApiProperty({ example: 180 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(5000)
  heightMm!: number;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000f701',
    description: 'My uploaded image',
  })
  @IsUUID()
  fileId!: string;
}

export class DesignRenderDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f702' })
  id!: string;

  @ApiProperty({ enum: ['outside', 'inside'], enumName: 'RenderSide', example: 'outside' })
  side!: string;

  @ApiProperty({ enum: ['tile', 'finish_mask'], enumName: 'DesignRenderKind', example: 'tile' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  separation!: string | null;

  @ApiProperty({ example: 0 })
  xMm!: number;

  @ApiProperty({ example: 0 })
  yMm!: number;

  @ApiProperty({ example: 340.5 })
  widthMm!: number;

  @ApiProperty({ example: 180 })
  heightMm!: number;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f701' })
  fileId!: string;
}

export class StudioOrderDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
    description: 'The studio quotation of the version',
  })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a202' })
  @IsUUID()
  quoteOptionId!: string;

  @ApiPropertyOptional({ type: 'integer', example: 3, description: 'Absent: the current version' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @ApiPropertyOptional({ type: [DestinationInputDto], description: 'As `store.cart.addItem`' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DestinationInputDto)
  destinations?: DestinationInputDto[];
}

export class StudioPrintJobDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' })
  id!: string;

  @ApiProperty({
    enum: ['queued', 'running', 'succeeded', 'failed'],
    enumName: 'JobStatus',
    example: 'queued',
  })
  status!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d101' })
  designId!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  versionNo!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000c901',
  })
  cartItemId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  orderId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The artwork submission it became',
  })
  submissionId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Signed URL (5 minutes)' })
  printFileUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'The digital proof, signed URL' })
  proofFileUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'The 3D snapshot, signed URL' })
  snapshotUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({
    example: '/v1/store/studio/jobs/0192f3a0-7c1e-7d2a-9b1f-00000000a301',
    description: 'Poll this',
  })
  statusUrl!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;
}

export class StudioApprovalViewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a401' })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ example: 'pending_company_approval' })
  groupStatus!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d101' })
  designId!: string;

  @ApiProperty({ example: 'กล่องกาแฟ' })
  title!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  versionNo!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, example: null })
  box!: Record<string, unknown> | null;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { content: { elements: [] } } })
  document!: Record<string, unknown>;

  @ApiProperty({ example: '13718.40', description: 'The order line incl. VAT and shipping' })
  grossAmount!: string;

  @ApiProperty({ type: CheckRunDto, nullable: true })
  checks!: CheckRunDto | null;
}

export const PRINT_JOB_EXAMPLE: StudioPrintJobDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000a301',
  status: 'queued',
  designId: '0192f3a0-7c1e-7d2a-9b1f-00000000d101',
  versionNo: 3,
  cartItemId: '0192f3a0-7c1e-7d2a-9b1f-00000000c901',
  orderId: null,
  submissionId: null,
  printFileUrl: null,
  proofFileUrl: null,
  snapshotUrl: null,
  error: null,
  statusUrl: '/v1/store/studio/jobs/0192f3a0-7c1e-7d2a-9b1f-00000000a301',
  createdAt: '2026-10-03T10:00:00+07:00',
  completedAt: null,
};
