import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { AGENT_IDS } from '@modules/agents/agents.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  DISQUALIFY_REASONS,
  INBOUND_CONSENT_BASES,
  INBOUND_SOURCES,
  INBOUND_STATUSES,
} from './sales-desk-rules';
import { type InboundRow } from './sales-inbound.service';
import { P4_IDS } from './sales-pipeline.dto';

const E164 = /^\+[1-9]\d{7,14}$/;
const csvList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value;

export class SalesInboundListQuery extends PageQuery {
  @ApiPropertyOptional({
    type: [String],
    enum: INBOUND_STATUSES,
    enumName: 'SalesInboundStatus',
    isArray: true,
    description: 'One or more statuses, comma-separated',
  })
  @IsOptional()
  @Transform(csvList)
  @IsArray()
  @IsIn(INBOUND_STATUSES, { each: true })
  status?: (typeof INBOUND_STATUSES)[number][];

  @ApiPropertyOptional({ enum: INBOUND_SOURCES, enumName: 'SalesInboundSource' })
  @IsOptional()
  @IsIn(INBOUND_SOURCES)
  source?: (typeof INBOUND_SOURCES)[number];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Managers: one rep’s enquiries (a rep always sees their own)',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Managers: only enquiries nobody has yet' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Only those past (true) or within (false) the first-response SLA',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  breached?: boolean;
}

export class CreateSalesInboundDto {
  @ApiProperty({ example: 'คุณวิภา รักษ์ดี', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  contactName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '+66890002222', pattern: E164.source })
  @IsOptional()
  @Matches(E164)
  contactPhone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  contactEmail?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'บริษัท ขนมดี จำกัด', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisationName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'กล่องขนม 5,000 ใบต่อเดือน',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  need?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Managers: assign at once to this rep (staff user id). A rep’s own entry is theirs.',
  })
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;
}

export class MarkSalesInboundContactedDto {
  @ApiPropertyOptional({ example: 'โทรแล้ว นัดส่งตัวอย่างพรุ่งนี้', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DisqualifySalesInboundDto {
  @ApiProperty({
    enum: DISQUALIFY_REASONS,
    enumName: 'SalesInboundDisqualifyReason',
    example: 'out_of_scope',
  })
  @IsIn(DISQUALIFY_REASONS)
  reason!: (typeof DISQUALIFY_REASONS)[number];

  @ApiPropertyOptional({ example: 'ต้องการถุงพลาสติก ไม่ใช่กล่อง', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssignSalesInboundDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: P4_IDS.rep,
    description: 'The rep (staff user id); omitted = round robin among the reps with room',
  })
  @IsOptional()
  @IsUUID()
  repUserId?: string;

  @ApiPropertyOptional({
    example: 'ลูกค้าอยู่เชียงใหม่ ให้ทีมภาคเหนือดูแล',
    maxLength: 300,
    description: 'Required to move an enquiry from one rep to another (audited)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BulkAssignSalesInboundDto extends AssignSalesInboundDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [P4_IDS.inbound], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class SalesInboundDto {
  @IdField(P4_IDS.inbound)
  id!: string;

  @ApiProperty({
    enum: INBOUND_SOURCES,
    enumName: 'SalesInboundSource',
    example: 'contact_form',
    description:
      '`contact_form` / `rfq` (the person asked), `manual` (staff), `line_chat` (deferred), D-471 capture: ' +
      '`studio_idle` "ออกแบบแล้วยังไม่สั่ง" (a saved studio design not ordered) and `dieline_download` (a free dieline ' +
      'downloaded by a signed-in non-customer)',
  })
  source!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CS-2611-00042',
    description: 'Ticket no., RFQ code or the dieline’s style code',
  })
  sourceRef!: string | null;

  @ApiProperty({ example: 'คุณวิภา รักษ์ดี' })
  contactName!: string;

  @ApiProperty({ type: String, nullable: true, example: '+66890002222' })
  contactPhone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  contactEmail!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'บริษัท ขนมดี จำกัด' })
  organisationName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'business · กล่องขนม · qty 5000' })
  need!: string | null;

  @ApiProperty({ enum: INBOUND_STATUSES, enumName: 'SalesInboundStatus', example: 'assigned' })
  status!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  assignee!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-03T10:05:00+07:00' })
  assignedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: AGENT_IDS.lead,
    description: 'The lead registered for the rep (open it with admin.salesLeads.get)',
  })
  leadId!: string | null;

  @ApiProperty({
    enum: ['unavailable', 'too_many_leads'],
    enumName: 'SalesInboundLeadRefusal',
    nullable: true,
    example: null,
    description:
      'Why no lead could be registered for the rep: `unavailable` (one neutral reason — an existing customer or ' +
      'someone else’s protected lead, D-440) or `too_many_leads` (the rep’s open-leads limit)',
  })
  leadRefusal!: string | null;

  @TimestampField('2026-11-03T14:00:00+07:00')
  firstResponseDueAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  firstRespondedAt!: string | null;

  @ApiProperty({ example: false, description: 'Past the first-response due time without an answer (or was)' })
  slaBreached!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  slaBreachedAt!: string | null;

  @ApiProperty({
    enum: DISQUALIFY_REASONS,
    enumName: 'SalesInboundDisqualifyReason',
    nullable: true,
    example: null,
  })
  disqualifiedReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  statusNote!: string | null;

  @ApiProperty({
    enum: INBOUND_CONSENT_BASES,
    enumName: 'SalesInboundConsentBasis',
    example: 'enquiry',
    description:
      'D-471 why getpack may contact the person (PDPA): `enquiry` (they asked), `staff_entry` (entered with their ' +
      'agreement), `marketing_consent` (a captured signal; their latest marketing consent was granted)',
  })
  consentBasis!: string;

  @ApiProperty({
    example: 1,
    description: 'D-471 signals behind the item (repeat dieline downloads refresh one open item)',
  })
  signalCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-03T10:00:00+07:00' })
  lastSignalAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description:
      'D-471 the signed-in customer the item came from (captured signals, RFQs, signed-in contacts)',
  })
  customerId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'D-471 the saved studio design not ordered (`studio_idle`)',
  })
  designId!: string | null;

  @TimestampField('2026-11-03T10:00:00+07:00')
  createdAt!: string;

  @TimestampField('2026-11-03T10:05:00+07:00')
  updatedAt!: string;
}

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

export function inboundDto(r: InboundRow, now = new Date()): SalesInboundDto {
  return {
    id: r.publicId,
    source: r.source,
    sourceRef: r.sourceRef,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    organisationName: r.organisationName,
    need: r.need,
    status: r.status,
    assignee: r.assignee ? { id: r.assignee.publicId, displayName: r.assignee.displayName } : null,
    assignedAt: iso(r.assignedAt),
    leadId: r.agentLead?.publicId ?? null,
    leadRefusal: r.leadRefusal,
    firstResponseDueAt: toBangkokIso(r.firstResponseDueAt),
    firstRespondedAt: iso(r.firstRespondedAt),
    slaBreached:
      r.slaBreachedAt !== null ||
      (r.firstRespondedAt === null && r.firstResponseDueAt <= now) ||
      (r.firstRespondedAt !== null && r.firstRespondedAt > r.firstResponseDueAt),
    slaBreachedAt: iso(r.slaBreachedAt),
    disqualifiedReason: r.disqualifiedReason,
    statusNote: r.statusNote,
    consentBasis: r.consentBasis,
    signalCount: r.signalCount,
    lastSignalAt: iso(r.lastSignalAt),
    customerId: r.captureUser?.publicId ?? null,
    designId: r.designDocument?.publicId ?? null,
    createdAt: toBangkokIso(r.createdAt),
    updatedAt: toBangkokIso(r.updatedAt),
  };
}

export const INBOUND_EXAMPLE: SalesInboundDto = {
  id: P4_IDS.inbound,
  source: 'contact_form',
  sourceRef: 'CS-2611-00042',
  contactName: 'คุณวิภา รักษ์ดี',
  contactPhone: '+66890002222',
  contactEmail: null,
  organisationName: 'บริษัท ขนมดี จำกัด',
  need: 'business · กล่องขนม · qty 5000',
  status: 'assigned',
  assignee: { id: P4_IDS.rep, displayName: 'สมหญิง ขายดี' },
  assignedAt: '2026-11-03T10:05:00+07:00',
  leadId: AGENT_IDS.lead,
  leadRefusal: null,
  firstResponseDueAt: '2026-11-03T14:00:00+07:00',
  firstRespondedAt: null,
  slaBreached: false,
  slaBreachedAt: null,
  disqualifiedReason: null,
  statusNote: null,
  consentBasis: 'enquiry',
  signalCount: 1,
  lastSignalAt: '2026-11-03T10:00:00+07:00',
  customerId: null,
  designId: null,
  createdAt: '2026-11-03T10:00:00+07:00',
  updatedAt: '2026-11-03T10:05:00+07:00',
};

export class BulkAssignResultDto {
  @ApiProperty({ type: [SalesInboundDto] })
  assigned!: SalesInboundDto[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [],
    description: 'Enquiries not assigned (closed, not found or no rep with room)',
  })
  skipped!: string[];
}
