import { EnumField, IdField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsString, Matches } from 'class-validator';

export const BANK_ACCOUNT_STATUSES = ['pending_approval', 'active', 'superseded', 'rejected'] as const;
export const VERIFICATION_OUTCOMES = ['confirmed', 'mismatch', 'unreachable'] as const;

export const BANK_IDS = {
  account: '0192f3a0-7c1e-7d2a-9b1f-00000000f201',
  approval: '0192f3a0-7c1e-7d2a-9b1f-00000000f202',
} as const;

export class VerificationCallDto {
  @ApiProperty({ enum: VERIFICATION_OUTCOMES, enumName: 'BankVerificationOutcome', example: 'confirmed' })
  outcome!: (typeof VERIFICATION_OUTCOMES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-09-26T11:00:00+07:00' })
  calledAt!: string;

  @ApiProperty({
    example: '08x-xxx-1234',
    description: 'Number called, masked (§8: the call is logged, PDPA)',
  })
  calledNumberMasked!: string;
}

/** A vendor bank account; the number is never returned, only its last 4 digits (PDPA). */
export class BankAccountDto {
  @IdField(BANK_IDS.account)
  id!: string;

  @ApiProperty({ example: '014', description: 'Bank code' })
  bankCode!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สาขาตัวอย่าง' })
  branchName!: string | null;

  @ApiProperty({ example: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด' })
  accountName!: string;

  @ApiProperty({ example: '6789' })
  accountNoLast4!: string;

  @ApiProperty({ enum: BANK_ACCOUNT_STATUSES, enumName: 'BankAccountStatus', example: 'pending_approval' })
  status!: (typeof BANK_ACCOUNT_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  effectiveFrom!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: BANK_IDS.approval,
    description: 'Dual approval (Finance → Finance Manager)',
  })
  approvalRequestId!: string | null;

  @ApiProperty({
    type: VerificationCallDto,
    nullable: true,
    description: 'Staff only; null on the partner surface',
  })
  verification!: VerificationCallDto | null;

  @ApiProperty({
    example: false,
    description: 'Another vendor already has this account number (§8 exception report)',
  })
  duplicateOfOtherVendor!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-09-26T10:00:00+07:00' })
  createdAt!: string;
}

export class ProposeBankAccountDto {
  @ApiProperty({ example: '014', pattern: '^[A-Z0-9]{3,11}$' })
  @IsString()
  @Matches(/^[A-Z0-9]{3,11}$/)
  bankCode!: string;

  @TextField({ example: 'สาขาตัวอย่าง', nullable: true, max: 200 })
  branchName?: string | null;

  @TextField({ example: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด', max: 300 })
  accountName!: string;

  @ApiProperty({
    example: '000-0-00000-9',
    description: 'Digits, optionally grouped with `-` or spaces; stored encrypted, never returned or logged',
  })
  @IsString()
  @Matches(/^[0-9][0-9 -]{4,28}[0-9]$/)
  accountNo!: string;
}

export class RecordVerificationCallDto {
  @EnumField(VERIFICATION_OUTCOMES, 'BankVerificationOutcome', { example: 'confirmed' })
  outcome!: (typeof VERIFICATION_OUTCOMES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-09-26T11:00:00+07:00' })
  @Type(() => Date)
  @IsDate()
  calledAt!: Date;

  @ApiProperty({
    example: '081-000-1234',
    description: 'The number called (from the factory record, not from the request); stored masked',
  })
  @IsString()
  @Matches(/^[0-9+ -]{6,20}$/)
  calledNumber!: string;

  @TextField({ example: 'ยืนยันกับผู้จัดการฝ่ายบัญชี', nullable: true, max: 1000 })
  note?: string | null;
}
