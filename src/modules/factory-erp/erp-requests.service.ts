import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type ErpPurchaseRequestStatus, type ErpRequestSource, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { type ErpDraftFromReorderResultDto } from './erp.dto';
import { cost6, dec, fmtCost, fmtMoney, fmtQty, money2, roundToPurchase } from './erp.math';
import {
  type ErpPurchaseRequestDto,
  type ErpPurchaseRequestListQuery,
  type ErpPurchaseRequestSummaryDto,
  type ErpSavePurchaseRequestDto,
} from './erp-e2.dto';
import { ErpPricingService } from './erp-pricing.service';
import { type DraftLine, ErpPurchasingService } from './erp-purchasing.service';
import { ErpStockService } from './erp-stock.service';
import { itemRef, partnerRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const PR_INCLUDE = {
  createdBy: { select: { displayName: true } },
  decidedBy: { select: { displayName: true } },
  lines: {
    include: { item: true, supplier: true, purchaseOrderLine: { include: { purchaseOrder: true } } },
    orderBy: { lineNo: 'asc' },
  },
} as const;

type PrRow = Prisma.ErpPurchaseRequestGetPayload<{ include: typeof PR_INCLUDE }>;

interface PrFacts {
  status: string;
}

/** The factory's actions on its purchase request (D-336). */
export const PR_ACTIONS: ActionRule<PrFacts>[] = [
  { key: 'erp_pr.edit', permissions: ['factory_procurement.request'], when: (p) => p.status === 'draft' },
  { key: 'erp_pr.submit', permissions: ['factory_procurement.request'], when: (p) => p.status === 'draft' },
  {
    key: 'erp_pr.approve',
    permissions: ['factory_procurement.approve'],
    when: (p) => p.status === 'submitted',
  },
  {
    key: 'erp_pr.reject',
    permissions: ['factory_procurement.approve'],
    irreversible: true,
    when: (p) => p.status === 'submitted',
  },
  {
    key: 'erp_pr.convert',
    permissions: ['factory_procurement.manage'],
    when: (p) => p.status === 'approved',
  },
  {
    key: 'erp_pr.cancel',
    permissions: ['factory_procurement.request'],
    irreversible: true,
    when: (p) => ['draft', 'submitted', 'approved'].includes(p.status),
  },
];

export const prEtag = (p: { publicId: string; rowVersion: number }) => etagOf(p.publicId, p.rowVersion);

/**
 * Purchase requests (D-336): anyone who needs material asks — by hand, from the reorder list or from MRP —
 * an approver decides (or, when the factory switched approval off or the requester may approve, it is approved
 * on submit), and purchasing turns approved lines into draft purchase orders, one per supplier.
 */
@Injectable()
export class ErpRequestsService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly pricing: ErpPricingService,
    private readonly purchasing: ErpPurchasingService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: ErpScope, q: ErpPurchaseRequestListQuery) {
    const where: Prisma.ErpPurchaseRequestWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open') where.status = { in: ['submitted', 'approved'] };
    else if (q.status) where.status = q.status as ErpPurchaseRequestStatus;
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { prNo: { contains: search, mode: 'insensitive' } },
        { note: { contains: search, mode: 'insensitive' } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpPurchaseRequest.findMany({
        where,
        include: { createdBy: { select: { displayName: true } }, _count: { select: { lines: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpPurchaseRequest.count({ where }),
    ]);
    return paginated(
      rows.map((r) => summary(r, r._count.lines)),
      total,
      q,
    );
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpPurchaseRequestDto> {
    const row = await this.workspace.db.erpPurchaseRequest.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: PR_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return prDto(row, perms);
  }

  /** Lines priced at the chosen (else preferred) supplier's latest price per base unit. */
  private async lines(tx: Tx, scope: ErpScope, body: ErpSavePurchaseRequestDto) {
    const items = await this.stock.items(
      tx,
      scope.factory.id,
      body.lines.map((l) => l.itemId),
    );
    const supplierIds = [...new Set(body.lines.map((l) => l.supplierId).filter((x): x is string => !!x))];
    const suppliers = new Map(
      (
        await tx.erpTradingPartner.findMany({
          where: { factoryId: scope.factory.id, publicId: { in: supplierIds } },
        })
      ).map((s) => [s.publicId, s]),
    );
    const preferred = await this.pricing.preferred(
      tx,
      scope.factory.id,
      items.map((i) => i.id),
    );
    const out = [];
    for (const [i, l] of body.lines.entries()) {
      const item = items[i]!;
      const quantity = dec(l.quantity);
      if (!quantity.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
        });
      let supplierId: bigint | null = null;
      if (l.supplierId) {
        const s = suppliers.get(l.supplierId);
        if (!s) throw new DomainException('http.not_found');
        if (s.kind === 'customer')
          throw new DomainException('erp.not_a_supplier', { params: { name: s.name } });
        supplierId = s.id;
      }
      const link = supplierId ? await this.pricing.link(tx, item.id, supplierId) : preferred.get(item.id);
      // D-346: priced at the supplier's break for the quantity in its unit, else its latest price.
      const linkPrice = link
        ? await this.pricing.priceFor(
            tx,
            link,
            roundToPurchase(
              quantity,
              dec(link.purchaseFactor),
              link.minOrderQty ? dec(link.minOrderQty) : null,
            ).purchaseQty,
          )
        : null;
      const cost =
        link && linkPrice
          ? linkPrice.div(dec(link.purchaseFactor))
          : item.lastPurchasePrice !== null
            ? dec(item.lastPurchasePrice).div(dec(item.purchaseFactor))
            : null;
      out.push({
        lineNo: i + 1,
        itemId: item.id,
        quantity: fmtQty(quantity),
        supplierId,
        estimatedUnitCost: cost ? fmtCost(cost6(cost)) : null,
        neededBy: l.neededBy ? day(l.neededBy) : null,
        note: l.note ?? null,
      });
    }
    const total = out.reduce(
      (a, l) =>
        a.plus(l.estimatedUnitCost ? money2(dec(l.quantity).times(dec(l.estimatedUnitCost))) : dec(0)),
      dec(0),
    );
    return { lines: out, estimatedTotal: fmtMoney(total) };
  }

  async create(
    scope: ErpScope,
    body: ErpSavePurchaseRequestDto,
    perms: ReadonlySet<string>,
    source: ErpRequestSource = 'manual',
  ): Promise<ErpPurchaseRequestDto> {
    const id = await this.workspace.tx(async (tx) => {
      const { lines, estimatedTotal } = await this.lines(tx, scope, body);
      const prNo = await this.workspace.nextNumber(tx, scope.factory.id, 'pr');
      const pr = await tx.erpPurchaseRequest.create({
        data: {
          factoryId: scope.factory.id,
          prNo,
          source,
          neededBy: body.neededBy ? day(body.neededBy) : null,
          note: body.note ?? null,
          estimatedTotal,
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_purchase_request.drafted',
        'erp_purchase_request',
        pr.publicId,
        {
          prNo,
        },
      );
      return pr.publicId;
    });
    return this.get(scope, id, perms);
  }

  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSavePurchaseRequestDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, prEtag(current));
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const { lines, estimatedTotal } = await this.lines(tx, scope, body);
      await tx.erpPurchaseRequestLine.deleteMany({ where: { purchaseRequestId: current.id } });
      await tx.erpPurchaseRequest.update({
        where: { id: current.id },
        data: {
          neededBy: body.neededBy ? day(body.neededBy) : null,
          note: body.note ?? null,
          estimatedTotal,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          lines: { create: lines },
        },
      });
    });
    return this.get(scope, publicId, perms);
  }

  private async lock(tx: Tx, scope: ErpScope, publicId: string) {
    const found = await tx.erpPurchaseRequest.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_purchase_requests WHERE id = ${found.id} FOR UPDATE`;
    return (await tx.erpPurchaseRequest.findUnique({ where: { id: found.id } }))!;
  }

  /**
   * Sends a draft for approval (D-336). Approved at once when the factory does not require approval or the
   * requester may approve purchases themselves.
   */
  async submit(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const auto = !settings.requireRequestApproval || perms.has('factory_procurement.approve');
      const now = new Date();
      await tx.erpPurchaseRequest.update({
        where: { id: current.id },
        data: {
          status: auto ? 'approved' : 'submitted',
          submittedAt: now,
          ...(auto && { decidedAt: now, decidedById: scope.actor.userId }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        auto ? 'erp_purchase_request.approved' : 'erp_purchase_request.submitted',
        'erp_purchase_request',
        publicId,
        { prNo: current.prNo, auto },
      );
    });
    return this.get(scope, publicId, perms);
  }

  async decide(
    scope: ErpScope,
    publicId: string,
    approve: boolean,
    note: string | null,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'submitted')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpPurchaseRequest.update({
        where: { id: current.id },
        data: {
          status: approve ? 'approved' : 'rejected',
          decidedAt: new Date(),
          decidedById: scope.actor.userId,
          decisionNote: note,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: approve ? 'erp.purchase_request_approved' : 'erp.purchase_request_rejected',
        resourceType: 'erp_purchase_request',
        resourcePublicId: publicId,
        data: { prNo: current.prNo },
      });
      await this.workspace.record(
        tx,
        scope,
        approve ? 'erp_purchase_request.approved' : 'erp_purchase_request.rejected',
        'erp_purchase_request',
        publicId,
        { prNo: current.prNo },
      );
    });
    return this.get(scope, publicId, perms);
  }

  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (!['draft', 'submitted', 'approved'].includes(current.status))
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpPurchaseRequest.update({
        where: { id: current.id },
        data: {
          status: 'cancelled',
          decisionNote: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_purchase_request.cancelled',
        'erp_purchase_request',
        publicId,
        {
          prNo: current.prNo,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Turns an approved request into draft purchase orders, one per supplier (D-336): each line goes to its
   * chosen supplier or the item's preferred one, in that supplier's unit rounded up to whole units and its
   * minimum order (D-335), at its latest price. Lines with no supplier stay on the request.
   */
  async convert(scope: ErpScope, publicId: string): Promise<ErpDraftFromReorderResultDto> {
    const pr = await this.workspace.db.erpPurchaseRequest.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: { lines: { include: { item: true, supplier: true }, orderBy: { lineNo: 'asc' } } },
    });
    if (!pr) throw new DomainException('http.not_found');
    if (pr.status !== 'approved')
      throw new DomainException('erp.invalid_status', { params: { status: pr.status } });
    const open = pr.lines.filter((l) => l.purchaseOrderLineId === null);
    const preferred = await this.pricing.preferred(
      this.workspace.db,
      scope.factory.id,
      open.map((l) => l.itemId),
    );
    const wanted: DraftLine[] = [];
    const skipped = [];
    for (const l of open) {
      const supplier = l.supplier ?? preferred.get(l.itemId)?.supplier ?? null;
      if (!supplier || supplier.status === 'archived') {
        skipped.push(itemRef(l.item));
        continue;
      }
      const link = await this.pricing.link(this.workspace.db, l.itemId, supplier.id);
      const unit = link?.purchaseUnit ?? l.item.purchaseUnit ?? l.item.baseUnit;
      const factor = link ? dec(link.purchaseFactor) : dec(l.item.purchaseFactor);
      const rounded = roundToPurchase(
        dec(l.quantity),
        factor,
        link?.minOrderQty ? dec(link.minOrderQty) : null,
      );
      const breakPrice = link
        ? await this.pricing.priceFor(this.workspace.db, link, rounded.purchaseQty)
        : null;
      const price =
        breakPrice !== null
          ? breakPrice
          : l.estimatedUnitCost !== null
            ? dec(l.estimatedUnitCost).times(factor)
            : dec(0);
      wanted.push({
        item: l.item,
        supplierId: supplier.publicId,
        quantity: fmtQty(rounded.purchaseQty),
        unit,
        unitPrice: fmtCost(price),
        lead: link?.leadTimeDays ?? l.item.leadTimeDays ?? 0,
        requestLineId: l.id,
      });
    }
    const created = await this.purchasing.draftOrders(scope, wanted, `จากใบขอซื้อ ${pr.prNo}`);
    await this.workspace.tx(async (tx) => {
      for (const c of created) {
        const poLines = [...c.po.lines].sort((a, b) => a.lineNo - b.lineNo);
        for (const [i, row] of c.rows.entries())
          await tx.erpPurchaseRequestLine.update({
            where: { id: row.requestLineId! },
            data: { purchaseOrderLineId: poLines[i]!.id },
          });
      }
      if (skipped.length === 0 && created.length > 0)
        await tx.erpPurchaseRequest.update({
          where: { id: pr.id },
          data: { status: 'ordered', rowVersion: { increment: 1 } },
        });
      await this.workspace.record(
        tx,
        scope,
        'erp_purchase_request.converted',
        'erp_purchase_request',
        publicId,
        {
          prNo: pr.prNo,
          purchaseOrders: created.length,
        },
      );
    });
    return { created: created.map((c) => c.summary), skipped };
  }
}

function summary(
  r: {
    publicId: string;
    prNo: string;
    status: string;
    source: string;
    neededBy: Date | null;
    estimatedTotal: Prisma.Decimal;
    createdAt: Date;
    createdBy: { displayName: string };
  },
  lineCount: number,
): ErpPurchaseRequestSummaryDto {
  return {
    id: r.publicId,
    prNo: r.prNo,
    status: r.status,
    source: r.source,
    neededBy: iso(r.neededBy),
    estimatedTotal: fmtMoney(r.estimatedTotal),
    currency: 'THB',
    lineCount,
    requestedBy: r.createdBy.displayName,
    createdAt: toBangkokIso(r.createdAt),
  };
}

export function prDto(r: PrRow, perms: ReadonlySet<string>): ErpPurchaseRequestDto {
  return {
    ...summary(r, r.lines.length),
    note: r.note,
    submittedAt: r.submittedAt ? toBangkokIso(r.submittedAt) : null,
    decidedAt: r.decidedAt ? toBangkokIso(r.decidedAt) : null,
    decidedBy: r.decidedBy?.displayName ?? null,
    decisionNote: r.decisionNote,
    lines: r.lines.map((l) => ({
      id: l.publicId,
      lineNo: l.lineNo,
      item: itemRef(l.item),
      quantity: fmtQty(l.quantity),
      supplier: l.supplier ? partnerRef(l.supplier) : null,
      estimatedUnitCost: l.estimatedUnitCost === null ? null : fmtCost(l.estimatedUnitCost),
      estimatedAmount:
        l.estimatedUnitCost === null
          ? null
          : fmtMoney(money2(dec(l.quantity).times(dec(l.estimatedUnitCost)))),
      neededBy: iso(l.neededBy),
      note: l.note,
      purchaseOrder: l.purchaseOrderLine
        ? {
            id: l.purchaseOrderLine.purchaseOrder.publicId,
            code: l.purchaseOrderLine.purchaseOrder.poNo ?? '',
            name: l.purchaseOrderLine.purchaseOrder.poNo ?? '',
          }
        : null,
    })),
    nextActions: nextActions({ status: r.status }, PR_ACTIONS, perms),
    version: r.rowVersion,
  };
}
