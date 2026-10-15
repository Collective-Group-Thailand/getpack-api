import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PAYOUT_TRIGGERS } from '@modules/partners/configuration/configuration.dto';
import { PAYABLE_SOURCES, PAYABLE_STATUSES, PO_STATUSES } from '@modules/payables/payables.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
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
/** D-421 adds ภ.ง.ด.1 (commission to individuals); the factory ERP's own `WhtForm` stays pnd3 / pnd53. */
export const WHT_FORMS = ['pnd3', 'pnd53', 'pnd1'] as const;
/** What a factory sees of its payout items (U-B0.3): an excluded item never reaches it. */
export const PARTNER_ITEM_STATUSES = ['included', 'paid', 'failed'] as const;

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

  @ApiProperty({ enum: WHT_FORMS, enumName: 'PayoutWhtForm', nullable: true, example: 'pnd53' })
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

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in user may do on the run now (U-B0.3)',
  })
  nextActions!: NextActionDto[];
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
  nextActions: [{ key: 'payout_run.propose', irreversible: false, disabledReason: null }],
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
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2003',
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
  @ApiProperty({
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2002',
    format: 'uuid',
    description: 'The payout item id echoed by the bank',
  })
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
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2001',
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

  @ApiProperty({ enum: WHT_FORMS, enumName: 'PayoutWhtForm', example: 'pnd53' })
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

export class WhtCertificateDownloadDto extends IssuedWhtCertificateDto {
  @ApiProperty({
    type: DownloadUrlDto,
    nullable: true,
    description: 'Short-lived signed URL; null while not rendered',
  })
  download!: DownloadUrlDto | null;
}

/** The documents of a paid payout item (U-B0.3): remittance advice and 50 ทวิ, as short-lived signed URLs. */
export class PayoutItemDocumentsDto {
  @ApiProperty({ type: DownloadUrlDto })
  remittanceAdvice!: DownloadUrlDto;

  @ApiProperty({ type: [WhtCertificateDownloadDto] })
  whtCertificates!: WhtCertificateDownloadDto[];
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

  @ApiProperty({
    enum: PARTNER_ITEM_STATUSES,
    enumName: 'PartnerPayoutStatus',
    example: 'paid',
    description:
      '`included`: in a payout run not yet confirmed by the bank; `failed`: the transfer failed (U-B0.3)',
  })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27', description: 'The run’s planned transfer date' })
  payOn!: string;

  @ApiProperty({
    example: '0.00',
    description:
      'Claim deductions (D-083) applied to the payables this payout settles; not part of `retentionAmount`',
  })
  claimDeductionAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
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
  status: 'paid',
  payOn: '2026-10-27',
  claimDeductionAmount: '0.00',
  currency: 'THB',
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

  @ApiPropertyOptional({
    enum: PARTNER_ITEM_STATUSES,
    enumName: 'PartnerPayoutStatus',
    description:
      'Default `paid`; dates filter the paid date of paid items, the planned date of the others (U-B0.3)',
  })
  @IsOptional()
  @IsIn(PARTNER_ITEM_STATUSES)
  status?: (typeof PARTNER_ITEM_STATUSES)[number];
}

/** One payable a payout settles (U-B0.3). */
export class PayoutAllocationDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000530201' })
  payableId!: string;

  @ApiProperty({ enum: PAYABLE_SOURCES, enumName: 'PayableSource', example: 'goods_receipt' })
  source!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEVPO-26-00001' })
  poNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'J-2610-0001' })
  jobNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'DEV-2610-0001' })
  orderCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'DEVGR-26-00001' })
  grNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'DEVBS-26-00001' })
  bsNumber!: string | null;

  @ApiProperty({ example: '5560.00' })
  netAmount!: string;

  @ApiProperty({ example: '389.20' })
  vatAmount!: string;
}

export class PayoutClaimDeductionDto {
  @ApiProperty({ type: String, nullable: true, example: 'DEVCL-26-00001' })
  claimNo!: string | null;

  @ApiProperty({ example: '500.00' })
  amount!: string;
}

/** One payout of the factory with what it settles (U-B0.3, D-022, D-164, D-166). */
export class PartnerPayoutDetailDto extends PartnerPayoutDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'B123456',
    description: 'The bank’s transfer reference',
  })
  bankRef!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why the transfer failed' })
  failureReason!: string | null;

  @ApiProperty({
    example: true,
    description: 'A paid payout has a remittance advice: `partner.payables.payoutDocuments` downloads it',
  })
  remittanceAdviceAvailable!: boolean;

  @ApiProperty({ type: [PayoutAllocationDto] })
  allocations!: PayoutAllocationDto[];

  @ApiProperty({ type: [PayoutClaimDeductionDto] })
  claimDeductions!: PayoutClaimDeductionDto[];
}

export const PARTNER_PAYOUT_DETAIL_EXAMPLE: PartnerPayoutDetailDto = {
  ...PARTNER_PAYOUT_EXAMPLE,
  bankRef: 'B123456',
  failureReason: null,
  remittanceAdviceAvailable: true,
  allocations: [
    {
      payableId: '0192f3a0-7c1e-7d2a-9b1f-000000530201',
      source: 'goods_receipt',
      poNumber: 'DEVPO-26-00001',
      jobNo: 'J-2610-0001',
      orderCode: 'DEV-2610-0001',
      grNumber: 'DEVGR-26-00001',
      bsNumber: 'DEVBS-26-00001',
      netAmount: '5560.00',
      vatAmount: '389.20',
    },
  ],
  claimDeductions: [],
};

/** What a payable item still waits for before the factory is paid (U-B0.3). */
export const PAYOUT_WAITING_FOR = ['eligibility_date', 'payout_run', 'bank_confirmation'] as const;

export class PayoutScheduleItemDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000530201' })
  id!: string;

  @ApiProperty({
    enum: PAYABLE_SOURCES,
    enumName: 'PayableSource',
    example: 'goods_receipt',
    description: '`advance`, `goods_receipt` (the balance) or `retention` (D-022, D-164)',
  })
  source!: string;

  @ApiProperty({ enum: PAYABLE_STATUSES, enumName: 'PayableStatus', example: 'open' })
  status!: string;

  @ApiProperty({ example: '5560.00' })
  netAmount!: string;

  @ApiProperty({ example: '389.20' })
  vatAmount!: string;

  @ApiProperty({ example: '5560.00', description: 'Still to pay (after claim deductions)' })
  openNetAmount!: string;

  @ApiProperty({ example: '389.20' })
  openVatAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-20T10:00:00+07:00' })
  eligibleAt!: string | null;

  @ApiProperty({
    enum: PAYOUT_WAITING_FOR,
    enumName: 'PayoutWaitingFor',
    nullable: true,
    example: 'eligibility_date',
    description: 'null once paid or cancelled',
  })
  waitingFor!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  paidOn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The payout that paid it (`partner.payables.getPayout`)',
  })
  payoutId!: string | null;
}

/** The payout terms a job's PO keeps (D-022, D-164): the factory's approved policy, else the platform defaults. */
export class PayoutTermsDto {
  @ApiProperty({ example: '30.0000' })
  advancePct!: string;

  @ApiProperty({ enum: PAYOUT_TRIGGERS, enumName: 'PayoutTrigger', example: 'job_accepted' })
  advanceTrigger!: string;

  @ApiProperty({ enum: PAYOUT_TRIGGERS, enumName: 'PayoutTrigger', example: 'after_pod_and_claim_window' })
  balanceTrigger!: string;

  @ApiProperty({ type: 'integer', example: 7 })
  claimWindowDays!: number;

  @ApiProperty({ example: '5.0000' })
  retentionPct!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  retentionReleaseDays!: number;

  @ApiProperty({ type: 'integer', example: 30 })
  paymentTermsDays!: number;
}

export class PayoutScheduleJobDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000530301' })
  purchaseOrderId!: string;

  @ApiProperty({ example: 'DEVPO-26-00001' })
  poNumber!: string;

  @ApiProperty({ enum: PO_STATUSES, enumName: 'PoStatus', example: 'accepted' })
  poStatus!: string;

  @ApiProperty({ example: 'J-2610-0001' })
  jobNo!: string;

  @ApiProperty({ example: 'DEV-2610-0001' })
  orderCode!: string;

  @ApiProperty({ type: PayoutTermsDto })
  terms!: PayoutTermsDto;

  @ApiProperty({
    example: true,
    description:
      'The balance is not payable yet: it opens with the goods receipt at proof of delivery (D-165)',
  })
  balancePending!: boolean;

  @ApiProperty({ type: [PayoutScheduleItemDto] })
  items!: PayoutScheduleItemDto[];
}

export const PAYOUT_SCHEDULE_EXAMPLE: PayoutScheduleJobDto = {
  purchaseOrderId: '0192f3a0-7c1e-7d2a-9b1f-000000530301',
  poNumber: 'DEVPO-26-00001',
  poStatus: 'accepted',
  jobNo: 'J-2610-0001',
  orderCode: 'DEV-2610-0001',
  terms: {
    advancePct: '30.0000',
    advanceTrigger: 'job_accepted',
    balanceTrigger: 'after_pod_and_claim_window',
    claimWindowDays: 7,
    retentionPct: '5.0000',
    retentionReleaseDays: 30,
    paymentTermsDays: 30,
  },
  balancePending: true,
  items: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-000000530201',
      source: 'advance',
      status: 'paid',
      netAmount: '2388.00',
      vatAmount: '167.16',
      openNetAmount: '0.00',
      openVatAmount: '0.00',
      eligibleAt: '2026-10-06T10:00:00+07:00',
      waitingFor: null,
      paidOn: '2026-10-07',
      payoutId: PAYOUT_IDS.item,
    },
  ],
};

/** What moves the factory's balance with Packio (U-B0.3): the journal source of each entry. */
export const ACCOUNT_ENTRY_KINDS = [
  'goods_receipt',
  'advance_offset',
  'payout',
  'deduction',
  'adjustment',
] as const;

export class StatementOfAccountEntryDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  date!: string;

  @ApiProperty({ enum: ACCOUNT_ENTRY_KINDS, enumName: 'AccountEntryKind', example: 'goods_receipt' })
  kind!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'DEVGR-26-00001',
    description: 'GR, PO (advance applied), PV or claim number',
  })
  reference!: string | null;

  @ApiProperty({ example: '0.00', description: 'Lowers what Packio owes the factory (payments, deductions)' })
  debit!: string;

  @ApiProperty({ example: '7960.00', description: 'Raises what Packio owes the factory (goods received)' })
  credit!: string;

  @ApiProperty({ example: '5404.84', description: 'Running balance after the entry' })
  balance!: string;
}

/**
 * The factory's account with Packio (U-B0.3): Packio's posted ledger lines for the factory — factory payables, retention
 * held, advances and claim receivables (accounting-design §5) — excluding VAT, which Packio books at payment (§2).
 * A positive balance is what Packio owes the factory.
 */
export class StatementOfAccountDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000f01' })
  factoryId!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: '-2388.00', description: 'Balance before `from`' })
  opening!: string;

  @ApiProperty({ example: '2388.00' })
  totalDebit!: string;

  @ApiProperty({ example: '7960.00' })
  totalCredit!: string;

  @ApiProperty({ example: '3184.00' })
  closing!: string;

  @ApiProperty({ type: [StatementOfAccountEntryDto] })
  entries!: StatementOfAccountEntryDto[];
}

export const STATEMENT_OF_ACCOUNT_EXAMPLE: StatementOfAccountDto = {
  factoryId: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
  from: '2026-10-01',
  to: '2026-10-31',
  currency: 'THB',
  opening: '-2388.00',
  totalDebit: '2388.00',
  totalCredit: '7960.00',
  closing: '3184.00',
  entries: [
    {
      date: '2026-10-20',
      kind: 'goods_receipt',
      reference: 'DEVGR-26-00001',
      debit: '0.00',
      credit: '7960.00',
      balance: '5572.00',
    },
    {
      date: '2026-10-20',
      kind: 'advance_offset',
      reference: 'DEVPO-26-00001',
      debit: '2388.00',
      credit: '2388.00',
      balance: '5572.00',
    },
  ],
};

export class StatementOfAccountQuery {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Default: the first day of this month',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Default: today (Asia/Bangkok)',
  })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}
