import { QuoteCalculationDto, STORE_CALCULATION_EXAMPLE } from '@modules/pricing/quotes/quote.dto';
import { TargetPriceField } from '@modules/pricing/quotes/target-price';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
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
  @ApiProperty({ example: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่ปรู๊ฟสัญญา' })
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
    label: { th: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่ปรู๊ฟสัญญา', en: 'Preview, not a contract proof' },
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
