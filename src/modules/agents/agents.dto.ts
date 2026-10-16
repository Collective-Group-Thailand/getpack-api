import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
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
} from 'class-validator';

/** The sales agent programme (D-416 – D-423). Money: decimal strings, THB. */

export const AGENT_KINDS = ['freelance', 'employee'] as const;
export const AGENT_STATUSES = ['active', 'suspended', 'ended'] as const;
export const APPLICATION_STATUSES = ['submitted', 'approved', 'rejected', 'withdrawn'] as const;
export const JURISTIC_TYPES = ['individual', 'company', 'partnership'] as const;
export const LINK_SOURCES = ['link', 'lead', 'staff', 'company'] as const;
export const LINK_STATUSES = ['active', 'ended'] as const;
export const LEAD_KINDS = ['customer', 'factory'] as const;
export const LEAD_STATUSES = ['registered', 'converted', 'expired', 'rejected', 'withdrawn'] as const;
export const FACTORY_LINK_STATUSES = ['pending', 'qualified', 'expired', 'ended'] as const;
export const COMMISSION_KINDS = ['order', 'factory_bounty', 'adjustment', 'reversal'] as const;
export const COMMISSION_STATUSES = ['pending', 'held', 'earned', 'statemented', 'paid', 'cancelled'] as const;
export const STATEMENT_STATUSES = ['draft', 'approved', 'exported', 'paid', 'voided'] as const;
export const PLAN_VERSION_STATUSES = ['draft', 'approved', 'rejected', 'withdrawn'] as const;

const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const POSITIVE_MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PCT = /^\d{1,3}(\.\d{1,4})?$/;
const TAX_ID = /^\d{13}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[a-z][a-z0-9_]{2,40}$/;

export const AGENT_IDS = {
  agent: '0192f3a0-7c1e-7d2a-9b1f-0000000a6001',
  application: '0192f3a0-7c1e-7d2a-9b1f-0000000a6002',
  plan: '0192f3a0-7c1e-7d2a-9b1f-0000000a6003',
  planVersion: '0192f3a0-7c1e-7d2a-9b1f-0000000a6004',
  link: '0192f3a0-7c1e-7d2a-9b1f-0000000a6005',
  lead: '0192f3a0-7c1e-7d2a-9b1f-0000000a6006',
  factoryLink: '0192f3a0-7c1e-7d2a-9b1f-0000000a6007',
  commission: '0192f3a0-7c1e-7d2a-9b1f-0000000a6008',
  statement: '0192f3a0-7c1e-7d2a-9b1f-0000000a6009',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000a6010',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000a6011',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000a6012',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000a6013',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000a6014',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000a6015',
  vendor: '0192f3a0-7c1e-7d2a-9b1f-0000000a6016',
  invoice: '0192f3a0-7c1e-7d2a-9b1f-0000000a6017',
  agreement: '0192f3a0-7c1e-7d2a-9b1f-0000000a6018',
};

// --- plans ------------------------------------------------------------------------------------------------

/** The terms of a plan version (D-418, D-419). */
export class AgentPlanTermsDto {
  @ApiProperty({ example: '5', description: 'Commission on a customer’s first order, % of the base' })
  firstOrderPct!: string;

  @ApiProperty({ example: '3', description: 'Commission on later orders, % of the base' })
  repeatOrderPct!: string;

  @ApiProperty({ type: 'integer', example: 12, description: 'Months a customer stays linked to the agent' })
  attributionMonths!: number;

  @ApiProperty({ example: '30', description: 'Commission ≤ this % of the order’s margin (never below 0)' })
  marginCapPct!: string;

  @ApiProperty({ example: '0.00', description: 'Orders with a smaller base earn nothing' })
  minBaseAmount!: string;

  @ApiProperty({ example: '3000.00', description: 'Bounty for a factory brought in (D-419)' })
  factoryBountyAmount!: string;

  @ApiProperty({
    type: 'integer',
    example: 3,
    description: 'Completed jobs the factory needs for the bounty',
  })
  factoryQualifyJobs!: number;

  @ApiProperty({ type: 'integer', example: 120, description: '… within this many days of activation' })
  factoryQualifyDays!: number;
}

const TERMS_EXAMPLE: AgentPlanTermsDto = {
  firstOrderPct: '5',
  repeatOrderPct: '3',
  attributionMonths: 12,
  marginCapPct: '30',
  minBaseAmount: '0.00',
  factoryBountyAmount: '3000.00',
  factoryQualifyJobs: 3,
  factoryQualifyDays: 120,
};

export class AgentPlanVersionDto extends AgentPlanTermsDto {
  @IdField(AGENT_IDS.planVersion)
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @TimestampField('2026-01-01T00:00:00+07:00')
  effectiveFrom!: string;

  @ApiProperty({ enum: PLAN_VERSION_STATUSES, enumName: 'AgentPlanVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ example: 'Seed: starting plan (D-418, proposed figures)' })
  reason!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  createdBy!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  decidedBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-01-01T00:00:00+07:00' })
  decidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionNote!: string | null;

  @ApiProperty({ example: true, description: 'The version that applies now' })
  inForce!: boolean;
}

export class AgentPlanDto {
  @IdField(AGENT_IDS.plan)
  id!: string;

  @ApiProperty({ example: 'freelance_standard' })
  code!: string;

  @ApiProperty({ example: 'ตัวแทนอิสระ — มาตรฐาน' })
  nameTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Freelance agent — standard' })
  nameEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'D-418 starting plan for freelance agents' })
  description!: string | null;

  @ApiProperty({ enum: AGENT_KINDS, enumName: 'AgentKind', example: 'freelance' })
  agentKind!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  retiredAt!: string | null;

  @ApiProperty({ type: AgentPlanTermsDto, nullable: true, description: 'Terms in force now' })
  current!: AgentPlanTermsDto | null;

  @ApiProperty({ type: 'integer', example: 4, description: 'Active agents on this plan' })
  agentCount!: number;

  @ApiProperty({ type: [AgentPlanVersionDto], description: 'Newest first' })
  versions!: AgentPlanVersionDto[];
}

export const PLAN_VERSION_EXAMPLE: AgentPlanVersionDto = {
  ...TERMS_EXAMPLE,
  id: AGENT_IDS.planVersion,
  versionNo: 1,
  effectiveFrom: '2026-01-01T00:00:00+07:00',
  status: 'approved',
  reason: 'Seed: starting plan (D-418, proposed figures)',
  createdBy: null,
  decidedBy: null,
  decidedAt: '2026-01-01T00:00:00+07:00',
  decisionNote: null,
  inForce: true,
};

export const PLAN_EXAMPLE: AgentPlanDto = {
  id: AGENT_IDS.plan,
  code: 'freelance_standard',
  nameTh: 'ตัวแทนอิสระ — มาตรฐาน',
  nameEn: 'Freelance agent — standard',
  description: 'D-418 starting plan for freelance agents (proposed figures)',
  agentKind: 'freelance',
  retiredAt: null,
  current: TERMS_EXAMPLE,
  agentCount: 4,
  versions: [PLAN_VERSION_EXAMPLE],
};

export class AgentPlanTermsInputDto {
  @ApiProperty({ example: '5', pattern: PCT.source })
  @Matches(PCT)
  firstOrderPct!: string;

  @ApiProperty({ example: '3', pattern: PCT.source })
  @Matches(PCT)
  repeatOrderPct!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 120, example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  attributionMonths!: number;

  @ApiProperty({ example: '30', pattern: PCT.source })
  @Matches(PCT)
  marginCapPct!: string;

  @ApiProperty({ example: '0.00', pattern: POSITIVE_MONEY.source })
  @Matches(POSITIVE_MONEY)
  minBaseAmount!: string;

  @ApiProperty({ example: '3000.00', pattern: POSITIVE_MONEY.source })
  @Matches(POSITIVE_MONEY)
  factoryBountyAmount!: string;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  factoryQualifyJobs!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 730, example: 120 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(730)
  factoryQualifyDays!: number;
}

export class CreateAgentPlanDto extends AgentPlanTermsInputDto {
  @ApiProperty({ example: 'freelance_premium', pattern: CODE.source })
  @Matches(CODE)
  code!: string;

  @ApiProperty({ example: 'ตัวแทนอิสระ — พรีเมียม' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameTh!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Freelance agent — premium' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ enum: AGENT_KINDS, enumName: 'AgentKind', example: 'freelance' })
  @IsIn(AGENT_KINDS)
  agentKind!: (typeof AGENT_KINDS)[number];

  @ApiProperty({ example: 'แผนสำหรับตัวแทนที่ขายได้ต่อเนื่อง', description: 'Why the plan exists' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class DraftAgentPlanVersionDto extends AgentPlanTermsInputDto {
  @ApiProperty({ format: 'date-time', example: '2026-11-01T00:00:00+07:00', description: 'Not in the past' })
  @IsString()
  @MaxLength(40)
  effectiveFrom!: string;

  @ApiProperty({ example: 'ปรับอัตราค่าคอมตามผลไตรมาส 3' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// --- applications -----------------------------------------------------------------------------------------

export class AgentAgreementTextDto {
  @ApiProperty({ example: 'sales_agent_agreement' })
  key!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @TimestampField('2026-01-01T00:00:00+07:00')
  effectiveFrom!: string;

  @ApiProperty({ example: 'ข้อตกลงตัวแทนขาย getpack (ฉบับที่ 1) …' })
  textTh!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  textEn!: string | null;
}

/** What a customer reads before applying (D-416). */
export class AgentProgrammeDto {
  @ApiProperty({
    type: AgentAgreementTextDto,
    nullable: true,
    description: 'The agreement in force (null: none yet)',
  })
  agreement!: AgentAgreementTextDto | null;

  @ApiProperty({
    type: AgentPlanTermsDto,
    nullable: true,
    description: 'The standard freelance plan in force',
  })
  plan!: AgentPlanTermsDto | null;

  @ApiProperty({
    type: 'integer',
    example: 90,
    description: 'Days a visit through an agent link is remembered',
  })
  linkCookieDays!: number;

  @ApiProperty({ type: 'integer', example: 60, description: 'Days a registered lead is protected' })
  leadProtectionDays!: number;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description: 'Days after a statement is approved until payment',
  })
  paymentTermsDays!: number;

  @ApiProperty({
    enum: ['none', 'applied', 'rejected', 'withdrawn', 'agent'],
    enumName: 'AgentProgrammeState',
    example: 'none',
    description: 'Where the signed-in customer stands',
  })
  state!: string;
}

export const AGENT_PROGRAMME_EXAMPLE: AgentProgrammeDto = {
  agreement: {
    key: 'sales_agent_agreement',
    versionNo: 1,
    effectiveFrom: '2026-01-01T00:00:00+07:00',
    textTh: 'ข้อตกลงตัวแทนขาย getpack (ฉบับที่ 1) …',
    textEn: null,
  },
  plan: TERMS_EXAMPLE,
  linkCookieDays: 90,
  leadProtectionDays: 60,
  paymentTermsDays: 15,
  state: 'none',
};

export class SubmitAgentApplicationDto {
  @ApiProperty({ enum: JURISTIC_TYPES, enumName: 'JuristicType', example: 'individual' })
  @IsIn(JURISTIC_TYPES)
  juristicType!: (typeof JURISTIC_TYPES)[number];

  @ApiProperty({ example: 'สมชาย ขายเก่ง', description: 'As on the ID card or company certificate' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({
    example: '0000000000127',
    pattern: TAX_ID.source,
    description: 'Citizen id or company tax id',
  })
  @Matches(TAX_ID)
  taxId!: string;

  @ApiPropertyOptional({ example: '00000', pattern: '^\\d{5}$' })
  @IsOptional()
  @Matches(/^\d{5}$/)
  branchCode?: string;

  @ApiPropertyOptional({ example: false, description: 'VAT registered (juristic agents)' })
  @IsOptional()
  @IsBoolean()
  isVatRegistered?: boolean;

  @ApiProperty({ example: '99/1 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  address!: string;

  @ApiProperty({ example: '10310', pattern: '^\\d{5}$' })
  @Matches(/^\d{5}$/)
  postcode!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'ขายให้ร้านกาแฟและร้านเบเกอรี่ในย่านลาดพร้าว',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  pitch?: string | null;

  @ApiProperty({
    format: 'uuid',
    example: AGENT_IDS.file,
    description: 'ID card or company certificate (uploaded)',
  })
  @IsUUID()
  idDocumentFileId!: string;

  @ApiProperty({ example: '014', description: 'Bank code' })
  @Matches(/^\d{3}$/)
  bankCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สาขาลาดพร้าว' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankBranchName?: string | null;

  @ApiProperty({ example: 'สมชาย ขายเก่ง', description: 'Must match the legal name' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  bankAccountName!: string;

  @ApiProperty({ example: '1234567890', description: 'Digits only; stored encrypted' })
  @Matches(/^[0-9 -]{6,20}$/)
  bankAccountNo!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, example: null })
  @IsOptional()
  @IsUUID()
  bankBookFileId?: string | null;

  @ApiProperty({ type: 'integer', example: 1, description: 'The agreement version read and accepted' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  agreementVersionNo!: number;
}

export class AgentFileRefDto {
  @IdField(AGENT_IDS.file)
  id!: string;

  @ApiProperty({ example: 'id-card.jpg' })
  originalName!: string;
}

export class AgentApplicationDto {
  @IdField(AGENT_IDS.application)
  id!: string;

  @ApiProperty({ enum: APPLICATION_STATUSES, enumName: 'AgentApplicationStatus', example: 'submitted' })
  status!: string;

  @ApiProperty({ enum: JURISTIC_TYPES, enumName: 'JuristicType', example: 'individual' })
  juristicType!: string;

  @ApiProperty({ example: 'สมชาย ขายเก่ง' })
  legalName!: string;

  @ApiProperty({ example: '0000000000127' })
  taxId!: string;

  @ApiProperty({ example: '00000' })
  branchCode!: string;

  @ApiProperty({ example: false })
  isVatRegistered!: boolean;

  @ApiProperty({ example: '99/1 ถนนพระราม 9 …' })
  address!: string;

  @ApiProperty({ example: '10310' })
  postcode!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  pitch!: string | null;

  @ApiProperty({ example: '014' })
  bankCode!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  bankBranchName!: string | null;

  @ApiProperty({ example: 'สมชาย ขายเก่ง' })
  bankAccountName!: string;

  @ApiProperty({ example: '7890', description: 'Last 4 digits only (PDPA)' })
  bankAccountNoLast4!: string;

  @ApiProperty({ type: AgentFileRefDto })
  idDocument!: AgentFileRefDto;

  @ApiProperty({ type: AgentFileRefDto, nullable: true })
  bankBook!: AgentFileRefDto | null;

  @ApiProperty({ type: 'integer', example: 1 })
  agreementVersionNo!: number;

  @TimestampField('2026-10-16T10:00:00+07:00')
  agreementAcceptedAt!: string;

  @TimestampField('2026-10-16T10:00:00+07:00')
  submittedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why it was rejected' })
  decisionReason!: string | null;
}

export class AdminAgentApplicationDto extends AgentApplicationDto {
  @ApiProperty({ type: UserRefDto, description: 'The customer account' })
  user!: UserRefDto;

  @ApiProperty({ type: String, nullable: true, example: '+66810005678' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'somchai@example.invalid' })
  email!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  decidedBy!: UserRefDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The agent created',
  })
  agentId!: string | null;

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'What Sales should check: `tax_id_in_use` (another agent or vendor), `name_mismatch` (bank account name ≠ legal name), `has_orders` (the applicant already buys)',
  })
  checks!: string[];
}

export const APPLICATION_EXAMPLE: AgentApplicationDto = {
  id: AGENT_IDS.application,
  status: 'submitted',
  juristicType: 'individual',
  legalName: 'สมชาย ขายเก่ง',
  taxId: '0000000000127',
  branchCode: '00000',
  isVatRegistered: false,
  address: '99/1 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ',
  postcode: '10310',
  pitch: null,
  bankCode: '014',
  bankBranchName: null,
  bankAccountName: 'สมชาย ขายเก่ง',
  bankAccountNoLast4: '7890',
  idDocument: { id: AGENT_IDS.file, originalName: 'id-card.jpg' },
  bankBook: null,
  agreementVersionNo: 1,
  agreementAcceptedAt: '2026-10-16T10:00:00+07:00',
  submittedAt: '2026-10-16T10:00:00+07:00',
  decidedAt: null,
  decisionReason: null,
};

export const ADMIN_APPLICATION_EXAMPLE: AdminAgentApplicationDto = {
  ...APPLICATION_EXAMPLE,
  user: { id: AGENT_IDS.user, displayName: 'สมชาย ขายเก่ง' },
  phone: '+66810005678',
  email: null,
  decidedBy: null,
  agentId: null,
  checks: [],
};

export class ApproveAgentApplicationDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.plan, description: 'A freelance plan' })
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'โทรยืนยันตัวตนแล้ว' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ApplicationListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES, enumName: 'AgentApplicationStatus' })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: (typeof APPLICATION_STATUSES)[number];
}

// --- agents -----------------------------------------------------------------------------------------------

export class AgentPlanRefDto {
  @IdField(AGENT_IDS.plan)
  id!: string;

  @ApiProperty({ example: 'freelance_standard' })
  code!: string;

  @ApiProperty({ example: 'ตัวแทนอิสระ — มาตรฐาน' })
  nameTh!: string;
}

export class AgentTotalsDto {
  @ApiProperty({ example: '1250.00', description: 'Accrued, waiting for the claim window or payment' })
  pending!: string;

  @ApiProperty({ example: '0.00', description: 'Held for review' })
  held!: string;

  @ApiProperty({ example: '830.50', description: 'Earned, not yet on a statement' })
  earned!: string;

  @ApiProperty({ example: '0.00', description: 'On a statement not yet paid' })
  statemented!: string;

  @ApiProperty({ example: '4200.00', description: 'Paid, this calendar year' })
  paidThisYear!: string;

  @ApiProperty({ type: 'integer', example: 6, description: 'Customers and companies linked now' })
  activeLinks!: number;

  @ApiProperty({ type: 'integer', example: 3, description: 'Leads still protected' })
  openLeads!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Factories brought in' })
  factories!: number;
}

export class AgentDto {
  @IdField(AGENT_IDS.agent)
  id!: string;

  @ApiProperty({ enum: AGENT_KINDS, enumName: 'AgentKind', example: 'freelance' })
  kind!: string;

  @ApiProperty({ enum: AGENT_STATUSES, enumName: 'AgentStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: 'K7QX2MAP', description: 'Shared in the agent link' })
  code!: string;

  @ApiProperty({ example: 'https://www.getpack.invalid/a/K7QX2MAP' })
  link!: string;

  @ApiProperty({ example: 'สมชาย ขายเก่ง' })
  legalName!: string;

  @ApiProperty({ type: AgentPlanRefDto })
  plan!: AgentPlanRefDto;

  @ApiProperty({ type: AgentPlanTermsDto, nullable: true, description: 'The plan’s terms in force' })
  terms!: AgentPlanTermsDto | null;

  @TimestampField('2026-10-16T10:00:00+07:00')
  joinedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why suspended or ended' })
  statusReason!: string | null;

  @ApiProperty({ type: AgentTotalsDto })
  totals!: AgentTotalsDto;
}

export class AdminAgentDto extends AgentDto {
  @ApiProperty({ type: UserRefDto, description: 'The customer account the agent signs in with' })
  user!: UserRefDto;

  @ApiProperty({ type: String, nullable: true, example: '+66810005678' })
  phone!: string | null;

  @ApiProperty({ enum: JURISTIC_TYPES, enumName: 'JuristicType', example: 'individual' })
  juristicType!: string;

  @ApiProperty({ type: String, nullable: true, example: '0000000000127' })
  taxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Employees only' })
  employeeCode!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'The employee’s back-office account' })
  staffUser!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AGENT_IDS.vendor })
  vendorId!: string | null;

  @ApiProperty({
    enum: ['none', 'pending_approval', 'active'],
    enumName: 'AgentBankAccountState',
    example: 'pending_approval',
    description: 'Freelance: whether payouts can reach the agent',
  })
  bankAccount!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AGENT_IDS.application })
  applicationId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: 'integer', example: 1 })
  rowVersion!: number;
}

const TOTALS_EXAMPLE: AgentTotalsDto = {
  pending: '1250.00',
  held: '0.00',
  earned: '830.50',
  statemented: '0.00',
  paidThisYear: '4200.00',
  activeLinks: 6,
  openLeads: 3,
  factories: 1,
};

export const AGENT_EXAMPLE: AgentDto = {
  id: AGENT_IDS.agent,
  kind: 'freelance',
  status: 'active',
  code: 'K7QX2MAP',
  link: 'https://www.getpack.invalid/a/K7QX2MAP',
  legalName: 'สมชาย ขายเก่ง',
  plan: { id: AGENT_IDS.plan, code: 'freelance_standard', nameTh: 'ตัวแทนอิสระ — มาตรฐาน' },
  terms: TERMS_EXAMPLE,
  joinedAt: '2026-10-16T10:00:00+07:00',
  statusReason: null,
  totals: TOTALS_EXAMPLE,
};

export const ADMIN_AGENT_EXAMPLE: AdminAgentDto = {
  ...AGENT_EXAMPLE,
  user: { id: AGENT_IDS.user, displayName: 'สมชาย ขายเก่ง' },
  phone: '+66810005678',
  juristicType: 'individual',
  taxId: '0000000000127',
  employeeCode: null,
  staffUser: null,
  vendorId: AGENT_IDS.vendor,
  bankAccount: 'pending_approval',
  applicationId: AGENT_IDS.application,
  note: null,
  rowVersion: 1,
};

export class AgentListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: AGENT_STATUSES, enumName: 'AgentStatus' })
  @IsOptional()
  @IsIn(AGENT_STATUSES)
  status?: (typeof AGENT_STATUSES)[number];

  @ApiPropertyOptional({ enum: AGENT_KINDS, enumName: 'AgentKind' })
  @IsOptional()
  @IsIn(AGENT_KINDS)
  kind?: (typeof AGENT_KINDS)[number];
}

export class CreateEmployeeAgentDto {
  @ApiProperty({
    format: 'uuid',
    example: AGENT_IDS.user,
    description: 'The employee’s customer account (they sign in to the storefront with it)',
  })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: 'สมหญิง พนักงานขาย' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({ example: 'CG-0142' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  employeeCode!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Their staff account' })
  @IsOptional()
  @IsUUID()
  staffUserId?: string | null;

  @ApiProperty({ format: 'uuid', example: AGENT_IDS.plan, description: 'An employee plan' })
  @IsUUID()
  planId!: string;
}

export class UpdateAgentDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Another plan of the same kind (new orders only)' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Employees' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Why (audited)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class AgentRefDto {
  @IdField(AGENT_IDS.agent)
  id!: string;

  @ApiProperty({ example: 'K7QX2MAP' })
  code!: string;

  @ApiProperty({ example: 'สมชาย ขายเก่ง' })
  legalName!: string;

  @ApiProperty({ enum: AGENT_KINDS, enumName: 'AgentKind', example: 'freelance' })
  kind!: string;
}

// --- links ------------------------------------------------------------------------------------------------

export class ClaimedAgentLinkDto {
  @ApiProperty({
    example: true,
    description: 'False when the visit was not attributed (the reason says why)',
  })
  linked!: boolean;

  @ApiProperty({
    nullable: true,
    enum: ['not_new_customer', 'already_linked', 'own_code', 'agent_inactive'],
    enumName: 'AgentLinkSkipReason',
    example: null,
  })
  reason!: string | null;
}

export class AgentLinkDto {
  @IdField(AGENT_IDS.link)
  id!: string;

  @ApiProperty({ enum: LINK_SOURCES, enumName: 'AgentLinkSource', example: 'link' })
  source!: string;

  @ApiProperty({ enum: LINK_STATUSES, enumName: 'AgentLinkStatus', example: 'active' })
  status!: string;

  @ApiProperty({ enum: ['customer', 'company'], enumName: 'AgentLinkSubject', example: 'customer' })
  subject!: string;

  @ApiProperty({ example: 'ส•••', description: 'Masked for a link-sourced person (D-422)' })
  name!: string;

  @TimestampField('2026-10-16T10:00:00+07:00')
  attributedAt!: string;

  @TimestampField('2027-10-16T10:00:00+07:00')
  endsAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  endedAt!: string | null;

  @ApiProperty({ type: 'integer', example: 2, description: 'Orders commissioned' })
  orders!: number;

  @ApiProperty({ example: '1820.00', description: 'Commission from this link, net of reversals' })
  commission!: string;
}

export class AdminAgentLinkDto extends AgentLinkDto {
  @ApiProperty({ type: AgentRefDto })
  agent!: AgentRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  customer!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  companyName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  endedReason!: string | null;
}

export const AGENT_LINK_EXAMPLE: AgentLinkDto = {
  id: AGENT_IDS.link,
  source: 'link',
  status: 'active',
  subject: 'customer',
  name: 'ส•••',
  attributedAt: '2026-10-16T10:00:00+07:00',
  endsAt: '2027-10-16T10:00:00+07:00',
  endedAt: null,
  orders: 2,
  commission: '1820.00',
};

export const ADMIN_AGENT_LINK_EXAMPLE: AdminAgentLinkDto = {
  ...AGENT_LINK_EXAMPLE,
  name: 'สมหญิง ทดสอบ',
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  customer: { id: AGENT_IDS.customer, displayName: 'สมหญิง ทดสอบ' },
  companyId: null,
  companyName: null,
  reason: null,
  endedReason: null,
};

export class AssignAgentLinkDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.agent })
  @IsUUID()
  agentId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'A customer account (or companyId)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'A company (or customerId)' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ example: 'ลูกค้าแจ้งว่าตัวแทนคนนี้แนะนำมา' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class LinkListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: LINK_STATUSES, enumName: 'AgentLinkStatus' })
  @IsOptional()
  @IsIn(LINK_STATUSES)
  status?: (typeof LINK_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class MyLinkListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: LINK_STATUSES, enumName: 'AgentLinkStatus' })
  @IsOptional()
  @IsIn(LINK_STATUSES)
  status?: (typeof LINK_STATUSES)[number];
}

// --- leads ------------------------------------------------------------------------------------------------

export class RegisterAgentLeadDto {
  @ApiProperty({ enum: LEAD_KINDS, enumName: 'AgentLeadKind', example: 'customer' })
  @IsIn(LEAD_KINDS)
  kind!: (typeof LEAD_KINDS)[number];

  @ApiProperty({ example: 'คุณมานี ใจดี' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  contactName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ร้านกาแฟบ้านสวน' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisationName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '+66890001234', pattern: E164.source })
  @IsOptional()
  @Matches(E164)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'manee@example.invalid' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, pattern: TAX_ID.source })
  @IsOptional()
  @Matches(TAX_ID)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สนใจกล่องเบเกอรี่ 1,000 ใบ/เดือน' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({
    example: true,
    description: 'The lead agreed to be contacted by getpack (PDPA); required',
  })
  @IsBoolean()
  consentConfirmed!: boolean;
}

export class AgentLeadDto {
  @IdField(AGENT_IDS.lead)
  id!: string;

  @ApiProperty({ enum: LEAD_KINDS, enumName: 'AgentLeadKind', example: 'customer' })
  kind!: string;

  @ApiProperty({ enum: LEAD_STATUSES, enumName: 'AgentLeadStatus', example: 'registered' })
  status!: string;

  @ApiProperty({ example: 'คุณมานี ใจดี' })
  contactName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ร้านกาแฟบ้านสวน' })
  organisationName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66890001234' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'manee@example.invalid' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  taxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @TimestampField('2026-12-15T10:00:00+07:00')
  protectedUntil!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  convertedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why it was closed' })
  closedReason!: string | null;

  @TimestampField('2026-10-16T10:00:00+07:00')
  createdAt!: string;
}

export class AdminAgentLeadDto extends AgentLeadDto {
  @ApiProperty({ type: AgentRefDto })
  agent!: AgentRefDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  convertedCustomerId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  convertedCompanyId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  convertedFactoryId!: string | null;
}

export const LEAD_EXAMPLE: AgentLeadDto = {
  id: AGENT_IDS.lead,
  kind: 'customer',
  status: 'registered',
  contactName: 'คุณมานี ใจดี',
  organisationName: 'ร้านกาแฟบ้านสวน',
  phone: '+66890001234',
  email: 'manee@example.invalid',
  taxId: null,
  note: null,
  protectedUntil: '2026-12-15T10:00:00+07:00',
  convertedAt: null,
  closedReason: null,
  createdAt: '2026-10-16T10:00:00+07:00',
};

export const ADMIN_LEAD_EXAMPLE: AdminAgentLeadDto = {
  ...LEAD_EXAMPLE,
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  convertedCustomerId: null,
  convertedCompanyId: null,
  convertedFactoryId: null,
};

export class LeadListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: LEAD_STATUSES, enumName: 'AgentLeadStatus' })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  @ApiPropertyOptional({ enum: LEAD_KINDS, enumName: 'AgentLeadKind' })
  @IsOptional()
  @IsIn(LEAD_KINDS)
  kind?: (typeof LEAD_KINDS)[number];
}

export class MyLeadListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: LEAD_STATUSES, enumName: 'AgentLeadStatus' })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];
}

// --- factory links ----------------------------------------------------------------------------------------

export class AgentFactoryLinkDto {
  @IdField(AGENT_IDS.factoryLink)
  id!: string;

  @ApiProperty({ enum: FACTORY_LINK_STATUSES, enumName: 'AgentFactoryLinkStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ type: AgentRefDto })
  agent!: AgentRefDto;

  @IdField(AGENT_IDS.factory)
  factoryId!: string;

  @ApiProperty({ example: 'F9001' })
  factoryCode!: string;

  @ApiProperty({ example: 'โรงพิมพ์ตัวอย่าง' })
  factoryName!: string;

  @ApiProperty({ example: 'trial', description: 'The factory’s status' })
  factoryStatus!: string;

  @TimestampField('2026-10-16T10:00:00+07:00')
  linkedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  qualifiedAt!: string | null;

  @ApiProperty({ type: 'integer', example: 1, description: 'Qualifying jobs completed so far' })
  completedJobs!: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  reason!: string | null;
}

export const FACTORY_LINK_EXAMPLE: AgentFactoryLinkDto = {
  id: AGENT_IDS.factoryLink,
  status: 'pending',
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  factoryId: AGENT_IDS.factory,
  factoryCode: 'F9001',
  factoryName: 'โรงพิมพ์ตัวอย่าง',
  factoryStatus: 'trial',
  linkedAt: '2026-10-16T10:00:00+07:00',
  qualifiedAt: null,
  completedJobs: 1,
  reason: null,
};

export class LinkAgentFactoryDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.agent })
  @IsUUID()
  agentId!: string;

  @ApiProperty({ format: 'uuid', example: AGENT_IDS.factory })
  @IsUUID()
  factoryId!: string;

  @ApiProperty({ example: 'ตัวแทนพาโรงงานมาเยี่ยมชมและสมัคร' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class FactoryLinkListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: FACTORY_LINK_STATUSES, enumName: 'AgentFactoryLinkStatus' })
  @IsOptional()
  @IsIn(FACTORY_LINK_STATUSES)
  status?: (typeof FACTORY_LINK_STATUSES)[number];
}

// --- commissions ------------------------------------------------------------------------------------------

export class AgentCommissionDto {
  @IdField(AGENT_IDS.commission)
  id!: string;

  @ApiProperty({ enum: COMMISSION_KINDS, enumName: 'AgentCommissionKind', example: 'order' })
  kind!: string;

  @ApiProperty({ enum: COMMISSION_STATUSES, enumName: 'AgentCommissionStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PK-2610-00042', description: 'The order' })
  orderCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ส•••',
    description: 'Who bought (masked as the link)',
  })
  customerName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'The factory (bounty)' })
  factoryName!: string | null;

  @ApiProperty({ example: true })
  isFirstOrder!: boolean;

  @ApiProperty({ example: '12000.00', description: 'Lines before VAT, no shipping, after discounts' })
  baseAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: '5' })
  ratePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1080.00',
    description: '30 % of the order’s margin',
  })
  capAmount!: string | null;

  @ApiProperty({ example: '600.00', description: 'Signed' })
  amount!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-08T00:00:00+07:00' })
  availableAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  earnedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'The statement number' })
  statementNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @TimestampField('2026-10-31T10:00:00+07:00')
  createdAt!: string;
}

export class AdminAgentCommissionDto extends AgentCommissionDto {
  @ApiProperty({ type: AgentRefDto })
  agent!: AgentRefDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AGENT_IDS.order })
  orderId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3600.00',
    description: 'The order’s margin (staff only)',
  })
  marginAmount!: string | null;

  @ApiProperty({ type: [String], example: [], description: '`<kind>_match` when held (D-417)' })
  holdFlags!: string[];
}

export const COMMISSION_EXAMPLE: AgentCommissionDto = {
  id: AGENT_IDS.commission,
  kind: 'order',
  status: 'pending',
  orderCode: 'PK-2610-00042',
  customerName: 'ส•••',
  factoryName: null,
  isFirstOrder: true,
  baseAmount: '12000.00',
  ratePct: '5',
  capAmount: '1080.00',
  amount: '600.00',
  availableAt: '2026-11-08T00:00:00+07:00',
  earnedAt: null,
  statementNo: null,
  note: null,
  createdAt: '2026-10-31T10:00:00+07:00',
};

export const ADMIN_COMMISSION_EXAMPLE: AdminAgentCommissionDto = {
  ...COMMISSION_EXAMPLE,
  customerName: 'สมหญิง ทดสอบ',
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  orderId: AGENT_IDS.order,
  marginAmount: '3600.00',
  holdFlags: [],
};

export class CommissionListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: COMMISSION_STATUSES, enumName: 'AgentCommissionStatus' })
  @IsOptional()
  @IsIn(COMMISSION_STATUSES)
  status?: (typeof COMMISSION_STATUSES)[number];

  @ApiPropertyOptional({ enum: COMMISSION_KINDS, enumName: 'AgentCommissionKind' })
  @IsOptional()
  @IsIn(COMMISSION_KINDS)
  kind?: (typeof COMMISSION_KINDS)[number];
}

export class MyCommissionListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: COMMISSION_STATUSES, enumName: 'AgentCommissionStatus' })
  @IsOptional()
  @IsIn(COMMISSION_STATUSES)
  status?: (typeof COMMISSION_STATUSES)[number];
}

export class AdjustAgentCommissionDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.agent })
  @IsUUID()
  agentId!: string;

  @ApiProperty({ example: '-150.00', pattern: MONEY.source, description: 'Signed, not zero' })
  @Matches(MONEY)
  amount!: string;

  @ApiProperty({ example: 'ปรับคืนส่วนต่างราคาที่ตกลงกับลูกค้า' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class DecideHeldAgentCommissionDto {
  @ApiProperty({ enum: ['release', 'cancel'], enumName: 'AgentHeldDecision', example: 'release' })
  @IsIn(['release', 'cancel'])
  decision!: 'release' | 'cancel';

  @ApiProperty({ example: 'ตรวจแล้ว ลูกค้าเป็นคนละคนกับตัวแทน' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// --- statements -------------------------------------------------------------------------------------------

export class AgentStatementDto {
  @IdField(AGENT_IDS.statement)
  id!: string;

  @ApiProperty({ example: 'AG2610-K7QX2MAP' })
  statementNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  periodStart!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  periodEnd!: string;

  @ApiProperty({ enum: STATEMENT_STATUSES, enumName: 'AgentStatementStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  entryCount!: number;

  @ApiProperty({ example: '2350.00', description: 'Before withholding' })
  totalAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '70.50',
    description: 'Withheld at payment (freelance)',
  })
  whtAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2279.50', description: 'Transferred (freelance)' })
  paidAmount!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-01T09:00:00+07:00' })
  approvedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  paidAt!: string | null;

  @ApiProperty({ example: false, description: 'A 50 ทวิ is available to download' })
  hasWhtCertificate!: boolean;
}

export class AgentStatementDetailDto extends AgentStatementDto {
  @ApiProperty({ type: [AgentCommissionDto] })
  entries!: AgentCommissionDto[];
}

export class AdminAgentStatementDto extends AgentStatementDto {
  @ApiProperty({ type: AgentRefDto })
  agent!: AgentRefDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AGENT_IDS.invoice })
  vendorInvoiceId!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  approvedBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  exportedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  voidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  voidReason!: string | null;

  @ApiProperty({ type: 'integer', example: 1 })
  rowVersion!: number;
}

export class AdminAgentStatementDetailDto extends AdminAgentStatementDto {
  @ApiProperty({ type: [AdminAgentCommissionDto] })
  entries!: AdminAgentCommissionDto[];
}

export const STATEMENT_EXAMPLE: AgentStatementDto = {
  id: AGENT_IDS.statement,
  statementNo: 'AG2610-K7QX2MAP',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'approved',
  entryCount: 3,
  totalAmount: '2350.00',
  whtAmount: null,
  paidAmount: null,
  approvedAt: '2026-11-01T09:00:00+07:00',
  paidAt: null,
  hasWhtCertificate: false,
};

export const STATEMENT_DETAIL_EXAMPLE: AgentStatementDetailDto = {
  ...STATEMENT_EXAMPLE,
  entries: [COMMISSION_EXAMPLE],
};

export const ADMIN_STATEMENT_EXAMPLE: AdminAgentStatementDto = {
  ...STATEMENT_EXAMPLE,
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  vendorInvoiceId: AGENT_IDS.invoice,
  approvedBy: { id: AGENT_IDS.user, displayName: 'Dev Finance Manager' },
  exportedAt: null,
  voidedAt: null,
  voidReason: null,
  rowVersion: 2,
};

export const ADMIN_STATEMENT_DETAIL_EXAMPLE: AdminAgentStatementDetailDto = {
  ...ADMIN_STATEMENT_EXAMPLE,
  entries: [ADMIN_COMMISSION_EXAMPLE],
};

export class StatementListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: STATEMENT_STATUSES, enumName: 'AgentStatementStatus' })
  @IsOptional()
  @IsIn(STATEMENT_STATUSES)
  status?: (typeof STATEMENT_STATUSES)[number];

  @ApiPropertyOptional({ example: '2026-10', pattern: MONTH.source })
  @IsOptional()
  @Matches(MONTH)
  period?: string;

  @ApiPropertyOptional({ enum: AGENT_KINDS, enumName: 'AgentKind' })
  @IsOptional()
  @IsIn(AGENT_KINDS)
  kind?: (typeof AGENT_KINDS)[number];
}

export class AgentStatementsGeneratedDto {
  @ApiProperty({ type: 'integer', example: 4, description: 'Statements created' })
  created!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Agents whose net was zero or less (carried forward)',
  })
  carriedForward!: number;
}

export class AgentMarkPaidDto {
  @ApiProperty({ format: 'date', example: '2026-11-25', pattern: DAY.source, description: 'Payroll day' })
  @Matches(DAY)
  paidOn!: string;
}

export class AgentPayrollExportDto {
  @IdField(AGENT_IDS.file)
  fileId!: string;

  @ApiProperty({ example: 'https://getpack-files.s3.example.com/…' })
  url!: string;

  @TimestampField('2026-11-02T10:05:00+07:00')
  expiresAt!: string;

  @ApiProperty({ type: 'integer', example: 3, description: 'Employee statements in the file (now exported)' })
  statements!: number;
}

// --- shared refs ------------------------------------------------------------------------------------------

export const isMonth = (v: string) => MONTH.test(v);
export const isTaxId = (v: string) => TAX_ID.test(v);
