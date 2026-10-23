import { AppConfig } from '@config/app-config';
import { type Prisma, PrismaClient } from '@generated/prisma/client';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { type ErpTx } from './erp-prisma.service';

export type Tx = Prisma.TransactionClient;

/** A transaction of either client (ADR-0013), for the platform writers both use: audit, activity, outbox. */
export type AnyTx = Tx | ErpTx;

/**
 * Views either client's transaction as the core one. Only for tables both clients map (audit, activity, domain
 * events, outbox), with scalar columns only: the ERP client's copy of those models has the same columns, its
 * generated types are just separate declarations.
 */
export function platformTx(tx: AnyTx): Tx {
  return tx as unknown as Tx;
}

/** Prisma 7 client over the `pg` driver adapter. Connects lazily on the first query. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` in one database transaction. Every state change goes through here together with
   * its audit row and outbox event (CLAUDE.md hard rules; the outbox arrives in B1.3).
   * `timeout` (ms, Prisma default 5 000) is raised only by bulk operations such as catalogue imports.
   */
  withTx<T>(
    work: (tx: Tx) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
  ): Promise<T> {
    return this.$transaction(work, options);
  }
}
