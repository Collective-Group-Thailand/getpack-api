import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Proofs, annotations and templates (D-070, D-073). */

export const PROOF_STATUSES = ['pending_customer', 'approved', 'changes_requested', 'superseded'] as const;
export const DECISION_CHANNELS = ['web', 'line_liff', 'cs_on_behalf'] as const;
export const ANNOTATION_KINDS = ['pin', 'rect', 'draw'] as const;
export const CONFIRMED_VIA = ['phone', 'line', 'email', 'in_person'] as const;

export const PROOF_IDS = {
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000e2001',
  proof: '0192f3a0-7c1e-7d2a-9b1f-0000000e2002',
  previous: '0192f3a0-7c1e-7d2a-9b1f-0000000e2003',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000e2004',
  dieline: '0192f3a0-7c1e-7d2a-9b1f-0000000e2005',
  submission: '0192f3a0-7c1e-7d2a-9b1f-0000000e2006',
  annotation: '0192f3a0-7c1e-7d2a-9b1f-0000000e2007',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000e2008',
  approved: '0192f3a0-7c1e-7d2a-9b1f-0000000e2009',
  delivery: '0192f3a0-7c1e-7d2a-9b1f-0000000e200a',
};

export class SendProofDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: PROOF_IDS.submission,
    description: 'The accepted submission this proof answers; defaults to the latest accepted one',
  })
  @IsOptional()
  @IsUUID()
  submissionId?: string;

  @ApiProperty({
    format: 'uuid',
    example: PROOF_IDS.file,
    description: 'The proof (PDF or image) Prepress uploaded',
  })
  @IsUUID()
  proofFileId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: PROOF_IDS.dieline,
    description: 'The dieline overlay, if separate',
  })
  @IsOptional()
  @IsUUID()
  dielineFileId?: string;

  @ApiPropertyOptional({
    example: 'ขยายโลโก้ตามที่ลูกค้าขอ',
    maxLength: 2000,
    description: 'What changed since the previous version',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeNote?: string;
}

export class AnnotateProofDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: null,
    nullable: true,
    description: 'Reply to this annotation',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 999,
    example: 1,
    description: 'Required for a new annotation; a reply (`parentId`) takes its parent’s',
  })
  @ValidateIf((o: AnnotateProofDto) => !o.parentId || o.page !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  page?: number;

  @ApiPropertyOptional({
    enum: ANNOTATION_KINDS,
    enumName: 'AnnotationKind',
    example: 'pin',
    description: 'Required for a new annotation; a reply takes its parent’s',
  })
  @ValidateIf((o: AnnotateProofDto) => !o.parentId || o.kind !== undefined)
  @IsIn(ANNOTATION_KINDS)
  kind?: (typeof ANNOTATION_KINDS)[number];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { x: 0.42, y: 0.31 },
    description:
      'Page-relative (0–1) coordinates: pin `{x,y}`, rect `{x,y,w,h}`, draw `{points:[[x,y],…]}` (≤ 500 points). Required for a new annotation; a reply takes its parent’s',
  })
  @ValidateIf((o: AnnotateProofDto) => !o.parentId || o.geometry !== undefined)
  @IsObject()
  geometry?: Record<string, unknown>;

  @ApiProperty({ example: 'ขอโลโก้ใหญ่ขึ้นอีกนิด', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment!: string;
}

export class RequestChangesDto {
  @ApiProperty({ example: 'สีพื้นหลังเข้มเกินไป ขอโทนอ่อนลง', minLength: 3, maxLength: 4000 })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  comment!: string;
}

export class DecideOnBehalfDto {
  @ApiProperty({ example: 'ลูกค้ายืนยันทางโทรศัพท์ว่าอนุมัติแบบ', minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({
    enum: CONFIRMED_VIA,
    enumName: 'CustomerConfirmationChannel',
    example: 'phone',
    description: 'How the customer confirmed',
  })
  @IsIn(CONFIRMED_VIA)
  confirmedVia!: (typeof CONFIRMED_VIA)[number];

  @ApiPropertyOptional({
    example: 'สีพื้นหลังเข้มเกินไป',
    maxLength: 4000,
    description: 'Required when requesting changes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

export class SendTemplateDto {
  @ApiProperty({
    format: 'uuid',
    example: PROOF_IDS.dieline,
    description: 'The template / dieline file Prepress uploaded',
  })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({ example: 'แบบแปลนกล่องขนาด 100×100×50 มม. พร้อมระยะตัดตก 3 มม.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AnnotationAuthorDto {
  @ApiProperty({ enum: ['customer', 'staff'], enumName: 'AnnotationAuthorKind', example: 'customer' })
  kind!: string;

  @ApiProperty({
    example: 'ลูกค้า ทดสอบ',
    description: 'Customer name, or "Packio" on the store surface for staff',
  })
  displayName!: string;
}

export class AnnotationDto {
  @ApiProperty({ format: 'uuid', example: PROOF_IDS.annotation })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  parentId!: string | null;

  @ApiProperty({ type: 'integer', example: 1 })
  page!: number;

  @ApiProperty({ enum: ANNOTATION_KINDS, enumName: 'AnnotationKind', example: 'pin' })
  kind!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { x: 0.42, y: 0.31 } })
  geometry!: Record<string, unknown>;

  @ApiProperty({ example: 'ขอโลโก้ใหญ่ขึ้นอีกนิด' })
  comment!: string;

  @ApiProperty({ type: AnnotationAuthorDto })
  author!: AnnotationAuthorDto;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  resolvedAt!: string | null;

  @ApiProperty({ type: AnnotationAuthorDto, nullable: true, description: 'Who resolved it' })
  resolvedBy!: AnnotationAuthorDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T11:00:00+07:00' })
  createdAt!: string;
}

export class ProofFileDto {
  @ApiProperty({ format: 'uuid', example: PROOF_IDS.file })
  id!: string;

  @ApiProperty({ example: 'proof-v2.pdf' })
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  pageCount!: number | null;
}

export class ProofCompareDto {
  @ApiProperty({ format: 'uuid', example: PROOF_IDS.previous })
  previousProofId!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  previousVersionNo!: number;

  @ApiProperty({ format: 'uuid', example: PROOF_IDS.file })
  previousProofFileId!: string;

  @ApiProperty({ enum: PROOF_STATUSES, enumName: 'ProofStatus', example: 'changes_requested' })
  previousStatus!: string;

  @ApiStatusLabelTh('ProofStatus', 'previousStatus')
  previousStatusLabelTh!: string;

  @ApiStatusLabelAdminTh('ProofStatus', 'previousStatus')
  previousStatusLabelAdminTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สีพื้นหลังเข้มเกินไป' })
  previousDecisionComment!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Annotations on the previous version not marked resolved',
  })
  openAnnotationsOnPrevious!: number;
}

export class ProofDto {
  @ApiProperty({ format: 'uuid', example: PROOF_IDS.proof })
  id!: string;

  @ApiProperty({ format: 'uuid', example: PROOF_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR2609270001' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: PROOF_STATUSES, enumName: 'ProofStatus', example: 'pending_customer' })
  status!: string;

  @ApiStatusLabelTh('ProofStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ProofStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: PROOF_IDS.submission })
  submissionId!: string | null;

  @ApiProperty({ type: ProofFileDto })
  proofFile!: ProofFileDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: PROOF_IDS.dieline })
  dielineFileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขยายโลโก้ตามที่ลูกค้าขอ' })
  changeNote!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T11:00:00+07:00' })
  sentAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  decidedAt!: string | null;

  @ApiProperty({ enum: DECISION_CHANNELS, enumName: 'DecisionChannel', nullable: true, example: null })
  decisionChannel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionComment!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Who decided: the customer’s name, or “Packio” for a staff decision on their behalf',
  })
  decidedByName!: string | null;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Approval checklist items confirmed (`artwork.approval_checklist`)',
  })
  decisionChecklist!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'CS approvals on behalf: the reason given',
  })
  onBehalfReason!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The locked copy of the approved file',
  })
  approvedFileId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'SHA-256 (hex) of the approved file',
  })
  approvedFileSha256!: string | null;

  @ApiProperty({ type: ProofCompareDto, nullable: true, description: 'The version this one answers' })
  compare!: ProofCompareDto | null;

  @ApiProperty({ type: [AnnotationDto] })
  annotations!: AnnotationDto[];
}

export class DielineDeliveryDto {
  @ApiProperty({ format: 'uuid', example: PROOF_IDS.delivery })
  id!: string;

  @ApiProperty({ enum: ['auto_after_payment', 'manual'], enumName: 'DielineTrigger', example: 'manual' })
  trigger!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: PROOF_IDS.dieline })
  fileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'แบบแปลนกล่องขนาด 100×100×50 มม.' })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T09:00:00+07:00' })
  sentAt!: string;
}

export const ANNOTATION_EXAMPLE: AnnotationDto = {
  id: PROOF_IDS.annotation,
  parentId: null,
  page: 1,
  kind: 'pin',
  geometry: { x: 0.42, y: 0.31 },
  comment: 'ขอโลโก้ใหญ่ขึ้นอีกนิด',
  author: { kind: 'customer', displayName: 'ลูกค้า ทดสอบ' },
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-09-27T11:05:00+07:00',
};

export const PROOF_EXAMPLE: ProofDto = {
  id: PROOF_IDS.proof,
  orderId: PROOF_IDS.order,
  orderCode: 'OR2609270001',
  versionNo: 2,
  status: 'pending_customer',
  ...statusLabels('ProofStatus', 'pending_customer'),
  submissionId: PROOF_IDS.submission,
  proofFile: { id: PROOF_IDS.file, originalName: 'proof-v2.pdf', mimeType: 'application/pdf', pageCount: 1 },
  dielineFileId: PROOF_IDS.dieline,
  changeNote: 'ขยายโลโก้ตามที่ลูกค้าขอ',
  sentAt: '2026-09-27T11:00:00+07:00',
  decidedAt: null,
  decisionChannel: null,
  decisionComment: null,
  decidedByName: null,
  decisionChecklist: [],
  onBehalfReason: null,
  approvedFileId: null,
  approvedFileSha256: null,
  compare: {
    previousProofId: PROOF_IDS.previous,
    previousVersionNo: 1,
    previousProofFileId: PROOF_IDS.file,
    previousStatus: 'changes_requested',
    ...statusLabels('ProofStatus', 'changes_requested', 'previousStatus'),
    previousDecisionComment: 'สีพื้นหลังเข้มเกินไป',
    openAnnotationsOnPrevious: 0,
  },
  annotations: [ANNOTATION_EXAMPLE],
};

export const APPROVED_EXAMPLE: ProofDto = {
  ...PROOF_EXAMPLE,
  status: 'approved',
  decidedAt: '2026-09-27T12:00:00+07:00',
  decisionChannel: 'web',
  approvedFileId: PROOF_IDS.approved,
  approvedFileSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
};

export const DELIVERY_EXAMPLE: DielineDeliveryDto = {
  id: PROOF_IDS.delivery,
  trigger: 'manual',
  fileId: PROOF_IDS.dieline,
  note: 'แบบแปลนกล่องขนาด 100×100×50 มม.',
  sentAt: '2026-09-27T09:00:00+07:00',
};

/** Optional approval evidence (U-B0.1): the checklist items confirmed and a note. */
export class ApproveProofDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['spelling_checked', 'colours_checked'],
    description:
      'Keys of `artwork.approval_checklist`; every item must be confirmed once the checklist is set',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  checklist?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
