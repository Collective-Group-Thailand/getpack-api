import { type Prisma } from '@generated/prisma/client';

/** The `admin.banking.listLines` filter, shared with the dashboard's unmatched-lines card (`matchStatus=unmatched`). */
export function bankLineWhere(q: {
  companyBankAccountId?: string;
  matchStatus?: Prisma.BankStatementLineWhereInput['matchStatus'];
}): Prisma.BankStatementLineWhereInput {
  return {
    ...(q.companyBankAccountId && { companyBankAccount: { publicId: q.companyBankAccountId } }),
    ...(q.matchStatus && { matchStatus: q.matchStatus }),
  };
}

/** The `admin.banking.listUnidentified` filter, shared with the dashboard card (`status=open`). */
export function unidentifiedWhere(
  status?: Prisma.UnidentifiedReceiptWhereInput['status'],
): Prisma.UnidentifiedReceiptWhereInput {
  return status ? { status } : {};
}
