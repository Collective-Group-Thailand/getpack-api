import { MoneyDecimal } from '@common/money/money';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type PayablesQueryService } from '@modules/payables/payables-query.service';
import { type PolicySnapshot } from '@modules/payables/purchasing.service';

import {
  type PartnerPayoutDetailDto,
  type PartnerPayoutDto,
  type PayoutExceptionDto,
  type PayoutItemDto,
  type PayoutRunDto,
  type PayoutScheduleJobDto,
  type StatementOfAccountDto,
} from './payouts.dto';
import { type PartnerPayoutRow, type PayoutsService, type RunRow } from './payouts.service';

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

const deductionsOf = (i: PartnerPayoutRow) =>
  i.allocations.flatMap((a) =>
    a.payableItem.deductions.map((d) => ({ claimNo: d.claim?.claimNo ?? null, amount: m(d.amount) })),
  );

export const partnerPayoutDto = (i: PartnerPayoutRow): PartnerPayoutDto => ({
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
  status: i.status,
  payOn: bangkokDate(i.run.payOn),
  claimDeductionAmount: deductionsOf(i)
    .reduce((a, d) => a.add(d.amount), new MoneyDecimal(0))
    .toFixed(2),
  currency: 'THB',
});

/** One payout with the payables it settles and the claim deductions taken from them (U-B0.3). */
export const partnerPayoutDetailDto = (i: PartnerPayoutRow): PartnerPayoutDetailDto => ({
  ...partnerPayoutDto(i),
  bankRef: i.bankRef,
  failureReason: i.failureReason,
  remittanceAdviceAvailable: i.status === 'paid' && i.pvNumber !== null,
  allocations: i.allocations.map((a) => ({
    payableId: a.payableItem.publicId,
    source: a.payableItem.source,
    poNumber: a.payableItem.purchaseOrder?.poNumber ?? null,
    jobNo: a.payableItem.purchaseOrder?.productionJob.jobNo ?? null,
    orderCode: a.payableItem.order?.orderCode ?? null,
    grNumber: a.payableItem.goodsReceipt?.grNumber ?? null,
    bsNumber: a.payableItem.goodsReceipt?.statementLines[0]?.statement.bsNumber ?? null,
    netAmount: m(a.netAmount),
    vatAmount: m(a.vatAmount),
  })),
  claimDeductions: deductionsOf(i),
});

type ScheduleRow = Awaited<ReturnType<PayablesQueryService['payoutSchedule']>>['rows'][number];

const waitingFor = (p: ScheduleRow['payableItems'][number], now: Date) => {
  if (p.status === 'in_run') return 'bank_confirmation';
  if (p.status === 'eligible') return 'payout_run';
  if (p.status === 'open') return p.eligibleAt && p.eligibleAt <= now ? 'payout_run' : 'eligibility_date';
  return null;
};

/** A job's payables with the terms its PO keeps (U-B0.3, D-022, D-164). */
export const payoutScheduleDto = (r: ScheduleRow, now = new Date()): PayoutScheduleJobDto => {
  const policy = r.payoutPolicy as unknown as PolicySnapshot;
  return {
    purchaseOrderId: r.publicId,
    poNumber: r.poNumber,
    poStatus: r.status,
    jobNo: r.productionJob.jobNo,
    orderCode: r.order.orderCode,
    terms: {
      advancePct: new MoneyDecimal(policy.advancePct).toFixed(4),
      advanceTrigger: policy.advanceTrigger,
      balanceTrigger: policy.balanceTrigger,
      claimWindowDays: policy.claimWindowDays,
      retentionPct: new MoneyDecimal(policy.retentionPct).toFixed(4),
      retentionReleaseDays: policy.retentionReleaseDays,
      paymentTermsDays: policy.paymentTermsDays,
    },
    balancePending: r.status !== 'cancelled' && r._count.goodsReceipts === 0,
    items: r.payableItems.map((p) => {
      const paid = p.allocations[0]?.payoutItem;
      return {
        id: p.publicId,
        source: p.source,
        status: p.status,
        netAmount: m(p.netAmount),
        vatAmount: m(p.vatAmount),
        openNetAmount: m(p.openNetAmount),
        openVatAmount: m(p.openVatAmount),
        eligibleAt: p.eligibleAt ? toBangkokIso(p.eligibleAt) : null,
        waitingFor: waitingFor(p, now),
        paidOn: p.status === 'paid' && paid?.paidOn ? bangkokDate(paid.paidOn) : null,
        payoutId: p.status === 'paid' ? (paid?.publicId ?? null) : null,
      };
    }),
  };
};

/** The factory's account between two days, with a running balance (U-B0.3). */
export const statementOfAccountDto = (
  factoryId: string,
  from: string,
  to: string,
  account: Awaited<ReturnType<PayablesQueryService['accountEntries']>>,
): StatementOfAccountDto => {
  let balance = account.opening;
  let debit = new MoneyDecimal(0);
  let credit = new MoneyDecimal(0);
  const entries = account.entries.map((e) => {
    balance = balance.add(e.credit).sub(e.debit);
    debit = debit.add(e.debit);
    credit = credit.add(e.credit);
    return {
      date: bangkokDate(e.date),
      kind: e.kind,
      reference: e.reference,
      debit: m(e.debit),
      credit: m(e.credit),
      balance: m(balance),
    };
  });
  return {
    factoryId,
    from,
    to,
    currency: 'THB',
    opening: m(account.opening),
    totalDebit: m(debit),
    totalCredit: m(credit),
    closing: m(balance),
    entries,
  };
};
