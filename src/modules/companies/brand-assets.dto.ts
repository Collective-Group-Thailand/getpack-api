import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** The company's brand asset library (D-227). */

export const COMPANY_ASSET_KINDS = ['logo', 'guideline', 'font', 'artwork', 'other'] as const;

export class AddCompanyAssetDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c2001',
    description: 'A file I uploaded (for the company or myself), scanned clean',
  })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ enum: COMPANY_ASSET_KINDS, enumName: 'CompanyAssetKind', example: 'logo' })
  @IsIn(COMPANY_ASSET_KINDS)
  kind!: (typeof COMPANY_ASSET_KINDS)[number];

  @ApiProperty({ example: 'โลโก้หลัก', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class CompanyAssetDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c2002' })
  id!: string;

  @ApiProperty({ enum: COMPANY_ASSET_KINDS, enumName: 'CompanyAssetKind', example: 'logo' })
  kind!: string;

  @ApiProperty({ example: 'โลโก้หลัก' })
  name!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c2001' })
  fileId!: string;

  @ApiProperty({ example: 'logo.png' })
  fileName!: string;

  @ApiProperty({ example: 'image/png' })
  mimeType!: string;

  @ApiProperty({ type: 'integer', example: 48213 })
  sizeBytes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://files.example.test/customer_content/2026/10/0192f3a0?X-Amz-Signature=fake',
    description: 'Signed download URL (5 minutes); null until the file is scanned clean',
  })
  url!: string | null;

  @ApiProperty({ type: UserRefDto, description: 'Who added it' })
  addedBy!: UserRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  addedAt!: string;
}

export const COMPANY_ASSET_EXAMPLE: CompanyAssetDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000c2002',
  kind: 'logo',
  name: 'โลโก้หลัก',
  fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000c2001',
  fileName: 'logo.png',
  mimeType: 'image/png',
  sizeBytes: 48213,
  url: 'https://files.example.test/customer_content/2026/10/0192f3a0?X-Amz-Signature=fake',
  addedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000c1007', displayName: 'สมชาย ทดสอบ' },
  addedAt: '2026-10-01T10:00:00+07:00',
};
