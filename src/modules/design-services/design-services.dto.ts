import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Hired design (D-071). */

export const DESIGN_SERVICE_STATUSES = [
  'brief_pending',
  'in_progress',
  'delivered',
  'revision_requested',
  'approved',
  'cancelled',
  'requoted',
] as const;
export const DESIGN_ROUND_STATUSES = [
  'awaiting_payment',
  'in_progress',
  'delivered',
  'approved',
  'changes_requested',
] as const;
const MONEY = /^\d{1,12}\.\d{2}$/;

export const DS_IDS = {
  request: '0192f3a0-7c1e-7d2a-9b1f-0000000e3001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000e3002',
  round: '0192f3a0-7c1e-7d2a-9b1f-0000000e3003',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000e3004',
  submission: '0192f3a0-7c1e-7d2a-9b1f-0000000e3005',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000e3006',
  vendor: '0192f3a0-7c1e-7d2a-9b1f-0000000e3007',
  instalment: '0192f3a0-7c1e-7d2a-9b1f-0000000e3008',
};

export class DesignBriefDto {
  @ApiProperty({ example: 'ร้านกาแฟทดสอบ', maxLength: 200, description: 'Legacy `brd_brand_name`' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  brandName!: string;

  @ApiProperty({ example: 'เครื่องดื่ม', maxLength: 200, description: 'Legacy `brd_brand_category`' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  brandCategory!: string;

  @ApiProperty({
    example: 'กล่องโทนมินิมอล สีครีม มีโลโก้ด้านหน้า',
    maxLength: 5000,
    description: 'Legacy `brd_description`',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [DS_IDS.file],
    description: 'Logos and references you uploaded',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  attachmentFileIds?: string[];
}

export class ConfirmExtraRoundDto {
  @ApiProperty({
    example: '535.00',
    description:
      'The fee incl. VAT the customer agrees to (from `nextRevision.feeGross`); refused if it changed',
  })
  @IsString()
  @Matches(MONEY)
  expectedFeeGross!: string;

  @ApiProperty({ example: 'ขอเปลี่ยนสีตัวอักษรเป็นสีทอง', minLength: 3, maxLength: 4000 })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  changeRequest!: string;
}

export class AssignDesignerDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: DS_IDS.user,
    description: 'A Packio designer (staff user)',
  })
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: null,
    nullable: true,
    description: 'A freelance designer (vendor of kind freelancer)',
  })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

export class DeliverDesignDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [DS_IDS.file],
    description: 'The designed artwork (uploads with purpose `artwork`)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds!: string[];

  @ApiPropertyOptional({ example: 'แบบรอบแรกตามบรีฟ', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CloseDesignServiceDto {
  @ApiProperty({
    example: 'ลูกค้าต้องการเปลี่ยนโครงสร้างกล่อง ต้องเสนอราคาออกแบบใหม่',
    minLength: 3,
    maxLength: 1500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1500)
  reason!: string;
}

export class DesignServiceListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: DESIGN_SERVICE_STATUSES, enumName: 'DesignServiceStatus' })
  @IsOptional()
  @IsIn(DESIGN_SERVICE_STATUSES)
  status?: (typeof DESIGN_SERVICE_STATUSES)[number];

  @ApiPropertyOptional({
    enum: ['me'],
    enumName: 'AssigneeFilter',
    description: '`me`: assigned to the signed-in user',
  })
  @IsOptional()
  @IsIn(['me'])
  assignee?: 'me';
}

export class DesignRoundDto {
  @ApiProperty({ format: 'uuid', example: DS_IDS.round })
  id!: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Round 1 is the initial design; later rounds are revisions',
  })
  roundNo!: number;

  @ApiProperty({ enum: ['initial', 'revision'], enumName: 'DesignRoundKind', example: 'initial' })
  kind!: string;

  @ApiProperty({ example: false })
  chargeable!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Fee net of VAT (THB)' })
  feeNet!: string | null;

  @ApiProperty({ enum: DESIGN_ROUND_STATUSES, enumName: 'DesignRoundStatus', example: 'in_progress' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  changeRequest!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The artwork version delivered',
  })
  submissionId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The instalment paying a chargeable round',
  })
  instalmentId!: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  requestedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-27T10:00:00+07:00' })
  startedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  deliveredAt!: string | null;
}

export class NextRevisionDto {
  @ApiProperty({
    type: 'integer',
    example: 4,
    description: 'Revision number (the initial design is not a revision)',
  })
  revisionNo!: number;

  @ApiProperty({ example: true })
  chargeable!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '500.00',
    description: 'max(minimum, % of the design fee), net (D-071)',
  })
  feeNet!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '535.00', description: 'Incl. VAT' })
  feeGross!: string | null;
}

export class DesignBriefViewDto {
  @ApiProperty({ example: 'ร้านกาแฟทดสอบ' })
  brandName!: string;

  @ApiProperty({ example: 'เครื่องดื่ม' })
  brandCategory!: string;

  @ApiProperty({ example: 'กล่องโทนมินิมอล สีครีม มีโลโก้ด้านหน้า' })
  description!: string;

  @ApiProperty({ type: [String], format: 'uuid', example: [DS_IDS.file] })
  attachmentFileIds!: string[];
}

export class DesignServiceDto {
  @ApiProperty({ format: 'uuid', example: DS_IDS.request })
  id!: string;

  @ApiProperty({ format: 'uuid', example: DS_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR2609270001' })
  orderCode!: string;

  @ApiProperty({ enum: DESIGN_SERVICE_STATUSES, enumName: 'DesignServiceStatus', example: 'in_progress' })
  status!: string;

  @ApiProperty({ type: DesignBriefViewDto, nullable: true })
  brief!: DesignBriefViewDto | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-27T09:00:00+07:00' })
  briefSubmittedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Staff only; null on the store surface' })
  assignee!: UserRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-10-04T10:00:00+07:00',
    description: '5 business days from the start (D-071)',
  })
  targetDueAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-10-11T10:00:00+07:00',
    description: '10 business days from the start (D-071)',
  })
  maxDueAt!: string | null;

  @ApiProperty({
    enum: ['not_started', 'on_track', 'target_missed', 'max_breached', 'closed'],
    enumName: 'DesignDueState',
    example: 'on_track',
  })
  dueState!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  freeRounds!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Revision rounds opened so far' })
  revisionsUsed!: number;

  @ApiProperty({
    example: '1500.00',
    description: 'The order’s design fee, net of VAT (basis of the extra-round fee)',
  })
  designFeeNet!: string;

  @ApiProperty({
    type: NextRevisionDto,
    nullable: true,
    description: 'What the next revision costs, once changes are requested',
  })
  nextRevision!: NextRevisionDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  closeReason!: string | null;

  @ApiProperty({ type: [DesignRoundDto] })
  rounds!: DesignRoundDto[];
}

export const DESIGN_SERVICE_EXAMPLE: DesignServiceDto = {
  id: DS_IDS.request,
  orderId: DS_IDS.order,
  orderCode: 'OR2609270001',
  status: 'in_progress',
  brief: {
    brandName: 'ร้านกาแฟทดสอบ',
    brandCategory: 'เครื่องดื่ม',
    description: 'กล่องโทนมินิมอล สีครีม มีโลโก้ด้านหน้า',
    attachmentFileIds: [DS_IDS.file],
  },
  briefSubmittedAt: '2026-09-27T09:00:00+07:00',
  assignee: null,
  targetDueAt: '2026-10-04T10:00:00+07:00',
  maxDueAt: '2026-10-11T10:00:00+07:00',
  dueState: 'on_track',
  freeRounds: 3,
  revisionsUsed: 0,
  designFeeNet: '1500.00',
  nextRevision: null,
  closeReason: null,
  rounds: [
    {
      id: DS_IDS.round,
      roundNo: 1,
      kind: 'initial',
      chargeable: false,
      feeNet: null,
      status: 'in_progress',
      changeRequest: null,
      submissionId: null,
      instalmentId: null,
      requestedAt: '2026-09-27T10:00:00+07:00',
      startedAt: '2026-09-27T10:00:00+07:00',
      deliveredAt: null,
    },
  ],
};
