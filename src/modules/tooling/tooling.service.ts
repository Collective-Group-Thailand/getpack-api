import { type Actor, systemActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type ToolingKind, type ToolingStatus } from '@generated/prisma/client';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import {
  type QuoteStepView,
  type ToolingAmountsView,
  type ToolingCredit,
} from '@modules/pricing/quotes/quote-engine.service';
import { ProductionService } from '@modules/production/production.service';
import { specificationHash } from '@modules/quotes/specification-hash';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { type ToolingItemDto, type ToolingRemakeDto } from './tooling.dto';

const BANGKOK_OFFSET_MS = 7 * 3600_000;
const ACTOR = systemActor('tooling.register');

const INCLUDE = {
  factory: { select: { publicId: true, code: true, tradeName: true, legalName: true } },
  sourceOrder: { select: { publicId: true, orderCode: true } },
  lastOrder: { select: { publicId: true, orderCode: true } },
  remakes: { orderBy: { id: 'desc' }, include: { productionJob: { select: { publicId: true } } } },
} satisfies Prisma.ToolingItemInclude;
type ToolingRow = Prisma.ToolingItemGetPayload<{ include: typeof INCLUDE }>;

type Internal = { tooling?: { charged: ToolingAmountsView; waived: ToolingAmountsView } | null };

/** `instant` + `months` calendar months on the Bangkok clock. */
export function addBangkokMonths(instant: Date, months: number): Date {
  const local = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  local.setUTCMonth(local.getUTCMonth() + months);
  return new Date(local.getTime() - BANGKOK_OFFSET_MS);
}

const hex = (b: Uint8Array | null) => (b ? Buffer.from(b).toString('hex') : null);
const KIND_PREFIX: Record<ToolingKind, string> = { plates: 'plates', die_block: 'die_block' };

/**
 * D-205 / D-289 the tooling register. A delivered order whose quotation charged plates or a die block — or reused
 * them — registers them at the factory that made the order (plates bound to the specification and the approved
 * artwork, a die block to the specification); a reorder of the same specification priced within
 * `tooling.reuse_months` of the last use gets them as credits, and the engine waives them at that factory. The factory
 * may report a reused tool unusable before accepting the job: Packio absorbs the remake (its buy price is paid
 * with the job's goods receipt; the customer price is unchanged, D-012).
 */
@Injectable()
export class ToolingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly access: FactoryAccess,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly production: ProductionService,
  ) {}

  /** Register tooling a reorder of `spec` may reuse (plates only with the same artwork). */
  async credits(
    spec: { productTypeCode: string; configuration: Record<string, unknown> },
    artworkSha256: Uint8Array | null,
    at = new Date(),
  ): Promise<ToolingCredit[]> {
    const since = addBangkokMonths(at, -(await this.reuseMonths(at)));
    const rows = await this.prisma.toolingItem.findMany({
      where: {
        specSha256: Uint8Array.from(specificationHash(spec.productTypeCode, spec.configuration)),
        status: 'active',
        lastUsedAt: { gte: since },
      },
      include: { factory: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter(
        (r) =>
          r.kind === 'die_block' ||
          (artworkSha256 !== null && r.artworkSha256 !== null && hex(r.artworkSha256) === hex(artworkSha256)),
      )
      .map((r) => ({ toolingId: r.publicId, factoryId: r.factory.publicId, kind: r.kind }));
  }

  // --- the register ----------------------------------------------------------------------------------------------

  /** A delivered order registers (or refreshes) the plates and die blocks its quotation charged or reused. */
  @OnDomainEvent('order.fact_recorded', { consumer: 'tooling.register' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'delivered') return;
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      include: {
        quote: { select: { input: true } },
        quoteOption: { select: { internalBreakdown: true, selectedFactoryId: true } },
        proofs: { where: { status: 'approved' }, orderBy: { versionNo: 'desc' }, take: 1 },
        productionJobs: {
          where: { jobKind: 'production', status: { notIn: ['rejected', 'cancelled'] } },
          orderBy: { id: 'desc' },
          take: 1,
          select: { factoryId: true },
        },
      },
    });
    if (!order?.deliveredAt || order.kind === 'sample') return;
    const tooling = (order.quoteOption.internalBreakdown as Internal | null)?.tooling;
    const input = order.quote.input as { productTypeCode?: string; configuration?: Record<string, unknown> };
    if (!tooling || !input.productTypeCode || !input.configuration) return;
    const factoryId = order.productionJobs[0]?.factoryId ?? order.quoteOption.selectedFactoryId;
    if (!factoryId) return;
    const used = (sale: string, buy: string, waivedSale: string, waivedBuy: string) =>
      new MoneyDecimal(sale).add(buy).add(waivedSale).add(waivedBuy).gt(0);
    const { charged: c, waived: w } = tooling;
    const kinds: ToolingKind[] = [];
    if (used(c.platesSale, c.platesBuy, w.platesSale, w.platesBuy)) kinds.push('plates');
    if (used(c.dieBlockSale, c.dieBlockBuy, w.dieBlockSale, w.dieBlockBuy)) kinds.push('die_block');
    const specSha256 = specificationHash(input.productTypeCode, input.configuration);
    const artwork = order.proofs[0]?.approvedFileSha256 ?? null;
    for (const kind of kinds) {
      // Plates print one artwork: without an approved file hash they cannot be matched again.
      if (kind === 'plates' && !artwork) continue;
      const artworkSha256 = kind === 'plates' ? Uint8Array.from(artwork!) : null;
      const keySha256 = sha256([KIND_PREFIX[kind], hex(specSha256), hex(artworkSha256) ?? ''].join(':'));
      const existing = await tx.toolingItem.findUnique({
        where: { factoryId_keySha256: { factoryId, keySha256 } },
      });
      const item = existing
        ? await tx.toolingItem.update({
            where: { id: existing.id },
            data: {
              status: 'active',
              lastOrderId: order.id,
              lastUsedAt: existing.lastUsedAt > order.deliveredAt ? existing.lastUsedAt : order.deliveredAt,
            },
          })
        : await tx.toolingItem.create({
            data: {
              factoryId,
              kind,
              specSha256: Uint8Array.from(specSha256),
              artworkSha256,
              keySha256,
              sourceOrderId: order.id,
              lastOrderId: order.id,
              lastUsedAt: order.deliveredAt,
            },
          });
      const type = existing ? 'tooling.used' : 'tooling.registered';
      const factory = await tx.factory.findUniqueOrThrow({
        where: { id: factoryId },
        select: { publicId: true },
      });
      const recorded = await this.events.record(
        tx,
        {
          type,
          aggregateType: 'tooling',
          aggregateId: item.publicId,
          payload: { toolingId: item.publicId, kind, factoryId: factory.publicId, orderId: order.publicId },
        },
        ACTOR,
      );
      await this.activity.record(tx, {
        aggregateType: 'order',
        aggregatePublicId: order.publicId,
        action: type,
        messageKey: `activity.${type}`,
        messageParams: { toolingId: item.publicId, kind },
        visibility: ['internal'],
        entityId: order.entityId,
        domainEventId: recorded.id,
        actor: ACTOR,
      });
    }
  }

  async list(query: {
    page: number;
    perPage: number;
    factoryId?: string;
    kind?: ToolingKind;
    status?: ToolingStatus;
  }): Promise<{ rows: ToolingItemDto[]; total: number }> {
    const where: Prisma.ToolingItemWhereInput = {
      ...(query.factoryId && { factory: { publicId: query.factoryId } }),
      ...(query.kind && { kind: query.kind }),
      ...(query.status && { status: query.status }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.toolingItem.findMany({
        where,
        include: INCLUDE,
        orderBy: { lastUsedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.toolingItem.count({ where }),
    ]);
    return { rows: await this.dtos(rows), total };
  }

  /** My factory's register (D-044: own factory only). */
  async listForFactory(actor: Actor, factoryPublicId: string): Promise<ToolingItemDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.toolingItem.findMany({
      where: { factoryId: factory.id },
      include: INCLUDE,
      orderBy: { lastUsedAt: 'desc' },
    });
    return this.dtos(rows);
  }

  /** The tools a job's order reuses (its quotation's waiver, D-289). */
  async forJob(job: { id: bigint; orderId: bigint; factoryId: bigint }): Promise<ToolingItemDto[]> {
    const ids = await this.reusedIds(this.prisma, job.orderId);
    const rows = await this.prisma.toolingItem.findMany({
      where: { publicId: { in: ids }, factoryId: job.factoryId },
      include: INCLUDE,
      orderBy: { id: 'asc' },
    });
    return this.dtos(rows);
  }

  /**
   * D-205: the factory found a reused tool unusable before accepting the job. The tool is marked unusable, the remake
   * recorded at the buy price the quotation waived; the job's goods receipt pays it (`PurchasingService.onReconciled`).
   */
  async reportUnusable(
    actor: Actor,
    jobId: bigint,
    input: { toolingId: string; reason: string },
  ): Promise<ToolingRemakeDto> {
    if (actor.type !== 'user') throw new DomainException('http.not_found');
    return this.prisma.withTx(async (tx) => {
      const job = await tx.productionJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { order: { include: { quoteOption: { select: { internalBreakdown: true } } } } },
      });
      if (job.status !== 'released')
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      const ids = await this.reusedIds(tx, job.orderId);
      const item = ids.includes(input.toolingId)
        ? await tx.toolingItem.findFirst({ where: { publicId: input.toolingId, factoryId: job.factoryId } })
        : null;
      if (!item) throw new DomainException('http.not_found');
      if (
        await tx.toolingRemake.findUnique({
          where: { toolingId_productionJobId: { toolingId: item.id, productionJobId: job.id } },
        })
      )
        throw new DomainException('tooling.already_reported');
      const waived = (job.order.quoteOption.internalBreakdown as Internal | null)?.tooling?.waived;
      const buy = waived ? (item.kind === 'plates' ? waived.platesBuy : waived.dieBlockBuy) : '0.00';
      const remake = await tx.toolingRemake.create({
        data: {
          toolingId: item.id,
          productionJobId: job.id,
          reason: input.reason.trim(),
          buyNetAmount: formatMoney(new MoneyDecimal(buy)),
          reportedById: actor.userId,
        },
      });
      await tx.toolingItem.update({ where: { id: item.id }, data: { status: 'unusable' } });
      await this.production.record(
        tx,
        job.id,
        'tooling.remake_absorbed',
        {
          toolingId: item.publicId,
          remakeId: remake.publicId,
          kind: item.kind,
          reason: remake.reason,
          buyCostNet: remake.buyNetAmount.toFixed(2),
        },
        actor,
      );
      return remakeDto(remake, job.publicId, item.publicId);
    });
  }

  private async reusedIds(db: Tx, orderId: bigint): Promise<string[]> {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { quoteOption: { select: { result: true } } },
    });
    const waiver = (order.quoteOption.result as Partial<QuoteStepView> | null)?.toolingWaiver;
    return waiver?.tooling.map((t) => t.id) ?? [];
  }

  private async reuseMonths(at: Date): Promise<number> {
    return Number((await this.settings.at('tooling.reuse_months', { at })).value);
  }

  private async dtos(rows: ToolingRow[]): Promise<ToolingItemDto[]> {
    const months = await this.reuseMonths(new Date());
    return rows.map((r) => ({
      id: r.publicId,
      kind: r.kind,
      status: r.status,
      factory: {
        id: r.factory.publicId,
        code: r.factory.code,
        name: r.factory.tradeName ?? r.factory.legalName,
      },
      sourceOrder: { orderId: r.sourceOrder.publicId, orderCode: r.sourceOrder.orderCode },
      lastOrder: { orderId: r.lastOrder.publicId, orderCode: r.lastOrder.orderCode },
      lastUsedAt: toBangkokIso(r.lastUsedAt),
      reusableUntil: toBangkokIso(addBangkokMonths(r.lastUsedAt, months)),
      artworkSha256: hex(r.artworkSha256),
      remakes: r.remakes.map((m) => remakeDto(m, m.productionJob.publicId, r.publicId)),
      createdAt: toBangkokIso(r.createdAt),
    }));
  }
}

function remakeDto(
  m: { publicId: string; reason: string; buyNetAmount: Prisma.Decimal; createdAt: Date },
  jobId: string,
  toolingId: string,
): ToolingRemakeDto {
  return {
    id: m.publicId,
    toolingId,
    productionJobId: jobId,
    reason: m.reason,
    buyNetAmount: m.buyNetAmount.toFixed(2),
    reportedAt: toBangkokIso(m.createdAt),
  };
}
