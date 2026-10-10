import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { type MoneyValue } from '@common/money/money';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpItem,
  type ErpItemSupplier,
  type ErpPriceSource,
  type ErpTradingPartner,
  type ErpUnit,
  Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  basePrice,
  breakPrice,
  changePct,
  cost6,
  dec,
  fmtCost,
  fmtMoney,
  fmtQty,
  priceSpread,
  supplierScore,
} from './erp.math';
import {
  type ErpCreateItemSupplierDto,
  type ErpItemSupplierDto,
  type ErpPriceListQuery,
  type ErpPriceRecordDto,
  type ErpPriceStatsDto,
  type ErpRecordPriceDto,
  type ErpSupplierScoreDto,
  type ErpUpdateItemSupplierDto,
} from './erp-e2.dto';
import {
  type ErpApproveSupplierDto,
  type ErpSavePriceBreaksDto,
  type ErpSupplierScorecardDto,
} from './erp-e3.dto';
import { itemRef, partnerEtag, partnerRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => bangkokDate(new Date());

export const LINK_INCLUDE = {
  item: true,
  supplier: true,
  approvedBy: { select: { displayName: true } },
  priceBreaks: { orderBy: { minQty: 'asc' } },
} as const;

type LinkRow = Prisma.ErpItemSupplierGetPayload<{ include: typeof LINK_INCLUDE }>;

const ZERO_SCORE: ErpSupplierScoreDto = {
  receipts: 0,
  deliveredValue: '0.00',
  acceptedValue: '0.00',
  rejectedLines: 0,
  qualityPct: null,
  onTimePct: null,
  score: null,
  grade: null,
};

/** One price the factory met, to write into the history (D-334). Prices are net, without VAT. */
export interface PriceNote {
  factoryId: bigint;
  userId: bigint;
  item: ErpItem;
  supplier: ErpTradingPartner;
  source: ErpPriceSource;
  unit: ErpUnit;
  factor: MoneyValue;
  unitPrice: MoneyValue;
  quantity?: MoneyValue | null;
  pricedOn: string;
  validUntil?: string | null;
  sourcePublicId?: string | null;
  documentNo?: string | null;
  note?: string | null;
}

/**
 * Who sells what at what price (E1.1; D-333 – D-335): one link per item × supplier with the supplier's own
 * code, unit, minimum order, lead time and latest price, and an append-only history of every price met —
 * paid on a goods receipt, agreed on a purchase order, quoted, or noted by hand. Purchasing reads the
 * preferred link (the item's usual supplier) for reorders, MRP and purchase requests.
 */
@Injectable()
export class ErpPricingService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------------- recording

  /**
   * Writes a price into the history and moves the link's latest price when it is not older than the one it
   * has (D-334). Creates the link the first time a supplier is met; the first link of an item becomes its
   * preferred one and the item's default supplier.
   */
  async note(tx: Tx, n: PriceNote): Promise<void> {
    const base = basePrice(n.unitPrice, n.factor);
    const record = await tx.erpPriceRecord.create({
      data: {
        factoryId: n.factoryId,
        itemId: n.item.id,
        supplierId: n.supplier.id,
        source: n.source,
        unit: n.unit,
        factor: fmtCost(n.factor),
        unitPrice: fmtCost(n.unitPrice),
        baseUnitPrice: fmtCost(base),
        quantity: n.quantity ? fmtQty(n.quantity) : null,
        pricedOn: day(n.pricedOn),
        validUntil: n.validUntil ? day(n.validUntil) : null,
        sourcePublicId: n.sourcePublicId ?? null,
        documentNo: n.documentNo ?? null,
        note: n.note ?? null,
        createdById: n.userId,
      },
    });
    const link = await this.ensureLink(tx, n.factoryId, n.item, n.supplier, n.unit, n.factor, n.userId);
    const newer = !link.lastPricedOn || iso(link.lastPricedOn)! <= n.pricedOn;
    await tx.erpItemSupplier.update({
      where: { id: link.id },
      data: {
        ...(newer && {
          lastPrice: fmtCost(cost6(base.times(dec(link.purchaseFactor)))),
          lastPricedOn: record.pricedOn,
        }),
        ...(n.source === 'goods_receipt' &&
          (!link.lastPurchasedOn || iso(link.lastPurchasedOn)! <= n.pricedOn) && {
            lastPurchasedOn: record.pricedOn,
          }),
      },
    });
  }

  /** The item × supplier link, created on first use in the unit the supplier sold in. */
  async ensureLink(
    tx: Tx,
    factoryId: bigint,
    item: ErpItem,
    supplier: ErpTradingPartner,
    unit: ErpUnit,
    factor: MoneyValue,
    userId: bigint | null,
  ): Promise<ErpItemSupplier> {
    const found = await tx.erpItemSupplier.findUnique({
      where: { itemId_supplierId: { itemId: item.id, supplierId: supplier.id } },
    });
    if (found) return found;
    const hasPreferred = await tx.erpItemSupplier.count({ where: { itemId: item.id, preferred: true } });
    const preferred =
      hasPreferred === 0 && (item.defaultSupplierId === null || item.defaultSupplierId === supplier.id);
    const created = await tx.erpItemSupplier.create({
      data: {
        factoryId,
        itemId: item.id,
        supplierId: supplier.id,
        purchaseUnit: unit,
        purchaseFactor: fmtCost(factor),
        leadTimeDays: item.defaultSupplierId === supplier.id ? item.leadTimeDays : null,
        preferred,
        createdById: userId,
      },
    });
    if (preferred && item.defaultSupplierId === null)
      await tx.erpItem.update({ where: { id: item.id }, data: { defaultSupplierId: supplier.id } });
    return created;
  }

  /** Makes `linkId` the item's one preferred supplier; the item's default supplier follows (D-333). */
  private async prefer(tx: Tx, itemId: bigint, linkId: bigint, supplierId: bigint) {
    await tx.erpItemSupplier.updateMany({
      where: { itemId, preferred: true, id: { not: linkId } },
      data: { preferred: false },
    });
    await tx.erpItemSupplier.update({ where: { id: linkId }, data: { preferred: true } });
    await tx.erpItem.update({ where: { id: itemId }, data: { defaultSupplierId: supplierId } });
  }

  /**
   * The item form's default supplier (E1) kept in step with the links: choosing one makes (or finds) its
   * link and prefers it; clearing it leaves no preferred link.
   */
  async syncDefault(tx: Tx, item: ErpItem, supplierId: bigint | null, userId: bigint) {
    if (supplierId === null) {
      await tx.erpItemSupplier.updateMany({
        where: { itemId: item.id, preferred: true },
        data: { preferred: false },
      });
      return;
    }
    const supplier = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: supplierId } });
    const link = await this.ensureLink(
      tx,
      item.factoryId,
      item,
      supplier,
      item.purchaseUnit ?? item.baseUnit,
      dec(item.purchaseFactor),
      userId,
    );
    await this.prefer(tx, item.id, link.id, supplier.id);
  }

  /** Preferred links (else the default supplier's link) of the given items, by item id. */
  async preferred(
    db: Tx | PrismaService,
    factoryId: bigint,
    itemIds: bigint[],
  ): Promise<Map<bigint, ErpItemSupplier & { supplier: ErpTradingPartner }>> {
    if (itemIds.length === 0) return new Map();
    const links = await db.erpItemSupplier.findMany({
      where: { factoryId, itemId: { in: itemIds }, status: 'active', supplier: { status: 'active' } },
      include: { supplier: true, item: { select: { defaultSupplierId: true } } },
    });
    const out = new Map<bigint, ErpItemSupplier & { supplier: ErpTradingPartner }>();
    for (const l of links) {
      const current = out.get(l.itemId);
      const rank = (x: typeof l) => (x.preferred ? 2 : x.supplierId === x.item.defaultSupplierId ? 1 : 0);
      if (!current || rank(l) > rank(current as typeof l)) out.set(l.itemId, l);
    }
    return out;
  }

  /** The link of one supplier for one item, if any. */
  link(db: Tx | PrismaService, itemId: bigint, supplierId: bigint) {
    return db.erpItemSupplier.findUnique({ where: { itemId_supplierId: { itemId, supplierId } } });
  }

  // ------------------------------------------------------------------------------------ links

  private async item(db: Tx | PrismaService, scope: ErpScope, publicId: string) {
    const item = await db.erpItem.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!item) throw new DomainException('http.not_found');
    return item;
  }

  private async supplier(db: Tx | PrismaService, scope: ErpScope, publicId: string) {
    const s = await db.erpTradingPartner.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!s) throw new DomainException('http.not_found');
    if (s.kind === 'customer') throw new DomainException('erp.not_a_supplier', { params: { name: s.name } });
    return s;
  }

  /** The unit and factor a supplier sells an item in: the base unit is 1; another unit needs a factor. */
  private unit(item: ErpItem, unit: string | undefined, factor: string | undefined) {
    const chosen = (unit ?? item.purchaseUnit ?? item.baseUnit) as ErpUnit;
    if (chosen === item.baseUnit) return { unit: chosen, factor: dec(1) };
    const f = factor ? dec(factor) : chosen === item.purchaseUnit ? dec(item.purchaseFactor) : null;
    if (!f || !f.gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'purchaseFactor', code: 'required', message: 'Base units per purchase unit' }],
      });
    return { unit: chosen, factor: f };
  }

  async listForItem(scope: ErpScope, itemPublicId: string): Promise<ErpItemSupplierDto[]> {
    const item = await this.item(this.workspace.db, scope, itemPublicId);
    const rows = await this.workspace.db.erpItemSupplier.findMany({
      where: { itemId: item.id },
      include: LINK_INCLUDE,
      orderBy: [{ preferred: 'desc' }, { status: 'asc' }, { lastPricedOn: { sort: 'desc', nulls: 'last' } }],
    });
    return this.views(scope.factory.id, rows);
  }

  async listForSupplier(scope: ErpScope, partnerPublicId: string): Promise<ErpItemSupplierDto[]> {
    const s = await this.workspace.db.erpTradingPartner.findFirst({
      where: { factoryId: scope.factory.id, publicId: partnerPublicId },
    });
    if (!s) throw new DomainException('http.not_found');
    const rows = await this.workspace.db.erpItemSupplier.findMany({
      where: { supplierId: s.id },
      include: LINK_INCLUDE,
      orderBy: [{ status: 'asc' }, { item: { sku: 'asc' } }],
    });
    return this.views(scope.factory.id, rows);
  }

  async getLink(scope: ErpScope, itemPublicId: string, linkPublicId: string): Promise<ErpItemSupplierDto> {
    const item = await this.item(this.workspace.db, scope, itemPublicId);
    const row = await this.workspace.db.erpItemSupplier.findFirst({
      where: { itemId: item.id, publicId: linkPublicId },
      include: LINK_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return (await this.views(scope.factory.id, [row]))[0]!;
  }

  async createLink(scope: ErpScope, itemPublicId: string, body: ErpCreateItemSupplierDto) {
    const id = await this.workspace.tx(async (tx) => {
      const item = await this.item(tx, scope, itemPublicId);
      const supplier = await this.supplier(tx, scope, body.supplierId);
      if (supplier.status === 'archived')
        throw new DomainException('erp.archived', { params: { name: supplier.name } });
      if (await this.link(tx, item.id, supplier.id))
        throw new DomainException('erp.supplier_linked', { params: { name: supplier.name } });
      const { unit, factor } = this.unit(item, body.purchaseUnit, body.purchaseFactor);
      const link = await this.ensureLink(
        tx,
        scope.factory.id,
        item,
        supplier,
        unit,
        factor,
        scope.actor.userId,
      );
      await tx.erpItemSupplier.update({
        where: { id: link.id },
        data: {
          supplierSku: body.supplierSku ?? null,
          supplierName: body.supplierName ?? null,
          minOrderQty: body.minOrderQty ?? null,
          leadTimeDays: body.leadTimeDays ?? link.leadTimeDays,
          note: body.note ?? null,
        },
      });
      if (body.preferred) await this.prefer(tx, item.id, link.id, supplier.id);
      if (body.price)
        await this.note(tx, {
          factoryId: scope.factory.id,
          userId: scope.actor.userId,
          item,
          supplier,
          source: 'quotation',
          unit,
          factor,
          unitPrice: dec(body.price),
          pricedOn: today(),
          validUntil: body.validUntil ?? null,
        });
      await this.workspace.record(tx, scope, 'erp_item_supplier.linked', 'erp_item', item.publicId, {
        supplierId: supplier.publicId,
      });
      return link.publicId;
    });
    return this.getLink(scope, itemPublicId, id);
  }

  async updateLink(
    scope: ErpScope,
    itemPublicId: string,
    linkPublicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateItemSupplierDto,
  ) {
    await this.workspace.tx(async (tx) => {
      const item = await this.item(tx, scope, itemPublicId);
      const link = await tx.erpItemSupplier.findFirst({ where: { itemId: item.id, publicId: linkPublicId } });
      if (!link) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, partnerEtag(link));
      const changesUnit = body.purchaseUnit !== undefined || body.purchaseFactor !== undefined;
      const next = changesUnit
        ? this.unit(
            item,
            body.purchaseUnit ?? link.purchaseUnit,
            body.purchaseFactor ?? link.purchaseFactor.toString(),
          )
        : null;
      // The latest price follows the unit: per base unit it stays the same.
      const lastPrice =
        next && link.lastPrice !== null
          ? fmtCost(cost6(dec(link.lastPrice).div(dec(link.purchaseFactor)).times(next.factor)))
          : undefined;
      const archiving = body.status === 'archived';
      await tx.erpItemSupplier.update({
        where: { id: link.id },
        data: {
          ...(body.supplierSku !== undefined && { supplierSku: body.supplierSku }),
          ...(body.supplierName !== undefined && { supplierName: body.supplierName }),
          ...(next && { purchaseUnit: next.unit, purchaseFactor: fmtCost(next.factor) }),
          ...(lastPrice !== undefined && { lastPrice }),
          ...(body.minOrderQty !== undefined && { minOrderQty: body.minOrderQty }),
          ...(body.leadTimeDays !== undefined && { leadTimeDays: body.leadTimeDays }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.status !== undefined && { status: body.status as 'active' | 'archived' }),
          ...(archiving && { preferred: false }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (archiving && link.preferred)
        await tx.erpItem.update({ where: { id: item.id }, data: { defaultSupplierId: null } });
      if (body.preferred === true && !archiving) await this.prefer(tx, item.id, link.id, link.supplierId);
      if (body.preferred === false && link.preferred) {
        await tx.erpItemSupplier.update({ where: { id: link.id }, data: { preferred: false } });
        await tx.erpItem.update({ where: { id: item.id }, data: { defaultSupplierId: null } });
      }
      await this.workspace.record(tx, scope, 'erp_item_supplier.updated', 'erp_item', item.publicId, {
        fields: Object.keys(body),
      });
    });
    return this.getLink(scope, itemPublicId, linkPublicId);
  }

  // ---------------------------------------------------------------------------------- history

  async history(scope: ErpScope, itemPublicId: string, q: ErpPriceListQuery) {
    const item = await this.item(this.workspace.db, scope, itemPublicId);
    const where: Prisma.ErpPriceRecordWhereInput = { itemId: item.id };
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    if (q.source) where.source = q.source as ErpPriceSource;
    const [rows, total] = await Promise.all([
      this.workspace.db.erpPriceRecord.findMany({
        where,
        include: { item: true, supplier: true, createdBy: { select: { displayName: true } } },
        orderBy: [{ pricedOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpPriceRecord.count({ where }),
    ]);
    return paginated(rows.map(priceDto), total, q);
  }

  /** A quotation or a price noted by hand (D-334). */
  async record(scope: ErpScope, itemPublicId: string, body: ErpRecordPriceDto): Promise<ErpPriceRecordDto> {
    const pricedOn = body.pricedOn ?? today();
    if (body.validUntil && body.validUntil < pricedOn)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'validUntil', code: 'invalid', message: 'On or after the price date' }],
      });
    const id = await this.workspace.tx(async (tx) => {
      const item = await this.item(tx, scope, itemPublicId);
      const supplier = await this.supplier(tx, scope, body.supplierId);
      const link = await this.link(tx, item.id, supplier.id);
      const unit = body.unit ?? link?.purchaseUnit ?? undefined;
      const resolved =
        link && unit === link.purchaseUnit
          ? { unit: link.purchaseUnit, factor: dec(link.purchaseFactor) }
          : this.unit(item, unit, undefined);
      await this.note(tx, {
        factoryId: scope.factory.id,
        userId: scope.actor.userId,
        item,
        supplier,
        source: body.source as ErpPriceSource,
        unit: resolved.unit,
        factor: resolved.factor,
        unitPrice: dec(body.unitPrice),
        quantity: body.quantity ? dec(body.quantity) : null,
        pricedOn,
        validUntil: body.validUntil ?? null,
        documentNo: body.documentNo ?? null,
        note: body.note ?? null,
      });
      const last = await tx.erpPriceRecord.findFirstOrThrow({
        where: { itemId: item.id, supplierId: supplier.id },
        orderBy: { id: 'desc' },
      });
      await this.workspace.record(tx, scope, 'erp_price.recorded', 'erp_item', item.publicId, {
        supplierId: supplier.publicId,
        source: body.source,
      });
      return last.id;
    });
    const row = await this.workspace.db.erpPriceRecord.findUniqueOrThrow({
      where: { id },
      include: { item: true, supplier: true, createdBy: { select: { displayName: true } } },
    });
    return priceDto(row);
  }

  // ------------------------------------------------------------- E2.1 breaks, approval, scores

  /**
   * D-346: the price per the link's unit for `qty` of that unit — the largest break not above it while the
   * breaks hold, else the latest price.
   */
  async priceFor(db: Tx | PrismaService, link: ErpItemSupplier, qty: MoneyValue): Promise<MoneyValue | null> {
    const valid = !link.breaksValidUntil || iso(link.breaksValidUntil)! >= today();
    if (valid) {
      const breaks = await db.erpPriceBreak.findMany({ where: { itemSupplierId: link.id } });
      const p = breakPrice(
        breaks.map((b) => ({ minQty: dec(b.minQty), unitPrice: dec(b.unitPrice) })),
        qty,
      );
      if (p) return p;
    }
    return link.lastPrice === null ? null : dec(link.lastPrice);
  }

  /** The last price paid (goods receipt) per base unit to a supplier for an item, if any (D-347). */
  async lastPaid(db: Tx | PrismaService, itemId: bigint, supplierId: bigint): Promise<MoneyValue | null> {
    const r = await db.erpPriceRecord.findFirst({
      where: { itemId, supplierId, source: 'goods_receipt' },
      orderBy: [{ pricedOn: 'desc' }, { id: 'desc' }],
    });
    return r ? dec(r.baseUnitPrice) : null;
  }

  private async lockedLink(tx: Tx, scope: ErpScope, itemPublicId: string, linkPublicId: string) {
    const item = await this.item(tx, scope, itemPublicId);
    const link = await tx.erpItemSupplier.findFirst({
      where: { itemId: item.id, publicId: linkPublicId },
      include: { supplier: true },
    });
    if (!link) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_item_suppliers WHERE id = ${link.id} FOR UPDATE`;
    return { item, link };
  }

  /** D-346: replaces the link's quantity breaks; each is written into the price history as a quotation. */
  async saveBreaks(
    scope: ErpScope,
    itemPublicId: string,
    linkPublicId: string,
    ifMatch: string | undefined,
    body: ErpSavePriceBreaksDto,
  ) {
    const mins = body.breaks.map((b) => dec(b.minQty));
    if (mins.some((m) => !m.gt(0)) || new Set(mins.map((m) => m.toFixed(3))).size !== mins.length)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'breaks', code: 'invalid', message: 'Minimum quantities must be positive and different' },
        ],
      });
    if (body.validUntil && body.validUntil < today())
      throw new DomainException('validation.failed', {
        errors: [{ path: 'validUntil', code: 'invalid', message: 'Today or later' }],
      });
    await this.workspace.tx(async (tx) => {
      const { item, link } = await this.lockedLink(tx, scope, itemPublicId, linkPublicId);
      assertIfMatch(ifMatch, partnerEtag(link));
      await tx.erpPriceBreak.deleteMany({ where: { itemSupplierId: link.id } });
      if (body.breaks.length)
        await tx.erpPriceBreak.createMany({
          data: body.breaks.map((b) => ({
            itemSupplierId: link.id,
            minQty: fmtQty(b.minQty),
            unitPrice: fmtCost(b.unitPrice),
            createdById: scope.actor.userId,
          })),
        });
      for (const b of body.breaks)
        await tx.erpPriceRecord.create({
          data: {
            factoryId: scope.factory.id,
            itemId: item.id,
            supplierId: link.supplierId,
            source: 'quotation',
            unit: link.purchaseUnit,
            factor: fmtCost(link.purchaseFactor),
            unitPrice: fmtCost(b.unitPrice),
            baseUnitPrice: fmtCost(basePrice(dec(b.unitPrice), dec(link.purchaseFactor))),
            quantity: fmtQty(b.minQty),
            pricedOn: day(today()),
            validUntil: body.validUntil ? day(body.validUntil) : null,
            note: 'ราคาตามขั้นจำนวน',
            createdById: scope.actor.userId,
          },
        });
      await tx.erpItemSupplier.update({
        where: { id: link.id },
        data: {
          breaksValidUntil: body.validUntil ? day(body.validUntil) : null,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_item_supplier.breaks_saved', 'erp_item', item.publicId, {
        supplierId: link.supplier.publicId,
        breaks: body.breaks.length,
      });
    });
    return this.getLink(scope, itemPublicId, linkPublicId);
  }

  /** D-351: approves (with an optional review date) or suspends (with a reason) a supplier for an item. */
  async decideApproval(
    scope: ErpScope,
    itemPublicId: string,
    linkPublicId: string,
    decision: 'approved' | 'suspended',
    body: ErpApproveSupplierDto,
  ) {
    if (body.reviewOn && body.reviewOn <= today())
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reviewOn', code: 'invalid', message: 'After today' }],
      });
    await this.workspace.tx(async (tx) => {
      const { item, link } = await this.lockedLink(tx, scope, itemPublicId, linkPublicId);
      await tx.erpItemSupplier.update({
        where: { id: link.id },
        data: {
          approval: decision,
          approvalNote: body.note ?? null,
          ...(decision === 'approved'
            ? {
                approvedAt: new Date(),
                approvedById: scope.actor.userId,
                reviewOn: body.reviewOn ? day(body.reviewOn) : null,
              }
            : { reviewOn: null }),
          ...(decision === 'suspended' && link.preferred && { preferred: false }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (decision === 'suspended' && link.preferred)
        await tx.erpItem.update({ where: { id: item.id }, data: { defaultSupplierId: null } });
      await this.audit.record(tx, {
        category: 'approval',
        action: decision === 'approved' ? 'erp.supplier_approved' : 'erp.supplier_suspended',
        resourceType: 'erp_item',
        resourcePublicId: item.publicId,
        data: { supplierId: link.supplier.publicId },
      });
      await this.workspace.record(
        tx,
        scope,
        decision === 'approved' ? 'erp_item_supplier.approved' : 'erp_item_supplier.suspended',
        'erp_item',
        item.publicId,
        { supplierId: link.supplier.publicId },
      );
    });
    return this.getLink(scope, itemPublicId, linkPublicId);
  }

  /** D-349: 12-month quality, on-time and score per supplier. */
  async scores(factoryId: bigint, supplierIds: bigint[]): Promise<Map<bigint, ErpSupplierScoreDto>> {
    const out = new Map<bigint, ErpSupplierScoreDto>();
    if (supplierIds.length === 0) return out;
    const since = day(addCalendarDays(today(), -365));
    const [values, timing] = await Promise.all([
      this.workspace.db.$queryRaw<
        {
          supplier_id: bigint;
          receipts: bigint;
          accepted: Prisma.Decimal;
          rejected: Prisma.Decimal;
          rejected_lines: bigint;
        }[]
      >(Prisma.sql`
        SELECT g.supplier_id, count(DISTINCT g.id) AS receipts, coalesce(sum(l.amount), 0) AS accepted,
               coalesce(sum(round(l.rejected_quantity * l.factor * l.unit_cost, 2)), 0) AS rejected,
               count(*) FILTER (WHERE l.rejected_quantity > 0) AS rejected_lines
          FROM erp_goods_receipt_lines l JOIN erp_goods_receipts g ON g.id = l.goods_receipt_id
         WHERE g.factory_id = ${factoryId} AND g.supplier_id IN (${Prisma.join(supplierIds)})
           AND g.received_on >= ${since}
         GROUP BY g.supplier_id`),
      this.workspace.db.$queryRaw<{ supplier_id: bigint; timed: bigint; on_time: bigint }[]>(Prisma.sql`
        SELECT g.supplier_id, count(*) AS timed, count(*) FILTER (WHERE g.received_on <= p.expected_on) AS on_time
          FROM erp_goods_receipts g JOIN erp_purchase_orders p ON p.id = g.purchase_order_id
         WHERE g.factory_id = ${factoryId} AND g.supplier_id IN (${Prisma.join(supplierIds)})
           AND g.received_on >= ${since} AND p.expected_on IS NOT NULL
         GROUP BY g.supplier_id`),
    ]);
    for (const id of supplierIds) {
      const v = values.find((x) => x.supplier_id === id);
      const t = timing.find((x) => x.supplier_id === id);
      const accepted = dec(v?.accepted ?? 0);
      const delivered = accepted.plus(dec(v?.rejected ?? 0));
      const s = supplierScore({
        receipts: Number(v?.receipts ?? 0),
        deliveredValue: delivered,
        acceptedValue: accepted,
        onTime: Number(t?.on_time ?? 0),
        timed: Number(t?.timed ?? 0),
      });
      out.set(id, {
        receipts: Number(v?.receipts ?? 0),
        deliveredValue: fmtMoney(delivered),
        acceptedValue: fmtMoney(accepted),
        rejectedLines: Number(v?.rejected_lines ?? 0),
        qualityPct: s.qualityPct?.toFixed(2) ?? null,
        onTimePct: s.onTimePct?.toFixed(2) ?? null,
        score: s.score?.toFixed(2) ?? null,
        grade: s.grade,
      });
    }
    return out;
  }

  /** D-349: a supplier's scorecard — score, approvals and the latest rejections. */
  async scorecard(scope: ErpScope, partnerPublicId: string): Promise<ErpSupplierScorecardDto> {
    const s = await this.workspace.db.erpTradingPartner.findFirst({
      where: { factoryId: scope.factory.id, publicId: partnerPublicId },
    });
    if (!s) throw new DomainException('http.not_found');
    const since = day(addCalendarDays(today(), -365));
    const [scores, approvals, rejections] = await Promise.all([
      this.scores(scope.factory.id, [s.id]),
      this.workspace.db.erpItemSupplier.groupBy({
        by: ['approval'],
        where: { supplierId: s.id, status: 'active' },
        _count: { _all: true },
      }),
      this.workspace.db.erpGoodsReceiptLine.findMany({
        where: {
          rejectedQuantity: { gt: 0 },
          goodsReceipt: { supplierId: s.id, receivedOn: { gte: since } },
        },
        include: { item: true, goodsReceipt: true },
        orderBy: [{ goodsReceipt: { receivedOn: 'desc' } }, { id: 'desc' }],
        take: 20,
      }),
    ]);
    const n = (a: string) => approvals.find((x) => x.approval === a)?._count._all ?? 0;
    return {
      ...(scores.get(s.id) ?? ZERO_SCORE),
      supplier: partnerRef(s),
      approvedItems: n('approved'),
      pendingItems: n('pending'),
      rejections: rejections.map((r) => ({
        goodsReceipt: { id: r.goodsReceipt.publicId, code: r.goodsReceipt.grNo, name: r.goodsReceipt.grNo },
        receivedOn: iso(r.goodsReceipt.receivedOn)!,
        item: itemRef(r.item),
        rejectedQuantity: fmtQty(r.rejectedQuantity),
        unit: r.unit,
        reason: r.rejectReason,
      })),
    };
  }

  // ------------------------------------------------------------------------------------ stats

  /** Links with their 12-month purchase statistics and the cheapest flag (D-334, D-335). */
  async views(factoryId: bigint, rows: LinkRow[]): Promise<ErpItemSupplierDto[]> {
    if (rows.length === 0) return [];
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const since = day(addCalendarDays(today(), -365));
    const [records, receipts, quotes, siblings] = await Promise.all([
      this.workspace.db.erpPriceRecord.findMany({
        where: { factoryId, itemId: { in: itemIds }, source: 'goods_receipt', pricedOn: { gte: since } },
        orderBy: [{ pricedOn: 'desc' }, { id: 'desc' }],
      }),
      this.workspace.db.$queryRaw<
        {
          item_id: bigint;
          supplier_id: bigint;
          received_on: Date;
          ordered_on: Date;
          expected_on: Date | null;
        }[]
      >(Prisma.sql`
        SELECT DISTINCT l.item_id, g.supplier_id, g.received_on, p.ordered_on, p.expected_on, g.id
          FROM erp_goods_receipt_lines l
          JOIN erp_goods_receipts g ON g.id = l.goods_receipt_id
          JOIN erp_purchase_orders p ON p.id = g.purchase_order_id
         WHERE g.factory_id = ${factoryId} AND l.item_id IN (${Prisma.join(itemIds)})
           AND g.received_on >= ${since}`),
      this.workspace.db.erpPriceRecord.findMany({
        where: { factoryId, itemId: { in: itemIds }, source: 'quotation', validUntil: { gte: day(today()) } },
        orderBy: [{ pricedOn: 'desc' }, { id: 'desc' }],
      }),
      this.workspace.db.erpItemSupplier.findMany({
        where: { itemId: { in: itemIds }, status: 'active', lastPrice: { not: null } },
      }),
    ]);
    const scores = await this.scores(factoryId, [...new Set(rows.map((r) => r.supplierId))]);
    const cheapest = new Map<bigint, MoneyValue>();
    for (const s of siblings) {
      const p = dec(s.lastPrice!).div(dec(s.purchaseFactor));
      const c = cheapest.get(s.itemId);
      if (!c || p.lt(c)) cheapest.set(s.itemId, p);
    }
    return rows.map((r) => {
      const mine = records.filter((x) => x.itemId === r.itemId && x.supplierId === r.supplierId);
      const spread = priceSpread(
        mine.map((x) => ({
          baseUnitPrice: dec(x.baseUnitPrice),
          quantity: x.quantity === null ? null : dec(x.quantity).times(dec(x.factor)),
        })),
      );
      const got = receipts.filter((x) => x.item_id === r.itemId && x.supplier_id === r.supplierId);
      const timed = got.filter((x) => x.expected_on !== null);
      const onTime = timed.filter((x) => x.received_on.getTime() <= x.expected_on!.getTime()).length;
      const leadDays = got.map((x) => (x.received_on.getTime() - x.ordered_on.getTime()) / 86_400_000);
      const stats: ErpPriceStatsDto = {
        minBaseUnitPrice: spread ? fmtCost(spread.min) : null,
        avgBaseUnitPrice: spread ? fmtCost(spread.avg) : null,
        maxBaseUnitPrice: spread ? fmtCost(spread.max) : null,
        purchases: new Set(mine.map((x) => x.sourcePublicId ?? x.publicId)).size,
        changePct:
          mine.length >= 2
            ? (changePct(dec(mine[0]!.baseUnitPrice), dec(mine[1]!.baseUnitPrice))?.toFixed(2) ?? null)
            : null,
        onTimePct: timed.length ? dec(onTime).times(100).div(timed.length).toFixed(2) : null,
        avgLeadDays: leadDays.length
          ? dec(leadDays.reduce((a, b) => a + b, 0))
              .div(leadDays.length)
              .toFixed(1)
          : null,
      };
      const lastBase = r.lastPrice === null ? null : dec(r.lastPrice).div(dec(r.purchaseFactor));
      const quote = quotes.find((x) => x.itemId === r.itemId && x.supplierId === r.supplierId);
      return {
        id: r.publicId,
        item: itemRef(r.item),
        supplier: partnerRef(r.supplier),
        supplierSku: r.supplierSku,
        supplierName: r.supplierName,
        purchaseUnit: r.purchaseUnit,
        purchaseFactor: fmtCost(r.purchaseFactor),
        minOrderQty: r.minOrderQty === null ? null : fmtQty(r.minOrderQty),
        leadTimeDays: r.leadTimeDays,
        lastPrice: r.lastPrice === null ? null : fmtCost(r.lastPrice),
        lastBaseUnitPrice: lastBase ? fmtCost(lastBase) : null,
        lastPricedOn: iso(r.lastPricedOn),
        lastPurchasedOn: iso(r.lastPurchasedOn),
        quoteValidUntil: quote ? iso(quote.validUntil) : null,
        preferred: r.preferred,
        cheapest:
          r.status === 'active' &&
          lastBase !== null &&
          cheapest.has(r.itemId) &&
          cost6(lastBase).eq(cost6(cheapest.get(r.itemId)!)),
        note: r.note,
        status: r.status,
        stats,
        approval: r.approval,
        approvalNote: r.approvalNote,
        approvedAt: r.approvedAt ? toBangkokIso(r.approvedAt) : null,
        approvedBy: r.approvedBy?.displayName ?? null,
        reviewOn: iso(r.reviewOn),
        priceBreaks: r.priceBreaks.map((b) => ({
          minQty: fmtQty(b.minQty),
          unitPrice: fmtCost(b.unitPrice),
          baseUnitPrice: fmtCost(dec(b.unitPrice).div(dec(r.purchaseFactor))),
        })),
        breaksValidUntil: iso(r.breaksValidUntil),
        score: scores.get(r.supplierId) ?? ZERO_SCORE,
        version: r.rowVersion,
      };
    });
  }
}

export function priceDto(
  r: Prisma.ErpPriceRecordGetPayload<{
    include: { item: true; supplier: true; createdBy: { select: { displayName: true } } };
  }>,
): ErpPriceRecordDto {
  return {
    id: r.publicId,
    item: itemRef(r.item),
    supplier: partnerRef(r.supplier),
    source: r.source,
    unit: r.unit,
    factor: fmtCost(r.factor),
    unitPrice: fmtCost(r.unitPrice),
    baseUnitPrice: fmtCost(r.baseUnitPrice),
    quantity: r.quantity === null ? null : fmtQty(r.quantity),
    pricedOn: iso(r.pricedOn)!,
    validUntil: iso(r.validUntil),
    documentNo: r.documentNo,
    sourceId: r.sourcePublicId,
    note: r.note,
    by: r.createdBy.displayName,
    createdAt: toBangkokIso(r.createdAt),
  };
}
