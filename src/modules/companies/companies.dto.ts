import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
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
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { COMPANY_ROLES } from './companies.service';

/** B2B companies (D-120…D-125). */

export const COMPANY_STATUSES = ['applied', 'kyc_review', 'active', 'suspended', 'closed'] as const;
export const CREDIT_STATUSES = ['prepaid', 'eligible', 'credit', 'blocked_overdue'] as const;
export const PO_POLICIES = ['required', 'optional', 'none'] as const;
export const COMPANY_KYC_TYPES = [
  'company_certificate',
  'vat_registration_pp20',
  'signatory_id',
  'financial_statement',
  'other',
] as const;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const IDS = {
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000c1001',
  branch: '0192f3a0-7c1e-7d2a-9b1f-0000000c1002',
  member: '0192f3a0-7c1e-7d2a-9b1f-0000000c1003',
  document: '0192f3a0-7c1e-7d2a-9b1f-0000000c1004',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000c1005',
  province: '0192f3a0-7c1e-7d2a-9b1f-0000000c1006',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000c1007',
};

export class CompanyBranchInputDto {
  @ApiPropertyOptional({ enum: ['head_office', 'branch'], enumName: 'BranchType', example: 'branch' })
  @IsOptional()
  @IsIn(['head_office', 'branch'])
  branchType?: 'head_office' | 'branch';

  @ApiPropertyOptional({
    example: '00001',
    pattern: '^[0-9]{5}$',
    description: 'Branch number on the tax invoice (head office 00000)',
  })
  @IsOptional()
  @Matches(/^[0-9]{5}$/)
  branchCode?: string;

  @ApiProperty({ example: 'สาขาบางนา' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '99/9 ถนนบางนา-ตราด' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, example: null })
  @IsOptional()
  @IsUUID()
  subdistrictId?: string | null;

  @ApiProperty({ example: '10260', pattern: '^[0-9]{5}$' })
  @Matches(/^[0-9]{5}$/)
  postcode!: string;

  @ApiProperty({ format: 'uuid', example: IDS.province })
  @IsUUID()
  provinceId!: string;

  @ApiPropertyOptional({ example: false, description: 'Default branch for tax invoices' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CompanySignatoryDto {
  @ApiProperty({ example: 'สมชาย ทดสอบ', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'กรรมการผู้จัดการ', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  position!: string;
}

const PHONE = /^\+?[0-9 -]{6,40}$/;

export class ApplyCompanyDto {
  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Example Foods' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string | null;

  @ApiProperty({ example: '0000000000019', pattern: '^[0-9]{13}$' })
  @Matches(/^[0-9]{13}$/)
  taxId!: string;

  @ApiProperty({ example: true, description: 'ภ.พ.20 required in KYC when true (D-120)' })
  @IsBoolean()
  isVatRegistered!: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'The company withholds tax on payments (accounting-design §2)',
  })
  @IsOptional()
  @IsBoolean()
  withholdsTax?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'account@example.com' })
  @IsOptional()
  @IsEmail()
  documentEmail?: string | null;

  @ApiProperty({ type: CompanyBranchInputDto, description: 'The head office address (branch 00000)' })
  @ValidateNested()
  @Type(() => CompanyBranchInputDto)
  headOffice!: CompanyBranchInputDto;

  @ApiPropertyOptional({
    type: CompanySignatoryDto,
    description: 'The authorised signatory (D-120); required before the application is submitted for review',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanySignatoryDto)
  signatory?: CompanySignatoryDto;

  @ApiPropertyOptional({ example: '020000000', maxLength: 40, description: 'The company’s phone' })
  @IsOptional()
  @Matches(PHONE)
  contactPhone?: string;
}

export class UpdateCompanySettingsDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Example Foods' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'account@example.com' })
  @IsOptional()
  @IsEmail()
  documentEmail?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  withholdsTax?: boolean;

  @ApiPropertyOptional({
    enum: PO_POLICIES,
    enumName: 'PoNumberPolicy',
    example: 'required',
    description: 'D-125',
  })
  @IsOptional()
  @IsIn(PO_POLICIES)
  poNumberPolicy?: (typeof PO_POLICIES)[number];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '50000.00',
    description: 'Orders above this value wait for the company approver (D-123); null = never. Audited.',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  orderApprovalThreshold?: string | null;

  @ApiPropertyOptional({ type: CompanySignatoryDto, description: 'The authorised signatory (D-120)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanySignatoryDto)
  signatory?: CompanySignatoryDto;

  @ApiPropertyOptional({ type: String, nullable: true, example: '020000000' })
  @IsOptional()
  @Matches(PHONE)
  contactPhone?: string | null;
}

export class ChangeMemberRolesDto {
  @ApiProperty({ enum: COMPANY_ROLES, enumName: 'CompanyRole', isArray: true, example: ['company_buyer', 'company_approver'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsIn(COMPANY_ROLES, { each: true })
  roles!: (typeof COMPANY_ROLES)[number][];
}

export class AddCompanyKycDocumentDto {
  @ApiProperty({ enum: COMPANY_KYC_TYPES, enumName: 'CompanyKycDocType', example: 'company_certificate' })
  @IsIn(COMPANY_KYC_TYPES)
  docType!: (typeof COMPANY_KYC_TYPES)[number];

  @ApiProperty({ format: 'uuid', example: IDS.file, description: 'A file you uploaded (purpose `evidence`)' })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-09-01',
    description: 'Issue date (certificate ≤ 6 months, D-120)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  issuedOn?: string | null;
}

export class InviteMemberDto {
  @ApiPropertyOptional({
    example: '+66810001234',
    description: 'Phone (E.164) or e-mail of an existing customer account',
  })
  @IsOptional()
  @Matches(/^\+66[0-9]{8,9}$/)
  phone?: string;

  @ApiPropertyOptional({ example: 'buyer@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: COMPANY_ROLES, enumName: 'CompanyRole', isArray: true, example: ['company_buyer'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsIn(COMPANY_ROLES, { each: true })
  roles!: (typeof COMPANY_ROLES)[number][];
}

export class ReviewKycDocumentDto {
  @ApiProperty({ enum: ['verified', 'rejected'], enumName: 'KycReviewOutcome', example: 'verified' })
  @IsIn(['verified', 'rejected'])
  outcome!: 'verified' | 'rejected';

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CompanyBranchDto {
  @IdField(IDS.branch)
  id!: string;

  @ApiProperty({ enum: ['head_office', 'branch'], enumName: 'BranchType', example: 'head_office' })
  branchType!: string;

  @ApiProperty({ example: '00000' })
  branchCode!: string;

  @ApiProperty({ example: 'สำนักงานใหญ่' })
  name!: string;

  @ApiProperty({ example: '99/9 ถนนบางนา-ตราด' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  line2!: string | null;

  @ApiProperty({ example: '10260' })
  postcode!: string;

  @ApiProperty({ format: 'uuid', example: IDS.province })
  provinceId!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  provinceNameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  provinceNameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'บางนาเหนือ' })
  subdistrictNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bang Na Nuea' })
  subdistrictNameEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'บางนา' })
  districtNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bang Na' })
  districtNameEn!: string | null;

  @ApiProperty({ example: true })
  isDefault!: boolean;
}

export class CompanyMemberDto {
  @IdField(IDS.member)
  id!: string;

  @ApiProperty({ type: UserRefDto })
  user!: UserRefDto;

  @ApiProperty({ enum: ['invited', 'active', 'removed'], enumName: 'MemberStatus', example: 'active' })
  status!: string;

  @ApiProperty({ enum: COMPANY_ROLES, enumName: 'CompanyRole', isArray: true, example: ['company_admin'] })
  roles!: string[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:00:00+07:00' })
  joinedAt!: string | null;
}

export class CompanyKycDocumentDto {
  @IdField(IDS.document)
  id!: string;

  @ApiProperty({ enum: COMPANY_KYC_TYPES, enumName: 'CompanyKycDocType', example: 'company_certificate' })
  docType!: string;

  @ApiProperty({ format: 'uuid', example: IDS.file })
  fileId!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-09-01' })
  issuedOn!: string | null;

  @ApiProperty({
    enum: ['pending', 'verified', 'rejected', 'expired'],
    enumName: 'KycStatus',
    example: 'pending',
  })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;
}

/** What I may do in the company, from my company roles (D-123, D-125, D-227). */
export class CompanyCapabilitiesDto {
  @ApiProperty({ example: true, description: 'Invite, remove and change members' })
  manageMembers!: boolean;

  @ApiProperty({ example: true, description: 'Settings, branches, KYC, credit application' })
  manageSettings!: boolean;

  @ApiProperty({ example: true, description: 'Add and remove brand assets (D-227)' })
  manageAssets!: boolean;

  @ApiProperty({ example: false, description: 'Approve orders above the threshold (D-123)' })
  approveOrders!: boolean;

  @ApiProperty({ example: true, description: 'Invoices, statements, credit and spend' })
  viewFinance!: boolean;

  @ApiProperty({ example: true, description: 'Place orders for the company' })
  order!: boolean;
}

export class CompanyDto {
  @IdField(IDS.company)
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'CO-00001', description: 'Assigned at activation' })
  companyCode!: string | null;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  legalName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Example Foods' })
  tradeName!: string | null;

  @ApiProperty({ example: '0000000000019' })
  taxId!: string;

  @ApiProperty({ example: true })
  isVatRegistered!: boolean;

  @ApiProperty({ example: true })
  withholdsTax!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'account@example.com' })
  documentEmail!: string | null;

  @ApiProperty({ enum: COMPANY_STATUSES, enumName: 'CompanyStatus', example: 'active' })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Why it was sent back, suspended or closed',
  })
  statusReason!: string | null;

  @ApiProperty({
    enum: CREDIT_STATUSES,
    enumName: 'CreditStatus',
    example: 'prepaid',
    description: 'D-121 / D-122',
  })
  creditStatus!: string;

  @ApiProperty({ enum: PO_POLICIES, enumName: 'PoNumberPolicy', example: 'optional' })
  poNumberPolicy!: string;

  @ApiProperty({ type: String, nullable: true, example: '50000.00' })
  orderApprovalThreshold!: string | null;

  @ApiProperty({ type: CompanySignatoryDto, nullable: true, description: 'The authorised signatory (D-120)' })
  signatory!: CompanySignatoryDto | null;

  @ApiProperty({ type: String, nullable: true, example: '020000000' })
  contactPhone!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.0000',
    description: 'The company discount % in force (D-124, approved through a discount memo); null without one',
  })
  discountPct!: string | null;

  @ApiProperty({
    enum: COMPANY_ROLES,
    enumName: 'CompanyRole',
    isArray: true,
    example: ['company_admin'],
    description: 'My company roles (empty in staff views)',
  })
  myRoles!: string[];

  @ApiProperty({ type: CompanyCapabilitiesDto, description: 'What my roles allow (all false in staff views)' })
  can!: CompanyCapabilitiesDto;

  @ApiProperty({ type: [CompanyBranchDto] })
  branches!: CompanyBranchDto[];

  @ApiProperty({ type: [CompanyMemberDto] })
  members!: CompanyMemberDto[];

  @ApiProperty({ type: [CompanyKycDocumentDto] })
  kycDocuments!: CompanyKycDocumentDto[];

  @ApiProperty({
    type: [String],
    enum: COMPANY_KYC_TYPES,
    enumName: 'CompanyKycDocType',
    example: [],
    description: 'Documents still required before review (D-120)',
  })
  missingKyc!: string[];

  @TimestampField()
  createdAt!: string;
}

export class AdminCompanyDto extends CompanyDto {
  @ApiProperty({ type: 'integer', example: 2, description: 'Paid order groups (credit eligibility, D-121)' })
  paidOrdersCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  kycApprovedAt!: string | null;
}

export const COMPANY_EXAMPLE: CompanyDto = {
  id: IDS.company,
  companyCode: 'CO-00001',
  legalName: 'บริษัท ตัวอย่าง จำกัด',
  tradeName: 'Example Foods',
  taxId: '0000000000019',
  isVatRegistered: true,
  withholdsTax: true,
  documentEmail: 'account@example.com',
  status: 'active',
  statusReason: null,
  creditStatus: 'prepaid',
  poNumberPolicy: 'optional',
  orderApprovalThreshold: '50000.00',
  signatory: { name: 'สมชาย ทดสอบ', position: 'กรรมการผู้จัดการ' },
  contactPhone: '020000000',
  discountPct: null,
  myRoles: ['company_admin'],
  can: {
    manageMembers: true,
    manageSettings: true,
    manageAssets: true,
    approveOrders: false,
    viewFinance: true,
    order: true,
  },
  branches: [
    {
      id: IDS.branch,
      branchType: 'head_office',
      branchCode: '00000',
      name: 'สำนักงานใหญ่',
      line1: '99/9 ถนนบางนา-ตราด',
      line2: null,
      postcode: '10260',
      provinceId: IDS.province,
      provinceNameTh: 'กรุงเทพมหานคร',
      provinceNameEn: 'Bangkok',
      subdistrictNameTh: 'บางนาเหนือ',
      subdistrictNameEn: 'Bang Na Nuea',
      districtNameTh: 'บางนา',
      districtNameEn: 'Bang Na',
      isDefault: true,
    },
  ],
  members: [
    {
      id: IDS.member,
      user: { id: IDS.user, displayName: 'สมชาย ทดสอบ' },
      status: 'active',
      roles: ['company_admin'],
      joinedAt: '2026-10-01T10:00:00+07:00',
    },
  ],
  kycDocuments: [
    {
      id: IDS.document,
      docType: 'company_certificate',
      fileId: IDS.file,
      issuedOn: '2026-09-01',
      status: 'verified',
      note: null,
    },
  ],
  missingKyc: [],
  createdAt: '2026-10-01T10:00:00+07:00',
};

export const ADMIN_COMPANY_EXAMPLE: AdminCompanyDto = {
  ...COMPANY_EXAMPLE,
  paidOrdersCount: 2,
  kycApprovedAt: '2026-10-02T10:00:00+07:00',
};

export const APPLY_EXAMPLE = {
  legalName: 'บริษัท ตัวอย่าง จำกัด',
  taxId: '0000000000019',
  isVatRegistered: true,
  withholdsTax: true,
  documentEmail: 'account@example.com',
  headOffice: {
    name: 'สำนักงานใหญ่',
    line1: '99/9 ถนนบางนา-ตราด',
    postcode: '10260',
    provinceId: IDS.province,
  },
  signatory: { name: 'สมชาย ทดสอบ', position: 'กรรมการผู้จัดการ' },
  contactPhone: '020000000',
};

export class CompanyInvitationDto {
  @ApiProperty({ format: 'uuid', example: IDS.member, description: 'Accept with this id' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.company })
  companyId!: string;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  companyName!: string;

  @ApiProperty({ enum: COMPANY_ROLES, enumName: 'CompanyRole', isArray: true, example: ['company_buyer'] })
  roles!: string[];

  @ApiProperty({ type: UserRefDto, nullable: true })
  invitedBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  invitedAt!: string;
}

export const INVITATION_EXAMPLE: CompanyInvitationDto = {
  id: IDS.member,
  companyId: IDS.company,
  companyName: 'บริษัท ตัวอย่าง จำกัด',
  roles: ['company_buyer'],
  invitedBy: { id: IDS.user, displayName: 'สมชาย ทดสอบ' },
  invitedAt: '2026-10-01T10:00:00+07:00',
};

export class CompanyListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: COMPANY_STATUSES, enumName: 'CompanyStatus' })
  @IsOptional()
  @IsIn(COMPANY_STATUSES)
  status?: (typeof COMPANY_STATUSES)[number];
}

export class CompanyApprovalDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1010',
    description: 'The approval to decide',
  })
  id!: string;

  @ApiProperty({
    enum: ['pending', 'approved', 'rejected', 'withdrawn', 'expired'],
    enumName: 'ApprovalStatus',
    example: 'pending',
  })
  status!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1011' })
  groupId!: string;

  @ApiProperty({ example: 'OG-2610-00001' })
  groupCode!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PO-0001' })
  poNumber!: string | null;

  @ApiProperty({ example: '85600.00', description: 'Order value incl. VAT' })
  amount!: string;

  @ApiProperty({ type: UserRefDto, description: 'Who placed the order' })
  requester!: UserRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  requestedAt!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const COMPANY_APPROVAL_EXAMPLE: CompanyApprovalDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000c1010',
  status: 'pending',
  groupId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1011',
  groupCode: 'OG-2610-00001',
  poNumber: 'PO-0001',
  amount: '85600.00',
  requester: { id: IDS.user, displayName: 'สมชาย ทดสอบ' },
  requestedAt: '2026-10-01T10:00:00+07:00',
  currency: 'THB',
};

export class CompanyApprovalDecisionDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'อนุมัติตามงบประมาณ', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}
