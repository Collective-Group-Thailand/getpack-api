import { statusLabels } from '@common/labels/status-labels';
import { toBangkokIso } from '@common/time/bangkok';

import {
  type AdminPaymentDto,
  type PaymentDto,
  type RefundDto,
  type SlipDto,
  type SlipQueueItemDto,
} from './payments.dto';
import { type PaymentRow, type PaymentsService } from './payments.service';
import { type RefundRow } from './refunds.service';

type SlipRow = PaymentRow['slips'][number];
type QueueRow = Awaited<ReturnType<PaymentsService['slipQueue']>>['rows'][number];

export function slipDto(s: SlipRow | QueueRow): SlipDto {
  return {
    id: s.publicId,
    status: s.verificationStatus,
    ...statusLabels('SlipStatus', s.verificationStatus),
    declaredAmount: s.declaredAmount.toFixed(2),
    declaredTransferredAt: toBangkokIso(s.declaredTransferredAt),
    slaDueAt: s.slaDueAt ? toBangkokIso(s.slaDueAt) : null,
    lastCheck: s.verifications[0]?.result ?? null,
    fileId: s.fileObject.publicId,
    createdAt: toBangkokIso(s.createdAt),
  };
}

type ReceiverAccount = { accountType: string; accountNumber: string; accountNameTH?: string };

export function paymentDto(p: PaymentRow, receivers: readonly ReceiverAccount[] = []): PaymentDto {
  return {
    id: p.publicId,
    referenceCode: p.referenceCode,
    groupId: p.orderGroup?.publicId ?? null,
    method: p.method,
    status: p.status,
    ...statusLabels('PaymentStatus', p.status),
    amount: p.amount.toFixed(2),
    whtAmount: p.whtAmount.toFixed(2),
    cashAmount: p.cashAmount.toFixed(2),
    currency: 'THB',
    qrPayload: p.qrPayload,
    redirectUrl: p.redirectUrl,
    expiresAt: p.expiresAt ? toBangkokIso(p.expiresAt) : null,
    paidAt: p.paidAt ? toBangkokIso(p.paidAt) : null,
    slips: p.slips.map(slipDto),
    receiverAccounts:
      p.method === 'bank_transfer_slip'
        ? receivers.map((r) => ({
            accountType: r.accountType,
            accountNumber: r.accountNumber,
            accountName: r.accountNameTH ?? null,
          }))
        : [],
    failureCode: p.status === 'failed' ? p.failureCode : null,
    createdAt: toBangkokIso(p.createdAt),
  };
}

export function adminPaymentDto(p: PaymentRow): AdminPaymentDto {
  return {
    ...paymentDto(p),
    provider: p.provider,
    providerRef: p.providerRef,
    feeAmount: p.feeAmount.toFixed(2),
    refundedAmount: p.refundedAmount.toFixed(2),
    failureReason: p.failureReason,
  };
}

export function slipQueueDto(s: QueueRow, now = new Date()): SlipQueueItemDto {
  return {
    ...slipDto(s),
    paymentId: s.payment.publicId,
    groupId: s.payment.orderGroup?.publicId ?? null,
    groupCode: s.payment.orderGroup?.groupCode ?? null,
    expectedAmount: s.payment.cashAmount.toFixed(2),
    overdue: s.slaDueAt !== null && s.slaDueAt < now,
  };
}

export function refundDto(r: RefundRow): RefundDto {
  return {
    id: r.publicId,
    paymentId: r.payment.publicId,
    groupId: r.payment.orderGroup?.publicId ?? null,
    amount: r.amount.toFixed(2),
    currency: 'THB',
    channel: r.channel,
    status: r.status,
    ...statusLabels('RefundStatus', r.status),
    reasonNote: r.reasonNote,
    approvalRequestId: r.approvalRequest?.publicId ?? null,
    providerRef: r.providerRef,
    failureReason: r.failureReason,
    createdAt: toBangkokIso(r.createdAt),
    completedAt: r.completedAt ? toBangkokIso(r.completedAt) : null,
  };
}
