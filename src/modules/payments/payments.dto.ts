import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** Payments and slips (D-061, B3.2). Money: decimal strings, THB. */

export const PAYMENT_METHODS = [
  'scb_qr',
  'scb_qr_cross_bank',
  'card_2c2p',
  'online_banking_2c2p',
  'bank_transfer_slip',
  'store_credit',
  'credit_term_transfer',
  'card_instalment_2c2p',
  'scb_direct_debit',
] as const;
export const PAYMENT_STATUSES = [
  'initiated',
  'pending',
  'awaiting_verification',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
] as const;
export const SLIP_STATUSES = [
  'pending',
  'passed',
  'failed',
  'manual_review',
  'manual_approved',
  'manual_rejected',
] as const;
export const SLIP_CHECK_RESULTS = ['pass', 'mismatch', 'duplicate', 'unreadable', 'provider_error'] as const;
const MONEY = /^\d{1,12}\.\d{2}$/;

const IDS = {
  payment: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001',
  slip: '0192f3a0-7c1e-7d2a-9b1f-0000000a0002',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001',
  instalment: '0192f3a0-7c1e-7d2a-9b1f-0000000b0002',
};

export class InitiatePaymentDto {
  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    example: 'scb_qr',
    description:
      'Card instalments and direct debit are R2 (D-111); store credit and credit-term transfers are not paid here',
  })
  @IsIn(PAYMENT_METHODS)
  method!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [IDS.instalment],
    description: 'Instalments to pay; default: every instalment due now (or the next open one)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID('all', { each: true })
  instalmentIds?: string[];
}

export class UploadSlipDto {
  @ApiProperty({ format: 'uuid', example: IDS.file, description: 'An uploaded file with purpose `slip`' })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ example: '7091.40', description: 'Amount on the slip' })
  @IsString()
  @Matches(MONEY)
  declaredAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-01T10:30:00+07:00' })
  @IsISO8601()
  transferredAt!: string;
}

export class SlipDto {
  @IdField(IDS.slip)
  id!: string;

  @ApiProperty({ enum: SLIP_STATUSES, enumName: 'SlipStatus', example: 'passed' })
  status!: string;

  @ApiStatusLabelTh('SlipStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('SlipStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ example: '7091.40' })
  declaredAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-01T10:30:00+07:00' })
  declaredTransferredAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-01T14:30:00+07:00',
    description: 'Finance deadline (4 business hours, D-061)',
  })
  slaDueAt!: string | null;

  @ApiProperty({
    enum: SLIP_CHECK_RESULTS,
    enumName: 'SlipCheckResult',
    nullable: true,
    example: 'pass',
    description: 'Last automatic check',
  })
  lastCheck!: string | null;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000a5101',
    description: 'The slip image: download with `admin.files.download` (`payments.verify_slip`, D-061)',
  })
  fileId!: string;

  @TimestampField()
  createdAt!: string;
}

export const PAYMENT_FAILURE_CODES = ['provider_error', 'declined'] as const;

/** A Packio account a bank-transfer slip pays into (setting `payments.slip_receiver_accounts`, D-061). */
export class SlipReceiverAccountDto {
  @ApiProperty({ example: 'scb_savings', description: 'Account type code of the slip-verification provider' })
  accountType!: string;

  @ApiProperty({ example: '0000000000', description: 'Account number (fake in examples)' })
  accountNumber!: string;

  @ApiProperty({ type: String, nullable: true, example: 'บจก. ทดสอบ' })
  accountName!: string | null;
}

export class PaymentDto {
  @IdField(IDS.payment)
  id!: string;

  @ApiProperty({
    example: 'PKAB23CD45EF67GH',
    description: 'Reference shown on QR / transfer (provider ref1 / invoice)',
  })
  referenceCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.group })
  groupId!: string | null;

  @ApiProperty({ enum: PAYMENT_METHODS, enumName: 'PaymentMethod', example: 'scb_qr' })
  method!: string;

  @ApiProperty({ enum: PAYMENT_STATUSES, enumName: 'PaymentStatus', example: 'pending' })
  status!: string;

  @ApiStatusLabelTh('PaymentStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('PaymentStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({
    example: '7091.40',
    description: 'Gross this payment settles (incl. the customer’s withholding)',
  })
  amount!: string;

  @ApiProperty({ example: '0.00' })
  whtAmount!: string;

  @ApiProperty({ example: '7091.40', description: 'Money to transfer / charged' })
  cashAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '00020101021230…6304CE18',
    description: 'EMVCo QR payload to render (SCB)',
  })
  qrPayload!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Redirect the customer here (2C2P)',
  })
  redirectUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-02T10:00:00+07:00' })
  expiresAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  paidAt!: string | null;

  @ApiProperty({ type: [SlipDto] })
  slips!: SlipDto[];

  @ApiProperty({
    type: [SlipReceiverAccountDto],
    description:
      '`bank_transfer_slip` only: the accounts to transfer to (empty until Finance sets them, D-061)',
  })
  receiverAccounts!: SlipReceiverAccountDto[];

  @ApiProperty({
    enum: PAYMENT_FAILURE_CODES,
    enumName: 'PaymentFailureCode',
    nullable: true,
    example: null,
    description:
      'Why a `failed` payment failed: `declined` by the card / bank, or `provider_error`; start a new payment',
  })
  failureCode!: (typeof PAYMENT_FAILURE_CODES)[number] | null;

  @TimestampField()
  createdAt!: string;
}

export class AdminPaymentDto extends PaymentDto {
  @ApiProperty({ example: 'scb' })
  provider!: string;

  @ApiProperty({ type: String, nullable: true, example: '46a0e0c00f114482991414ef26654ace' })
  providerRef!: string | null;

  @ApiProperty({ example: '0.00', description: 'Expected gateway fee (`payments.method_fees`)' })
  feeAmount!: string;

  @ApiProperty({ example: '0.00' })
  refundedAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  failureReason!: string | null;
}

export const SLIP_EXAMPLE: SlipDto = {
  id: IDS.slip,
  status: 'manual_review',
  ...statusLabels('SlipStatus', 'manual_review'),
  declaredAmount: '7091.40',
  declaredTransferredAt: '2026-10-01T10:30:00+07:00',
  slaDueAt: '2026-10-01T14:30:00+07:00',
  lastCheck: 'mismatch',
  fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000a5101',
  createdAt: '2026-10-01T10:31:00+07:00',
};

export const PAYMENT_EXAMPLE: PaymentDto = {
  id: IDS.payment,
  referenceCode: 'PKAB23CD45EF67GH',
  groupId: IDS.group,
  method: 'scb_qr',
  status: 'pending',
  ...statusLabels('PaymentStatus', 'pending'),
  amount: '7091.40',
  whtAmount: '0.00',
  cashAmount: '7091.40',
  currency: 'THB',
  qrPayload: '00020101021230…6304CE18',
  redirectUrl: null,
  expiresAt: '2026-10-02T10:00:00+07:00',
  paidAt: null,
  slips: [],
  createdAt: '2026-10-01T10:00:00+07:00',
  receiverAccounts: [],
  failureCode: null,
};

export const ADMIN_PAYMENT_EXAMPLE: AdminPaymentDto = {
  ...PAYMENT_EXAMPLE,
  provider: 'scb',
  providerRef: null,
  feeAmount: '0.00',
  refundedAmount: '0.00',
  failureReason: null,
};

export class AdminPaymentQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, enumName: 'PaymentStatus' })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: (typeof PAYMENT_STATUSES)[number];

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, enumName: 'PaymentMethod' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ type: Boolean, example: true, description: 'Receipts that match no order group' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unidentified?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Payments of this order group' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Payments of the group of this order' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class SlipReviewDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({
    example: '015073144041ATF00999',
    description: 'Required to approve: the bank transaction reference',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankTransRef?: string;

  @ApiPropertyOptional({
    example: '7091.40',
    description: 'Amount actually received, when it differs from the slip',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  receivedAmount?: string;

  @ApiPropertyOptional({ example: 'ตรวจกับ statement แล้ว', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SlipQueueItemDto extends SlipDto {
  @ApiProperty({ format: 'uuid', example: IDS.payment })
  paymentId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.group })
  groupId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'OG-2610-00042' })
  groupCode!: string | null;

  @ApiProperty({ example: '7091.40', description: 'Cash the payment expects' })
  expectedAmount!: string;

  @ApiProperty({ example: false, description: 'The SLA passed' })
  overdue!: boolean;
}

export const SLIP_QUEUE_EXAMPLE: SlipQueueItemDto = {
  ...SLIP_EXAMPLE,
  paymentId: IDS.payment,
  groupId: IDS.group,
  groupCode: 'OG-2610-00042',
  expectedAmount: '7091.40',
  overdue: false,
};

export class AllocatePaymentDto {
  @ApiProperty({ format: 'uuid', example: IDS.group })
  @IsUUID()
  groupId!: string;
}

export class ScbCallbackAckDto {
  @ApiProperty({ example: '00' })
  resCode!: string;

  @ApiProperty({ example: 'success' })
  resDesc!: string;

  @ApiProperty({ example: '46a0e0c00f114482991414ef26654ace' })
  transactionId!: string;
}

// --- refunds -----------------------------------------------------------------------------------------

export const REFUND_CHANNELS = ['original_gateway', 'bank_transfer', 'store_credit'] as const;
export const REFUND_STATUSES = [
  'requested',
  'pending_approval',
  'approved',
  'processing',
  'succeeded',
  'failed',
  'rejected',
] as const;

export class RequestRefundDto {
  @ApiProperty({ example: '7091.40' })
  @IsString()
  @Matches(MONEY)
  amount!: string;

  @ApiProperty({ example: 'ยกเลิกคำสั่งซื้อก่อนผลิต', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reasonNote!: string;

  @ApiPropertyOptional({
    enum: REFUND_CHANNELS,
    enumName: 'RefundChannel',
    example: 'bank_transfer',
    description:
      'Default: the gateway when it refunds by API (2C2P), otherwise a bank transfer; store credit arrives with B5',
  })
  @IsOptional()
  @IsIn(REFUND_CHANNELS)
  channel?: (typeof REFUND_CHANNELS)[number];

  @ApiPropertyOptional({ example: 'customer_changed_mind' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  cancelReasonCode?: string;

  @ApiPropertyOptional({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d0002' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class CompleteRefundDto {
  @ApiProperty({
    example: 'TRF20261001-0001',
    description: 'Bank or provider reference of the money sent back',
  })
  @IsString()
  @MaxLength(64)
  providerRef!: string;
}

export class RefundDto {
  @IdField('0192f3a0-7c1e-7d2a-9b1f-0000000a0010')
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.payment })
  paymentId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: '7091.40' })
  amount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ enum: REFUND_CHANNELS, enumName: 'RefundChannel', example: 'bank_transfer' })
  channel!: string;

  @ApiProperty({ enum: REFUND_STATUSES, enumName: 'RefundStatus', example: 'pending_approval' })
  status!: string;

  @ApiStatusLabelTh('RefundStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('RefundStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ example: 'ยกเลิกคำสั่งซื้อก่อนผลิต' })
  reasonNote!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f0101',
    description: 'Approval request (Finance Manager)',
  })
  approvalRequestId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  providerRef!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  failureReason!: string | null;

  @TimestampField()
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;
}

export const REFUND_EXAMPLE: RefundDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000a0010',
  paymentId: IDS.payment,
  groupId: IDS.group,
  amount: '7091.40',
  currency: 'THB',
  channel: 'bank_transfer',
  status: 'pending_approval',
  ...statusLabels('RefundStatus', 'pending_approval'),
  reasonNote: 'ยกเลิกคำสั่งซื้อก่อนผลิต',
  approvalRequestId: '0192f3a0-7c1e-7d2a-9b1f-0000000f0101',
  providerRef: null,
  failureReason: null,
  createdAt: '2026-10-01T10:00:00+07:00',
  completedAt: null,
};

export class RefundListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: REFUND_STATUSES, enumName: 'RefundStatus' })
  @IsOptional()
  @IsIn(REFUND_STATUSES)
  status?: (typeof REFUND_STATUSES)[number];
}
