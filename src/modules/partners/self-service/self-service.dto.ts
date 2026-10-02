import { PageQuery } from '@common/pagination/pagination.dto';
import { EnumField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
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

import { ENVELOPE_EXAMPLE, TierBEnvelopeDto } from '../configuration/tier-b-envelope.dto';
import { CapacityWeekDto } from '../operations.dto';

/**
 * Factory self-service reads and requests (U-B0.3): change requests to the Partner team, its own site visits, the
 * catalogue names its price lines reference, the capacity calendar and price-proposal evidence.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IDS = {
  request: '0192f3a0-7c1e-7d2a-9b1f-000000c0a001',
  factory: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
  visit: '0192f3a0-7c1e-7d2a-9b1f-000000c0a002',
  productType: '0192f3a0-7c1e-7d2a-9b1f-000000c0a003',
  material: '0192f3a0-7c1e-7d2a-9b1f-000000c0a004',
  file: '0192f3a0-7c1e-7d2a-9b1f-000000c0a005',
  attachment: '0192f3a0-7c1e-7d2a-9b1f-000000c0a006',
};

// --- change requests -----------------------------------------------------------------------------------------

export const CHANGE_REQUEST_TOPICS = [
  'capability',
  'capacity',
  'delivery_zones',
  'tolerance',
  'participation_tier',
  'pricing_arrangement',
  'payout_policy',
  'site_visit',
  'other',
] as const;
export const CHANGE_REQUEST_STATUSES = ['open', 'in_progress', 'done', 'declined'] as const;
export const CHANGE_REQUEST_ANSWERS = ['in_progress', 'done', 'declined'] as const;

export class FactoryChangeRequestDto {
  @ApiProperty({ format: 'uuid', example: IDS.request })
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'PRINTCO' })
  factoryCode!: string;

  @ApiProperty({ enum: CHANGE_REQUEST_TOPICS, enumName: 'FactoryChangeRequestTopic', example: 'site_visit' })
  topic!: string;

  @ApiProperty({ example: 'ขอนัดตรวจโรงงานหลังติดตั้งเครื่องใหม่' })
  message!: string;

  @ApiProperty({ type: [String], format: 'date', example: ['2026-10-20'] })
  preferredDates!: string[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Topic participation_tier: the product type (D-234)',
  })
  productTypeId!: string | null;

  @ApiProperty({
    enum: ['A', 'B', 'C'],
    enumName: 'ParticipationTier',
    nullable: true,
    example: null,
    description: 'Topic participation_tier: the tier asked for',
  })
  proposedTier!: 'A' | 'B' | 'C' | null;

  @ApiProperty({
    type: TierBEnvelopeDto,
    nullable: true,
    example: null,
    description: 'Topic participation_tier, tier B: the envelope asked for (D-234)',
  })
  proposedEnvelope!: TierBEnvelopeDto | null;

  @ApiProperty({ enum: CHANGE_REQUEST_STATUSES, enumName: 'FactoryChangeRequestStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'The Partner team’s answer' })
  response!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  respondedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, example: null })
  respondedBy!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto })
  createdBy!: UserRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  createdAt!: string;
}

export const CHANGE_REQUEST_EXAMPLE: FactoryChangeRequestDto = {
  id: IDS.request,
  factoryId: IDS.factory,
  factoryCode: 'PRINTCO',
  topic: 'site_visit',
  message: 'ขอนัดตรวจโรงงานหลังติดตั้งเครื่องใหม่',
  preferredDates: ['2026-10-20'],
  productTypeId: null,
  proposedTier: null,
  proposedEnvelope: null,
  status: 'open',
  response: null,
  respondedAt: null,
  respondedBy: null,
  createdBy: { id: '0192f3a0-7c1e-7d2a-9b1f-000000c0a007', displayName: 'เจ้าของโรงงาน (fake)' },
  createdAt: '2026-10-01T10:00:00+07:00',
};

export class CreateFactoryChangeRequestDto {
  @ApiProperty({ enum: CHANGE_REQUEST_TOPICS, enumName: 'FactoryChangeRequestTopic', example: 'site_visit' })
  @IsIn(CHANGE_REQUEST_TOPICS)
  topic!: (typeof CHANGE_REQUEST_TOPICS)[number];

  @ApiProperty({ example: 'ขอนัดตรวจโรงงานหลังติดตั้งเครื่องใหม่', minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'date',
    example: ['2026-10-20'],
    maxItems: 5,
    description: 'Preferred days; a site visit needs at least one day after today (Asia/Bangkok)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(DAY, { each: true })
  preferredDates?: string[];

  @RefField({
    example: IDS.productType,
    optional: true,
    description: 'Topic participation_tier: the product type the tier is for (D-234)',
  })
  productTypeId?: string;

  @EnumField(['A', 'B', 'C'], 'ParticipationTier', {
    example: 'B',
    optional: true,
    description: 'Topic participation_tier: the tier asked for',
  })
  proposedTier?: 'A' | 'B' | 'C';

  @ApiPropertyOptional({
    type: TierBEnvelopeDto,
    example: ENVELOPE_EXAMPLE,
    description: 'Topic participation_tier, tier B: the envelope asked for; staff apply it (D-234)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TierBEnvelopeDto)
  proposedEnvelope?: TierBEnvelopeDto;
}

export class ChangeRequestListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CHANGE_REQUEST_STATUSES, enumName: 'FactoryChangeRequestStatus' })
  @IsOptional()
  @IsIn(CHANGE_REQUEST_STATUSES)
  status?: (typeof CHANGE_REQUEST_STATUSES)[number];
}

export class AdminChangeRequestListQuery extends ChangeRequestListQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ enum: CHANGE_REQUEST_TOPICS, enumName: 'FactoryChangeRequestTopic' })
  @IsOptional()
  @IsIn(CHANGE_REQUEST_TOPICS)
  topic?: (typeof CHANGE_REQUEST_TOPICS)[number];
}

export class AnswerChangeRequestDto {
  @ApiProperty({
    enum: CHANGE_REQUEST_ANSWERS,
    enumName: 'FactoryChangeRequestAnswer',
    example: 'done',
    description: '`done` and `declined` close the request and need a response',
  })
  @IsIn(CHANGE_REQUEST_ANSWERS)
  status!: (typeof CHANGE_REQUEST_ANSWERS)[number];

  @ApiPropertyOptional({ example: 'นัดตรวจวันที่ 20 ต.ค. 10:00 น.', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  response?: string;
}

// --- site visits ---------------------------------------------------------------------------------------------

/** A factory's own site visit (D-041): the date and result only — no inspectors, checklist, notes or photos. */
export class PartnerSiteVisitDto {
  @ApiProperty({ format: 'uuid', example: IDS.visit })
  id!: string;

  @ApiProperty({ format: 'date', example: '2026-09-20' })
  visitedOn!: string;

  @ApiProperty({ enum: ['pass', 'conditional', 'fail'], enumName: 'SiteVisitResult', example: 'pass' })
  result!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-20T15:00:00+07:00' })
  createdAt!: string;
}

export const PARTNER_SITE_VISIT_EXAMPLE: PartnerSiteVisitDto = {
  id: IDS.visit,
  visitedOn: '2026-09-20',
  result: 'pass',
  createdAt: '2026-09-20T15:00:00+07:00',
};

// --- references ----------------------------------------------------------------------------------------------

export class ReferenceProductTypeDto {
  @ApiProperty({ format: 'uuid', example: IDS.productType })
  id!: string;

  @ApiProperty({ example: 'folding_carton' })
  code!: string;

  @ApiProperty({ example: 'กล่องพับ' })
  nameTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Folding carton' })
  nameEn!: string | null;
}

export class CatalogueReferenceDto {
  @ApiProperty({
    example: 'materials',
    description: 'The catalogue the row belongs to (a price column’s reference table)',
  })
  catalogue!: string;

  @ApiProperty({ format: 'uuid', example: IDS.material, description: 'The id a price line carries' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'KA125' })
  code!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กระดาษคราฟท์ 125 แกรม' })
  nameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Kraft 125 gsm' })
  nameEn!: string | null;
}

/** Names of what the factory's own price lines and capabilities refer to — never a price (D-044, D-040). */
export class PriceReferencesDto {
  @ApiProperty({ type: [ReferenceProductTypeDto] })
  productTypes!: ReferenceProductTypeDto[];

  @ApiProperty({ type: [CatalogueReferenceDto] })
  items!: CatalogueReferenceDto[];
}

export const PRICE_REFERENCES_EXAMPLE: PriceReferencesDto = {
  productTypes: [
    { id: IDS.productType, code: 'folding_carton', nameTh: 'กล่องพับ', nameEn: 'Folding carton' },
  ],
  items: [
    {
      catalogue: 'materials',
      id: IDS.material,
      code: 'KA125',
      nameTh: 'กระดาษคราฟท์ 125 แกรม',
      nameEn: 'Kraft 125 gsm',
    },
  ],
};

// --- capacity calendar ---------------------------------------------------------------------------------------

export class CapacityCalendarRowDto {
  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องพับ' })
  productTypeNameTh!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'sheets',
    description: 'Capacity unit of the version in force',
  })
  unit!: string | null;

  @ApiProperty({ type: [CapacityWeekDto] })
  weeks!: CapacityWeekDto[];
}

export const CALENDAR_SOURCES = ['national', 'factory'] as const;

export class CalendarClosureDto {
  @ApiProperty({ format: 'date', example: '2026-10-13' })
  day!: string;

  @ApiProperty({
    enum: ['holiday', 'closure', 'extra_working_day'],
    enumName: 'CalendarDayKind',
    example: 'holiday',
  })
  kind!: string;

  @ApiProperty({ enum: CALENDAR_SOURCES, enumName: 'CalendarSource', example: 'national' })
  source!: string;

  @ApiProperty({ example: 'วันนวมินทรมหาราช' })
  nameTh!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  nameEn!: string | null;
}

export class CapacityCalendarDto {
  @ApiProperty({ format: 'date', example: '2026-09-28', description: 'Monday of the first week' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-11-22', description: 'Sunday of the last week' })
  to!: string;

  @ApiProperty({ type: [CapacityCalendarRowDto] })
  productTypes!: CapacityCalendarRowDto[];

  @ApiProperty({
    type: [CalendarClosureDto],
    description:
      'National holidays observed by all (D-161) and the factory’s own closures and extra working days, in the range',
  })
  days!: CalendarClosureDto[];
}

export const CAPACITY_CALENDAR_EXAMPLE: CapacityCalendarDto = {
  from: '2026-09-28',
  to: '2026-11-22',
  productTypes: [
    {
      productTypeId: IDS.productType,
      productTypeCode: 'folding_carton',
      productTypeNameTh: 'กล่องพับ',
      unit: 'sheets',
      weeks: [
        {
          weekStart: '2026-09-28',
          capacity: '12000.000',
          booked: '4500.000',
          free: '7500.000',
          source: 'version',
        },
      ],
    },
  ],
  days: [
    { day: '2026-10-13', kind: 'holiday', source: 'national', nameTh: 'วันนวมินทรมหาราช', nameEn: null },
  ],
};

export class CapacityCalendarQuery {
  @ApiPropertyOptional({ format: 'date', example: '2026-09-28', description: 'Defaults to today (its week)' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ type: 'integer', example: 8, minimum: 1, maximum: 26, description: 'Default 8' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  weeks?: number;
}

// --- price-proposal evidence ---------------------------------------------------------------------------------

export class ProposalEvidenceDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.file,
    description: 'The file (download through the files API)',
  })
  fileId!: string;

  @ApiProperty({ example: 'quotation-supplier.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ใบเสนอราคากระดาษจากผู้ขาย' })
  note!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  addedBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  addedAt!: string;
}

export const PROPOSAL_EVIDENCE_EXAMPLE: ProposalEvidenceDto = {
  fileId: IDS.file,
  fileName: 'quotation-supplier.pdf',
  mimeType: 'application/pdf',
  note: 'ใบเสนอราคากระดาษจากผู้ขาย',
  addedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-000000c0a007', displayName: 'เจ้าของโรงงาน (fake)' },
  addedAt: '2026-10-01T10:00:00+07:00',
};

export class AddProposalEvidenceDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.file,
    description: 'An uploaded, clean file of the signed-in user',
  })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({ example: 'ใบเสนอราคากระดาษจากผู้ขาย', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
