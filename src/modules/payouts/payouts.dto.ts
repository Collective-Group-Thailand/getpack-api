import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';

/** Payout runs (B5.3, accounting-design §6, D-022, D-093, D-164, D-166). Money: strings, THB. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const RUN_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'file_generated',
  'confirmed',
  'partially_failed',
  'rejected',
  'cancelled',
] as const;
export const PAYOUT_KINDS = ['advance', 'balance', 'retention_release', 'vendor_bill'] as const;
export const ITEM_STATUSES = ['included', 'paid', 'failed', 'excluded'] as const;
export const WHT_FORMS = ['pnd3', 'pnd53'] as const;

export const PAYOUT_IDS = {
  run: '0192f3a0-7c1e-7d2a-9b1f-000000530101',
  item: '0192f3a0-7c1e-7d2a-9b1f-000000530102',
  bank: '0192f3a0-7c1e-7d2a-9b1f-000000530103',
  approval: '0192f3a0-7c1e-7d2a-9b1f-000000530104',
  vendor: '0192f3a0-7c1e-7d2a-9b1f-000000530006',
  cert: '0192f3a0-7c1e-7d2a-9b1f-000000530105',
  file: '0192f3a0-7c1e-7d2a-9b1f-000000530106',
};

export class PayoutItemDto {
  @ApiProperty({
    format: 'uuid',
    example: PAYOUT_IDS.item,
    description: 'Also the reference in the bank file',
  })
  id!: string;

  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.vendor })
  vendorId!: string;

  @ApiProperty({ example: 'โรงพิมพ์ตัวอย่าง (fake)' })
  vendorName!: string;

  @ApiProperty({ enum: PAYOUT_KINDS, enumName: 'PayoutKind', example: 'balance' })
  kind!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0009',
    description: 'Last 4 digits of the vendor account; null when excluded',
  })
  bankAccountLast4!: string | null;

  @ApiProperty({ example: '5560.00' })
  apNetAmount!: string;

  @ApiProperty({ example: '389.20' })
  vatAmount!: string;

  @ApiProperty({
    example: true,
    description: 'Input VAT claimable now (a validated tax invoice) or parked in 1242',
  })
  vatClaimable!: boolean;

  @ApiProperty({ example: '166.80' })
  whtAmount!: string;

  @ApiProperty({ example: '5560.00' })
  whtBase!: string;

  @ApiProperty({ enum: WHT_FORMS, enumName: 'WhtForm', nullable: true, example: 'pnd53' })
  whtForm!: string | null;

  @ApiProperty({ example: '278.00', description: 'Retention held back (D-164)' })
  retentionAmount!: string;

  @ApiProperty({ example: '5504.40', description: 'Transferred = net + VAT − WHT − retention' })
  cashAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEVPV-26-00001' })
  pvNumber!: string | null;

  @ApiProperty({ enum: ITEM_STATUSES, enumName: 'PayoutItemStatus', example: 'included' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  bankRef!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  failureReason!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  paidOn!: string | null;
}

export class RunBankAccountDto {
  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.bank })
  id!: string;

  @ApiProperty({ example: '014' })
  bankCode!: string;

  @ApiProperty({ example: '1234' })
  accountNoLast4!: string;

  @ApiProperty({ example: '1121' })
  glAccountCode!: string;
}

export class PayoutRunDto {
  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.run })
  id!: string;

  @ApiProperty({ example: 'PR261020-001' })
  runNo!: string;

  @ApiProperty({ enum: RUN_STATUSES, enumName: 'PayoutRunStatus', example: 'proposed' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  payOn!: string;

  @ApiProperty({ type: RunBankAccountDto })
  bankAccount!: RunBankAccountDto;

  @ApiProperty({ example: 'generic_csv' })
  bankFormat!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: PAYOUT_IDS.approval })
  approvalRequestId!: string | null;

  @ApiProperty({ example: true })
  bankFileReady!: boolean;

  @ApiProperty({ example: '5560.00' })
  apNetAmount!: string;

  @ApiProperty({ example: '389.20' })
  vatAmount!: string;

  @ApiProperty({ example: '166.80' })
  whtAmount!: string;

  @ApiProperty({ example: '278.00' })
  retentionAmount!: string;

  @ApiProperty({ example: '5504.40' })
  cashAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [PayoutItemDto] })
  items!: PayoutItemDto[];
}

const ITEM_EXAMPLE: PayoutItemDto = {
  id: PAYOUT_IDS.item,
  vendorId: PAYOUT_IDS.vendor,
  vendorName: 'โรงพิมพ์ตัวอย่าง (fake)',
  kind: 'balance',
  bankAccountLast4: '0009',
  apNetAmount: '5560.00',
  vatAmount: '389.20',
  vatClaimable: true,
  whtAmount: '166.80',
  whtBase: '5560.00',
  whtForm: 'pnd53',
  retentionAmount: '278.00',
  cashAmount: '5504.40',
  pvNumber: null,
  status: 'included',
  bankRef: null,
  failureReason: null,
  paidOn: null,
};
export const RUN_EXAMPLE: PayoutRunDto = {
  id: PAYOUT_IDS.run,
  runNo: 'PR261020-001',
  status: 'proposed',
  payOn: '2026-10-27',
  bankAccount: { id: PAYOUT_IDS.bank, bankCode: '014', accountNoLast4: '1234', glAccountCode: '1121' },
  bankFormat: 'generic_csv',
  approvalRequestId: PAYOUT_IDS.approval,
  bankFileReady: false,
  apNetAmount: '5560.00',
  vatAmount: '389.20',
  whtAmount: '166.80',
  retentionAmount: '278.00',
  cashAmount: '5504.40',
  currency: 'THB',
  items: [ITEM_EXAMPLE],
};
export const PAID_ITEM_EXAMPLE: PayoutItemDto = {
  ...ITEM_EXAMPLE,
  status: 'paid',
  pvNumber: 'DEVPV-26-00001',
  bankRef: 'SCB0001',
  paidOn: '2026-10-27',
};

export class CreatePayoutRunDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Active company bank account the money leaves from (purpose payout / both)',
  })
  @IsUUID()
  companyBankAccountId!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-27',
    description: 'Payables eligible by this day are included',
  })
  @Matches(DAY)
  payOn!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Only these vendors (default: every vendor with eligible payables)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  vendorIds?: string[];

  @ApiPropertyOptional({
    example: 'generic_csv',
    description: 'Bank file adapter (default: the bank account’s)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankFormat?: string;
}

export class ConfirmationLineDto {
  @ApiProperty({ format: 'uuid', description: 'The payout item id echoed by the bank' })
  @IsUUID()
  reference!: string;

  @ApiProperty({ enum: ['paid', 'failed'], enumName: 'TransferOutcome', example: 'paid' })
  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';

  @ApiPropertyOptional({ example: 'SCB0001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankRef?: string;

  @ApiPropertyOptional({ example: 'บัญชีปิดแล้ว' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ConfirmPayoutRunDto {
  @ApiPropertyOptional({
    type: [ConfirmationLineDto],
    description: 'The bank’s result per item (or `fileId`)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ConfirmationLineDto)
  confirmations?: ConfirmationLineDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The bank’s confirmation file, parsed by the run’s adapter',
  })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class EligibleQuery {
  @ApiProperty({ format: 'date', example: '2026-10-27' })
  @Matches(DAY)
  payOn!: string;
}

export class PayoutExceptionDto {
  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.item })
  id!: string;

  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.run })
  runId!: string;

  @ApiProperty({ example: 'PR261020-001' })
  runNo!: string;

  @ApiProperty({ example: 'โรงพิมพ์ตัวอย่าง (fake)' })
  vendorName!: string;

  @ApiProperty({ enum: ITEM_STATUSES, enumName: 'PayoutItemStatus', example: 'failed' })
  status!: string;

  @ApiProperty({ example: '5504.40' })
  cashAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: 'บัญชีปิดแล้ว' })
  failureReason!: string | null;
}

export const EXCEPTION_EXAMPLE: PayoutExceptionDto = {
  id: PAYOUT_IDS.item,
  runId: PAYOUT_IDS.run,
  runNo: 'PR261020-001',
  vendorName: 'โรงพิมพ์ตัวอย่าง (fake)',
  status: 'failed',
  cashAmount: '5504.40',
  failureReason: 'บัญชีปิดแล้ว',
};

export class IssuedWhtCertificateDto {
  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.cert })
  id!: string;

  @ApiProperty({ example: 'DEVWT-26-00001' })
  wtNumber!: string;

  @ApiProperty({ enum: WHT_FORMS, enumName: 'WhtForm', example: 'pnd53' })
  form!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  paidOn!: string;

  @ApiProperty({ example: '5560.00' })
  paidAmount!: string;

  @ApiProperty({ example: '3.0000' })
  whtRatePct!: string;

  @ApiProperty({ example: '166.80' })
  whtAmount!: string;

  @ApiProperty({ example: true })
  pdfReady!: boolean;
}

export class PartnerPayoutDto {
  @ApiProperty({ format: 'uuid', example: PAYOUT_IDS.item })
  id!: string;

  @ApiProperty({ enum: PAYOUT_KINDS, enumName: 'PayoutKind', example: 'balance' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEVPV-26-00001' })
  pvNumber!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-27' })
  paidOn!: string | null;

  @ApiProperty({ example: '5560.00' })
  apNetAmount!: string;

  @ApiProperty({ example: '389.20' })
  vatAmount!: string;

  @ApiProperty({ example: '166.80' })
  whtAmount!: string;

  @ApiProperty({ example: '278.00' })
  retentionAmount!: string;

  @ApiProperty({ example: '5504.40' })
  cashAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: '0009' })
  bankAccountLast4!: string | null;

  @ApiProperty({ type: [IssuedWhtCertificateDto] })
  whtCertificates!: IssuedWhtCertificateDto[];
}

export const PARTNER_PAYOUT_EXAMPLE: PartnerPayoutDto = {
  id: PAYOUT_IDS.item,
  kind: 'balance',
  pvNumber: 'DEVPV-26-00001',
  paidOn: '2026-10-27',
  apNetAmount: '5560.00',
  vatAmount: '389.20',
  whtAmount: '166.80',
  retentionAmount: '278.00',
  cashAmount: '5504.40',
  bankAccountLast4: '0009',
  whtCertificates: [
    {
      id: PAYOUT_IDS.cert,
      wtNumber: 'DEVWT-26-00001',
      form: 'pnd53',
      paidOn: '2026-10-27',
      paidAmount: '5560.00',
      whtRatePct: '3.0000',
      whtAmount: '166.80',
      pdfReady: true,
    },
  ],
};

export class PayoutStatementQuery {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}
