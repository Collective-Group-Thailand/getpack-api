import { toBangkokIso } from '@common/time/bangkok';

import { type AdminPaymentDto, type PaymentDto, type SlipDto, type SlipQueueItemDto } from './payments.dto';
import { type PaymentRow, type PaymentsService } from './payments.service';

type SlipRow = PaymentRow['slips'][number];
type QueueRow = Awaited<ReturnType<PaymentsService['slipQueue']>>['rows'][number];

export function slipDto(s: SlipRow | QueueRow): SlipDto {
  return {
    id: s.publicId,
    status: s.verificationStatus,
    declaredAmount: s.declaredAmount.toFixed(2),
    declaredTransferredAt: toBangkokIso(s.declaredTransferredAt),
    slaDueAt: s.slaDueAt ? toBangkokIso(s.slaDueAt) : null,
    lastCheck: s.verifications[0]?.result ?? null,
    createdAt: toBangkokIso(s.createdAt),
  };
}

export function paymentDto(p: PaymentRow): PaymentDto {
  return {
    id: p.publicId,
    referenceCode: p.referenceCode,
    groupId: p.orderGroup?.publicId ?? null,
    method: p.method,
    status: p.status,
    amount: p.amount.toFixed(2),
    whtAmount: p.whtAmount.toFixed(2),
    cashAmount: p.cashAmount.toFixed(2),
    currency: 'THB',
    qrPayload: p.qrPayload,
    redirectUrl: p.redirectUrl,
    expiresAt: p.expiresAt ? toBangkokIso(p.expiresAt) : null,
    paidAt: p.paidAt ? toBangkokIso(p.paidAt) : null,
    slips: p.slips.map(slipDto),
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
