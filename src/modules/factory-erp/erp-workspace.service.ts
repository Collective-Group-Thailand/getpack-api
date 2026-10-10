import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpDocumentType,
  type ErpFactorySettings,
  type ErpWarehouse,
  type Factory,
  Prisma,
} from '@generated/prisma/client';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

export const DEFAULT_PREFIXES: Record<ErpDocumentType, string> = {
  po: 'PO',
  gr: 'GR',
  adj: 'ADJ',
  trf: 'TRF',
  iss: 'ISS',
  pr: 'PR',
  ap: 'AP',
  pv: 'PV',
  mo: 'MO',
  rfq: 'RFQ',
  mt: 'MT',
  qt: 'QT',
  so: 'SO',
  do: 'DO',
  iv: 'IV',
  cn: 'CN',
  dr: 'DR',
  rc: 'RC',
  bn: 'BN',
  wht: 'WHT',
};

/** A person working in their own factory's ERP (D-317): partner users only, never staff or machines. */
export function erpUser(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'partner') throw new DomainException('auth.forbidden');
  return actor;
}

export interface ErpScope {
  actor: UserActor;
  factory: Factory;
}

/**
 * The factory's ERP workspace (D-316, D-317): resolves the factory from the path within the caller's scopes
 * (another factory's id → 404, D-044), and owns the per-factory settings, the default warehouse and the
 * document numbering (D-323).
 */
@Injectable()
export class ErpWorkspace {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly events: DomainEvents,
  ) {}

  async open(actor: Actor, factoryPublicId: string): Promise<ErpScope> {
    const user = erpUser(actor);
    const factory = await this.access.factory(user, factoryPublicId);
    return { actor: user, factory };
  }

  async settings(db: Tx | PrismaService, factoryId: bigint): Promise<ErpFactorySettings> {
    const found = await db.erpFactorySettings.findUnique({ where: { factoryId } });
    if (found) return found;
    return db.erpFactorySettings.upsert({ where: { factoryId }, create: { factoryId }, update: {} });
  }

  /** The default warehouse, created as `MAIN` ("คลังหลัก") on first use. */
  async defaultWarehouse(tx: Tx, factoryId: bigint, userId: bigint | null): Promise<ErpWarehouse> {
    const found = await tx.erpWarehouse.findFirst({ where: { factoryId, isDefault: true } });
    if (found) return found;
    const main = await tx.erpWarehouse.findUnique({ where: { factoryId_code: { factoryId, code: 'MAIN' } } });
    if (main) return tx.erpWarehouse.update({ where: { id: main.id }, data: { isDefault: true } });
    return tx.erpWarehouse.create({
      data: { factoryId, code: 'MAIN', name: 'คลังหลัก', isDefault: true, createdById: userId },
    });
  }

  /** A warehouse of this factory by public id (else the default one); archived ones are refused. */
  async warehouse(tx: Tx, scope: ErpScope, publicId: string | undefined): Promise<ErpWarehouse> {
    if (!publicId) return this.defaultWarehouse(tx, scope.factory.id, scope.actor.userId);
    const found = await tx.erpWarehouse.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!found) throw new DomainException('http.not_found');
    if (found.status === 'archived')
      throw new DomainException('erp.archived', { params: { name: found.name } });
    return found;
  }

  /**
   * The next number of a series (D-323): `<PREFIX>-YYMM-NNNN`, per factory, type and Bangkok month; the upsert
   * row-locks the series until the transaction ends, so numbers are gapless and never reused.
   */
  async nextNumber(
    tx: Tx,
    factoryId: bigint,
    docType: ErpDocumentType,
    at: Date = new Date(),
  ): Promise<string> {
    const day = bangkokDate(at);
    const period = `${day.slice(2, 4)}${day.slice(5, 7)}`;
    const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      INSERT INTO erp_document_series (factory_id, doc_type, period, next_no)
      VALUES (${factoryId}, ${docType}::erp_document_type, ${period}, 2)
      ON CONFLICT (factory_id, doc_type, period) DO UPDATE SET next_no = erp_document_series.next_no + 1
      RETURNING next_no - 1 AS n`);
    const settings = await this.settings(tx, factoryId);
    const prefixes = (settings.prefixes ?? {}) as Record<string, string>;
    const prefix = prefixes[docType] || DEFAULT_PREFIXES[docType];
    return `${prefix}-${period}-${String(Number(rows[0]!.n)).padStart(4, '0')}`;
  }

  /**
   * A domain event of the factory's ERP (D-317): ids and document numbers only — never prices, costs or the
   * factory's own customers — so staff tooling that reads events learns nothing private.
   */
  async record(
    tx: Tx,
    scope: ErpScope,
    type: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events.record(
      tx,
      { type, aggregateType, aggregateId, payload: { factoryId: scope.factory.publicId, ...payload } },
      scope.actor,
    );
  }

  /** A domain event the ERP records on its own (a Packio job turned into a production order, D-340). */
  async recordSystem(
    tx: Tx,
    factoryPublicId: string,
    type: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events.record(
      tx,
      { type, aggregateType, aggregateId, payload: { factoryId: factoryPublicId, ...payload } },
      systemActor('factory-erp'),
    );
  }

  /** Runs `work` in one transaction (CLAUDE.md: one transaction per state change). */
  tx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.withTx(work);
  }

  get db(): PrismaService {
    return this.prisma;
  }
}
