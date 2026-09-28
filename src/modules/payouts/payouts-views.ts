import { bangkokDate } from '@common/time/bangkok';

import {
  type PartnerPayoutDto,
  type PayoutExceptionDto,
  type PayoutItemDto,
  type PayoutRunDto,
} from './payouts.dto';
import { type PayoutsService, type RunRow } from './payouts.service';

type Amount = { toFixed(dp: number): string };
const m = (v: Amount) => v.toFixed(2);

const itemDto = (i: RunRow['items'][number]): PayoutItemDto => ({
  id: i.publicId,
  vendorId: i.vendor.publicId,
  vendorName: i.vendor.legalName,
  kind: i.kind,
  bankAccountLast4: i.vendorBankAccount?.accountNoLast4 ?? null,
  apNetAmount: m(i.apNetAmount),
  vatAmount: m(i.vatAmount),
  vatClaimable: i.vatClaimable,
  whtAmount: m(i.whtAmount),
  whtBase: m(i.whtBase),
  whtForm: i.whtForm,
  retentionAmount: m(i.retentionAmount),
  cashAmount: m(i.cashAmount),
  pvNumber: i.pvNumber,
  status: i.status,
  bankRef: i.bankRef,
  failureReason: i.failureReason,
  paidOn: i.paidOn ? bangkokDate(i.paidOn) : null,
});

export const runDto = (r: RunRow): PayoutRunDto => ({
  id: r.publicId,
  runNo: r.runNo,
  status: r.status,
  payOn: bangkokDate(r.payOn),
  bankAccount: {
    id: r.companyBankAccount.publicId,
    bankCode: r.companyBankAccount.bankCode,
    accountNoLast4: r.companyBankAccount.accountNoLast4,
    glAccountCode: r.companyBankAccount.glAccount.code,
  },
  bankFormat: r.bankFormatAdapter,
  approvalRequestId: r.approvalRequest?.publicId ?? null,
  bankFileReady: r.bankFile !== null,
  apNetAmount: m(r.apNetAmount),
  vatAmount: m(r.vatAmount),
  whtAmount: m(r.whtAmount),
  retentionAmount: m(r.retentionAmount),
  cashAmount: m(r.cashAmount),
  currency: 'THB',
  items: r.items.map(itemDto),
});

export const exceptionDto = (
  i: Awaited<ReturnType<PayoutsService['exceptions']>>[number],
): PayoutExceptionDto => ({
  id: i.publicId,
  runId: i.run.publicId,
  runNo: i.run.runNo,
  vendorName: i.vendor.legalName,
  status: i.status,
  cashAmount: m(i.cashAmount),
  failureReason: i.failureReason,
});

export const partnerPayoutDto = (
  i: Awaited<ReturnType<PayoutsService['statementOf']>>[number],
): PartnerPayoutDto => ({
  id: i.publicId,
  kind: i.kind,
  pvNumber: i.pvNumber,
  paidOn: i.paidOn ? bangkokDate(i.paidOn) : null,
  apNetAmount: m(i.apNetAmount),
  vatAmount: m(i.vatAmount),
  whtAmount: m(i.whtAmount),
  retentionAmount: m(i.retentionAmount),
  cashAmount: m(i.cashAmount),
  bankAccountLast4: i.vendorBankAccount?.accountNoLast4 ?? null,
  whtCertificates: i.whtCertificates
    .filter((c) => c.status === 'issued')
    .map((c) => ({
      id: c.publicId,
      wtNumber: c.wtNumber,
      form: c.form,
      paidOn: bangkokDate(c.paidOn),
      paidAmount: m(c.paidAmount),
      whtRatePct: c.whtRatePct.toFixed(4),
      whtAmount: m(c.whtAmount),
      pdfReady: c.fileObjectId !== null,
    })),
});
