import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type ReorderSuggestionStatus } from '@generated/prisma/client';
import { CompaniesService } from '@modules/companies/companies.service';
import { specificationHash } from '@modules/quotes/specification-hash';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type SkuOrder, type SuggestionResult, suggestReorder } from './reorder-suggestion';
import { type AdminReorderSuggestionDto, type ReorderSuggestionDto } from './reorder-suggestions.dto';

const ACTOR = systemActor('reorder.suggestions');
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);

const INCLUDE = {
  productType: { select: { publicId: true, code: true, nameTh: true, nameEn: true } },
  company: { select: { publicId: true, legalName: true } },
  customer: { select: { publicId: true, displayName: true } },
  lastOrder: { select: { publicId: true, orderCode: true, quantityOrdered: true, unit: true } },
  contactedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.ReorderSuggestionInclude;
type SuggestionRow = Prisma.ReorderSuggestionGetPayload<{ include: typeof INCLUDE }>;

interface SkuGroup {
  customerUserId: bigint | null;
  companyId: bigint | null;
  productTypeId: bigint;
  orders: (SkuOrder & { id: bigint; customerUserId: bigint })[];
}

/**
 * D-288 reorder suggestions. A SKU is the customer (or the company, for company orders) × the specification (product
 * type + configuration without quantities or delivery) × the approved artwork's sha256; with ≥ `reorder.min_orders`
 * orders it gets a suggestion — next need, suggested date and quantity (`suggestReorder`) — recomputed nightly. A new
 * order of the SKU opens a new cycle. The customer sees them (and may dismiss one), CS works them as a queue, and the
 * reminder is marketing: the notification router applies consent and quiet hours (D-144).
 */
@Injectable()
export class ReorderSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly companies: CompaniesService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  /** Recomputes every SKU's suggestion; returns how many cycles opened. */
  async recompute(at = new Date()): Promise<number> {
    const [min, avg, safety] = await Promise.all(
      (['reorder.min_orders', 'reorder.average_orders', 'reorder.safety_stock_days'] as const).map((k) =>
        this.settings.at(k, { at }),
      ),
    );
    const rules = {
      minOrders: Number(min!.value),
      averageOrders: Number(avg!.value),
      safetyStockDays: Number(safety!.value),
    };
    const settingVersionIds = {
      'reorder.min_orders': String(min!.versionId),
      'reorder.average_orders': String(avg!.versionId),
      'reorder.safety_stock_days': String(safety!.versionId),
    };
    const groups = await this.skus();
    let opened = 0;
    for (const [key, group] of groups) {
      const result = suggestReorder(group.orders, rules);
      if (!result) continue;
      if (await this.upsert(key, group, result, settingVersionIds, at)) opened++;
    }
    return opened;
  }

  /** Orders grouped by SKU, oldest first: standard orders not cancelled, instant specification, approved artwork. */
  private async skus(): Promise<Map<string, SkuGroup>> {
    const orders = await this.prisma.order.findMany({
      where: { kind: 'standard', status: { not: 'cancelled' }, artworkApprovedAt: { not: null } },
      select: {
        id: true,
        createdAt: true,
        deliveredAt: true,
        quantityOrdered: true,
        customerUserId: true,
        productTypeId: true,
        orderGroup: { select: { companyId: true } },
        quote: { select: { input: true } },
        proofs: {
          where: { status: 'approved' },
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: { approvedFileSha256: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const groups = new Map<string, SkuGroup>();
    for (const o of orders) {
      const input = o.quote.input as { productTypeCode?: string; configuration?: Record<string, unknown> };
      const artwork = o.proofs[0]?.approvedFileSha256;
      if (!input.productTypeCode || !input.configuration || !artwork) continue;
      const companyId = o.orderGroup.companyId;
      const owner = companyId ? `company:${companyId}` : `customer:${o.customerUserId}`;
      const key = hex(
        sha256(
          [owner, hex(specificationHash(input.productTypeCode, input.configuration)), hex(artwork)].join('|'),
        ),
      );
      const group = groups.get(key) ?? {
        customerUserId: companyId ? null : o.customerUserId,
        companyId,
        productTypeId: o.productTypeId,
        orders: [],
      };
      group.orders.push({
        id: o.id,
        customerUserId: o.customerUserId,
        orderedOn: bangkokDate(o.createdAt),
        quantity: o.quantityOrdered,
        deliveredOn: o.deliveredAt ? bangkokDate(o.deliveredAt) : null,
      });
      groups.set(key, group);
    }
    return groups;
  }

  /** Writes the SKU's numbers; a new last order opens a new cycle (event + activity). True when a cycle opened. */
  private async upsert(
    key: string,
    group: SkuGroup,
    r: SuggestionResult,
    settingVersionIds: Record<string, string>,
    at: Date,
  ): Promise<boolean> {
    const skuSha256 = Uint8Array.from(Buffer.from(key, 'hex'));
    const last = group.orders.at(-1)!;
    const numbers = {
      productTypeId: group.productTypeId,
      lastOrderId: last.id,
      orderCount: r.orderCount,
      averageIntervalDays: r.averageIntervalDays,
      lastLeadTimeDays: r.lastLeadTimeDays,
      nextNeedOn: date(r.nextNeedOn),
      suggestedOn: date(r.suggestedOn),
      suggestedQuantity: r.suggestedQuantity,
      settingVersionIds,
      computedAt: at,
    };
    return this.prisma.withTx(async (tx) => {
      const existing = await tx.reorderSuggestion.findUnique({ where: { skuSha256 } });
      if (existing && existing.lastOrderId === last.id) {
        await tx.reorderSuggestion.update({ where: { id: existing.id }, data: numbers });
        return false;
      }
      const row = existing
        ? await tx.reorderSuggestion.update({
            where: { id: existing.id },
            data: {
              ...numbers,
              status: 'open',
              contactedAt: null,
              contactedById: null,
              contactNote: null,
              dismissedAt: null,
              dismissedById: null,
              remindedAt: null,
            },
          })
        : await tx.reorderSuggestion.create({
            data: {
              ...numbers,
              skuSha256,
              customerUserId: group.customerUserId,
              companyId: group.companyId,
            },
          });
      await this.record(tx, row.publicId, 'reorder_suggestion.opened', {
        suggestedOn: r.suggestedOn,
        suggestedQuantity: r.suggestedQuantity,
      });
      return true;
    });
  }

  /**
   * The marketing reminder of each open suggestion whose date has come (once per cycle): `reorder.suggestion_due` to
   * the customer of the SKU's last order — the router applies the channel consent and quiet hours (D-144).
   */
  async remind(at = new Date()): Promise<number> {
    const due = await this.prisma.reorderSuggestion.findMany({
      where: { status: 'open', remindedAt: null, suggestedOn: { lte: date(bangkokDate(at)) } },
      include: {
        ...INCLUDE,
        lastOrder: { select: { publicId: true, orderCode: true, customer: { select: { publicId: true } } } },
      },
    });
    for (const s of due) {
      await this.prisma.withTx(async (tx) => {
        const claimed = await tx.reorderSuggestion.updateMany({
          where: { id: s.id, remindedAt: null, status: 'open' },
          data: { remindedAt: at },
        });
        if (claimed.count === 0) return;
        await this.events.record(
          tx,
          {
            type: 'reorder.suggestion_due',
            aggregateType: 'reorder_suggestion',
            aggregateId: s.publicId,
            payload: {
              suggestionId: s.publicId,
              customerId: s.lastOrder.customer.publicId,
              orderId: s.lastOrder.publicId,
              orderCode: s.lastOrder.orderCode,
              productTypeNameTh: s.productType.nameTh,
              productTypeNameEn: s.productType.nameEn,
              suggestedQuantity: s.suggestedQuantity,
              suggestedOn: day(s.suggestedOn),
            },
          },
          ACTOR,
        );
      });
    }
    return due.length;
  }

  // --- reads and actions --------------------------------------------------------------------------------------------

  /** Mine: my own SKUs and those of companies where I may place orders; dismissed ones left out. */
  async mine(actor: UserActor): Promise<ReorderSuggestionDto[]> {
    const companies = await this.orderingCompanies(actor.userId);
    const rows = await this.prisma.reorderSuggestion.findMany({
      where: {
        status: { not: 'dismissed' },
        OR: [{ customerUserId: actor.userId }, { companyId: { in: companies } }],
      },
      include: INCLUDE,
      orderBy: [{ suggestedOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => dto(r));
  }

  async dismissMine(actor: UserActor, publicId: string): Promise<ReorderSuggestionDto> {
    const companies = await this.orderingCompanies(actor.userId);
    const row = await this.prisma.reorderSuggestion.findFirst({
      where: { publicId, OR: [{ customerUserId: actor.userId }, { companyId: { in: companies } }] },
    });
    if (!row) throw new DomainException('http.not_found');
    return dto(await this.decide(actor, row.id, 'dismissed', null));
  }

  /** CS queue: open by default, the soonest suggested date first. */
  async queue(query: {
    page: number;
    perPage: number;
    status?: ReorderSuggestionStatus;
    dueBy?: string;
  }): Promise<{ rows: AdminReorderSuggestionDto[]; total: number }> {
    const where: Prisma.ReorderSuggestionWhereInput = {
      status: query.status ?? 'open',
      ...(query.dueBy && { suggestedOn: { lte: date(query.dueBy) } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.reorderSuggestion.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ suggestedOn: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.reorderSuggestion.count({ where }),
    ]);
    return { rows: rows.map((r) => adminDto(r)), total };
  }

  async staffDecide(
    actor: UserActor,
    publicId: string,
    status: 'contacted' | 'dismissed',
    note: string | null,
  ): Promise<AdminReorderSuggestionDto> {
    const row = await this.prisma.reorderSuggestion.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    return adminDto(await this.decide(actor, row.id, status, note));
  }

  private async decide(
    actor: UserActor,
    id: bigint,
    status: 'contacted' | 'dismissed',
    note: string | null,
  ): Promise<SuggestionRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await tx.reorderSuggestion.findUniqueOrThrow({ where: { id } });
      if (row.status === 'dismissed' || row.status === status)
        throw new DomainException('reorders.suggestion_decided', { params: { status: row.status } });
      const at = new Date();
      const updated = await tx.reorderSuggestion.update({
        where: { id },
        data:
          status === 'contacted'
            ? { status, contactedAt: at, contactedById: actor.userId, contactNote: note?.trim() || null }
            : { status, dismissedAt: at, dismissedById: actor.userId },
        include: INCLUDE,
      });
      await this.record(
        tx,
        updated.publicId,
        `reorder_suggestion.${status}`,
        { note: note ?? undefined },
        actor,
      );
      return updated;
    });
  }

  private async orderingCompanies(userId: bigint): Promise<bigint[]> {
    const companies = await this.companies.mine(userId);
    const out: bigint[] = [];
    for (const c of companies)
      if (await this.companies.hasCompanyPermission(userId, c.id, 'company_orders.place')) out.push(c.id);
    return out;
  }

  private async record(
    tx: Tx,
    publicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor = ACTOR,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'reorder_suggestion',
        aggregateId: publicId,
        payload: { suggestionId: publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'reorder_suggestion',
      aggregatePublicId: publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }
}

function dto(r: SuggestionRow): ReorderSuggestionDto {
  return {
    id: r.publicId,
    status: r.status,
    productType: {
      id: r.productType.publicId,
      code: r.productType.code,
      nameTh: r.productType.nameTh,
      nameEn: r.productType.nameEn,
    },
    company: r.company ? { id: r.company.publicId, name: r.company.legalName } : null,
    lastOrder: {
      orderId: r.lastOrder.publicId,
      orderCode: r.lastOrder.orderCode,
      quantity: r.lastOrder.quantityOrdered,
      unit: r.lastOrder.unit,
    },
    orderCount: r.orderCount,
    averageIntervalDays: r.averageIntervalDays.toFixed(2),
    lastLeadTimeDays: r.lastLeadTimeDays,
    nextNeedOn: day(r.nextNeedOn),
    suggestedOn: day(r.suggestedOn),
    suggestedQuantity: r.suggestedQuantity,
    computedAt: toBangkokIso(r.computedAt),
  };
}

function adminDto(r: SuggestionRow): AdminReorderSuggestionDto {
  return {
    ...dto(r),
    customer: r.customer ? { id: r.customer.publicId, displayName: r.customer.displayName } : null,
    contactedAt: r.contactedAt ? toBangkokIso(r.contactedAt) : null,
    contactedBy: r.contactedBy
      ? { id: r.contactedBy.publicId, displayName: r.contactedBy.displayName }
      : null,
    contactNote: r.contactNote,
    remindedAt: r.remindedAt ? toBangkokIso(r.remindedAt) : null,
  };
}
