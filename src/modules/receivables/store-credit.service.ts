import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type StoreCreditSource } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

export interface StoreCreditMovement {
  entityId: bigint;
  customerUserId: bigint;
  amount: MoneyValue;
  source: StoreCreditSource;
  customerDocumentId?: bigint | null;
  orderId?: bigint | null;
  refundId?: bigint | null;
  note?: string | null;
  createdById?: bigint | null;
}

/**
 * The customer's credit balance (store-credit wallet, §6; the sub-ledger of 2320): credits from credit notes
 * settled to the wallet, debits when it is refunded or used. Append-only; the database refuses a negative
 * balance.
 */
@Injectable()
export class StoreCreditService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(tx: Tx, entityId: bigint, customerUserId: bigint) {
    const existing = await tx.storeCreditAccount.findUnique({
      where: { entityId_customerUserId: { entityId, customerUserId } },
    });
    return existing ?? tx.storeCreditAccount.create({ data: { entityId, customerUserId } });
  }

  async credit(tx: Tx, m: StoreCreditMovement) {
    return this.move(tx, m, m.amount);
  }

  async debit(tx: Tx, m: StoreCreditMovement) {
    return this.move(tx, m, m.amount.neg());
  }

  private async move(tx: Tx, m: StoreCreditMovement, amount: MoneyValue) {
    const account = await this.account(tx, m.entityId, m.customerUserId);
    return tx.storeCreditEntry.create({
      data: {
        accountId: account.id,
        amount: formatMoney(amount),
        source: m.source,
        customerDocumentId: m.customerDocumentId ?? null,
        orderId: m.orderId ?? null,
        refundId: m.refundId ?? null,
        note: m.note ?? null,
        createdById: m.createdById ?? null,
      },
    });
  }

  async balance(customerUserId: bigint, db: Tx = this.prisma): Promise<MoneyValue> {
    const sum = await db.storeCreditEntry.aggregate({
      where: { account: { customerUserId } },
      _sum: { amount: true },
    });
    return new MoneyDecimal(sum._sum.amount?.toString() ?? '0');
  }

  async entries(customerUserId: bigint) {
    return this.prisma.storeCreditEntry.findMany({
      where: { account: { customerUserId } },
      include: {
        customerDocument: { select: { publicId: true, docNumber: true } },
        order: { select: { publicId: true, orderCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
