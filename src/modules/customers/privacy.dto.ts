import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const PRIVACY_KINDS = ['export', 'deletion'] as const;
export const PRIVACY_STATUSES = ['submitted', 'completed', 'rejected'] as const;

export class CreatePrivacyRequestDto {
  @ApiProperty({ enum: PRIVACY_KINDS, enumName: 'PrivacyRequestKind', example: 'export' })
  @IsIn(PRIVACY_KINDS)
  kind!: (typeof PRIVACY_KINDS)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class PrivacyExportDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f101', description: 'Download it with `store.files.download`' })
  fileId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-08T10:00:00+07:00' })
  expiresAt!: string;
}

/** A PDPA request as its customer sees it (D-222). */
export class PrivacyRequestDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f100' })
  id!: string;

  @ApiProperty({ enum: PRIVACY_KINDS, enumName: 'PrivacyRequestKind', example: 'export' })
  kind!: string;

  @ApiProperty({ enum: PRIVACY_STATUSES, enumName: 'PrivacyRequestStatus', example: 'completed' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: "The Data Protection Officer's answer" })
  answer!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  requestedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-31T10:00:00+07:00', description: '`privacy.response_days` after the request' })
  dueAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:00:00+07:00' })
  decidedAt!: string | null;

  @ApiProperty({
    type: PrivacyExportDto,
    nullable: true,
    description: 'A completed export while it can still be downloaded (`privacy.export_link_days`)',
  })
  export!: PrivacyExportDto | null;
}

export class AdminPrivacyRequestDto extends PrivacyRequestDto {
  @ApiProperty({ type: UserRefDto })
  customer!: UserRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  decidedBy!: UserRefDto | null;

  @ApiProperty({ example: false })
  overdue!: boolean;
}

export class PrivacyQueueQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PRIVACY_STATUSES, enumName: 'PrivacyRequestStatus', example: 'submitted' })
  @IsOptional()
  @IsIn(PRIVACY_STATUSES)
  status?: (typeof PRIVACY_STATUSES)[number];
}

export class CompletePrivacyRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ส่งไฟล์ข้อมูลของคุณแล้ว', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  answer?: string | null;
}

export class RejectPrivacyRequestDto {
  @ApiProperty({ example: 'ไม่สามารถยืนยันตัวตนได้', minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  answer!: string;
}

export const PRIVACY_REQUEST_EXAMPLE: PrivacyRequestDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f100',
  kind: 'export',
  status: 'completed',
  note: null,
  answer: 'ส่งไฟล์ข้อมูลของคุณแล้ว',
  requestedAt: '2026-10-01T10:00:00+07:00',
  dueAt: '2026-10-31T10:00:00+07:00',
  decidedAt: '2026-10-01T11:00:00+07:00',
  export: { fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f101', expiresAt: '2026-10-08T11:00:00+07:00' },
};

export const ADMIN_PRIVACY_REQUEST_EXAMPLE: AdminPrivacyRequestDto = {
  ...PRIVACY_REQUEST_EXAMPLE,
  customer: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000c001', displayName: 'Somchai Test' },
  decidedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e801', displayName: 'Dev DPO' },
  overdue: false,
};
