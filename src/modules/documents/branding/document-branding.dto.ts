import { ErpPdfLinkDto } from '@modules/factory-erp/erp-e4.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { SIGNING_KINDS } from './document-branding.service';

/** Logos, seals and signatures on documents (D-428, D-429). */

export const BRAND_MARK_KINDS = ['logo', 'seal'] as const;

const FILE = '0192f3a0-7c1e-7d2a-9b1f-0000000d1001';
const SIGNATORY = '0192f3a0-7c1e-7d2a-9b1f-0000000d2001';
const USER = '0192f3a0-7c1e-7d2a-9b1f-0000000d3001';
const URL = 'https://files.example.test/financial_record/2026/10/0192f3a0?X-Amz-Signature=fake';

export class SetBrandMarkDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: FILE,
    description:
      'An image I uploaded (purpose `brand_mark`; for a factory also one uploaded for the factory), scanned clean. ' +
      '`null` removes the mark from now on. A seal photographed on white paper gets its paper made transparent.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  fileId!: string | null;
}

export class AddSignatoryDto {
  @ApiProperty({
    format: 'uuid',
    example: USER,
    description: 'An active staff member (getpack) or an active member of the factory',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'กรรมการผู้จัดการ', maxLength: 120, description: 'Printed under the signature' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  position!: string;
}

export class SetSigningRuleDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: SIGNATORY,
    description: 'Who signs this kind of document; null leaves the signature line blank',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  signatoryId!: string | null;

  @ApiProperty({ example: true, description: 'Stamp the company seal on this kind of document' })
  @IsBoolean()
  stampSeal!: boolean;
}

export class BrandingPreviewDto {
  @ApiProperty({ enum: SIGNING_KINDS, enumName: 'DocumentSigningKind', example: 'tax_invoice' })
  @IsIn(SIGNING_KINDS)
  docKind!: (typeof SIGNING_KINDS)[number];
}

export class UpdateMySignatureDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: FILE,
    description:
      'My signature image (purpose `signature`), scanned clean; `null` withdraws it, absent keeps the current one. ' +
      'Signed on white paper is fine: the paper is made transparent.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  fileId?: string | null;

  @ApiProperty({
    example: 'นายสมชาย ใจดี',
    maxLength: 120,
    description: 'Printed under the signature in brackets',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ example: 'กรรมการผู้จัดการ', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  position!: string;
}

export class SignatoryCandidatesQuery {
  @ApiPropertyOptional({ example: 'สมชาย', description: 'Part of the name or e-mail' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

// ---------------------------------------------------------------------------------------------------- views

export class BrandMarkDto {
  @ApiProperty({ enum: BRAND_MARK_KINDS, enumName: 'DocumentBrandMarkKind', example: 'logo' })
  kind!: string;

  @ApiProperty({ format: 'uuid', example: FILE, description: 'The processed PNG used on documents' })
  fileId!: string;

  @ApiProperty({ type: String, nullable: true, example: URL, description: 'Signed URL (5 minutes)' })
  url!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-23T10:00:00+07:00' })
  setAt!: string;

  @ApiProperty({ example: 'คุณสมหญิง (การเงิน)' })
  setBy!: string;
}

export class SignatoryDto {
  @ApiProperty({ format: 'uuid', example: SIGNATORY })
  id!: string;

  @ApiProperty({ format: 'uuid', example: USER })
  userId!: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  userName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'somchai@getpack.example' })
  email!: string | null;

  @ApiProperty({ example: 'นายสมชาย ใจดี', description: 'Printed under the signature' })
  displayName!: string;

  @ApiProperty({ example: 'กรรมการผู้จัดการ' })
  position!: string;

  @ApiProperty({ example: true, description: 'The signatory has uploaded a signature' })
  hasSignature!: boolean;

  @ApiProperty({ type: String, nullable: true, example: URL })
  signatureUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-23T10:05:00+07:00' })
  signatureUpdatedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-23T10:00:00+07:00' })
  addedAt!: string;
}

export class SigningRuleDto {
  @ApiProperty({ enum: SIGNING_KINDS, enumName: 'DocumentSigningKind', example: 'tax_invoice' })
  docKind!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: SIGNATORY })
  signatoryId!: string | null;

  @ApiProperty({ example: true })
  stampSeal!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-23T10:06:00+07:00' })
  changedAt!: string | null;
}

export class BrandingHistoryDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-23T10:06:00+07:00' })
  at!: string;

  @ApiProperty({ example: 'คุณสมหญิง (การเงิน)' })
  by!: string;

  @ApiProperty({
    enum: ['logo', 'seal', 'signatory_added', 'signatory_removed', 'signature', 'rule'],
    enumName: 'DocumentBrandingChange',
    example: 'rule',
  })
  change!: string;

  @ApiProperty({ example: 'tax_invoice' })
  detail!: string;
}

export class DocumentBrandingDto {
  @ApiProperty({ type: BrandMarkDto, nullable: true })
  @Type(() => BrandMarkDto)
  logo!: BrandMarkDto | null;

  @ApiProperty({ type: BrandMarkDto, nullable: true })
  @Type(() => BrandMarkDto)
  seal!: BrandMarkDto | null;

  @ApiProperty({ type: [SignatoryDto] })
  signatories!: SignatoryDto[];

  @ApiProperty({ type: [SigningRuleDto], description: 'One per kind of document the owner issues' })
  rules!: SigningRuleDto[];

  @ApiProperty({ type: [BrandingHistoryDto], description: 'Latest changes first (40)' })
  history!: BrandingHistoryDto[];
}

export class SignatoryCandidateDto {
  @ApiProperty({ format: 'uuid', example: USER })
  id!: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'somchai@getpack.example' })
  email!: string | null;
}

export class SignatoryOwnerDto {
  @ApiProperty({ enum: ['entity', 'factory'], enumName: 'DocumentOwnerKind', example: 'entity' })
  kind!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d4001' })
  id!: string;

  @ApiProperty({ example: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด' })
  name!: string;
}

export class MySignatoryDto {
  @ApiProperty({ format: 'uuid', example: SIGNATORY })
  id!: string;

  @ApiProperty({ type: SignatoryOwnerDto })
  owner!: SignatoryOwnerDto;

  @ApiProperty({ example: 'นายสมชาย ใจดี' })
  displayName!: string;

  @ApiProperty({ example: 'กรรมการผู้จัดการ' })
  position!: string;

  @ApiProperty({ example: true })
  hasSignature!: boolean;

  @ApiProperty({ type: String, nullable: true, example: URL })
  signatureUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-23T10:05:00+07:00' })
  signatureUpdatedAt!: string | null;

  @ApiProperty({
    enum: SIGNING_KINDS,
    enumName: 'DocumentSigningKind',
    isArray: true,
    example: ['tax_invoice', 'receipt'],
    description: 'The kinds of document that print my signature now',
  })
  signs!: string[];
}

export { ErpPdfLinkDto as BrandingPreviewLinkDto };

export const DOCUMENT_BRANDING_EXAMPLE: DocumentBrandingDto = {
  logo: {
    kind: 'logo',
    fileId: FILE,
    url: URL,
    setAt: '2026-10-23T10:00:00+07:00',
    setBy: 'คุณสมหญิง (การเงิน)',
  },
  seal: null,
  signatories: [
    {
      id: SIGNATORY,
      userId: USER,
      userName: 'สมชาย ใจดี',
      email: 'somchai@getpack.example',
      displayName: 'นายสมชาย ใจดี',
      position: 'กรรมการผู้จัดการ',
      hasSignature: true,
      signatureUrl: URL,
      signatureUpdatedAt: '2026-10-23T10:05:00+07:00',
      addedAt: '2026-10-23T10:00:00+07:00',
    },
  ],
  rules: [
    {
      docKind: 'tax_invoice',
      signatoryId: SIGNATORY,
      stampSeal: true,
      changedAt: '2026-10-23T10:06:00+07:00',
    },
  ],
  history: [
    { at: '2026-10-23T10:06:00+07:00', by: 'คุณสมหญิง (การเงิน)', change: 'rule', detail: 'tax_invoice' },
  ],
};

export const MY_SIGNATORY_EXAMPLE: MySignatoryDto = {
  id: SIGNATORY,
  owner: {
    kind: 'entity',
    id: '0192f3a0-7c1e-7d2a-9b1f-0000000d4001',
    name: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด',
  },
  displayName: 'นายสมชาย ใจดี',
  position: 'กรรมการผู้จัดการ',
  hasSignature: true,
  signatureUrl: URL,
  signatureUpdatedAt: '2026-10-23T10:05:00+07:00',
  signs: ['tax_invoice', 'receipt'],
};

export const BRANDING_PREVIEW_EXAMPLE: ErpPdfLinkDto = {
  url: URL,
  fileName: 'preview-tax_invoice.pdf',
  expiresAt: '2026-10-23T10:10:00+07:00',
};
