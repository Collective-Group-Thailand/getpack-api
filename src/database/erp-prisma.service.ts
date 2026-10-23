import { AppConfig } from '@config/app-config';
import { type Prisma, PrismaClient } from '@generated/prisma-erp/client';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

export type ErpTx = Prisma.TransactionClient;

/**
 * The factory ERP's Prisma client (ADR-0013): its own models plus the core tables it reads or writes in its
 * transactions (users, factories, files, audit, activity, outbox). Same database as `PrismaService`; a
 * transaction never spans the two clients.
 */
@Injectable()
export class ErpPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Runs `work` in one database transaction, with its audit row and outbox event (CLAUDE.md hard rules). */
  withTx<T>(
    work: (tx: ErpTx) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
  ): Promise<T> {
    return this.$transaction(work, options);
  }
}
