import { TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches } from 'class-validator';

import { LEVER_KINDS, LEVER_REASON_CODES } from './lever-candidates';

export const LEVER_SET_STATUSES = ['computed', 'meets_target', 'not_instant'] as const;
export const QUOTE_OUTCOMES = ['won', 'lost', 'expired', 'converted_to_rfq', 'revised'] as const;

const IDS = {
  quote: '0192f3a0-7c1e-7d2a-9b1f-00000000e601',
  lever: '0192f3a0-7c1e-7d2a-9b1f-00000000e701',
  rfq: '0192f3a0-7c1e-7d2a-9b1f-00000000e801',
};

export class QuoteLeverStepDto {
  @ApiProperty({ example: 2000 })
  quantity!: number;

  @ApiProperty({ example: '10.95', description: 'Per piece incl. VAT, excluding shipping' })
  unitPrice!: string;

  @ApiProperty({ example: '22028.40', description: 'Total incl. VAT and shipping' })
  grossAmount!: string;

  @ApiProperty({ type: Number, nullable: true, example: 9 })
  leadTimeDays!: number | null;

  @ApiProperty({ example: '-0.55', description: 'Unit price − target, THB (D-247)' })
  gapPerUnit!: string;

  @ApiProperty({ example: '-4.78' })
  gapPct!: string;

  @ApiProperty({ example: true })
  meetsTarget!: boolean;
}

export class QuoteLeverDto {
  @ApiProperty({ format: 'uuid', example: IDS.lever })
  id!: string;

  @ApiProperty({ example: 1, description: '1 = the largest saving' })
  rank!: number;

  @ApiProperty({ enum: LEVER_KINDS, enumName: 'QuoteLeverKind', example: 'quantity' })
  kind!: (typeof LEVER_KINDS)[number];

  @ApiProperty({
    enum: LEVER_REASON_CODES,
    enumName: 'QuoteLeverReason',
    isArray: true,
    example: ['quantity_increased'],
    description: 'The trade-off, as codes only (D-248)',
  })
  reasonCodes!: (typeof LEVER_REASON_CODES)[number][];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { quantities: { from: [500, 1000], to: [2000] } },
    description: 'Changed configuration paths → `{ from, to }` (`to` absent = removed)',
  })
  changes!: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { materialId: '0192f3a0-7c1e-7d2a-9b1f-00000000a103', quantities: [2000] },
    description: 'The full configuration the lever was priced with (what `applyLever` saves)',
  })
  configuration!: Record<string, unknown>;

  @ApiProperty({ type: [QuoteLeverStepDto], description: 'The re-priced instant quantities' })
  steps!: QuoteLeverStepDto[];

  @ApiProperty({
    example: '18.1600',
    description:
      'Largest unit-price saving against the quotation, % (a quantity lever: against its largest quantity)',
  })
  bestSavingPct!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-16T09:00:00+07:00',
    description: 'The quotation’s validity (D-051)',
  })
  validUntil!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The quotation saved from it',
  })
  takenQuoteId!: string | null;
}

export class QuoteLeversDto {
  @ApiProperty({ format: 'uuid', example: IDS.quote })
  quoteId!: string;

  @ApiProperty({ example: '11.50', description: 'The quotation’s target per unit (D-247)' })
  targetPricePerUnit!: string;

  @ApiProperty({
    enum: LEVER_SET_STATUSES,
    enumName: 'QuoteLeverSetStatus',
    example: 'computed',
    description:
      '`computed`: levers below (may be empty: nothing cheaper); `meets_target`: no quantity is above the target; ' +
      '`not_instant`: an RFQ quotation has no levers',
  })
  status!: (typeof LEVER_SET_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T09:05:00+07:00' })
  computedAt!: string | null;

  @ApiProperty({ type: [QuoteLeverDto] })
  levers!: QuoteLeverDto[];
}

export class QuoteOutcomeDto {
  @ApiProperty({ enum: QUOTE_OUTCOMES, enumName: 'QuoteOutcome', example: 'won' })
  outcome!: (typeof QUOTE_OUTCOMES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-10-05T14:00:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why it was declined (`lost`)' })
  lossReasonCode!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The lever taken (`revised`)',
  })
  leverTakenId!: string | null;
}

export class DeclineQuoteDto {
  @ApiPropertyOptional({
    example: 'price',
    pattern: '^[a-z][a-z0-9_]{0,63}$',
    description:
      'A loss reason code (`price`, `lead_time`, `specification`, `bought_elsewhere`, `no_longer_needed`, `other`; D-250); optional',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,63}$/)
  reasonCode?: string;

  @TextField({ example: 'งบประมาณไม่พอ', optional: true, max: 500 })
  note?: string;
}

export class SendQuoteToCsDto {
  @ApiPropertyOptional({
    example: '10110',
    pattern: '^[0-9]{5}$',
    description: 'Delivery postcode; default the quotation’s (required when it has none)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: {},
    description:
      'The type’s RFQ spec fields (`store.rfqs.getForm`); default none — CS reads the quotation’s configuration',
  })
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @TextField({ example: 'ขอราคาที่ 11.50 บาทต่อชิ้น ปรับสเปกได้', optional: true, max: 2000 })
  notes?: string;
}

export class SendQuoteToCsResultDto {
  @ApiProperty({ format: 'uuid', example: IDS.rfq })
  rfqId!: string;

  @ApiProperty({ example: 'RFQ-2610-00002' })
  rfqCode!: string;

  @ApiProperty({ enum: ['routed_to_rfq'], enumName: 'QuoteRoutedStatus', example: 'routed_to_rfq' })
  quoteStatus!: 'routed_to_rfq';
}

export const LEVERS_EXAMPLE: QuoteLeversDto = {
  quoteId: IDS.quote,
  targetPricePerUnit: '11.50',
  status: 'computed',
  computedAt: '2026-10-01T09:05:00+07:00',
  levers: [
    {
      id: IDS.lever,
      rank: 1,
      kind: 'quantity',
      reasonCodes: ['quantity_increased'],
      changes: { quantities: { from: [500, 1000], to: [2000] } },
      configuration: { materialId: '0192f3a0-7c1e-7d2a-9b1f-00000000a103', quantities: [2000] },
      steps: [
        {
          quantity: 2000,
          unitPrice: '10.95',
          grossAmount: '22028.40',
          leadTimeDays: 9,
          gapPerUnit: '-0.55',
          gapPct: '-4.78',
          meetsTarget: true,
        },
      ],
      bestSavingPct: '18.1600',
      validUntil: '2026-10-16T09:00:00+07:00',
      takenQuoteId: null,
    },
  ],
};

export const SEND_TO_CS_EXAMPLE: SendQuoteToCsResultDto = {
  rfqId: IDS.rfq,
  rfqCode: 'RFQ-2610-00002',
  quoteStatus: 'routed_to_rfq',
};
