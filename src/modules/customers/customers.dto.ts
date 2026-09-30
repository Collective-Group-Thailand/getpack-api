import { PageQuery } from '@common/pagination/pagination.dto';
import {
  BoolField,
  EnumField,
  IdField,
  RefField,
  TextField,
  TimestampField,
} from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Customers, addresses and tax profiles (schema-design §3.6, B3.1). Examples are obviously fake (PDPA). */

export const CUSTOMER_TYPES = ['individual', 'juristic', 'government'] as const;
export const ADDRESS_KINDS = ['delivery', 'billing'] as const;
export const BRANCH_TYPES = ['head_office', 'branch'] as const;
export const CREATION_CHANNELS = ['self', 'cs', 'line_liff'] as const;

export const CUSTOMER_IDS = {
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
  address: '0192f3a0-7c1e-7d2a-9b1f-0000000c0002',
  taxProfile: '0192f3a0-7c1e-7d2a-9b1f-0000000c0003',
  province: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004',
  subdistrict: '0192f3a0-7c1e-7d2a-9b1f-0000000c0005',
};

const PHONE = /^(\+[1-9]\d{7,14}|0\d{8,9})$/;
const POSTCODE = /^\d{5}$/;

function PhoneField(o: { optional?: boolean; description?: string } = {}) {
  const Doc = o.optional ? ApiPropertyOptional : ApiProperty;
  return (target: object, key: string) => {
    Doc({
      type: String,
      example: '+66810001234',
      pattern: PHONE.source,
      description: o.description ?? 'Thai (0…) or E.164 (+…); stored as E.164',
    })(target, key);
    if (o.optional) IsOptional()(target, key);
    IsString()(target, key);
    Matches(PHONE)(target, key);
  };
}

function PostcodeField() {
  return (target: object, key: string) => {
    ApiProperty({ type: String, example: '10110', pattern: POSTCODE.source })(target, key);
    IsString()(target, key);
    Matches(POSTCODE)(target, key);
  };
}

// --- addresses ------------------------------------------------------------------------------------

export class AddressInputDto {
  @EnumField(ADDRESS_KINDS, 'AddressKind', { example: 'delivery' })
  kind!: (typeof ADDRESS_KINDS)[number];

  @TextField({ example: 'สำนักงาน', max: 60, description: 'The customer’s own name for the address' })
  label!: string;

  @TextField({ example: 'สมชาย ทดสอบ', max: 120 })
  recipientName!: string;

  @PhoneField()
  phone!: string;

  @TextField({ example: '99/9 ถนนตัวอย่าง', max: 200 })
  line1!: string;

  @TextField({ example: 'อาคารทดสอบ ชั้น 9', max: 200, nullable: true, optional: true })
  line2?: string | null;

  @RefField({
    example: CUSTOMER_IDS.subdistrict,
    nullable: true,
    optional: true,
    description: 'Geography subdistrict; its postcode must match `postcode`',
  })
  subdistrictId?: string | null;

  @PostcodeField()
  postcode!: string;

  @RefField({ example: CUSTOMER_IDS.province })
  provinceId!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 13.7563, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 100.5018, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number | null;

  @BoolField({ example: true, optional: true, description: 'Default address of its kind' })
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @TextField({ example: 'สำนักงาน', max: 60, optional: true })
  label?: string;

  @TextField({ example: 'สมชาย ทดสอบ', max: 120, optional: true })
  recipientName?: string;

  @PhoneField({ optional: true })
  phone?: string;

  @TextField({ example: '99/9 ถนนตัวอย่าง', max: 200, optional: true })
  line1?: string;

  @TextField({ example: 'อาคารทดสอบ ชั้น 9', max: 200, nullable: true, optional: true })
  line2?: string | null;

  @RefField({ example: CUSTOMER_IDS.subdistrict, nullable: true, optional: true })
  subdistrictId?: string | null;

  @ApiPropertyOptional({ type: String, example: '10110', pattern: POSTCODE.source })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  postcode?: string;

  @RefField({ example: CUSTOMER_IDS.province, optional: true })
  provinceId?: string;

  @BoolField({ example: true, optional: true })
  isDefault?: boolean;
}

export class GeoRefDto {
  @IdField(CUSTOMER_IDS.province)
  id!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  nameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  nameEn!: string;
}

export class AddressDto {
  @IdField(CUSTOMER_IDS.address)
  id!: string;

  @ApiProperty({ enum: ADDRESS_KINDS, enumName: 'AddressKind', example: 'delivery' })
  kind!: string;

  @ApiProperty({ example: 'สำนักงาน' })
  label!: string;

  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  recipientName!: string;

  @ApiProperty({ example: '+66810001234', description: 'E.164' })
  phone!: string;

  @ApiProperty({ example: '99/9 ถนนตัวอย่าง' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: 'อาคารทดสอบ ชั้น 9' })
  line2!: string | null;

  @ApiProperty({ type: GeoRefDto, nullable: true })
  subdistrict!: GeoRefDto | null;

  @ApiProperty({ type: GeoRefDto })
  province!: GeoRefDto;

  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ type: Number, nullable: true, example: 13.7563 })
  lat!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 100.5018 })
  lng!: number | null;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @TimestampField()
  updatedAt!: string;
}

export const ADDRESS_EXAMPLE: AddressDto = {
  id: CUSTOMER_IDS.address,
  kind: 'delivery',
  label: 'สำนักงาน',
  recipientName: 'สมชาย ทดสอบ',
  phone: '+66810001234',
  line1: '99/9 ถนนตัวอย่าง',
  line2: 'อาคารทดสอบ ชั้น 9',
  subdistrict: { id: CUSTOMER_IDS.subdistrict, nameTh: 'แขวงตัวอย่าง', nameEn: 'Sample' },
  province: { id: CUSTOMER_IDS.province, nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' },
  postcode: '10110',
  lat: 13.7563,
  lng: 100.5018,
  isDefault: true,
  updatedAt: '2026-10-01T10:00:00+07:00',
};

export const ADDRESS_INPUT_EXAMPLE = {
  kind: 'delivery',
  label: 'สำนักงาน',
  recipientName: 'สมชาย ทดสอบ',
  phone: '0810001234',
  line1: '99/9 ถนนตัวอย่าง',
  subdistrictId: CUSTOMER_IDS.subdistrict,
  postcode: '10110',
  provinceId: CUSTOMER_IDS.province,
  isDefault: true,
};

export class AddressListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ADDRESS_KINDS, enumName: 'AddressKind' })
  @IsOptional()
  @IsIn(ADDRESS_KINDS)
  kind?: (typeof ADDRESS_KINDS)[number];
}

// --- tax profiles ---------------------------------------------------------------------------------

export class TaxProfileInputDto {
  @EnumField(CUSTOMER_TYPES, 'CustomerType', { example: 'juristic' })
  taxType!: (typeof CUSTOMER_TYPES)[number];

  @TextField({ example: 'บริษัท ตัวอย่าง จำกัด', max: 200, description: 'Buyer name on the tax invoice' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '0000000000019',
    pattern: '^\\d{13}$',
    description: 'Thai tax / citizen id; the check digit is validated',
  })
  @IsString()
  @Matches(/^\d{13}$/)
  taxId!: string;

  @EnumField(BRANCH_TYPES, 'BranchType', { example: 'head_office' })
  branchType!: (typeof BRANCH_TYPES)[number];

  @ApiPropertyOptional({
    type: String,
    example: '00000',
    pattern: '^\\d{5}$',
    description: 'Required for a branch; head office is always 00000',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/)
  branchCode?: string;

  @TextField({ example: '99/9 ถนนตัวอย่าง', max: 200 })
  line1!: string;

  @TextField({ example: 'อาคารทดสอบ ชั้น 9', max: 200, nullable: true, optional: true })
  line2?: string | null;

  @RefField({ example: CUSTOMER_IDS.subdistrict, nullable: true, optional: true })
  subdistrictId?: string | null;

  @PostcodeField()
  postcode!: string;

  @RefField({ example: CUSTOMER_IDS.province })
  provinceId!: string;

  @BoolField({
    example: false,
    optional: true,
    description: 'The customer withholds tax on payments (accounting-design §2, D-174)',
  })
  withholdsTax?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'account@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  documentEmail?: string | null;

  @BoolField({ example: true, optional: true })
  isDefault?: boolean;
}

export class UpdateTaxProfileDto {
  @TextField({ example: 'บริษัท ตัวอย่าง จำกัด', max: 200, optional: true })
  name?: string;

  @TextField({ example: '99/9 ถนนตัวอย่าง', max: 200, optional: true })
  line1?: string;

  @TextField({ example: 'อาคารทดสอบ ชั้น 9', max: 200, nullable: true, optional: true })
  line2?: string | null;

  @RefField({ example: CUSTOMER_IDS.subdistrict, nullable: true, optional: true })
  subdistrictId?: string | null;

  @ApiPropertyOptional({ type: String, example: '10110', pattern: POSTCODE.source })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  postcode?: string;

  @RefField({ example: CUSTOMER_IDS.province, optional: true })
  provinceId?: string;

  @BoolField({ example: false, optional: true })
  withholdsTax?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'account@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  documentEmail?: string | null;

  @BoolField({ example: true, optional: true })
  isDefault?: boolean;
}

export class TaxProfileDto {
  @IdField(CUSTOMER_IDS.taxProfile)
  id!: string;

  @ApiProperty({ enum: CUSTOMER_TYPES, enumName: 'CustomerType', example: 'juristic' })
  taxType!: string;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name!: string;

  @ApiProperty({ example: '0000000000019' })
  taxId!: string;

  @ApiProperty({ enum: BRANCH_TYPES, enumName: 'BranchType', example: 'head_office' })
  branchType!: string;

  @ApiProperty({ example: '00000' })
  branchCode!: string;

  @ApiProperty({ example: '99/9 ถนนตัวอย่าง' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: 'อาคารทดสอบ ชั้น 9' })
  line2!: string | null;

  @ApiProperty({ type: GeoRefDto, nullable: true })
  subdistrict!: GeoRefDto | null;

  @ApiProperty({ type: GeoRefDto })
  province!: GeoRefDto;

  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ example: false })
  withholdsTax!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'account@example.com' })
  documentEmail!: string | null;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @TimestampField()
  updatedAt!: string;
}

export const TAX_PROFILE_EXAMPLE: TaxProfileDto = {
  id: CUSTOMER_IDS.taxProfile,
  taxType: 'juristic',
  name: 'บริษัท ตัวอย่าง จำกัด',
  taxId: '0000000000019',
  branchType: 'head_office',
  branchCode: '00000',
  line1: '99/9 ถนนตัวอย่าง',
  line2: null,
  subdistrict: ADDRESS_EXAMPLE.subdistrict,
  province: ADDRESS_EXAMPLE.province,
  postcode: '10110',
  withholdsTax: true,
  documentEmail: 'account@example.com',
  isDefault: true,
  updatedAt: '2026-10-01T10:00:00+07:00',
};

export const TAX_PROFILE_INPUT_EXAMPLE = {
  taxType: 'juristic',
  name: 'บริษัท ตัวอย่าง จำกัด',
  taxId: '0000000000019',
  branchType: 'head_office',
  line1: '99/9 ถนนตัวอย่าง',
  postcode: '10110',
  provinceId: CUSTOMER_IDS.province,
  withholdsTax: true,
  isDefault: true,
};

// --- customer profile -----------------------------------------------------------------------------

export class CustomerProfileDto {
  @IdField(CUSTOMER_IDS.customer)
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CU-000042',
    description: 'Assigned at the first checkout or when CS creates the account',
  })
  customerCode!: string | null;

  @ApiProperty({ enum: CUSTOMER_TYPES, enumName: 'CustomerType', example: 'individual' })
  customerType!: string;

  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สมชาย' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ทดสอบ' })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'somchai@example.com' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66810001234' })
  phone!: string | null;

  @ApiProperty({ enum: CREATION_CHANNELS, enumName: 'CreationChannel', example: 'self' })
  createdVia!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'When I first saved my profile; null → the storefront asks for it (the customer type defaults to individual)',
  })
  profileCompletedAt!: string | null;

  @TimestampField()
  createdAt!: string;
}

export const CUSTOMER_PROFILE_EXAMPLE: CustomerProfileDto = {
  id: CUSTOMER_IDS.customer,
  customerCode: 'CU-000042',
  customerType: 'individual',
  displayName: 'สมชาย ทดสอบ',
  firstName: 'สมชาย',
  lastName: 'ทดสอบ',
  email: 'somchai@example.com',
  phone: '+66810001234',
  createdVia: 'self',
  profileCompletedAt: '2026-10-01T10:05:00+07:00',
  createdAt: '2026-10-01T10:00:00+07:00',
};

export class UpdateCustomerProfileDto {
  @EnumField(CUSTOMER_TYPES, 'CustomerType', { example: 'juristic', optional: true })
  customerType?: (typeof CUSTOMER_TYPES)[number];

  @TextField({ example: 'สมชาย ทดสอบ', max: 120, optional: true })
  displayName?: string;

  @TextField({ example: 'สมชาย', max: 80, nullable: true, optional: true })
  firstName?: string | null;

  @TextField({ example: 'ทดสอบ', max: 80, nullable: true, optional: true })
  lastName?: string | null;
}

// --- admin ----------------------------------------------------------------------------------------

export class AdminCustomerDto extends CustomerProfileDto {
  @ApiProperty({ example: 'active', description: 'Account status' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-02T09:00:00+07:00' })
  lastLoginAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'A company the customer is an active member of',
  })
  companyName!: string | null;

  @ApiProperty({ type: 'integer', example: 3, description: 'Order groups placed (not cancelled)' })
  ordersCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:00:00+07:00' })
  lastOrderAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PKO-7F3K',
    description: 'The customer’s referral code (D-136)',
  })
  referralCode!: string | null;
}

export const ADMIN_CUSTOMER_EXAMPLE: AdminCustomerDto = {
  ...CUSTOMER_PROFILE_EXAMPLE,
  createdVia: 'cs',
  status: 'active',
  lastLoginAt: null,
  companyName: null,
  ordersCount: 3,
  lastOrderAt: '2026-10-01T10:00:00+07:00',
  referralCode: null,
};

/** `q` searches phone (Thai or E.164), e-mail, name or customer code. */
export class CustomerListQuery extends PageQuery {
  @EnumField(CUSTOMER_TYPES, 'CustomerType', { example: 'juristic', optional: true })
  customerType?: (typeof CUSTOMER_TYPES)[number];

  @EnumField(CREATION_CHANNELS, 'CreationChannel', { example: 'cs', optional: true })
  createdVia?: (typeof CREATION_CHANNELS)[number];
}

export class FindOrCreateCustomerDto {
  @PhoneField({ optional: true, description: 'Phone (Thai or E.164); phone or e-mail is required' })
  phone?: string;

  @ApiPropertyOptional({ type: String, example: 'somchai@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @TextField({ example: 'สมชาย ทดสอบ', max: 120 })
  displayName!: string;

  @TextField({ example: 'สมชาย', max: 80, optional: true })
  firstName?: string;

  @TextField({ example: 'ทดสอบ', max: 80, optional: true })
  lastName?: string;

  @EnumField(CUSTOMER_TYPES, 'CustomerType', { example: 'individual', optional: true })
  customerType?: (typeof CUSTOMER_TYPES)[number];
}

export class FindOrCreateCustomerResultDto {
  @ApiProperty({ example: false, description: 'false when an existing customer matched' })
  created!: boolean;

  @ApiProperty({ type: AdminCustomerDto })
  customer!: AdminCustomerDto;
}
