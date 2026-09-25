import { PageQuery } from '@common/pagination/pagination.dto';
import {
  BoolField,
  EnumField,
  IdField,
  RefField,
  TextField,
  TimestampField,
} from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const FACTORY_STATUSES = [
  'applied',
  'under_review',
  'trial',
  'active',
  'suspended',
  'offboarded',
] as const;
export const JURISTIC_TYPES = ['company', 'partnership', 'individual'] as const;
export const ONBOARDING_MODES = ['self_service', 'assisted'] as const;
export const ONBOARDING_STEPS = [
  'application',
  'kyc',
  'bank_account',
  'capability',
  'capacity',
  'delivery_zones',
  'pricing_arrangement',
  'tolerance',
  'payout_policy',
  'agreement',
  'site_visit',
  'trial',
  'activation',
] as const;
export const ONBOARDING_STEP_STATUSES = [
  'pending',
  'in_progress',
  'submitted',
  'approved',
  'rejected',
  'waived',
] as const;
export const ADDRESS_KINDS = ['registered', 'plant', 'pickup'] as const;
export const KYC_DOC_TYPES = [
  'company_certificate',
  'vat_registration_pp20',
  'director_id',
  'signatory_id',
  'bank_book',
  'factory_licence',
  'financial_statement',
  'other',
] as const;
export const KYC_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;

export type FactoryStatusValue = (typeof FACTORY_STATUSES)[number];

const TS = '2026-09-26T10:00:00+07:00';
export const FACTORY_IDS = {
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f101',
  vendor: '0192f3a0-7c1e-7d2a-9b1f-00000000f102',
  address: '0192f3a0-7c1e-7d2a-9b1f-00000000f103',
  contact: '0192f3a0-7c1e-7d2a-9b1f-00000000f104',
  kyc: '0192f3a0-7c1e-7d2a-9b1f-00000000f105',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000f106',
  subdistrict: '0192f3a0-7c1e-7d2a-9b1f-00000000a203',
  user: '0192f3a0-7c1e-7d2a-9b1f-00000000f107',
  approval: '0192f3a0-7c1e-7d2a-9b1f-00000000f108',
} as const;

const TAX_ID = /^[0-9]{13}$/;
const BRANCH = /^[0-9]{5}$/;

// ------------------------------------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------------------------------------

export class OnboardingProgressDto {
  @ApiProperty({ type: 'integer', example: 5, description: 'Steps approved or waived' })
  done!: number;

  @ApiProperty({ type: 'integer', example: 13 })
  total!: number;
}

export class FactoryDto {
  @IdField(FACTORY_IDS.factory)
  id!: string;

  @ApiProperty({ example: 'F0001', description: 'Staff-facing code; never shown to customers (D-050)' })
  code!: string;

  @ApiProperty({ example: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด' })
  legalName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'โรงพิมพ์ตัวอย่าง' })
  tradeName!: string | null;

  @ApiProperty({ enum: JURISTIC_TYPES, enumName: 'JuristicType', example: 'company' })
  juristicType!: (typeof JURISTIC_TYPES)[number];

  @ApiProperty({ example: '0000000000019', description: 'Thai tax id (13 digits, check digit validated)' })
  taxId!: string;

  @ApiProperty({ example: '00000', description: 'Branch code; 00000 = head office' })
  branchCode!: string;

  @ApiProperty({
    example: true,
    description: 'Drives the effective cost to Collective Group (accounting-design.md §11)',
  })
  isVatRegistered!: boolean;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2020-01-15' })
  vatRegisteredOn!: string | null;

  @ApiProperty({ enum: FACTORY_STATUSES, enumName: 'FactoryStatus', example: 'under_review' })
  status!: FactoryStatusValue;

  @TimestampField(TS)
  statusChangedAt!: string;

  @ApiProperty({ enum: ONBOARDING_MODES, enumName: 'OnboardingMode', example: 'assisted' })
  onboardingMode!: (typeof ONBOARDING_MODES)[number];

  @ApiProperty({ type: String, nullable: true, example: null })
  lineGroupId!: string | null;

  @ApiProperty({ type: 'integer', example: 0, description: 'Completed trial jobs (D-076 first 3 jobs)' })
  trialJobsCompleted!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  activatedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  offboardedAt!: string | null;

  @ApiProperty({ type: OnboardingProgressDto })
  onboarding!: OnboardingProgressDto;

  @TimestampField(TS)
  updatedAt!: string;
}

export const FACTORY_EXAMPLE: FactoryDto = {
  id: FACTORY_IDS.factory,
  code: 'F0001',
  legalName: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด',
  tradeName: 'โรงพิมพ์ตัวอย่าง',
  juristicType: 'company',
  taxId: '0000000000019',
  branchCode: '00000',
  isVatRegistered: true,
  vatRegisteredOn: '2020-01-15',
  status: 'under_review',
  statusChangedAt: TS,
  onboardingMode: 'assisted',
  lineGroupId: null,
  trialJobsCompleted: 0,
  activatedAt: null,
  offboardedAt: null,
  onboarding: { done: 5, total: 13 },
  updatedAt: TS,
};

export class CreateFactoryDto {
  @TextField({ example: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด', max: 300 })
  legalName!: string;

  @TextField({ example: 'โรงพิมพ์ตัวอย่าง', nullable: true, max: 200 })
  tradeName?: string | null;

  @EnumField(JURISTIC_TYPES, 'JuristicType', { example: 'company' })
  juristicType!: (typeof JURISTIC_TYPES)[number];

  @ApiProperty({ example: '0000000000019', pattern: TAX_ID.source })
  @IsString()
  @Matches(TAX_ID)
  taxId!: string;

  @ApiPropertyOptional({ example: '00000', pattern: BRANCH.source, default: '00000' })
  @IsOptional()
  @IsString()
  @Matches(BRANCH)
  branchCode?: string;

  @BoolField({ example: true })
  isVatRegistered!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2020-01-15' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vatRegisteredOn?: Date | null;

  @EnumField(ONBOARDING_MODES, 'OnboardingMode', {
    example: 'assisted',
    description:
      '`assisted` = Packio staff enter data on the factory’s behalf, the factory signs off (D-100 note)',
  })
  onboardingMode!: (typeof ONBOARDING_MODES)[number];

  @TextField({ example: null, nullable: true, max: 100 })
  lineGroupId?: string | null;
}

export class UpdateFactoryDto extends PartialType(CreateFactoryDto) {}

/** What a factory may edit itself while it is `applied` or `under_review`. */
export class UpdateOwnFactoryDto {
  @TextField({ example: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด', optional: true, max: 300 })
  legalName?: string;

  @TextField({ example: 'โรงพิมพ์ตัวอย่าง', nullable: true, max: 200 })
  tradeName?: string | null;

  @EnumField(JURISTIC_TYPES, 'JuristicType', { example: 'company', optional: true })
  juristicType?: (typeof JURISTIC_TYPES)[number];

  @ApiPropertyOptional({ example: '0000000000019', pattern: TAX_ID.source })
  @IsOptional()
  @IsString()
  @Matches(TAX_ID)
  taxId?: string;

  @ApiPropertyOptional({ example: '00000', pattern: BRANCH.source })
  @IsOptional()
  @IsString()
  @Matches(BRANCH)
  branchCode?: string;

  @BoolField({ example: true, optional: true })
  isVatRegistered?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2020-01-15' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vatRegisteredOn?: Date | null;
}

export class FactoryListQuery extends PageQuery {
  @EnumField(FACTORY_STATUSES, 'FactoryStatus', { example: 'active', optional: true })
  status?: FactoryStatusValue;
}

export class ReasonBodyDto {
  @TextField({ example: 'Site visit passed; trial jobs agreed with the owner', max: 1000 })
  reason!: string;
}

export class ActivationRequestDto {
  @ApiProperty({
    format: 'uuid',
    example: FACTORY_IDS.approval,
    description: 'The `partner_activation` approval request',
  })
  approvalRequestId!: string;

  @ApiProperty({ enum: FACTORY_STATUSES, enumName: 'FactoryStatus', example: 'trial' })
  status!: FactoryStatusValue;
}

export class CreateOwnerAccountDto {
  @ApiProperty({ example: 'owner@factory.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @TextField({ example: 'เจ้าของ โรงงานทดสอบ', max: 200 })
  displayName!: string;

  @ApiProperty({
    example: 'temporary-passphrase-1',
    description:
      'Initial password handed over out of band; argon2id (ADR-0004). The owner changes it after sign-in.',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  initialPassword!: string;
}

export class OwnerAccountDto {
  @ApiProperty({ format: 'uuid', example: FACTORY_IDS.user })
  userId!: string;

  @ApiProperty({ example: 'owner@factory.example' })
  email!: string;

  @ApiProperty({ example: 'factory_owner' })
  role!: string;
}

// ------------------------------------------------------------------------------------------------
// Onboarding steps
// ------------------------------------------------------------------------------------------------

export class OnboardingStepDto {
  @ApiProperty({ enum: ONBOARDING_STEPS, enumName: 'OnboardingStep', example: 'capability' })
  step!: (typeof ONBOARDING_STEPS)[number];

  @ApiProperty({ enum: ONBOARDING_STEP_STATUSES, enumName: 'OnboardingStepStatus', example: 'submitted' })
  status!: (typeof ONBOARDING_STEP_STATUSES)[number];

  @ApiProperty({
    example: true,
    description: 'Packio staff entered the data (assisted onboarding, D-100 note)',
  })
  enteredByStaff!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Factory sign-off of staff-entered data',
  })
  factorySignedOffAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'รอเอกสาร ภ.พ.20' })
  notes!: string | null;
}

export class UpdateOnboardingStepDto {
  @EnumField(ONBOARDING_STEP_STATUSES, 'OnboardingStepStatus', { example: 'approved' })
  status!: (typeof ONBOARDING_STEP_STATUSES)[number];

  @TextField({ example: 'เอกสารครบ', nullable: true, max: 2000 })
  notes?: string | null;
}

// ------------------------------------------------------------------------------------------------
// Addresses, contacts
// ------------------------------------------------------------------------------------------------

export class FactoryAddressDto {
  @IdField(FACTORY_IDS.address)
  id!: string;

  @ApiProperty({ enum: ADDRESS_KINDS, enumName: 'FactoryAddressKind', example: 'plant' })
  kind!: (typeof ADDRESS_KINDS)[number];

  @ApiProperty({ example: '99/9 ถนนตัวอย่าง' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: 'นิคมอุตสาหกรรมตัวอย่าง' })
  line2!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: FACTORY_IDS.subdistrict })
  subdistrictId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10200' })
  postcode!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 13.75 })
  lat!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 100.5 })
  lng!: number | null;
}

export class CreateFactoryAddressDto {
  @EnumField(ADDRESS_KINDS, 'FactoryAddressKind', { example: 'plant' })
  kind!: (typeof ADDRESS_KINDS)[number];

  @TextField({ example: '99/9 ถนนตัวอย่าง', max: 300 })
  line1!: string;

  @TextField({ example: 'นิคมอุตสาหกรรมตัวอย่าง', nullable: true, max: 300 })
  line2?: string | null;

  @RefField({ example: FACTORY_IDS.subdistrict, nullable: true })
  subdistrictId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10200', pattern: '^[0-9]{5}$' })
  @IsOptional()
  @Matches(/^[0-9]{5}$/)
  postcode?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 13.75, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  lat?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 100.5, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  lng?: number | null;
}

export class UpdateFactoryAddressDto extends PartialType(CreateFactoryAddressDto) {}

export class FactoryContactDto {
  @IdField(FACTORY_IDS.contact)
  id!: string;

  @ApiProperty({ example: 'ผู้ติดต่อ ทดสอบ' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ผู้จัดการฝ่ายผลิต' })
  roleTitle!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66810001234' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'contact@factory.example' })
  email!: string | null;

  @ApiProperty({ example: true })
  isPrimary!: boolean;
}

export class CreateFactoryContactDto {
  @TextField({ example: 'ผู้ติดต่อ ทดสอบ', max: 200 })
  name!: string;

  @TextField({ example: 'ผู้จัดการฝ่ายผลิต', nullable: true, max: 200 })
  roleTitle?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+66810001234',
    pattern: '^\\+[1-9][0-9]{7,14}$',
  })
  @IsOptional()
  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'contact@factory.example' })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @BoolField({ example: true, optional: true })
  isPrimary?: boolean;
}

export class UpdateFactoryContactDto extends PartialType(CreateFactoryContactDto) {}

// ------------------------------------------------------------------------------------------------
// KYC documents
// ------------------------------------------------------------------------------------------------

export class KycDocumentDto {
  @IdField(FACTORY_IDS.kyc)
  id!: string;

  @ApiProperty({ enum: KYC_DOC_TYPES, enumName: 'KycDocType', example: 'company_certificate' })
  docType!: (typeof KYC_DOC_TYPES)[number];

  @ApiProperty({ format: 'uuid', example: FACTORY_IDS.file })
  fileId!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-08-01' })
  issuedOn!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  expiresOn!: string | null;

  @ApiProperty({ enum: KYC_STATUSES, enumName: 'KycStatus', example: 'pending' })
  status!: (typeof KYC_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  verifiedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;
}

export class CreateKycDocumentDto {
  @EnumField(KYC_DOC_TYPES, 'KycDocType', { example: 'company_certificate' })
  docType!: (typeof KYC_DOC_TYPES)[number];

  @RefField({ example: FACTORY_IDS.file, description: 'Uploaded file (purpose `evidence` or `document`)' })
  fileId!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-08-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedOn?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: null })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresOn?: Date | null;
}

export class ReviewKycDocumentDto {
  @EnumField(['verified', 'rejected'] as const, 'KycReviewOutcome', { example: 'verified' })
  outcome!: 'verified' | 'rejected';

  @TextField({ example: 'หนังสือรับรองอายุไม่เกิน 6 เดือน', nullable: true, max: 1000 })
  note?: string | null;
}
