import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type MoneyValue } from '@common/money/money';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpItem,
  type ErpProductionStatus,
  type ErpRecordStatus,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import {
  dec,
  finishedUnitCost,
  fmtCost,
  fmtMoney,
  fmtQty,
  materialRequirement,
  operationMinutes,
  roundToPurchase,
} from './erp.math';
import {
  type ErpCompleteProductionDto,
  type ErpCreateProductionOrderDto,
  type ErpMaterialMoveDto,
  type ErpMrpRowDto,
  type ErpOperationOutputDto,
  type ErpOperationQueueItemDto,
  type ErpPlanningOverviewDto,
  type ErpProductionOrderDto,
  type ErpProductionOrderListQuery,
  type ErpProductionOrderSummaryDto,
  type ErpPurchaseRequestDto,
  type ErpRecipeDto,
  type ErpRecipeListQuery,
  type ErpSaveRecipeDto,
  type ErpUpdateProductionOrderDto,
} from './erp-e2.dto';
import { ErpPricingService } from './erp-pricing.service';
import { ErpRequestsService } from './erp-requests.service';
import { ErpStockService, type StockEntry } from './erp-stock.service';
import { itemRef, partnerRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => bangkokDate(new Date());
const OPEN: ErpProductionStatus[] = ['planned', 'released', 'in_progress'];
const RUNNING: ErpProductionStatus[] = ['released', 'in_progress'];

const RECIPE_INCLUDE = {
  item: true,
  materials: { include: { item: true }, orderBy: { lineNo: 'asc' } },
  operations: { include: { machine: true }, orderBy: { seq: 'asc' } },
} as const;

const MO_INCLUDE = {
  item: true,
  recipe: { include: { item: true } },
  warehouse: true,
  productionJob: true,
  materials: { include: { item: true }, orderBy: { lineNo: 'asc' } },
  operations: { include: { machine: true }, orderBy: { seq: 'asc' } },
} as const;

type RecipeRow = Prisma.ErpRecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;
type MoRow = Prisma.ErpProductionOrderGetPayload<{ include: typeof MO_INCLUDE }>;

interface MoFacts {
  status: string;
  issued: boolean;
}

/** The factory's actions on a production order (D-340, D-341). */
export const MO_ACTIONS: ActionRule<MoFacts>[] = [
  {
    key: 'erp_mo.edit',
    permissions: ['factory_planning.manage'],
    when: (m) => OPEN.includes(m.status as never),
  },
  { key: 'erp_mo.release', permissions: ['factory_planning.manage'], when: (m) => m.status === 'planned' },
  {
    key: 'erp_mo.issue',
    permissions: ['factory_inventory.manage'],
    when: (m) => RUNNING.includes(m.status as never),
  },
  {
    key: 'erp_mo.return',
    permissions: ['factory_inventory.manage'],
    when: (m) => RUNNING.includes(m.status as never) && m.issued,
  },
  {
    key: 'erp_mo.complete',
    permissions: ['factory_planning.manage'],
    irreversible: true,
    when: (m) => RUNNING.includes(m.status as never),
  },
  {
    key: 'erp_mo.cancel',
    permissions: ['factory_planning.manage'],
    irreversible: true,
    when: (m) => OPEN.includes(m.status as never) && !m.issued,
  },
];

export const moEtag = (m: { publicId: string; rowVersion: number }) => etagOf(m.publicId, m.rowVersion);

/** The shapes a Packio job's frozen spec carries that planning reads (D-340). */
interface JobSpec {
  configuration?: { materialId?: unknown } | null;
  productTypeNameTh?: string;
  unit?: string;
}
interface JobBuy {
  parts?: { sheets?: unknown }[];
}

/**
 * Production (E2; D-339 – D-342): recipes of the factory's products, production orders — from an accepted
 * Packio job (automatically), for stock or for a sales order — that reserve their materials on release, take
 * them out of stock as they are issued, record each operation on the floor and put the finished goods into
 * stock at the cost of what was consumed; and MRP, which turns what the open orders still miss into purchase
 * requests.
 */
@Injectable()
export class ErpProductionService {
  private readonly logger = new Logger(ErpProductionService.name);

  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly pricing: ErpPricingService,
    private readonly requests: ErpRequestsService,
  ) {}

  // ------------------------------------------------------------------------------------ recipes

  async listRecipes(scope: ErpScope, q: ErpRecipeListQuery) {
    const where: Prisma.ErpRecipeWhereInput = { factoryId: scope.factory.id };
    if (q.itemId) where.item = { publicId: q.itemId };
    if (q.status) where.status = q.status as ErpRecordStatus;
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { item: { sku: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpRecipe.findMany({
        where,
        include: RECIPE_INCLUDE,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpRecipe.count({ where }),
    ]);
    return paginated(rows.map(recipeDto), total, q);
  }

  async getRecipe(scope: ErpScope, publicId: string): Promise<ErpRecipeDto> {
    const row = await this.workspace.db.erpRecipe.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: RECIPE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return recipeDto(row);
  }

  private async machines(
    db: Tx | PrismaService,
    factoryId: bigint,
    publicIds: (string | null | undefined)[],
  ) {
    const ids = [...new Set(publicIds.filter((x): x is string => !!x))];
    const rows = await db.factoryMachine.findMany({ where: { factoryId, publicId: { in: ids } } });
    if (rows.length !== ids.length) throw new DomainException('http.not_found');
    return new Map(rows.map((m) => [m.publicId, m.id]));
  }

  private async recipeParts(tx: Tx, scope: ErpScope, body: ErpSaveRecipeDto) {
    const [product] = await this.stock.items(tx, scope.factory.id, [body.itemId]);
    const materials = await this.stock.items(
      tx,
      scope.factory.id,
      body.materials.map((m) => m.itemId),
    );
    materials.forEach((m, i) => {
      if (m.id === product!.id)
        throw new DomainException('validation.failed', {
          errors: [
            { path: `materials.${i}.itemId`, code: 'invalid', message: 'A product is not its own material' },
          ],
        });
    });
    const machines = await this.machines(
      tx,
      scope.factory.id,
      body.operations.map((o) => o.machineId),
    );
    const batchQty = dec(body.batchQty ?? '1');
    if (!batchQty.gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'batchQty', code: 'invalid', message: 'Must be more than zero' }],
      });
    return {
      product: product!,
      batchQty: fmtQty(batchQty),
      materials: body.materials.map((m, i) => {
        if (!dec(m.quantity).gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `materials.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        return {
          lineNo: i + 1,
          itemId: materials[i]!.id,
          quantity: dec(m.quantity).toFixed(6),
          scrapPct: dec(m.scrapPct ?? '0').toFixed(4),
        };
      }),
      operations: body.operations.map((o, i) => ({
        seq: (i + 1) * 10,
        name: o.name,
        machineId: o.machineId ? machines.get(o.machineId)! : null,
        setupMinutes: o.setupMinutes ?? 0,
        runRatePerHour: o.runRatePerHour ?? null,
      })),
    };
  }

  async createRecipe(scope: ErpScope, body: ErpSaveRecipeDto): Promise<ErpRecipeDto> {
    const id = await this.workspace.tx(async (tx) => {
      const parts = await this.recipeParts(tx, scope, body);
      const recipe = await tx.erpRecipe.create({
        data: {
          factoryId: scope.factory.id,
          itemId: parts.product.id,
          name: body.name,
          batchQty: parts.batchQty,
          note: body.note ?? null,
          status: (body.status ?? 'active') as ErpRecordStatus,
          createdById: scope.actor.userId,
          materials: { create: parts.materials },
          operations: { create: parts.operations },
        },
      });
      await this.workspace.record(tx, scope, 'erp_recipe.created', 'erp_recipe', recipe.publicId);
      return recipe.publicId;
    });
    return this.getRecipe(scope, id);
  }

  async updateRecipe(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: ErpSaveRecipeDto) {
    await this.workspace.tx(async (tx) => {
      const current = await tx.erpRecipe.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(current.publicId, current.rowVersion));
      const parts = await this.recipeParts(tx, scope, body);
      await tx.erpRecipeMaterial.deleteMany({ where: { recipeId: current.id } });
      await tx.erpRecipeOperation.deleteMany({ where: { recipeId: current.id } });
      await tx.erpRecipe.update({
        where: { id: current.id },
        data: {
          itemId: parts.product.id,
          name: body.name,
          batchQty: parts.batchQty,
          note: body.note ?? null,
          ...(body.status && { status: body.status as ErpRecordStatus }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          materials: { create: parts.materials },
          operations: { create: parts.operations },
        },
      });
      await this.workspace.record(tx, scope, 'erp_recipe.updated', 'erp_recipe', publicId);
    });
    return this.getRecipe(scope, publicId);
  }

  // ---------------------------------------------------------------------------- production orders

  async list(scope: ErpScope, q: ErpProductionOrderListQuery) {
    const where: Prisma.ErpProductionOrderWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open') where.status = { in: OPEN };
    else if (q.status) where.status = q.status as ErpProductionStatus;
    if (q.source) where.source = q.source as MoRow['source'];
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { moNo: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { productionJob: { jobNo: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpProductionOrder.findMany({
        where,
        include: MO_INCLUDE,
        orderBy: [{ priority: 'desc' }, { dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpProductionOrder.count({ where }),
    ]);
    return paginated(rows.map(moSummary), total, q);
  }

  private async row(db: Tx | PrismaService, scope: ErpScope, publicId: string): Promise<MoRow> {
    const row = await db.erpProductionOrder.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: MO_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpProductionOrderDto> {
    const row = await this.row(this.workspace.db, scope, publicId);
    return moDto(row, await this.materialCost(this.workspace.db, row.publicId), perms);
  }

  /** Value of the materials consumed: production issues less returns (D-341). */
  private async materialCost(db: Tx | PrismaService, publicId: string): Promise<MoneyValue> {
    const sum = await db.erpStockMovement.aggregate({
      where: { sourcePublicId: publicId, kind: { in: ['production_issue', 'production_return'] } },
      _sum: { value: true },
    });
    return dec(sum._sum.value ?? 0).negated();
  }

  /** Materials and operations of `qty` units from a recipe (D-339). */
  private fromRecipe(recipe: RecipeRow, qty: MoneyValue) {
    return {
      materials: recipe.materials.map((m, i) => ({
        lineNo: i + 1,
        itemId: m.itemId,
        requiredQty: fmtQty(materialRequirement(dec(m.quantity), dec(recipe.batchQty), qty, dec(m.scrapPct))),
        origin: 'recipe',
        note: null as string | null,
      })),
      operations: recipe.operations.map((o) => ({
        seq: o.seq,
        name: o.name,
        machineId: o.machineId,
        plannedMinutes: operationMinutes(
          o.setupMinutes,
          o.runRatePerHour === null ? null : dec(o.runRatePerHour),
          qty,
        ),
      })),
    };
  }

  private async manualParts(
    tx: Tx,
    scope: ErpScope,
    materials: ErpCreateProductionOrderDto['materials'],
    operations: ErpCreateProductionOrderDto['operations'],
  ) {
    const items = materials
      ? await this.stock.items(
          tx,
          scope.factory.id,
          materials.map((m) => m.itemId),
        )
      : [];
    const machines = operations
      ? await this.machines(
          tx,
          scope.factory.id,
          operations.map((o) => o.machineId),
        )
      : new Map<string, bigint>();
    return {
      materials: materials?.map((m, i) => ({
        lineNo: i + 1,
        itemId: items[i]!.id,
        requiredQty: fmtQty(m.requiredQty),
        origin: 'manual',
        note: m.note ?? null,
      })),
      operations: operations?.map((o, i) => ({
        seq: (i + 1) * 10,
        name: o.name,
        machineId: o.machineId ? machines.get(o.machineId)! : null,
        plannedMinutes: o.plannedMinutes ?? 0,
      })),
    };
  }

  /** The factory's own production order (D-340): for stock or a sales order, from the product's recipe. */
  async create(
    scope: ErpScope,
    body: ErpCreateProductionOrderDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpProductionOrderDto> {
    const id = await this.workspace.tx(async (tx) => {
      const [item] = await this.stock.items(tx, scope.factory.id, [body.itemId]);
      const quantity = dec(body.quantity);
      if (!quantity.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: 'quantity', code: 'invalid', message: 'Must be more than zero' }],
        });
      const recipe = body.recipeId
        ? await tx.erpRecipe.findFirst({
            where: { factoryId: scope.factory.id, publicId: body.recipeId, itemId: item!.id },
            include: RECIPE_INCLUDE,
          })
        : await tx.erpRecipe.findFirst({
            where: { factoryId: scope.factory.id, itemId: item!.id, status: 'active' },
            include: RECIPE_INCLUDE,
            orderBy: { updatedAt: 'desc' },
          });
      if (body.recipeId && !recipe) throw new DomainException('http.not_found');
      const fromRecipe = recipe ? this.fromRecipe(recipe, quantity) : { materials: [], operations: [] };
      const manual = await this.manualParts(tx, scope, body.materials, body.operations);
      const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
      this.dates(body.plannedStartOn ?? null, body.dueOn ?? null);
      const moNo = await this.workspace.nextNumber(tx, scope.factory.id, 'mo');
      const mo = await tx.erpProductionOrder.create({
        data: {
          factoryId: scope.factory.id,
          moNo,
          source: body.source as MoRow['source'],
          itemId: item!.id,
          recipeId: recipe?.id ?? null,
          title: body.title ?? item!.name,
          quantity: fmtQty(quantity),
          unit: item!.baseUnit,
          dueOn: body.dueOn ? day(body.dueOn) : null,
          plannedStartOn: body.plannedStartOn ? day(body.plannedStartOn) : null,
          priority: body.priority ?? 0,
          warehouseId: warehouse.id,
          note: body.note ?? null,
          createdById: scope.actor.userId,
          materials: { create: manual.materials ?? fromRecipe.materials },
          operations: { create: manual.operations ?? fromRecipe.operations },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.planned',
        'erp_production_order',
        mo.publicId,
        {
          moNo,
          source: body.source,
        },
      );
      return mo.publicId;
    });
    return this.get(scope, id, perms);
  }

  private dates(start: string | null, due: string | null) {
    if (start && due && start > due)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'plannedStartOn', code: 'invalid', message: 'On or before the due date' }],
      });
  }

  private async lock(tx: Tx, scope: ErpScope, publicId: string) {
    const found = await tx.erpProductionOrder.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_production_orders WHERE id = ${found.id} FOR UPDATE`;
    return this.row(tx, scope, publicId);
  }

  /**
   * Plans an open order (D-340): title, dates and priority any time it is open; the quantity, materials and
   * operations only while planned (a recipe order rescales its materials to a new quantity).
   */
  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateProductionOrderDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, moEtag(mo));
      if (!OPEN.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      const structural =
        body.quantity !== undefined || body.materials !== undefined || body.operations !== undefined;
      if (structural && mo.status !== 'planned')
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      const quantity = body.quantity !== undefined ? dec(body.quantity) : dec(mo.quantity);
      if (!quantity.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: 'quantity', code: 'invalid', message: 'Must be more than zero' }],
        });
      this.dates(
        body.plannedStartOn !== undefined ? body.plannedStartOn : iso(mo.plannedStartOn),
        body.dueOn !== undefined ? body.dueOn : iso(mo.dueOn),
      );
      const manual = await this.manualParts(tx, scope, body.materials, body.operations);
      let materials = manual.materials;
      if (!materials && body.quantity !== undefined && mo.recipeId) {
        const recipe = await tx.erpRecipe.findUniqueOrThrow({
          where: { id: mo.recipeId },
          include: RECIPE_INCLUDE,
        });
        materials = this.fromRecipe(recipe, quantity).materials;
      }
      if (materials) await tx.erpProductionMaterial.deleteMany({ where: { productionOrderId: mo.id } });
      if (manual.operations)
        await tx.erpProductionOperation.deleteMany({ where: { productionOrderId: mo.id } });
      await tx.erpProductionOrder.update({
        where: { id: mo.id },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.quantity !== undefined && { quantity: fmtQty(quantity) }),
          ...(body.dueOn !== undefined && { dueOn: body.dueOn ? day(body.dueOn) : null }),
          ...(body.plannedStartOn !== undefined && {
            plannedStartOn: body.plannedStartOn ? day(body.plannedStartOn) : null,
          }),
          ...(body.priority !== undefined && { priority: body.priority }),
          ...(body.note !== undefined && { note: body.note }),
          ...(materials && { materials: { create: materials } }),
          ...(manual.operations && { operations: { create: manual.operations } }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.updated',
        'erp_production_order',
        publicId,
        {
          fields: Object.keys(body),
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Releases a planned order to the floor (D-341): each material's stock is reserved in the order's
   * warehouse, as much as is free; what is missing shows as short and goes to MRP.
   */
  async release(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (mo.status !== 'planned')
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      await this.reserveAll(tx, mo);
      await tx.erpProductionOrder.update({
        where: { id: mo.id },
        data: {
          status: 'released',
          releasedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.released',
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  private async reserveAll(tx: Tx, mo: MoRow) {
    for (const m of mo.materials) {
      const want = dec(m.requiredQty).minus(dec(m.issuedQty)).minus(dec(m.reservedQty));
      const got = await this.stock.reserve(tx, mo.factoryId, m.itemId, mo.warehouseId, want);
      if (got.gt(0))
        await tx.erpProductionMaterial.update({
          where: { id: m.id },
          data: { reservedQty: fmtQty(dec(m.reservedQty).plus(got)) },
        });
    }
  }

  private async releaseAll(tx: Tx, mo: MoRow) {
    for (const m of mo.materials) {
      if (!dec(m.reservedQty).gt(0)) continue;
      await this.stock.unreserve(tx, m.itemId, mo.warehouseId, dec(m.reservedQty));
      await tx.erpProductionMaterial.update({ where: { id: m.id }, data: { reservedQty: '0' } });
    }
  }

  /**
   * Takes materials out of stock for the order (D-341): the lines given, or every material's remaining
   * quantity. The reserved part is consumed first; the rest must be free stock (D-322).
   */
  async issue(scope: ErpScope, publicId: string, body: ErpMaterialMoveDto, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (!RUNNING.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      // Top up reservations first: stock that arrived since release is held for this order now.
      await this.reserveAll(tx, mo);
      const fresh = await this.row(tx, scope, publicId);
      const wanted = body.lines?.length
        ? body.lines.map((l, i) => {
            const m = fresh.materials.find((x) => x.publicId === l.materialId);
            if (!m) throw new DomainException('http.not_found');
            const q = dec(l.quantity);
            if (!q.gt(0))
              throw new DomainException('validation.failed', {
                errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
              });
            return { m, quantity: q, lotNo: l.lotNo ?? null };
          })
        : fresh.materials
            .map((m) => ({ m, quantity: dec(m.requiredQty).minus(dec(m.issuedQty)), lotNo: null }))
            .filter((x) => x.quantity.gt(0));
      if (wanted.length === 0) throw new DomainException('erp.nothing_to_issue');
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const entries: StockEntry[] = wanted.map((w) => {
        const reserved = dec(w.m.reservedQty);
        return {
          item: w.m.item,
          warehouse: fresh.warehouse,
          kind: 'production_issue',
          quantity: w.quantity.negated(),
          releaseReserved: reserved.gt(w.quantity) ? w.quantity : reserved,
          lotNo: w.lotNo,
          reason: body.note ?? null,
        };
      });
      await this.stock.post(tx, scope, settings, entries, {
        type: 'production_order',
        publicId: mo.publicId,
        documentNo: mo.moNo,
      });
      for (const [i, w] of wanted.entries())
        await tx.erpProductionMaterial.update({
          where: { id: w.m.id },
          data: {
            issuedQty: fmtQty(dec(w.m.issuedQty).plus(w.quantity)),
            reservedQty: fmtQty(dec(w.m.reservedQty).minus(entries[i]!.releaseReserved!)),
          },
        });
      await tx.erpProductionOrder.update({
        where: { id: mo.id },
        data: { status: 'in_progress', rowVersion: { increment: 1 } },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.materials_issued',
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
          lines: wanted.length,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /** Puts unused material back into stock at its average cost (D-341). */
  async returnMaterials(
    scope: ErpScope,
    publicId: string,
    body: ErpMaterialMoveDto,
    perms: ReadonlySet<string>,
  ) {
    if (!body.lines?.length)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'lines', code: 'required', message: 'Say what comes back' }],
      });
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (!RUNNING.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const lines = body.lines!.map((l, i) => {
        const m = mo.materials.find((x) => x.publicId === l.materialId);
        if (!m) throw new DomainException('http.not_found');
        const q = dec(l.quantity);
        if (!q.gt(0) || q.gt(dec(m.issuedQty)))
          throw new DomainException('validation.failed', {
            errors: [
              { path: `lines.${i}.quantity`, code: 'invalid', message: `At most ${fmtQty(m.issuedQty)}` },
            ],
          });
        return { m, quantity: q, lotNo: l.lotNo ?? null };
      });
      await this.stock.post(
        tx,
        scope,
        settings,
        lines.map((l) => ({
          item: l.m.item,
          warehouse: mo.warehouse,
          kind: 'production_return',
          quantity: l.quantity,
          lotNo: l.lotNo,
          reason: body.note ?? null,
        })),
        { type: 'production_order', publicId: mo.publicId, documentNo: mo.moNo },
      );
      for (const l of lines)
        await tx.erpProductionMaterial.update({
          where: { id: l.m.id },
          data: { issuedQty: fmtQty(dec(l.m.issuedQty).minus(l.quantity)) },
        });
      await tx.erpProductionOrder.update({ where: { id: mo.id }, data: { rowVersion: { increment: 1 } } });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.materials_returned',
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Completes an order (D-341): what is still reserved goes back to free stock; a product the factory keeps
   * in stock comes in at the cost of the materials consumed per good unit.
   */
  async complete(
    scope: ErpScope,
    publicId: string,
    body: ErpCompleteProductionDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (!RUNNING.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      await this.finish(tx, mo, dec(body.goodQty), dec(body.scrapQty ?? '0'), body.note ?? null, scope);
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.completed',
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  private async finish(
    tx: Tx,
    mo: MoRow,
    good: MoneyValue,
    scrap: MoneyValue,
    note: string | null,
    scope: ErpScope | null,
  ) {
    await this.releaseAll(tx, mo);
    if (mo.item && good.gt(0) && scope) {
      const cost = await this.materialCost(tx, mo.publicId);
      const unitCost = finishedUnitCost(cost, good);
      const settings = await this.workspace.settings(tx, mo.factoryId);
      await this.stock.post(
        tx,
        scope,
        settings,
        [
          {
            item: mo.item,
            warehouse: mo.warehouse,
            kind: 'production_receipt',
            quantity: good,
            unitCost,
            reason: note,
          },
        ],
        { type: 'production_order', publicId: mo.publicId, documentNo: mo.moNo },
      );
    }
    await tx.erpProductionOrder.update({
      where: { id: mo.id },
      data: {
        status: 'completed',
        goodQty: fmtQty(good),
        scrapQty: fmtQty(scrap),
        completedAt: new Date(),
        ...(note && { note: mo.note ? `${mo.note}\n${note}` : note }),
        ...(scope && { updatedById: scope.actor.userId }),
        rowVersion: { increment: 1 },
      },
    });
  }

  /** Cancels an open order nothing was issued to (return materials first); reservations are released. */
  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (!OPEN.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      if (mo.materials.some((m) => dec(m.issuedQty).gt(0))) throw new DomainException('erp.materials_issued');
      await this.releaseAll(tx, mo);
      await tx.erpProductionOrder.update({
        where: { id: mo.id },
        data: {
          status: 'cancelled',
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_production_order.cancelled',
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  // ------------------------------------------------------------------------------- shop floor

  /** An operator starts, finishes or skips an operation (D-341); the order is in progress from the first. */
  async operation(
    scope: ErpScope,
    publicId: string,
    operationId: string,
    action: 'start' | 'finish' | 'skip',
    body: ErpOperationOutputDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const mo = await this.lock(tx, scope, publicId);
      if (!RUNNING.includes(mo.status))
        throw new DomainException('erp.invalid_status', { params: { status: mo.status } });
      const op = mo.operations.find((o) => o.publicId === operationId);
      if (!op) throw new DomainException('http.not_found');
      const allowed =
        action === 'start'
          ? op.status === 'pending'
          : action === 'finish'
            ? op.status !== 'done' && op.status !== 'skipped'
            : op.status === 'pending';
      if (!allowed) throw new DomainException('erp.invalid_status', { params: { status: op.status } });
      await tx.erpProductionOperation.update({
        where: { id: op.id },
        data: {
          status: action === 'start' ? 'in_progress' : action === 'finish' ? 'done' : 'skipped',
          ...(action === 'finish' && {
            goodQty: fmtQty(body.goodQty ?? mo.quantity),
            scrapQty: fmtQty(body.scrapQty ?? '0'),
          }),
        },
      });
      await tx.erpProductionOrder.update({
        where: { id: mo.id },
        data: { status: 'in_progress', rowVersion: { increment: 1 } },
      });
      await this.workspace.record(
        tx,
        scope,
        `erp_production_operation.${action === 'start' ? 'started' : action === 'finish' ? 'finished' : 'skipped'}`,
        'erp_production_order',
        publicId,
        {
          moNo: mo.moNo,
          seq: op.seq,
        },
      );
    });
    return this.get(scope, publicId, perms);
  }

  /** The floor's queue (D-341): operations still to do on released orders, most urgent first. */
  async queue(scope: ErpScope, machineId?: string): Promise<ErpOperationQueueItemDto[]> {
    const rows = await this.workspace.db.erpProductionOperation.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        productionOrder: { factoryId: scope.factory.id, status: { in: RUNNING } },
        ...(machineId && { machine: { publicId: machineId } }),
      },
      include: { machine: true, productionOrder: { include: MO_INCLUDE } },
    });
    const items = rows.map((r) => ({ op: r, mo: r.productionOrder }));
    items.sort(
      (a, b) =>
        b.mo.priority - a.mo.priority ||
        (iso(a.mo.dueOn) ?? '9999').localeCompare(iso(b.mo.dueOn) ?? '9999') ||
        (a.mo.id < b.mo.id ? -1 : a.mo.id > b.mo.id ? 1 : 0) ||
        a.op.seq - b.op.seq,
    );
    return items.map(({ op, mo }) => ({ operation: operationDto(op), order: moSummary(mo) }));
  }

  // ------------------------------------------------------------------------------ planning

  async overview(scope: ErpScope): Promise<ErpPlanningOverviewDto> {
    const factoryId = scope.factory.id;
    const t = today();
    const [counts, late, dueSoon, machines, mrp] = await Promise.all([
      this.workspace.db.erpProductionOrder.groupBy({
        by: ['status'],
        where: { factoryId, status: { in: OPEN } },
        _count: { _all: true },
      }),
      this.workspace.db.erpProductionOrder.count({
        where: { factoryId, status: { in: OPEN }, dueOn: { lt: day(t) } },
      }),
      this.workspace.db.erpProductionOrder.count({
        where: { factoryId, status: { in: OPEN }, dueOn: { gte: day(t), lte: day(addCalendarDays(t, 7)) } },
      }),
      this.workspace.db.factoryMachine.findMany({
        where: { factoryId, status: 'active' },
        include: {
          erpProductionOperations: {
            where: { status: { in: ['pending', 'in_progress'] }, productionOrder: { status: { in: OPEN } } },
            select: { plannedMinutes: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.mrp(scope),
    ]);
    const n = (s: ErpProductionStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
    return {
      planned: n('planned'),
      released: n('released'),
      inProgress: n('in_progress'),
      late,
      dueThisWeek: dueSoon,
      shortItems: mrp.length,
      machines: machines.map((m) => ({
        machine: { id: m.publicId, name: m.name },
        operations: m.erpProductionOperations.length,
        plannedMinutes: m.erpProductionOperations.reduce((a, o) => a + o.plannedMinutes, 0),
      })),
    };
  }

  /**
   * MRP (D-342): per material, what the open production orders still need against what is reserved for
   * them, free in stock, on order and already requested; a shortage is rounded to the preferred supplier's
   * unit and minimum order.
   */
  async mrp(scope: ErpScope): Promise<ErpMrpRowDto[]> {
    const factoryId = scope.factory.id;
    const needs = await this.workspace.db.erpProductionMaterial.findMany({
      where: { productionOrder: { factoryId, status: { in: OPEN } } },
      include: { item: true, productionOrder: { select: { dueOn: true, id: true } } },
    });
    const byItem = new Map<
      bigint,
      { item: ErpItem; required: MoneyValue; reserved: MoneyValue; due: string | null; orders: Set<bigint> }
    >();
    for (const n of needs) {
      const open = dec(n.requiredQty).minus(dec(n.issuedQty));
      if (!open.gt(0)) continue;
      const row = byItem.get(n.itemId) ?? {
        item: n.item,
        required: dec(0),
        reserved: dec(0),
        due: null,
        orders: new Set(),
      };
      row.required = row.required.plus(open);
      row.reserved = row.reserved.plus(dec(n.reservedQty));
      const due = iso(n.productionOrder.dueOn);
      if (due && (!row.due || due < row.due)) row.due = due;
      row.orders.add(n.productionOrder.id);
      byItem.set(n.itemId, row);
    }
    if (byItem.size === 0) return [];
    const ids = [...byItem.keys()];
    const [totals, onOrder, requested, links] = await Promise.all([
      this.stock.totals(factoryId, ids),
      this.stock.onOrder(factoryId),
      this.workspace.db.erpPurchaseRequestLine.groupBy({
        by: ['itemId'],
        where: {
          itemId: { in: ids },
          purchaseOrderLineId: null,
          purchaseRequest: { factoryId, status: { in: ['draft', 'submitted', 'approved'] } },
        },
        _sum: { quantity: true },
      }),
      this.pricing.preferred(this.workspace.db, factoryId, ids),
    ]);
    const asked = new Map(requested.map((r) => [r.itemId, dec(r._sum.quantity ?? 0)]));
    const out: ErpMrpRowDto[] = [];
    for (const [id, r] of byItem) {
      const t = totals.get(id);
      const free = dec(t?.onHand ?? 0).minus(dec(t?.reserved ?? 0));
      const ordered = (onOrder.get(id) ?? dec(0)).plus(asked.get(id) ?? dec(0));
      const shortage = r.required
        .minus(r.reserved)
        .minus(free.gt(0) ? free : dec(0))
        .minus(ordered);
      if (!shortage.gt(0)) continue;
      const link = links.get(id);
      const factor = link ? dec(link.purchaseFactor) : dec(r.item.purchaseFactor);
      const rounded = roundToPurchase(shortage, factor, link?.minOrderQty ? dec(link.minOrderQty) : null);
      out.push({
        item: itemRef(r.item),
        required: fmtQty(r.required),
        reserved: fmtQty(r.reserved),
        available: fmtQty(free),
        onOrder: fmtQty(ordered),
        shortage: fmtQty(shortage),
        toOrderQty: fmtQty(rounded.baseQty),
        toOrderPurchaseQty: fmtQty(rounded.purchaseQty),
        purchaseUnit: link?.purchaseUnit ?? r.item.purchaseUnit ?? r.item.baseUnit,
        supplier: link ? partnerRef(link.supplier) : null,
        unitPrice: link?.lastPrice != null ? fmtCost(link.lastPrice) : null,
        neededBy: r.due,
        orders: r.orders.size,
      });
    }
    return out.sort((a, b) => (a.neededBy ?? '9999').localeCompare(b.neededBy ?? '9999'));
  }

  /** One purchase request (source `mrp`) for the chosen shortages (D-342). */
  async requestShortages(
    scope: ErpScope,
    itemIds: string[],
    perms: ReadonlySet<string>,
  ): Promise<ErpPurchaseRequestDto> {
    const rows = (await this.mrp(scope)).filter((r) => itemIds.includes(r.item.id));
    if (rows.length === 0) throw new DomainException('erp.nothing_to_request');
    const due =
      rows
        .map((r) => r.neededBy)
        .filter((x): x is string => !!x)
        .sort()[0] ?? null;
    return this.requests.create(
      scope,
      {
        neededBy: due,
        note: 'สร้างจาก MRP (วัตถุดิบไม่พอผลิต)',
        lines: rows.map((r) => ({
          itemId: r.item.id,
          quantity: r.toOrderQty,
          supplierId: r.supplier?.id ?? null,
          neededBy: r.neededBy,
        })),
      },
      perms,
      'mrp',
    );
  }

  // -------------------------------------------------------------------- Packio jobs (D-340)

  /**
   * An accepted Packio job becomes a production order of the factory, so its planning, materials and floor
   * work live in one place: the board material the job was quoted on (the item linked to that Packio
   * material) at the sheets the quote counted. Skipped when the factory switched planning off.
   */
  @OnDomainEvent('production_job.accepted', { consumer: 'factory_erp.job_to_production_order' })
  async onJobAccepted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const job = await tx.productionJob.findUnique({
      where: { publicId: event.aggregateId },
      include: { factory: true, erpProductionOrder: true },
    });
    if (!job || job.erpProductionOrder) return;
    const settings = await this.workspace.settings(tx, job.factoryId);
    if (settings.disabledModules.includes('planning')) return;
    const spec = (job.specSnapshot ?? {}) as JobSpec;
    const buy = (job.buyPriceSnapshot ?? {}) as JobBuy;
    const materials: {
      lineNo: number;
      itemId: bigint;
      requiredQty: string;
      origin: string;
      note: string | null;
    }[] = [];
    const materialId = spec.configuration?.materialId;
    if (typeof materialId === 'string') {
      const sheets = (buy.parts ?? []).reduce((a, p) => a + (typeof p.sheets === 'number' ? p.sheets : 0), 0);
      const item = await tx.erpItem.findFirst({
        where: { factoryId: job.factoryId, status: 'active', material: { publicId: materialId } },
        orderBy: [{ baseUnit: 'asc' }, { id: 'asc' }],
      });
      if (item && sheets > 0 && item.baseUnit === 'sheet')
        materials.push({
          lineNo: 1,
          itemId: item.id,
          requiredQty: fmtQty(sheets),
          origin: 'packio_spec',
          note: 'ตามจำนวนแผ่นที่ใช้คำนวณราคางาน',
        });
    }
    const warehouse = await this.workspace.defaultWarehouse(tx, job.factoryId, null);
    const moNo = await this.workspace.nextNumber(tx, job.factoryId, 'mo');
    const mo = await tx.erpProductionOrder.create({
      data: {
        factoryId: job.factoryId,
        moNo,
        source: 'packio_job',
        productionJobId: job.id,
        title: `${job.jobNo} · ${spec.productTypeNameTh ?? 'งาน Packio'}`,
        quantity: fmtQty(job.quantityOrdered),
        unit: spec.unit ?? 'pcs',
        dueOn: job.plannedFinishOn,
        plannedStartOn: job.plannedStartOn,
        priority: Math.max(0, Math.min(9, job.priority)),
        warehouseId: warehouse.id,
        materials: { create: materials },
      },
    });
    await this.workspace.recordSystem(
      tx,
      job.factory.publicId,
      'erp_production_order.planned',
      'erp_production_order',
      mo.publicId,
      {
        moNo,
        source: 'packio_job',
        jobId: job.publicId,
      },
    );
    this.logger.log(`${job.jobNo} → ${moNo}`);
  }

  /** A job taken away (rejected, reassigned) cancels its open production order when nothing was issued. */
  @OnDomainEvent(['production_job.rejected', 'production_job.reassigned'], {
    consumer: 'factory_erp.job_withdrawn',
  })
  async onJobWithdrawn(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const jobId =
      event.type === 'production_job.reassigned'
        ? (event.payload as { fromJobId?: string }).fromJobId
        : event.aggregateId;
    if (!jobId) return;
    const mo = await tx.erpProductionOrder.findFirst({
      where: { productionJob: { publicId: jobId }, status: { in: OPEN } },
      include: { ...MO_INCLUDE, factory: true },
    });
    if (!mo || mo.materials.some((m) => dec(m.issuedQty).gt(0))) return;
    await this.releaseAll(tx, mo);
    await tx.erpProductionOrder.update({
      where: { id: mo.id },
      data: {
        status: 'cancelled',
        cancelReason: `งาน Packio ${event.type === 'production_job.rejected' ? 'ถูกปฏิเสธ' : 'ย้ายไปโรงงานอื่น'}`,
        rowVersion: { increment: 1 },
      },
    });
    await this.workspace.recordSystem(
      tx,
      mo.factory.publicId,
      'erp_production_order.cancelled',
      'erp_production_order',
      mo.publicId,
      {
        moNo: mo.moNo,
      },
    );
  }

  /** A completed Packio job completes its production order (good and scrap quantities from the job). */
  @OnDomainEvent('production_job.completed', { consumer: 'factory_erp.job_completed' })
  async onJobCompleted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const mo = await tx.erpProductionOrder.findFirst({
      where: { productionJob: { publicId: event.aggregateId }, status: { in: OPEN } },
      include: { ...MO_INCLUDE, factory: true },
    });
    if (!mo) return;
    const p = event.payload as { quantityGood?: number | null; quantityScrap?: number | null };
    await this.finish(tx, mo, dec(p.quantityGood ?? mo.quantity), dec(p.quantityScrap ?? 0), null, null);
    await this.workspace.recordSystem(
      tx,
      mo.factory.publicId,
      'erp_production_order.completed',
      'erp_production_order',
      mo.publicId,
      {
        moNo: mo.moNo,
      },
    );
  }
}

// ------------------------------------------------------------------------------------- views

export function recipeDto(r: RecipeRow): ErpRecipeDto {
  return {
    id: r.publicId,
    item: itemRef(r.item),
    name: r.name,
    batchQty: fmtQty(r.batchQty),
    note: r.note,
    status: r.status,
    materials: r.materials.map((m) => ({
      lineNo: m.lineNo,
      item: itemRef(m.item),
      quantity: dec(m.quantity).toFixed(6),
      scrapPct: dec(m.scrapPct).toFixed(4),
    })),
    operations: r.operations.map((o) => ({
      seq: o.seq,
      name: o.name,
      machine: o.machine ? { id: o.machine.publicId, name: o.machine.name } : null,
      setupMinutes: o.setupMinutes,
      runRatePerHour: o.runRatePerHour === null ? null : fmtQty(o.runRatePerHour),
    })),
    version: r.rowVersion,
  };
}

function operationDto(o: MoRow['operations'][number]) {
  return {
    id: o.publicId,
    seq: o.seq,
    name: o.name,
    machine: o.machine ? { id: o.machine.publicId, name: o.machine.name } : null,
    plannedMinutes: o.plannedMinutes,
    status: o.status,
    goodQty: fmtQty(o.goodQty),
    scrapQty: fmtQty(o.scrapQty),
  };
}

function short(m: MoRow['materials'][number]): MoneyValue {
  const s = dec(m.requiredQty).minus(dec(m.issuedQty)).minus(dec(m.reservedQty));
  return s.gt(0) ? s : dec(0);
}

export function moSummary(m: MoRow): ErpProductionOrderSummaryDto {
  const done = m.operations.filter((o) => o.status === 'done' || o.status === 'skipped').length;
  return {
    id: m.publicId,
    moNo: m.moNo,
    source: m.source,
    title: m.title,
    item: m.item ? itemRef(m.item) : null,
    quantity: fmtQty(m.quantity),
    unit: m.unit,
    dueOn: iso(m.dueOn),
    priority: m.priority,
    status: m.status,
    late: OPEN.includes(m.status) && m.dueOn !== null && iso(m.dueOn)! < today(),
    progressPct: m.operations.length
      ? dec(done).times(100).div(m.operations.length).toFixed(2)
      : m.status === 'completed'
        ? '100.00'
        : '0.00',
    short: RUNNING.includes(m.status) && m.materials.some((x) => short(x).gt(0)),
  };
}

export function moDto(m: MoRow, materialCost: MoneyValue, perms: ReadonlySet<string>): ErpProductionOrderDto {
  const good = dec(m.goodQty);
  return {
    ...moSummary(m),
    job: m.productionJob
      ? { id: m.productionJob.publicId, code: m.productionJob.jobNo, name: m.title }
      : null,
    recipe: m.recipe ? { id: m.recipe.publicId, code: m.recipe.item.sku, name: m.recipe.name } : null,
    plannedStartOn: iso(m.plannedStartOn),
    warehouse: warehouseRef(m.warehouse),
    goodQty: fmtQty(m.goodQty),
    scrapQty: fmtQty(m.scrapQty),
    materialCost: fmtMoney(materialCost),
    unitCost: m.status === 'completed' && good.gt(0) ? fmtCost(finishedUnitCost(materialCost, good)) : null,
    note: m.note,
    releasedAt: m.releasedAt ? toBangkokIso(m.releasedAt) : null,
    completedAt: m.completedAt ? toBangkokIso(m.completedAt) : null,
    cancelReason: m.cancelReason,
    createdAt: toBangkokIso(m.createdAt),
    materials: m.materials.map((x) => {
      const remaining = dec(x.requiredQty).minus(dec(x.issuedQty));
      return {
        id: x.publicId,
        lineNo: x.lineNo,
        item: itemRef(x.item),
        requiredQty: fmtQty(x.requiredQty),
        reservedQty: fmtQty(x.reservedQty),
        issuedQty: fmtQty(x.issuedQty),
        remainingQty: fmtQty(remaining.gt(0) ? remaining : 0),
        shortQty: fmtQty(short(x)),
        origin: x.origin,
        note: x.note,
      };
    }),
    operations: m.operations.map(operationDto),
    nextActions: nextActions(
      { status: m.status, issued: m.materials.some((x) => dec(x.issuedQty).gt(0)) },
      MO_ACTIONS,
      perms,
    ),
    version: m.rowVersion,
  };
}
