import { FactoryRefDto } from '@common/dto/factory-ref.dto';
import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { FACTORY_ROLES } from '@modules/auth/me.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
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

  @ApiPropertyOptional({
    enum: ['to_accept', 'in_production', 'ready_to_ship', 'late'],
    enumName: 'JobView',
    description:
      'Shop-floor views: to_accept = released; in_production = accepted, in progress or on hold; ready_to_ship = ' +
      'completed jobs whose order is not delivered yet (see `destinations[].shippedQuantity`); late = at risk',
  })
  @IsOptional()
  @IsIn(['to_accept', 'in_production', 'ready_to_ship', 'late'])
  view?: 'to_accept' | 'in_production' | 'ready_to_ship' | 'late';

  @ApiPropertyOptional({ format: 'uuid', description: 'Jobs of this factory' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ example: 'folding_box' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,59}$/)
  productTypeCode?: string;
}

export class ProductionBoardQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Jobs of this factory' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ example: 'folding_box' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,59}$/)
  productTypeCode?: string;
}

export class BoardColumnDto {
  @ApiProperty({
    example: 'printing',
    description: 'The step open jobs are at; `awaiting_acceptance` before acceptance',
  })
  key!: string;

  @ApiProperty({ example: 'กำลังพิมพ์' })
  labelTh!: string;

  @ApiProperty({ example: 'Printing' })
  labelEn!: string;

  @ApiProperty({ type: 'integer', example: 4 })
  total!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Predicted to miss the promised date (D-075)' })
  atRisk!: number;
}

export class ProductionBoardDto {
  @ApiProperty({ type: [BoardColumnDto], description: 'In route order, then `awaiting_acceptance` first' })
  columns!: BoardColumnDto[];

  @ApiProperty({ type: 'integer', example: 12 })
  total!: number;

  @ApiProperty({ type: 'integer', example: 2 })
  atRisk!: number;
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

  @ApiStatusLabelTh('MilestoneStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('MilestoneStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ enum: EVIDENCE, enumName: 'EvidenceRequirement', example: 'photo' })
  evidence!: string;

  @ApiProperty({ example: true })
  tracksQuantity!: boolean;

  @ApiProperty({ example: true })
  customerVisible!: boolean;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: '2026-10-02T17:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: '2026-10-01T09:00:00+07:00' })
  startedAt!: string | null;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
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
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f2002',
    description: 'Referenced by shipment items (B4.3)',
  })
  id!: string;

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

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  provinceNameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  provinceNameEn!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({
    type: 'integer',
    example: 0,
    description: 'Pieces on live shipments of this job (not cancelled / returned)',
  })
  shippedQuantity!: number;
}

export class JobToleranceDto {
  @ApiProperty({ example: '5.0000', description: 'Shortage accepted, percent (frozen in the quote, D-021)' })
  shortagePct!: string;

  @ApiProperty({ example: '5.0000' })
  overagePct!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.00',
    description: 'Dimensional tolerance ± mm, frozen with the job (D-186); null = none published',
  })
  dimensionalMm!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.00',
    description:
      'Colour tolerance, ΔE2000 against the approved proof, frozen with the job (D-186); null = not printed',
  })
  colourDeltaE!: string | null;
}

export class JobArtworkDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1012' })
  proofId!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-26T15:00:00+07:00' })
  approvedAt!: string | null;
}

export class JobInspectionDto {
  @ApiProperty({
    enum: ['planned', 'in_progress', 'passed', 'failed', 'waived'],
    enumName: 'InspectionStatus',
    example: 'planned',
  })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  scheduledAt!: string | null;

  @ApiProperty({ type: 'integer', example: 80, description: 'Pieces Packio samples (D-076)' })
  sampleSize!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  resultAt!: string | null;
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

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
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

  @ApiStatusLabelTh('ProductionJobStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ProductionJobStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
  releasedAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-28T10:00:00+07:00',
    description: 'Accept within 1 business day (D-074)',
  })
  acceptDueAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  acceptedAt!: string | null;

  @ApiProperty({ format: 'date', type: String, nullable: true, example: '2026-09-28' })
  plannedStartOn!: string | null;

  @ApiProperty({ format: 'date', type: String, nullable: true, example: '2026-10-09' })
  plannedFinishOn!: string | null;

  @ApiProperty({ format: 'date', type: String, nullable: true, example: '2026-10-09' })
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

  @ApiProperty({ example: 'folding_box' })
  productTypeCode!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องพับ' })
  productTypeNameTh!: string | null;

  @ApiProperty({ example: 'กล่องพับ · 1000 ชิ้น', description: 'Short label: product type and quantity' })
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'printing',
    description: 'The first step not done yet',
  })
  currentMilestoneKey!: string | null;

  @ApiProperty({ example: false, description: 'Predicted to miss its promise (D-075)' })
  atRisk!: boolean;

  @ApiProperty({
    enum: ['step_overdue', 'late_plan'],
    enumName: 'JobRiskReason',
    nullable: true,
    example: null,
    description:
      '`step_overdue`: the current step is past due; `late_plan`: the plan already ends after the promise',
  })
  riskReason!: string | null;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  rejectedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReasonCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectNote!: string | null;

  @ApiProperty({
    type: JobToleranceDto,
    nullable: true,
    description: 'Quantity tolerance frozen in the quote (D-021)',
  })
  tolerance!: JobToleranceDto | null;

  @ApiProperty({ type: JobArtworkDto, nullable: true, description: 'The approved proof the job prints' })
  artwork!: JobArtworkDto | null;

  @ApiProperty({
    type: JobInspectionDto,
    nullable: true,
    description: 'Packio’s inspection when one is planned (D-076)',
  })
  inspection!: JobInspectionDto | null;

  @ApiProperty({ type: [JobDestinationDto] })
  destinations!: JobDestinationDto[];

  @ApiProperty({ type: [MilestoneDto] })
  milestones!: MilestoneDto[];

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in user may do on the job now (U-B0.3)',
  })
  nextActions!: NextActionDto[];
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

  @ApiProperty({
    format: 'date-time',
    type: String,
    nullable: true,
    example: null,
    description: 'Escalated to the Partner team / CS (D-074, D-012)',
  })
  escalatedAt!: string | null;

  @ApiProperty({ format: 'date', type: String, nullable: true, example: null })
  predictedFinishOn!: string | null;

  @ApiProperty({ type: [String], example: [], description: 'Why Packio inspects (D-076)' })
  inspectionReasons!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The factory’s net buy price of the job. D-141: only with `factory_buy_prices.read`',
  })
  buyPriceNet!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    deprecated: true,
    description: 'Deprecated: the same value as `buyPriceNet` (D-042 terminology)',
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
  ...statusLabels('MilestoneStatus', 'in_progress'),
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
  ...statusLabels('ProductionJobStatus', 'released'),
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
  productTypeCode: 'folding_box',
  productTypeNameTh: 'กล่องพับ',
  title: 'กล่องพับ · 1000 ชิ้น',
  currentMilestoneKey: 'printing',
  atRisk: false,
  riskReason: null,
  rejectedAt: null,
  rejectReasonCode: null,
  rejectNote: null,
  tolerance: { shortagePct: '5.0000', overagePct: '5.0000', dimensionalMm: '1.00', colourDeltaE: '3.00' },
  artwork: {
    proofId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1012',
    versionNo: 2,
    approvedAt: '2026-09-26T15:00:00+07:00',
  },
  inspection: null,
  destinations: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000f2002',
      recipientName: 'ผู้รับ ทดสอบ',
      phone: '+66810001234',
      line1: '1 ถนนทดสอบ',
      line2: null,
      postcode: '10110',
      provinceNameTh: 'กรุงเทพมหานคร',
      provinceNameEn: 'Bangkok',
      quantity: 1000,
      shippedQuantity: 0,
    },
  ],
  milestones: [MILESTONE_EXAMPLE],
  nextActions: [{ key: 'job.update_milestone', irreversible: false, disabledReason: null }],
};

export const ADMIN_JOB_EXAMPLE: AdminJobDto = {
  ...PARTNER_JOB_EXAMPLE,
  orderId: JOB_IDS.order,
  orderCode: 'DEVOR-2609-00001',
  factoryId: JOB_IDS.factory,
  factoryCode: 'F9001',
  releaseMode: 'auto',
  releaseReason: null,
  escalatedAt: null,
  predictedFinishOn: null,
  inspectionReasons: [],
  buyPriceNet: null,
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

// --- milestones, QC, issues (B4.2 slice 3) ----------------------------------------------------------

export class UpdateMilestoneDto {
  @ApiProperty({ enum: ['start', 'complete'], enumName: 'MilestoneAction', example: 'complete' })
  @IsIn(['start', 'complete'])
  action!: 'start' | 'complete';

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    example: 1050,
    description: 'Pieces that entered the step',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityIn?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    example: 1020,
    description: 'Good pieces out (required to complete a step that tracks quantities)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityOut?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityScrap?: number;

  @ApiPropertyOptional({ example: 'พิมพ์เสร็จ สีตรงตาม Proof', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [JOB_IDS.file],
    description: 'Photos uploaded through `partner.files`',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description: 'Let the customer see these photos (customer-visible steps only)',
  })
  @IsOptional()
  @IsBoolean()
  shareWithCustomer?: boolean;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1101',
    description: 'The device’s id of this update (replays change nothing)',
  })
  @IsUUID()
  clientRef!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-10-01T15:04:00+07:00',
    description: 'When the device recorded it',
  })
  @IsOptional()
  @IsISO8601()
  clientReportedAt?: string;
}

export class MilestoneUpdateResultDto {
  @ApiProperty({ example: true, description: 'false when the server’s state won (replay or stale update)' })
  applied!: boolean;

  @ApiProperty({
    enum: ['duplicate', 'already_started', 'already_completed', 'skipped'],
    enumName: 'MilestoneUpdateOutcome',
    nullable: true,
    example: null,
  })
  reason!: string | null;

  @ApiProperty({ type: PartnerJobDto })
  job!: PartnerJobDto;
}

export class QcDefectDto {
  @ApiProperty({ example: 'color_shift', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ enum: ['critical', 'major', 'minor'], enumName: 'DefectSeverity', example: 'minor' })
  @IsIn(['critical', 'major', 'minor'])
  severity!: 'critical' | 'major' | 'minor';

  @ApiProperty({ type: 'integer', minimum: 0, example: 3 })
  @IsInt()
  @Min(0)
  count!: number;

  @ApiPropertyOptional({ example: 'สีเพี้ยนเล็กน้อย', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordQcDto {
  @ApiProperty({ example: 'folding-v1', maxLength: 64, description: 'Which checklist the factory used' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  checklistVersion!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { colour: 'ok', dimensions: 'ok', gluing: 'ok' },
  })
  @IsObject()
  checklist!: Record<string, unknown>;

  @ApiProperty({ enum: ['pass', 'fail', 'conditional'], enumName: 'QcResult', example: 'pass' })
  @IsIn(['pass', 'fail', 'conditional'])
  result!: 'pass' | 'fail' | 'conditional';

  @ApiPropertyOptional({ type: [QcDefectDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QcDefectDto)
  defects?: QcDefectDto[];

  @ApiPropertyOptional({ type: 'integer', minimum: 0, example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityChecked?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityDefective?: number;

  @ApiPropertyOptional({ example: 'ผ่าน', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [JOB_IDS.file],
    description: 'At least one photo (D-076)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  photoFileIds!: string[];
}

export class QcCheckDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.milestone })
  id!: string;

  @ApiProperty({ example: 'folding-v1' })
  checklistVersion!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { colour: 'ok' } })
  checklist!: Record<string, unknown>;

  @ApiProperty({ enum: ['pass', 'fail', 'conditional'], enumName: 'QcResult', example: 'pass' })
  result!: string;

  @ApiProperty({ example: true, description: 'The job’s first QC and it passed (scorecard, D-155)' })
  isFirstPass!: boolean;

  @ApiProperty({ type: [QcDefectDto] })
  defects!: QcDefectDto[];

  @ApiProperty({ type: 'integer', nullable: true, example: 80 })
  quantityChecked!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  quantityDefective!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  performedAt!: string;

  @ApiProperty({ type: [String], format: 'uuid', example: [JOB_IDS.file] })
  photoFileIds!: string[];

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Who recorded the check' })
  performedBy!: UserRefDto | null;
}

export const JOB_ISSUE_KINDS = [
  'material_shortage',
  'machine_down',
  'artwork_question',
  'quantity',
  'quality',
  'delay',
  'other',
] as const;

export class RaiseIssueDto {
  @ApiProperty({ enum: JOB_ISSUE_KINDS, enumName: 'JobIssueKind', example: 'material_shortage' })
  @IsIn(JOB_ISSUE_KINDS)
  kind!: (typeof JOB_ISSUE_KINDS)[number];

  @ApiProperty({ example: 'กระดาษอาร์ตการ์ดขาดสต็อก รอของ 2 วัน', minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class JobIssueDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.milestone })
  id!: string;

  @ApiProperty({ example: 'material_shortage' })
  kind!: string;

  @ApiProperty({ example: 'กระดาษอาร์ตการ์ดขาดสต็อก รอของ 2 วัน' })
  description!: string;

  @ApiProperty({ enum: ['open', 'resolved'], enumName: 'IssueStatus', example: 'open' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-02T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  resolvedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  resolutionNote!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  raisedBy!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  resolvedBy!: UserRefDto | null;

  @ApiProperty({ type: [String], format: 'uuid', example: [] })
  photoFileIds!: string[];
}

export class ResolveIssueDto {
  @ApiProperty({ example: 'เลื่อนวันส่งกับลูกค้าแล้ว', minLength: 3, maxLength: 1500 })
  @IsString()
  @MinLength(3)
  @MaxLength(1500)
  note!: string;
}

export class HoldJobDto {
  @ApiProperty({ example: 'ลูกค้าขอพักงานเพื่อแก้ไฟล์', minLength: 3, maxLength: 700 })
  @IsString()
  @MinLength(3)
  @MaxLength(700)
  reason!: string;
}

// --- milestone routes (D-075) ------------------------------------------------------------------------

export class RouteStepInputDto {
  @ApiProperty({ example: 'printing', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(64)
  key!: string;

  @ApiProperty({ example: 'พิมพ์' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameTh!: string;

  @ApiProperty({ example: 'Printing' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'กำลังพิมพ์', description: 'Set to show the step to customers' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerLabelTh?: string;

  @ApiPropertyOptional({ example: 'Printing' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerLabelEn?: string;

  @ApiPropertyOptional({ enum: EVIDENCE, enumName: 'EvidenceRequirement', example: 'photo' })
  @IsOptional()
  @IsIn(EVIDENCE)
  evidence?: (typeof EVIDENCE)[number];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  tracksQuantity?: boolean;

  @ApiPropertyOptional({
    example: '20',
    description: 'Share of the planned time (percent); omit to spread evenly',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  plannedSharePct?: string;
}

export class CreateMilestoneRouteDto {
  @ApiProperty({ example: 'folding_carton' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiPropertyOptional({ format: 'uuid', example: JOB_IDS.proof })
  @IsOptional()
  @IsUUID()
  printTypeId?: string;

  @ApiProperty({ example: 'digital', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(32)
  variant!: string;

  @ApiProperty({ example: 'กล่องพิมพ์ดิจิทัล' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class AddRouteVersionDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty({ example: 'เพิ่มขั้นตอนเคลือบ UV', minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ type: [RouteStepInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RouteStepInputDto)
  steps!: RouteStepInputDto[];
}

export class RouteStepDto {
  @ApiProperty({ type: 'integer', example: 4 })
  seq!: number;

  @ApiProperty({ example: 'printing' })
  key!: string;

  @ApiProperty({ example: 'พิมพ์' })
  nameTh!: string;

  @ApiProperty({ example: 'Printing' })
  nameEn!: string;

  @ApiProperty({ example: true })
  customerVisible!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'กำลังพิมพ์' })
  customerLabelTh!: string | null;

  @ApiProperty({ enum: EVIDENCE, enumName: 'EvidenceRequirement', example: 'photo' })
  evidence!: string;

  @ApiProperty({ example: true })
  tracksQuantity!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  plannedSharePct!: string | null;
}

export class RouteVersionDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({
    enum: ['draft', 'proposed', 'pending_acceptance', 'approved', 'rejected', 'withdrawn'],
    enumName: 'ConfigVersionStatus',
    example: 'approved',
  })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'B4.2 default route' })
  reason!: string;

  @ApiProperty({ type: [RouteStepDto] })
  steps!: RouteStepDto[];
}

export class MilestoneRouteDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.job })
  id!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  printTypeId!: string | null;

  @ApiProperty({ example: 'standard' })
  variant!: string;

  @ApiProperty({ example: 'กล่องกระดาษแข็ง (standard)' })
  name!: string;

  @ApiProperty({ type: [RouteVersionDto], description: 'Newest first' })
  versions!: RouteVersionDto[];
}

// --- factory users (owner) ------------------------------------------------------------------------------

export const FACTORY_STAFF_ROLES = [
  'factory_planner',
  'factory_operator',
  'factory_qc',
  'factory_shipping',
  'factory_accountant',
  'factory_storekeeper',
  'factory_purchaser',
  'factory_maintenance',
] as const;

export class CreateFactoryUserDto {
  @ApiProperty({ example: 'planner@factory.example.invalid' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'ผู้วางแผน ทดสอบ' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 12,
    description: 'Handed over out of band; changed at first sign-in',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  initialPassword!: string;

  @ApiProperty({
    enum: FACTORY_STAFF_ROLES,
    enumName: 'FactoryStaffRole',
    isArray: true,
    example: ['factory_planner'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(FACTORY_STAFF_ROLES, { each: true })
  roles!: (typeof FACTORY_STAFF_ROLES)[number][];
}

/** A user's membership of the factory (U-B0.3): deactivated = every factory role revoked. */
export const FACTORY_USER_STATUSES = ['active', 'deactivated'] as const;

export class FactoryUserDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.factory })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'planner@factory.example.invalid' })
  email!: string | null;

  @ApiProperty({ example: 'ผู้วางแผน ทดสอบ' })
  displayName!: string;

  @ApiProperty({
    enum: FACTORY_ROLES,
    enumName: 'FactoryRole',
    isArray: true,
    example: ['factory_planner'],
    description: 'The factory roles held; for a deactivated user, the roles it held when deactivated',
  })
  roles!: string[];

  @ApiProperty({ enum: FACTORY_USER_STATUSES, enumName: 'FactoryUserStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T08:15:00+07:00' })
  lastSignInAt!: string | null;

  @ApiProperty({ example: false, description: 'The signed-in user' })
  isSelf!: boolean;
}

export class FactoryUserListQuery {
  @ApiPropertyOptional({
    enum: FACTORY_USER_STATUSES,
    enumName: 'FactoryUserStatus',
    description: 'Default `active`',
  })
  @IsOptional()
  @IsIn(FACTORY_USER_STATUSES)
  status?: (typeof FACTORY_USER_STATUSES)[number];
}

export class SetFactoryUserRolesDto {
  @ApiProperty({
    enum: FACTORY_STAFF_ROLES,
    enumName: 'FactoryStaffRole',
    isArray: true,
    example: ['factory_planner', 'factory_qc'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FACTORY_STAFF_ROLES.length)
  @IsIn(FACTORY_STAFF_ROLES, { each: true })
  roles!: (typeof FACTORY_STAFF_ROLES)[number][];
}

export const QC_EXAMPLE: QcCheckDto = {
  id: JOB_IDS.milestone,
  checklistVersion: 'folding-v1',
  checklist: { colour: 'ok' },
  result: 'pass',
  isFirstPass: true,
  defects: [],
  quantityChecked: 80,
  quantityDefective: 0,
  note: null,
  performedAt: '2026-10-05T10:00:00+07:00',
  photoFileIds: [JOB_IDS.file],
  performedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f1013', displayName: 'QC โรงงาน (fake)' },
};

export const ISSUE_EXAMPLE: JobIssueDto = {
  id: JOB_IDS.milestone,
  kind: 'material_shortage',
  description: 'กระดาษอาร์ตการ์ดขาดสต็อก รอของ 2 วัน',
  status: 'open',
  createdAt: '2026-10-02T10:00:00+07:00',
  resolvedAt: null,
  resolutionNote: null,
  raisedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f1013', displayName: 'วางแผน โรงงาน (fake)' },
  resolvedBy: null,
  photoFileIds: [],
};

export const ROUTE_EXAMPLE: MilestoneRouteDto = {
  id: JOB_IDS.job,
  productTypeCode: 'folding_carton',
  printTypeId: null,
  variant: 'standard',
  name: 'กล่องกระดาษแข็ง (standard)',
  versions: [
    {
      versionNo: 1,
      status: 'approved',
      effectiveFrom: '2026-01-01T00:00:00+07:00',
      reason: 'B4.2 default route',
      steps: [
        {
          seq: 1,
          key: 'job_received',
          nameTh: 'รับงาน',
          nameEn: 'Job received',
          customerVisible: true,
          customerLabelTh: 'โรงงานรับงานแล้ว',
          evidence: 'none',
          tracksQuantity: false,
          plannedSharePct: null,
        },
      ],
    },
  ],
};

export const ADD_ROUTE_VERSION_EXAMPLE = {
  effectiveFrom: '2026-10-01T00:00:00+07:00',
  reason: 'เพิ่มขั้นตอนเคลือบ UV',
  steps: [
    { key: 'job_received', nameTh: 'รับงาน', nameEn: 'Job received', customerLabelTh: 'โรงงานรับงานแล้ว' },
    { key: 'printing', nameTh: 'พิมพ์', nameEn: 'Printing', evidence: 'photo', tracksQuantity: true },
    { key: 'ready_to_ship', nameTh: 'พร้อมส่ง', nameEn: 'Ready to ship', customerLabelTh: 'พร้อมจัดส่ง' },
  ],
};

// --- inspections & scorecards (B4.2 slice 4) ---------------------------------------------------------

export const INSPECTION_STATUSES = ['planned', 'in_progress', 'passed', 'failed', 'waived'] as const;
export const INSPECTION_REASONS = [
  'value_100_pct',
  'value_band_sample',
  'trial_factory',
  'high_defect_factory',
  'special_finish_or_food',
] as const;

export class InspectionListQuery {
  @ApiPropertyOptional({ enum: INSPECTION_STATUSES, enumName: 'InspectionStatus' })
  @IsOptional()
  @IsIn(INSPECTION_STATUSES)
  status?: (typeof INSPECTION_STATUSES)[number];

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage: number = 25;

  @ApiPropertyOptional({ format: 'uuid', description: 'Inspections of this factory’s jobs' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

export class ScheduleInspectionDto {
  @ApiPropertyOptional({ format: 'uuid', example: JOB_IDS.factory, description: 'Defaults to you' })
  @IsOptional()
  @IsUUID()
  inspectorUserId?: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-08T10:00:00+07:00' })
  @IsISO8601()
  scheduledAt!: string;
}

export class RecordInspectionDto {
  @ApiProperty({ type: 'integer', minimum: 0, example: 0 })
  @IsInt()
  @Min(0)
  foundCritical!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  @IsInt()
  @Min(0)
  foundMajor!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  foundMinor!: number;

  @ApiPropertyOptional({ example: 'สุ่มตรวจ 80 ชิ้น พบตำหนิเล็กน้อย 2 ชิ้น', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class DefectCountsDto {
  @ApiProperty({ type: 'integer', example: 0 })
  critical!: number;

  @ApiProperty({ type: 'integer', example: 5 })
  major!: number;

  @ApiProperty({ type: 'integer', example: 7 })
  minor!: number;
}

export class AqlLevelsDto {
  @ApiProperty({ example: '0' })
  critical!: string;

  @ApiProperty({ example: '2.5' })
  major!: string;

  @ApiProperty({ example: '4.0' })
  minor!: string;
}

export class InspectionDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.milestone })
  id!: string;

  @ApiProperty({ format: 'uuid', example: JOB_IDS.job })
  jobId!: string;

  @ApiProperty({ example: 'JOB-2609-00001' })
  jobNo!: string;

  @ApiProperty({ example: 'F9001' })
  factoryCode!: string;

  @ApiProperty({ enum: INSPECTION_STATUSES, enumName: 'InspectionStatus', example: 'planned' })
  status!: string;

  @ApiProperty({
    enum: INSPECTION_REASONS,
    enumName: 'InspectionReason',
    isArray: true,
    example: ['trial_factory'],
  })
  reasons!: string[];

  @ApiProperty({ example: '100.0000', description: 'Probability the reasons gave (percent)' })
  ratePct!: string;

  @ApiProperty({ example: true, description: 'Drawn for inspection' })
  selected!: boolean;

  @ApiProperty({ type: 'integer', example: 1000 })
  lotSize!: number;

  @ApiProperty({ type: 'integer', example: 80, description: 'ISO 2859-1 level II sample' })
  sampleSize!: number;

  @ApiProperty({ type: () => DefectCountsDto, description: 'Acceptance numbers per class' })
  accept!: DefectCountsDto;

  @ApiProperty({ type: () => DefectCountsDto, nullable: true, description: 'Defects found per class' })
  found!: DefectCountsDto | null;

  @ApiProperty({ type: () => AqlLevelsDto, description: 'AQL per class the plan used (D-076)' })
  aql!: AqlLevelsDto;

  @ApiProperty({ format: 'uuid', example: JOB_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'DEVOR-2609-00001' })
  orderCode!: string;

  @ApiProperty({ example: 'folding_box' })
  productTypeCode!: string;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'The scheduled inspector' })
  inspectorUser!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  scheduledAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  inspector!: string | null;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  resultAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  notes!: string | null;
}

export class ScorecardDto {
  @ApiProperty({ format: 'date', example: '2026-09-01', description: 'First day of the month' })
  month!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '95.0000',
    description: 'Accepted within the SLA, % of released jobs',
  })
  onTimeAcceptancePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '90.0000',
    description: 'First pickup by the promised ship date, % of jobs first shipped in the month',
  })
  onTimeShippingPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '98.0000' })
  qcFirstPassPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.0000' })
  claimRatePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '92.0000',
    description: 'Milestones completed by their due time',
  })
  onTimeUpdatesPct!: string | null;

  @ApiProperty({ type: 'integer', example: 20 })
  jobsCount!: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Sample jobs completed in the month (D-259)' })
  sampleJobsCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '100.0000',
    description: 'Sample jobs completed by their planned finish (D-259)',
  })
  sampleOnTimePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4.50',
    description: 'Average days from release to completion of the sample jobs (D-259)',
  })
  sampleAvgLeadDays!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T02:00:00+07:00' })
  computedAt!: string;
}

export class RecomputeScorecardDto {
  @ApiProperty({ example: '2026-09-01', pattern: '^\\d{4}-\\d{2}-01$' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-01$/)
  month!: string;
}

export const INSPECTION_EXAMPLE: InspectionDto = {
  id: JOB_IDS.milestone,
  jobId: JOB_IDS.job,
  jobNo: 'JOB-2609-00001',
  factoryCode: 'F9001',
  status: 'planned',
  reasons: ['trial_factory'],
  ratePct: '100.0000',
  selected: true,
  lotSize: 1000,
  sampleSize: 80,
  accept: { critical: 0, major: 5, minor: 7 },
  found: null,
  aql: { critical: '0', major: '2.5', minor: '4.0' },
  orderId: JOB_IDS.order,
  orderCode: 'DEVOR-2609-00001',
  productTypeCode: 'folding_box',
  inspectorUser: null,
  scheduledAt: null,
  inspector: null,
  resultAt: null,
  notes: null,
};

export class ScorecardMonthQuery {
  @ApiProperty({ example: '2026-09', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Month (Bangkok)' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class FactoryScorecardDto extends ScorecardDto {
  @ApiProperty({ type: FactoryRefDto })
  factory!: FactoryRefDto;
}

export const SCORECARD_EXAMPLE: ScorecardDto = {
  month: '2026-09-01',
  onTimeAcceptancePct: '95.0000',
  onTimeShippingPct: '90.0000',
  qcFirstPassPct: '98.0000',
  claimRatePct: '0.0000',
  onTimeUpdatesPct: '92.0000',
  jobsCount: 20,
  sampleJobsCount: 2,
  sampleOnTimePct: '100.0000',
  sampleAvgLeadDays: '4.50',
  computedAt: '2026-10-01T02:00:00+07:00',
};

// --- U-B0.3: shop floor ------------------------------------------------------------------------------------

export class JobLookupQuery {
  @ApiProperty({
    example: 'JOB-2609-00001',
    minLength: 3,
    maxLength: 64,
    description: 'Job no., job id or a carton label code',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  code!: string;
}

export class JobLookupDto {
  @ApiProperty({ format: 'uuid', example: JOB_IDS.job })
  jobId!: string;

  @ApiProperty({ example: 'JOB-2609-00001' })
  jobNo!: string;
}

export class ScorecardQuery {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 24,
    default: 12,
    description: 'Latest months',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}

export class FactoryTodayCountersDto {
  @ApiProperty({ type: 'integer', example: 2, description: 'Released jobs to accept (D-074)' })
  awaitingAcceptance!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Of those, past the acceptance deadline' })
  acceptanceOverdue!: number;

  @ApiProperty({ type: 'integer', example: 3, description: 'Steps due today (Asia/Bangkok)' })
  milestonesDueToday!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  atRisk!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  onHold!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Packio inspections planned or in progress (D-076)',
  })
  inspectionsPlanned!: number;
}

export class FactoryTodayAlertDto {
  @ApiProperty({
    enum: ['acceptance_overdue', 'acceptance_due_soon', 'step_overdue', 'inspection_planned'],
    enumName: 'FactoryAlertKind',
    example: 'acceptance_due_soon',
  })
  kind!: string;

  @ApiProperty({ format: 'uuid', example: JOB_IDS.job })
  jobId!: string;

  @ApiProperty({ example: 'JOB-2609-00001' })
  jobNo!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-28T10:00:00+07:00' })
  dueAt!: string | null;
}

export class FactoryTodayDto {
  @ApiProperty({ type: FactoryTodayCountersDto })
  counters!: FactoryTodayCountersDto;

  @ApiProperty({ type: [FactoryTodayAlertDto] })
  alerts!: FactoryTodayAlertDto[];

  @ApiProperty({
    type: [PartnerJobDto],
    description: 'Work queue, at most 20: jobs to accept by deadline, then at-risk, then steps due today',
  })
  queue!: PartnerJobDto[];
}
