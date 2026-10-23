import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type ErpPrismaService, type ErpTx } from '@database/erp-prisma.service';
import { type ErpRfqStatus, type ErpUnit, type Prisma } from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';

import { type ErpDraftFromReorderResultDto } from './erp.dto';
import { basePrice, dec, fmtCost, fmtMoney, fmtQty, money2, roundToPurchase } from './erp.math';
import {
  type ErpAwardRfqDto,
  type ErpRecordQuoteDto,
  type ErpRfqComparisonDto,
  type ErpRfqDto,
  type ErpRfqListQuery,
  type ErpRfqOfferDto,
  type ErpRfqSummaryDto,
  type ErpSaveRfqDto,
} from './erp-e3.dto';
import { ErpPricingService } from './erp-pricing.service';
import { type DraftLine, ErpPurchasingService } from './erp-purchasing.service';
import { ErpStockService } from './erp-stock.service';
import { itemRef, partnerRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => bangkokDate(new Date());

const RFQ_INCLUDE = {
  createdBy: { select: { displayName: true } },
  purchaseRequest: true,
  lines: { include: { item: true }, orderBy: { lineNo: 'asc' } },
  suppliers: {
    include: {
      supplier: true,
      quotes: { include: { purchaseOrderLine: { include: { purchaseOrder: true } } } },
    },
    orderBy: { id: 'asc' },
  },
} as const;

type RfqRow = Prisma.ErpRfqGetPayload<{ include: typeof RFQ_INCLUDE }>;

interface RfqFacts {
  status: string;
  quoted: boolean;
}

/** The factory's actions on a request for quotation (D-348). */
export const RFQ_ACTIONS: ActionRule<RfqFacts>[] = [
  { key: 'erp_rfq.edit', permissions: ['factory_procurement.manage'], when: (r) => r.status === 'draft' },
  { key: 'erp_rfq.send', permissions: ['factory_procurement.manage'], when: (r) => r.status === 'draft' },
  { key: 'erp_rfq.record', permissions: ['factory_procurement.manage'], when: (r) => r.status === 'sent' },
  {
    key: 'erp_rfq.award',
    permissions: ['factory_procurement.manage'],
    irreversible: true,
    when: (r) => r.status === 'sent' && r.quoted,
  },
  {
    key: 'erp_rfq.cancel',
    permissions: ['factory_procurement.manage'],
    irreversible: true,
    when: (r) => r.status === 'draft' || r.status === 'sent',
  },
];

export const rfqEtag = (r: { publicId: string; rowVersion: number }) => etagOf(r.publicId, r.rowVersion);

/**
 * Requests for quotation (D-348): the same lines asked of several suppliers, each answer recorded (and kept in
 * the price history), compared per base unit with lead time, validity, approval and score, and awarded per line
 * into draft purchase orders, one per supplier.
 */
@Injectable()
export class ErpSourcingService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly pricing: ErpPricingService,
    private readonly purchasing: ErpPurchasingService,
  ) {}

  async list(scope: ErpScope, q: ErpRfqListQuery) {
    const where: Prisma.ErpRfqWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open') where.status = { in: ['draft', 'sent'] };
    else if (q.status) where.status = q.status as ErpRfqStatus;
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { rfqNo: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
        { suppliers: { some: { supplier: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpRfq.findMany({
        where,
        include: {
          createdBy: { select: { displayName: true } },
          _count: { select: { lines: true } },
          suppliers: { select: { status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpRfq.count({ where }),
    ]);
    return paginated(
      rows.map((r) => summary(r, r._count.lines, r.suppliers)),
      total,
      q,
    );
  }

  private async row(db: ErpTx | ErpPrismaService, scope: ErpScope, publicId: string): Promise<RfqRow> {
    const row = await db.erpRfq.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: RFQ_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpRfqDto> {
    return rfqDto(await this.row(this.workspace.db, scope, publicId), perms);
  }

  private async lock(tx: ErpTx, scope: ErpScope, publicId: string) {
    const found = await tx.erpRfq.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_rfqs WHERE id = ${found.id} FOR UPDATE`;
    return (await tx.erpRfq.findUnique({ where: { id: found.id } }))!;
  }

  /** Lines (from the body, else from the approved request's open lines) and suppliers of a draft. */
  private async parts(tx: ErpTx, scope: ErpScope, body: ErpSaveRfqDto) {
    let purchaseRequestId: bigint | null = null;
    let wanted = (body.lines ?? []).map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      note: l.note ?? null,
    }));
    if (body.purchaseRequestId) {
      const pr = await tx.erpPurchaseRequest.findFirst({
        where: { factoryId: scope.factory.id, publicId: body.purchaseRequestId },
        include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } } },
      });
      if (!pr) throw new DomainException('http.not_found');
      if (pr.status !== 'approved')
        throw new DomainException('erp.invalid_status', { params: { status: pr.status } });
      purchaseRequestId = pr.id;
      if (wanted.length === 0)
        wanted = pr.lines
          .filter((l) => l.purchaseOrderLineId === null)
          .map((l) => ({ itemId: l.item.publicId, quantity: l.quantity.toString(), note: l.note }));
    }
    if (wanted.length === 0)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'lines', code: 'required', message: 'At least one line' }],
      });
    const items = await this.stock.items(
      tx,
      scope.factory.id,
      wanted.map((l) => l.itemId),
    );
    const lines = wanted.map((l, i) => {
      const quantity = dec(l.quantity);
      if (!quantity.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
        });
      return { lineNo: i + 1, itemId: items[i]!.id, quantity: fmtQty(quantity), note: l.note };
    });
    const ids = [...new Set(body.supplierIds)];
    const suppliers = await tx.erpTradingPartner.findMany({
      where: { factoryId: scope.factory.id, publicId: { in: ids } },
    });
    if (suppliers.length !== ids.length) throw new DomainException('http.not_found');
    for (const s of suppliers) {
      if (s.kind === 'customer')
        throw new DomainException('erp.not_a_supplier', { params: { name: s.name } });
      if (s.status === 'archived') throw new DomainException('erp.archived', { params: { name: s.name } });
    }
    return { purchaseRequestId, lines, suppliers };
  }

  async create(scope: ErpScope, body: ErpSaveRfqDto, perms: ReadonlySet<string>): Promise<ErpRfqDto> {
    const id = await this.workspace.tx(async (tx) => {
      const { purchaseRequestId, lines, suppliers } = await this.parts(tx, scope, body);
      const rfqNo = await this.workspace.nextNumber(tx, scope.factory.id, 'rfq');
      const rfq = await tx.erpRfq.create({
        data: {
          factoryId: scope.factory.id,
          rfqNo,
          title: body.title.trim(),
          quoteBy: body.quoteBy ? day(body.quoteBy) : null,
          neededBy: body.neededBy ? day(body.neededBy) : null,
          note: body.note ?? null,
          purchaseRequestId,
          createdById: scope.actor.userId,
          lines: { create: lines },
          suppliers: { create: suppliers.map((s) => ({ supplierId: s.id })) },
        },
      });
      await this.workspace.record(tx, scope, 'erp_rfq.drafted', 'erp_rfq', rfq.publicId, { rfqNo });
      return rfq.publicId;
    });
    return this.get(scope, id, perms);
  }

  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveRfqDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpRfqDto> {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, rfqEtag(current));
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const { purchaseRequestId, lines, suppliers } = await this.parts(tx, scope, body);
      await tx.erpRfqLine.deleteMany({ where: { rfqId: current.id } });
      await tx.erpRfqSupplier.deleteMany({ where: { rfqId: current.id } });
      await tx.erpRfq.update({
        where: { id: current.id },
        data: {
          title: body.title.trim(),
          quoteBy: body.quoteBy ? day(body.quoteBy) : null,
          neededBy: body.neededBy ? day(body.neededBy) : null,
          note: body.note ?? null,
          purchaseRequestId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          lines: { create: lines },
          suppliers: { create: suppliers.map((s) => ({ supplierId: s.id })) },
        },
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** Marks a draft as sent to its suppliers (the factory sends it by its own channel or the printout). */
  async send(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpRfqDto> {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpRfq.update({
        where: { id: current.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_rfq.sent', 'erp_rfq', publicId, { rfqNo: current.rfqNo });
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Records one supplier's answer (D-348): a price per line it quoted, in its unit — which also goes into the
   * price history as a quotation (D-334) — replacing what was recorded for it before.
   */
  async recordQuote(
    scope: ErpScope,
    publicId: string,
    rfqSupplierId: string,
    body: ErpRecordQuoteDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpRfqDto> {
    const respondedOn = body.respondedOn ?? today();
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'sent')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const row = await tx.erpRfqSupplier.findFirst({
        where: { rfqId: current.id, publicId: rfqSupplierId },
        include: { supplier: true },
      });
      if (!row) throw new DomainException('http.not_found');
      const lines = await tx.erpRfqLine.findMany({ where: { rfqId: current.id }, include: { item: true } });
      const seen = new Set<string>();
      const quotes = [];
      for (const [i, q] of body.quotes.entries()) {
        const line = lines.find((l) => l.publicId === q.rfqLineId);
        if (!line) throw new DomainException('http.not_found');
        if (seen.has(q.rfqLineId))
          throw new DomainException('validation.failed', {
            errors: [{ path: `quotes.${i}.rfqLineId`, code: 'duplicate', message: 'One quote per line' }],
          });
        seen.add(q.rfqLineId);
        if (q.validUntil && q.validUntil < respondedOn)
          throw new DomainException('validation.failed', {
            errors: [
              { path: `quotes.${i}.validUntil`, code: 'invalid', message: 'On or after the answer date' },
            ],
          });
        const link = await this.pricing.link(tx, line.itemId, row.supplierId);
        const unitAndFactor = this.unitOf(line.item, link, q.unit, q.factor, `quotes.${i}.unit`);
        quotes.push({ line, q, ...unitAndFactor });
      }
      await tx.erpRfqQuote.deleteMany({ where: { rfqSupplierId: row.id } });
      for (const { line, q, unit, factor } of quotes) {
        await tx.erpRfqQuote.create({
          data: {
            rfqSupplierId: row.id,
            rfqLineId: line.id,
            unit,
            factor: fmtCost(factor),
            unitPrice: fmtCost(q.unitPrice),
            minOrderQty: q.minOrderQty ?? null,
            leadTimeDays: q.leadTimeDays ?? null,
            validUntil: q.validUntil ? day(q.validUntil) : null,
            note: q.note ?? null,
          },
        });
        await this.pricing.note(tx, {
          factoryId: scope.factory.id,
          userId: scope.actor.userId,
          item: line.item,
          supplier: row.supplier,
          source: 'quotation',
          unit,
          factor,
          unitPrice: dec(q.unitPrice),
          quantity: roundToPurchase(dec(line.quantity), factor, q.minOrderQty ? dec(q.minOrderQty) : null)
            .purchaseQty,
          pricedOn: respondedOn,
          validUntil: q.validUntil ?? null,
          sourcePublicId: current.publicId,
          documentNo: body.reference ? `${current.rfqNo} / ${body.reference}` : current.rfqNo,
        });
      }
      await tx.erpRfqSupplier.update({
        where: { id: row.id },
        data: {
          status: 'quoted',
          respondedOn: day(respondedOn),
          reference: body.reference ?? null,
          note: body.note ?? null,
          recordedById: scope.actor.userId,
        },
      });
      await tx.erpRfq.update({ where: { id: current.id }, data: { rowVersion: { increment: 1 } } });
      await this.workspace.record(tx, scope, 'erp_rfq.quote_recorded', 'erp_rfq', publicId, {
        rfqNo: current.rfqNo,
        supplierId: row.supplier.publicId,
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** The quote's unit: the supplier's unit for the item, the item's purchase unit or its base unit. */
  private unitOf(
    item: { baseUnit: ErpUnit; purchaseUnit: ErpUnit | null; purchaseFactor: Prisma.Decimal; name: string },
    link: { purchaseUnit: ErpUnit; purchaseFactor: Prisma.Decimal } | null,
    unit: string | undefined,
    factor: string | undefined,
    path: string,
  ) {
    const chosen = (unit ?? link?.purchaseUnit ?? item.purchaseUnit ?? item.baseUnit) as ErpUnit;
    if (chosen === item.baseUnit) return { unit: chosen, factor: dec(1) };
    if (link && chosen === link.purchaseUnit) return { unit: chosen, factor: dec(link.purchaseFactor) };
    if (!link && factor && dec(factor).gt(0)) return { unit: chosen, factor: dec(factor) };
    if (chosen === item.purchaseUnit) return { unit: chosen, factor: dec(item.purchaseFactor) };
    throw new DomainException('erp.unit_not_allowed', {
      params: {
        item: item.name,
        units: [...new Set([item.baseUnit, item.purchaseUnit, link?.purchaseUnit].filter(Boolean))].join(
          ', ',
        ),
      },
      errors: [
        {
          path,
          code: 'unit_not_allowed',
          message: 'Use the supplier’s unit, the purchase unit or the base unit',
        },
      ],
    });
  }

  /** A supplier said it will not quote. */
  async decline(
    scope: ErpScope,
    publicId: string,
    rfqSupplierId: string,
    reason: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpRfqDto> {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'sent')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const row = await tx.erpRfqSupplier.findFirst({
        where: { rfqId: current.id, publicId: rfqSupplierId },
      });
      if (!row) throw new DomainException('http.not_found');
      await tx.erpRfqQuote.deleteMany({ where: { rfqSupplierId: row.id } });
      await tx.erpRfqSupplier.update({
        where: { id: row.id },
        data: {
          status: 'declined',
          respondedOn: day(today()),
          note: reason,
          recordedById: scope.actor.userId,
        },
      });
      await tx.erpRfq.update({ where: { id: current.id }, data: { rowVersion: { increment: 1 } } });
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * The comparison (D-348): per line every quote per base unit, the amount for the requested quantity rounded
   * to the supplier's unit and minimum, lead time, validity, approval and score; cheapest and fastest flagged.
   */
  async comparison(scope: ErpScope, publicId: string): Promise<ErpRfqComparisonDto> {
    const rfq = await this.row(this.workspace.db, scope, publicId);
    const supplierIds = rfq.suppliers.map((s) => s.supplierId);
    const [scores, links] = await Promise.all([
      this.pricing.scores(scope.factory.id, supplierIds),
      this.workspace.db.erpItemSupplier.findMany({
        where: { supplierId: { in: supplierIds }, itemId: { in: rfq.lines.map((l) => l.itemId) } },
      }),
    ]);
    const t = today();
    let cheapestTotal = dec(0);
    const lines = rfq.lines.map((line) => {
      const offers: ErpRfqOfferDto[] = [];
      for (const s of rfq.suppliers) {
        const q = s.quotes.find((x) => x.rfqLineId === line.id);
        if (!q) continue;
        const factor = dec(q.factor);
        const rounded = roundToPurchase(
          dec(line.quantity),
          factor,
          q.minOrderQty ? dec(q.minOrderQty) : null,
        );
        const score = scores.get(s.supplierId);
        offers.push({
          quoteId: q.publicId,
          supplier: partnerRef(s.supplier),
          unit: q.unit,
          unitPrice: fmtCost(q.unitPrice),
          baseUnitPrice: fmtCost(basePrice(dec(q.unitPrice), factor)),
          orderQty: fmtQty(rounded.purchaseQty),
          orderBaseQty: fmtQty(rounded.baseQty),
          amount: fmtMoney(money2(rounded.purchaseQty.times(dec(q.unitPrice)))),
          leadTimeDays: q.leadTimeDays,
          validUntil: iso(q.validUntil),
          expired: q.validUntil !== null && iso(q.validUntil)! < t,
          approval:
            links.find((l) => l.itemId === line.itemId && l.supplierId === s.supplierId)?.approval ??
            'pending',
          score: score?.score ?? null,
          grade: score?.grade ?? null,
          cheapest: false,
          fastest: false,
          awarded: q.awarded,
        });
      }
      offers.sort((a, b) => dec(a.baseUnitPrice).comparedTo(dec(b.baseUnitPrice)));
      const live = offers.filter((o) => !o.expired);
      if (live.length) {
        const min = dec(live[0]!.baseUnitPrice);
        for (const o of live) o.cheapest = dec(o.baseUnitPrice).eq(min);
        cheapestTotal = cheapestTotal.plus(dec(live[0]!.amount));
        const leads = live.filter((o) => o.leadTimeDays !== null).map((o) => o.leadTimeDays!);
        if (leads.length) {
          const fast = Math.min(...leads);
          for (const o of live) o.fastest = o.leadTimeDays === fast;
        }
      }
      return {
        line: {
          id: line.publicId,
          lineNo: line.lineNo,
          item: itemRef(line.item),
          quantity: fmtQty(line.quantity),
          note: line.note,
        },
        offers,
      };
    });
    return {
      rfq: summary(rfq, rfq.lines.length, rfq.suppliers),
      lines,
      cheapestTotal: fmtMoney(cheapestTotal),
    };
  }

  /**
   * Awards one quote per line (D-348) and drafts one purchase order per supplier, in the quoted unit rounded
   * to the quote's minimum, at the quoted price; the RFQ is then awarded.
   */
  async award(
    scope: ErpScope,
    publicId: string,
    body: ErpAwardRfqDto,
  ): Promise<ErpDraftFromReorderResultDto> {
    const rfq = await this.row(this.workspace.db, scope, publicId);
    if (rfq.status !== 'sent')
      throw new DomainException('erp.invalid_status', { params: { status: rfq.status } });
    const seen = new Set<string>();
    const wanted: (DraftLine & { quoteId: bigint })[] = [];
    for (const [i, a] of body.awards.entries()) {
      const line = rfq.lines.find((l) => l.publicId === a.rfqLineId);
      const s = rfq.suppliers.find((x) => x.quotes.some((q) => q.publicId === a.quoteId));
      const q = s?.quotes.find((x) => x.publicId === a.quoteId);
      if (!line || !s || !q || q.rfqLineId !== line.id) throw new DomainException('http.not_found');
      if (seen.has(a.rfqLineId))
        throw new DomainException('validation.failed', {
          errors: [{ path: `awards.${i}.rfqLineId`, code: 'duplicate', message: 'One quote per line' }],
        });
      seen.add(a.rfqLineId);
      if (s.supplier.status === 'archived')
        throw new DomainException('erp.archived', { params: { name: s.supplier.name } });
      const rounded = roundToPurchase(
        dec(line.quantity),
        dec(q.factor),
        q.minOrderQty ? dec(q.minOrderQty) : null,
      );
      wanted.push({
        item: line.item,
        supplierId: s.supplier.publicId,
        quantity: fmtQty(rounded.purchaseQty),
        unit: q.unit,
        unitPrice: fmtCost(q.unitPrice),
        lead: q.leadTimeDays ?? 0,
        quoteId: q.id,
      });
    }
    const created = await this.purchasing.draftOrders(scope, wanted, `จากใบขอราคา ${rfq.rfqNo}`);
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'sent')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      for (const c of created) {
        const poLines = [...c.po.lines].sort((a, b) => a.lineNo - b.lineNo);
        for (const [i, row] of (c.rows as (DraftLine & { quoteId: bigint })[]).entries())
          await tx.erpRfqQuote.update({
            where: { id: row.quoteId },
            data: { awarded: true, purchaseOrderLineId: poLines[i]!.id },
          });
      }
      await tx.erpRfq.update({
        where: { id: current.id },
        data: {
          status: 'awarded',
          awardedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_rfq.awarded', 'erp_rfq', publicId, {
        rfqNo: rfq.rfqNo,
        purchaseOrders: created.length,
      });
    });
    return { created: created.map((c) => c.summary), skipped: [] };
  }

  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'draft' && current.status !== 'sent')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpRfq.update({
        where: { id: current.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_rfq.cancelled', 'erp_rfq', publicId, {
        rfqNo: current.rfqNo,
      });
    });
    return this.get(scope, publicId, perms);
  }
}

function summary(
  r: {
    publicId: string;
    rfqNo: string;
    status: string;
    title: string;
    quoteBy: Date | null;
    neededBy: Date | null;
    createdAt: Date;
    createdBy: { displayName: string };
  },
  lineCount: number,
  suppliers: { status: string }[],
): ErpRfqSummaryDto {
  return {
    id: r.publicId,
    rfqNo: r.rfqNo,
    status: r.status,
    title: r.title,
    quoteBy: iso(r.quoteBy),
    neededBy: iso(r.neededBy),
    lineCount,
    supplierCount: suppliers.length,
    answered: suppliers.filter((s) => s.status !== 'invited').length,
    createdBy: r.createdBy.displayName,
    createdAt: toBangkokIso(r.createdAt),
  };
}

export function rfqDto(r: RfqRow, perms: ReadonlySet<string>): ErpRfqDto {
  return {
    ...summary(r, r.lines.length, r.suppliers),
    note: r.note,
    purchaseRequest: r.purchaseRequest
      ? { id: r.purchaseRequest.publicId, code: r.purchaseRequest.prNo, name: r.purchaseRequest.prNo }
      : null,
    sentAt: r.sentAt ? toBangkokIso(r.sentAt) : null,
    awardedAt: r.awardedAt ? toBangkokIso(r.awardedAt) : null,
    cancelReason: r.cancelReason,
    lines: r.lines.map((l) => ({
      id: l.publicId,
      lineNo: l.lineNo,
      item: itemRef(l.item),
      quantity: fmtQty(l.quantity),
      note: l.note,
    })),
    suppliers: r.suppliers.map((s) => ({
      id: s.publicId,
      supplier: partnerRef(s.supplier),
      status: s.status,
      respondedOn: iso(s.respondedOn),
      reference: s.reference,
      note: s.note,
      quotes: s.quotes
        .map((q) => ({
          id: q.publicId,
          rfqLineId: r.lines.find((l) => l.id === q.rfqLineId)!.publicId,
          lineNo: r.lines.find((l) => l.id === q.rfqLineId)!.lineNo,
          unit: q.unit,
          factor: fmtCost(q.factor),
          unitPrice: fmtCost(q.unitPrice),
          baseUnitPrice: fmtCost(basePrice(dec(q.unitPrice), dec(q.factor))),
          minOrderQty: q.minOrderQty === null ? null : fmtQty(q.minOrderQty),
          leadTimeDays: q.leadTimeDays,
          validUntil: iso(q.validUntil),
          note: q.note,
          awarded: q.awarded,
          purchaseOrder: q.purchaseOrderLine
            ? {
                id: q.purchaseOrderLine.purchaseOrder.publicId,
                code: q.purchaseOrderLine.purchaseOrder.poNo ?? '',
                name: q.purchaseOrderLine.purchaseOrder.poNo ?? '',
              }
            : null,
        }))
        .sort((a, b) => a.lineNo - b.lineNo)
        .map(({ lineNo: _lineNo, ...q }) => q),
    })),
    nextActions: nextActions(
      { status: r.status, quoted: r.suppliers.some((s) => s.status === 'quoted') },
      RFQ_ACTIONS,
      perms,
    ),
    version: r.rowVersion,
  };
}
