import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.5, D-448): the style library page's staff-managed content —
 * `store.styleLibrary.getSettings` (public) and the back-office editor `admin.styleLibrary.getSettings` /
 * `updateSettings` (`styles.curate`: Admin, Marketing — D-246), kept in the effective-dated, audited setting
 * `storefront.style_library`. Shape = the getpack-web contract request `store.style-library.settings`, plus a
 * certificate's `expiresOn` and a logo's staff-only `permission`.
 */

const URL_RE = /^(https:\/\/\S+|\/\S*)$/;
const URL_HINT = 'An https link or a path on getpack’s own site';

export class LocalisedTextDto {
  @ApiProperty({ example: 'ใบกำกับภาษีเต็มรูปแบบทุกคำสั่งซื้อ' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  th!: string;

  @ApiProperty({ type: String, nullable: true, example: 'A full tax invoice with every order' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  en!: string | null;
}

export class QuickSearchTermDto {
  @ApiProperty({ type: LocalisedTextDto })
  @ValidateNested()
  @Type(() => LocalisedTextDto)
  label!: LocalisedTextDto;

  @ApiProperty({ example: 'เมลเลอร์' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  query!: string;
}

export class MaterialSwatchDto {
  @ApiProperty({ example: 'corrugated' })
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(40)
  materialClass!: string;

  @ApiProperty({ type: String, nullable: true, example: '#C8A27A', description: 'Board colour (#RRGGBB)' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  colour!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: URL_HINT })
  @IsOptional()
  @Matches(URL_RE)
  @MaxLength(2000)
  imageUrl!: string | null;
}

export class StoreTrustCertificationDto {
  @ApiProperty({ type: LocalisedTextDto })
  @ValidateNested()
  @Type(() => LocalisedTextDto)
  title!: LocalisedTextDto;

  @ApiProperty({ type: String, nullable: true, example: null, description: "The certificate's own number" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  number!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Who issued it' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  issuer!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: null,
    description: 'Last valid day (Asia/Bangkok); an expired certificate is not shown to customers',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: URL_HINT })
  @IsOptional()
  @Matches(URL_RE)
  @MaxLength(2000)
  documentUrl!: string | null;
}

export class TrustDocumentDto {
  @ApiProperty({ type: LocalisedTextDto })
  @ValidateNested()
  @Type(() => LocalisedTextDto)
  title!: LocalisedTextDto;

  @ApiProperty({ type: String, nullable: true, example: null, description: URL_HINT })
  @IsOptional()
  @Matches(URL_RE)
  @MaxLength(2000)
  documentUrl!: string | null;
}

export class TrustPhotoDto {
  @ApiProperty({ example: '/v1/store/catalog/images/0190a4b2-0000-7000-8000-000000000001', description: URL_HINT })
  @Matches(URL_RE)
  @MaxLength(2000)
  url!: string;

  @ApiProperty({ type: LocalisedTextDto, description: 'Alt text (product and process only, GLOBAL-RULES §1)' })
  @ValidateNested()
  @Type(() => LocalisedTextDto)
  alt!: LocalisedTextDto;
}

export class StoreCustomerLogoDto {
  @ApiProperty({ example: 'ร้านตัวอย่าง' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'https://example.invalid/logo.svg', description: URL_HINT })
  @Matches(URL_RE)
  @MaxLength(2000)
  logoUrl!: string;
}

export class CustomerLogoDto extends StoreCustomerLogoDto {
  @ApiProperty({
    example: 'อีเมลอนุญาตจากลูกค้า 2026-10-01 (CS ticket …)',
    description: "Where the customer's permission to show the logo is recorded — staff only, never published",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  permission!: string;
}

export class StoreTrustContentDto {
  @ApiProperty({ type: [StoreTrustCertificationDto], description: 'Not expired only' })
  certifications!: StoreTrustCertificationDto[];

  @ApiProperty({ type: [TrustDocumentDto] })
  foodGrade!: TrustDocumentDto[];

  @ApiProperty({ type: [TrustPhotoDto], description: 'Production-process photos ("รูปงานจริงระหว่างผลิต")' })
  productionPhotos!: TrustPhotoDto[];

  @ApiProperty({ type: [StoreCustomerLogoDto], description: 'Logos the customer permitted' })
  customerLogos!: StoreCustomerLogoDto[];

  @ApiProperty({ type: LocalisedTextDto, nullable: true, description: 'null = the storefront’s default note (D-010)' })
  taxInvoiceNote!: LocalisedTextDto | null;
}

export class StoreStyleLibrarySettingsDto {
  @ApiProperty({ type: [QuickSearchTermDto], description: '"ค้นหาบ่อย" in this order; empty hides the row' })
  quickSearch!: QuickSearchTermDto[];

  @ApiProperty({ type: 'integer', example: 3, description: 'Styles compared side by side (D-246)' })
  compareLimit!: number;

  @ApiProperty({ type: [MaterialSwatchDto] })
  materialSwatches!: MaterialSwatchDto[];

  @ApiProperty({ type: StoreTrustContentDto, description: 'Each part is hidden on the storefront while empty' })
  trust!: StoreTrustContentDto;
}

export class TrustContentDto {
  @ApiProperty({ type: [StoreTrustCertificationDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StoreTrustCertificationDto)
  certifications!: StoreTrustCertificationDto[];

  @ApiProperty({ type: [TrustDocumentDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TrustDocumentDto)
  foodGrade!: TrustDocumentDto[];

  @ApiProperty({ type: [TrustPhotoDto] })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => TrustPhotoDto)
  productionPhotos!: TrustPhotoDto[];

  @ApiProperty({ type: [CustomerLogoDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CustomerLogoDto)
  customerLogos!: CustomerLogoDto[];

  @ApiProperty({ type: LocalisedTextDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalisedTextDto)
  taxInvoiceNote!: LocalisedTextDto | null;
}

export class StyleLibraryContentDto {
  @ApiProperty({ type: [QuickSearchTermDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => QuickSearchTermDto)
  quickSearch!: QuickSearchTermDto[];

  @ApiProperty({ type: [MaterialSwatchDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MaterialSwatchDto)
  materialSwatches!: MaterialSwatchDto[];

  @ApiProperty({ type: TrustContentDto })
  @ValidateNested()
  @Type(() => TrustContentDto)
  trust!: TrustContentDto;
}

export class AdminStyleLibrarySettingsDto {
  @ApiProperty({ type: StyleLibraryContentDto, description: 'The content in force (empty while unset)' })
  content!: StyleLibraryContentDto;

  @ApiProperty({ type: 'integer', nullable: true, example: null, description: 'Version in force; null = unset' })
  versionNo!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  effectiveFrom!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The setting (`admin.settings.get`, version history); null before the reference seed ran',
  })
  settingId!: string | null;
}

export class UpdateStyleLibrarySettingsDto {
  @ApiProperty({ type: StyleLibraryContentDto })
  @ValidateNested()
  @Type(() => StyleLibraryContentDto)
  content!: StyleLibraryContentDto;

  @ApiProperty({ example: 'เพิ่มใบรับรอง FSC ที่ได้รับ', description: 'Why (kept with the version, audited)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-01T00:00:00+07:00',
    description: 'From when (now or later); default now',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export const EMPTY_STORE_STYLE_LIBRARY_EXAMPLE = {
  quickSearch: [],
  compareLimit: 3,
  materialSwatches: [],
  trust: { certifications: [], foodGrade: [], productionPhotos: [], customerLogos: [], taxInvoiceNote: null },
};
