import { bangkokDate } from '@common/time/bangkok';

import {
  type BankStatementLineDto,
  type CashPositionDto,
  type CompanyBankAccountDto,
  type UnidentifiedReceiptDto,
} from './banking.dto';
import { type BankingService, type LineRow } from './banking.service';
import { type CompanyAccountRow } from './company-bank-accounts.service';

type Amount = { toFixed(dp: number): string };
const m = (v: Amount) => v.toFixed(2);

export const companyAccountDto = (r: CompanyAccountRow): CompanyBankAccountDto => ({
  id: r.publicId,
  bankCode: r.bankCode,
  branchName: r.branchName,
  accountName: r.accountName,
  accountNoLast4: r.accountNoLast4,
  glAccountCode: r.glAccount.code,
  purpose: r.purpose,
  defaultBulkFormat: r.defaultBulkFormat,
  status: r.status,
  approvalRequestId: r.approvalRequest?.publicId ?? null,
});

export const lineDto = (r: LineRow): BankStatementLineDto => ({
  id: r.publicId,
  companyBankAccountId: r.companyBankAccount.publicId,
  accountNoLast4: r.companyBankAccount.accountNoLast4,
  txnDate: bangkokDate(r.txnDate),
  amount: m(r.amount),
  description: r.description,
  reference: r.reference,
  runningBalance: r.runningBalance ? m(r.runningBalance) : null,
  matchStatus: r.matchStatus,
  matches: r.matches.map((x) => ({
    targetType: x.targetType,
    targetId: x.targetPublicId,
    amount: m(x.amount),
    auto: x.auto,
  })),
});

export const receiptDto = (
  r: Awaited<ReturnType<BankingService['unidentified']>>[number],
): UnidentifiedReceiptDto => ({
  id: r.publicId,
  amount: m(r.amount),
  receivedOn: bangkokDate(r.statementLine.txnDate),
  description: r.statementLine.description,
  reference: r.statementLine.reference,
  status: r.status,
});

export const cashDto = (p: Awaited<ReturnType<BankingService['cashPosition']>>): CashPositionDto => ({
  asOf: p.asOf,
  banks: p.banks.map((b) => ({
    companyBankAccountId: b.account.publicId,
    accountNoLast4: b.account.accountNoLast4,
    glAccountCode: b.account.glAccount.code,
    glBalance: m(b.glBalance),
    statementBalance: b.statementBalance ? m(b.statementBalance) : null,
    unmatchedLines: b.unmatched,
  })),
  clearing: p.clearing.map((c) => ({ accountCode: c.code, balance: m(c.balance) })),
});
