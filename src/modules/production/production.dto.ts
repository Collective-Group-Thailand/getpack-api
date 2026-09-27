import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Production jobs and milestones (D-073…D-076, D-012, D-101, D-142). */

export const JOB_KINDS = ['production', 'mockup', 'reproduction'] as const;
export const JOB_STATUSES = [
  'released',
  'accepted',
  'rejected',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'] as const;
export const EVIDENCE = ['none', 'photo', 'qc_form', 'photo_and_qc_form'] as const;
export const REJECT_REASONS = [
  'capacity',
  'spec_not_feasible',
  'material_unavailable',
  'artwork_issue',
  'price',
  'other',
] as const;

export const JOB_IDS = {
  job: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000f1003',
  milestone: '0192f3a0-7c1e-7d2a-9b1f-0000000f1004',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000f1005',
  proof: '0192f3a0-7c1e-7d2a-9b1f-0000000f1006',
};

export class StartProductionDto {
  @ApiProperty({
    example: 'ลูกค้ายืนยันงานเร่งด่วน อนุมัติแบบทางโทรศัพท์แล้ว',
    minLength: 10,
    maxLength: 1000,
    description: 'Why production starts as an exception (audited)',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class ReassignJobDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.factory })
  @IsUUID()
  factoryId!: string;

  @ApiProperty({ example: 'โรงงานเดิมเครื่องจักรเสีย', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class RejectJobDto {
  @ApiProperty({ enum: REJECT_REASONS, enumName: 'JobRejectReason', example: 'capacity' })
  @IsIn(REJECT_REASONS)
  reasonCode!: (typeof REJECT_REASONS)[number];

  @ApiPropertyOptional({ example: 'คิวเต็มถึงสิ้นเดือน', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class JobListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: JOB_STATUSES, enumName: 'ProductionJobStatus' })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];

  @ApiPropertyOptional({
    enum: ['escalated', 'at_risk', 'awaiting_acceptance'],
    enumName: 'JobQueue',
    description: 'Work queues',
  })
  @IsOptional()
  @IsIn(['escalated', 'at_risk', 'awaiting_acceptance'])
  queue?: 'escalated' | 'at_risk' | 'awaiting_acceptance';

  @ApiPropertyOptional({ format: 'uuid', example: JOB_IDS.order })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class MilestoneDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.milestone })
  id!: string;

  @ApiProperty({ type: 'integer', example: 4 })
  seq!: number;

  @ApiProperty({ example: 'printing' })
  key!: string;

  @ApiProperty({ example: 'พิมพ์' })
  nameTh!: string;

  @ApiProperty({ example: 'Printing' })
  nameEn!: string;

  @ApiProperty({ enum: MILESTONE_STATUSES, enumName: 'MilestoneStatus', example: 'in_progress' })
  status!: string;

  @ApiProperty({ enum: EVIDENCE, enumName: 'EvidenceRequirement', example: 'photo' })
  evidence!: string;

  @ApiProperty({ example: true })
  tracksQuantity!: boolean;

  @ApiProperty({ example: true })
  customerVisible!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-02T17:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-01T09:00:00+07:00' })
  startedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  completedAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1050 })
  quantityIn!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  quantityOut!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  quantityScrap!: number | null;

  @ApiProperty({ type: Boolean, nullable: true, example: null, description: 'Completed by its due time' })
  onTime!: boolean | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [JOB_IDS.file],
    description: 'Photo evidence files',
  })
  photoFileIds!: string[];
}

export class JobDestinationDto {
  @ApiProperty({ example: 'ผู้รับ ทดสอบ', description: 'Recipient (D-142: name, address and phone only)' })
  recipientName!: string;

  @ApiProperty({ example: '+66810001234' })
  phone!: string;

  @ApiProperty({ example: '1 ถนนทดสอบ' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  line2!: string | null;

  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;
}

export class JobAssignmentDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  fromFactoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: JOB_IDS.factory })
  toFactoryId!: string | null;

  @ApiProperty({
    enum: ['initial', 'rejected', 'acceptance_overdue', 'manual'],
    enumName: 'AssignmentReason',
    example: 'initial',
  })
  reason!: string;

  @ApiProperty({ enum: ['auto', 'manual', 'escalated'], enumName: 'AssignmentMode', example: 'auto' })
  mode!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'D-141: only with `margin.read`' })
  marginAfterPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  decidedAt!: string;
}

export class PartnerJobDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.job })
  id!: string;

  @ApiProperty({ example: 'JOB-2609-00001' })
  jobNo!: string;

  @ApiProperty({ enum: JOB_KINDS, enumName: 'JobKind', example: 'production' })
  kind!: string;

  @ApiProperty({ enum: JOB_STATUSES, enumName: 'ProductionJobStatus', example: 'released' })
  status!: string;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  releasedAt!: string;

  @ApiProperty({ example: '2026-09-28T10:00:00+07:00', description: 'Accept within 1 business day (D-074)' })
  acceptDueAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  acceptedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-28' })
  plannedStartOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-09' })
  plannedFinishOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-09' })
  promisedShipDate!: string | null;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantityOrdered!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  quantityGood!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  quantityScrap!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  lotNo!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { productTypeCode: 'folding_carton', quantity: 1000 },
    description: 'What to make (no selling price)',
  })
  spec!: Record<string, unknown>;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: JOB_IDS.file,
    description: 'The approved artwork (locked copy)',
  })
  approvedFileId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  dielineFileId!: string | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'Packio inspects this job before shipping (D-076)',
  })
  inspectionRequired!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  holdReason!: string | null;

  @ApiProperty({ type: [JobDestinationDto] })
  destinations!: JobDestinationDto[];

  @ApiProperty({ type: [MilestoneDto] })
  milestones!: MilestoneDto[];
}

export class AdminJobDto extends PartnerJobDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'DEVOR-2609-00001' })
  orderCode!: string;

  @ApiProperty({ format: 'uuid', example: JOB_IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'F9001' })
  factoryCode!: string;

  @ApiProperty({ enum: ['auto', 'manual_exception'], enumName: 'ProductionStartMode', example: 'auto' })
  releaseMode!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  releaseReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReasonCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectNote!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Escalated to the Partner team / CS (D-074, D-012)',
  })
  escalatedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  predictedFinishOn!: string | null;

  @ApiProperty({ example: false })
  atRisk!: boolean;

  @ApiProperty({ type: [String], example: [], description: 'Why Packio inspects (D-076)' })
  inspectionReasons!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'D-141: only with `factory_cost.read`',
  })
  buyCostNet!: string | null;

  @ApiProperty({ type: [JobAssignmentDto] })
  assignments!: JobAssignmentDto[];
}

export const MILESTONE_EXAMPLE: MilestoneDto = {
  id: JOB_IDS.milestone,
  seq: 4,
  key: 'printing',
  nameTh: 'พิมพ์',
  nameEn: 'Printing',
  status: 'in_progress',
  evidence: 'photo',
  tracksQuantity: true,
  customerVisible: true,
  dueAt: '2026-10-02T17:00:00+07:00',
  startedAt: '2026-10-01T09:00:00+07:00',
  completedAt: null,
  quantityIn: 1050,
  quantityOut: null,
  quantityScrap: null,
  onTime: null,
  note: null,
  photoFileIds: [],
};

export const PARTNER_JOB_EXAMPLE: PartnerJobDto = {
  id: JOB_IDS.job,
  jobNo: 'JOB-2609-00001',
  kind: 'production',
  status: 'released',
  releasedAt: '2026-09-27T10:00:00+07:00',
  acceptDueAt: '2026-09-28T10:00:00+07:00',
  acceptedAt: null,
  plannedStartOn: '2026-09-28',
  plannedFinishOn: '2026-10-09',
  promisedShipDate: '2026-10-09',
  quantityOrdered: 1000,
  quantityGood: null,
  quantityScrap: null,
  lotNo: null,
  spec: { productTypeCode: 'folding_carton', quantity: 1000 },
  approvedFileId: JOB_IDS.file,
  dielineFileId: null,
  inspectionRequired: false,
  holdReason: null,
  destinations: [
    {
      recipientName: 'ผู้รับ ทดสอบ',
      phone: '+66810001234',
      line1: '1 ถนนทดสอบ',
      line2: null,
      postcode: '10110',
      quantity: 1000,
    },
  ],
  milestones: [MILESTONE_EXAMPLE],
};

export const ADMIN_JOB_EXAMPLE: AdminJobDto = {
  ...PARTNER_JOB_EXAMPLE,
  orderId: JOB_IDS.order,
  orderCode: 'DEVOR-2609-00001',
  factoryId: JOB_IDS.factory,
  factoryCode: 'F9001',
  releaseMode: 'auto',
  releaseReason: null,
  rejectedAt: null,
  rejectReasonCode: null,
  rejectNote: null,
  escalatedAt: null,
  predictedFinishOn: null,
  atRisk: false,
  inspectionReasons: [],
  buyCostNet: null,
  assignments: [
    {
      fromFactoryId: null,
      toFactoryId: JOB_IDS.factory,
      reason: 'initial',
      mode: 'auto',
      marginAfterPct: null,
      note: null,
      decidedAt: '2026-09-27T10:00:00+07:00',
    },
  ],
};
