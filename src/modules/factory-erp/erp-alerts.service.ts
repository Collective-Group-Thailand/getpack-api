import { DomainException } from '@common/errors/domain.exception';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import { type ErpAlertKind, type ErpAlertStatus, type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { type ErpAlertCountDto, type ErpAlertDto, type ErpAlertListQuery } from './erp-e3.dto';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The domain event each alert kind notifies with (the notification matrix routes them to the factory, D-358). */
const EVENT_OF: Record<ErpAlertKind, string> = {
  price_rise: 'erp_alert.price_rise',
  quote_expiring: 'erp_alert.quote_expiring',
  supplier_review_due: 'erp_alert.supplier_review_due',
  maintenance_due: 'erp_alert.maintenance_due',
  machine_breakdown: 'erp_alert.machine_breakdown',
  document_expiring: 'erp_alert.document_expiring',
  quote_follow_up: 'erp_alert.quote_follow_up',
  invoice_overdue: 'erp_alert.invoice_overdue',
  activity_overdue: 'erp_alert.activity_overdue',
};

export interface AlertInput {
  factoryId: bigint;
  factoryPublicId: string;
  kind: ErpAlertKind;
  /** One alert per cause: a second raise with the same key does nothing. */
  dedupeKey: string;
  subjectType: string;
  subjectPublicId: string;
  /** Names, numbers and dates to show — never another factory's data. */
  payload: Record<string, string | number | null>;
  dueOn?: string | null;
}

/**
 * The factory's ERP alerts (D-347, D-358): price rises, quotations and supplier reviews ending, preventive
 * maintenance due, breakdowns, documents expiring — one per cause, open until someone acknowledges it — each
 * announced once by a domain event that notifies the factory's own users.
 */
@Injectable()
export class ErpAlertsService {
  private readonly logger = new Logger(ErpAlertsService.name);

  constructor(private readonly workspace: ErpWorkspace) {}

  /** Raises an alert unless its cause was already raised; returns whether it is new. */
  async raise(tx: Tx, a: AlertInput): Promise<boolean> {
    const rows = await tx.erpAlert.createManyAndReturn({
      data: [
        {
          factoryId: a.factoryId,
          kind: a.kind,
          dedupeKey: a.dedupeKey,
          subjectType: a.subjectType,
          subjectPublicId: a.subjectPublicId,
          payload: a.payload,
          dueOn: a.dueOn ? new Date(`${a.dueOn}T00:00:00.000Z`) : null,
        },
      ],
      skipDuplicates: true,
    });
    if (rows.length === 0) return false;
    await this.workspace.recordSystem(
      tx,
      a.factoryPublicId,
      EVENT_OF[a.kind],
      'erp_alert',
      rows[0]!.publicId,
      {
        kind: a.kind,
        subjectType: a.subjectType,
        subjectId: a.subjectPublicId,
        ...a.payload,
      },
    );
    return true;
  }

  async list(scope: ErpScope, q: ErpAlertListQuery) {
    const where: Prisma.ErpAlertWhereInput = { factoryId: scope.factory.id };
    if (q.status) where.status = q.status as ErpAlertStatus;
    if (q.kind) where.kind = q.kind as ErpAlertKind;
    const [rows, total] = await Promise.all([
      this.workspace.db.erpAlert.findMany({
        where,
        include: { acknowledgedBy: { select: { displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpAlert.count({ where }),
    ]);
    return paginated(rows.map(alertDto), total, q);
  }

  async count(scope: ErpScope): Promise<ErpAlertCountDto> {
    const groups = await this.workspace.db.erpAlert.groupBy({
      by: ['kind'],
      where: { factoryId: scope.factory.id, status: 'open' },
      _count: { _all: true },
    });
    return {
      open: groups.reduce((a, g) => a + g._count._all, 0),
      byKind: Object.fromEntries(groups.map((g) => [g.kind, g._count._all])),
    };
  }

  async acknowledge(scope: ErpScope, publicId: string): Promise<ErpAlertDto> {
    const row = await this.workspace.db.erpAlert.findFirst({
      where: { factoryId: scope.factory.id, publicId },
    });
    if (!row) throw new DomainException('http.not_found');
    const updated = await this.workspace.db.erpAlert.update({
      where: { id: row.id },
      data:
        row.status === 'open'
          ? { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedById: scope.actor.userId }
          : {},
      include: { acknowledgedBy: { select: { displayName: true } } },
    });
    return alertDto(updated);
  }

  /** Acknowledges every open alert of the factory (the inbox's "mark all read"). */
  async acknowledgeAll(scope: ErpScope): Promise<ErpAlertCountDto> {
    await this.workspace.db.erpAlert.updateMany({
      where: { factoryId: scope.factory.id, status: 'open' },
      data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedById: scope.actor.userId },
    });
    return this.count(scope);
  }

  /** Closes the open alerts of a subject that no longer apply (a breakdown fixed, a document renewed). */
  async settle(db: Tx | PrismaService, factoryId: bigint, kind: ErpAlertKind, subjectPublicId: string) {
    await db.erpAlert.updateMany({
      where: { factoryId, kind, subjectPublicId, status: 'open' },
      data: { status: 'acknowledged', acknowledgedAt: new Date() },
    });
  }

  /**
   * D-347, D-351, D-358: the daily sourcing check — quantity breaks and latest quotations ending within the
   * factory's `quoteExpiryDays`, and approved suppliers whose review date is that close.
   */
  @ScheduledJob({ name: 'factory_erp.sourcing_alerts', cron: '10 7 * * *' })
  async sourcingCheck(): Promise<number> {
    const t = bangkokDate(new Date());
    const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const factories = await this.workspace.db.erpFactorySettings.findMany({ include: { factory: true } });
    let raised = 0;
    for (const f of factories) {
      const until = day(addCalendarDays(t, f.quoteExpiryDays));
      try {
        const links = await this.workspace.db.erpItemSupplier.findMany({
          where: {
            factoryId: f.factoryId,
            status: 'active',
            OR: [
              { breaksValidUntil: { gte: day(t), lte: until } },
              { approval: 'approved', reviewOn: { lte: until } },
            ],
          },
          include: { item: true, supplier: true },
        });
        const quotes = await this.workspace.db.erpPriceRecord.findMany({
          where: { factoryId: f.factoryId, source: 'quotation', validUntil: { gte: day(t), lte: until } },
          include: { item: true, supplier: true },
          orderBy: [{ pricedOn: 'desc' }, { id: 'desc' }],
        });
        await this.workspace.tx(async (tx) => {
          for (const l of links) {
            if (l.breaksValidUntil && iso(l.breaksValidUntil)! >= t && l.breaksValidUntil <= until)
              raised += Number(
                await this.raise(tx, {
                  factoryId: f.factoryId,
                  factoryPublicId: f.factory.publicId,
                  kind: 'quote_expiring',
                  dedupeKey: `quote_expiring:breaks:${l.publicId}:${iso(l.breaksValidUntil)}`,
                  subjectType: 'item',
                  subjectPublicId: l.item.publicId,
                  payload: {
                    item: l.item.name,
                    sku: l.item.sku,
                    supplier: l.supplier.name,
                    validUntil: iso(l.breaksValidUntil),
                  },
                  dueOn: iso(l.breaksValidUntil),
                }),
              );
            if (l.approval === 'approved' && l.reviewOn && l.reviewOn <= until)
              raised += Number(
                await this.raise(tx, {
                  factoryId: f.factoryId,
                  factoryPublicId: f.factory.publicId,
                  kind: 'supplier_review_due',
                  dedupeKey: `supplier_review_due:${l.publicId}:${iso(l.reviewOn)}`,
                  subjectType: 'item',
                  subjectPublicId: l.item.publicId,
                  payload: {
                    item: l.item.name,
                    sku: l.item.sku,
                    supplier: l.supplier.name,
                    reviewOn: iso(l.reviewOn),
                  },
                  dueOn: iso(l.reviewOn),
                }),
              );
          }
          const seen = new Set<string>();
          for (const q of quotes) {
            const key = `${q.itemId}:${q.supplierId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const link = await tx.erpItemSupplier.findUnique({
              where: { itemId_supplierId: { itemId: q.itemId, supplierId: q.supplierId } },
            });
            // Only while that quotation is still the supplier's latest price for the item.
            if (!link || link.status !== 'active' || (link.lastPricedOn && link.lastPricedOn > q.pricedOn))
              continue;
            raised += Number(
              await this.raise(tx, {
                factoryId: f.factoryId,
                factoryPublicId: f.factory.publicId,
                kind: 'quote_expiring',
                dedupeKey: `quote_expiring:${q.publicId}`,
                subjectType: 'item',
                subjectPublicId: q.item.publicId,
                payload: {
                  item: q.item.name,
                  sku: q.item.sku,
                  supplier: q.supplier.name,
                  validUntil: iso(q.validUntil),
                  documentNo: q.documentNo,
                },
                dueOn: iso(q.validUntil),
              }),
            );
          }
        });
      } catch (e) {
        this.logger.warn(`sourcing alerts ${f.factory.publicId}: ${(e as Error).message}`);
      }
    }
    return raised;
  }
}

export function alertDto(
  r: Prisma.ErpAlertGetPayload<{ include: { acknowledgedBy: { select: { displayName: true } } } }>,
): ErpAlertDto {
  return {
    id: r.publicId,
    kind: r.kind,
    status: r.status,
    subjectType: r.subjectType,
    subjectId: r.subjectPublicId,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    dueOn: iso(r.dueOn),
    createdAt: toBangkokIso(r.createdAt),
    acknowledgedAt: r.acknowledgedAt ? toBangkokIso(r.acknowledgedAt) : null,
    acknowledgedBy: r.acknowledgedBy?.displayName ?? null,
  };
}
