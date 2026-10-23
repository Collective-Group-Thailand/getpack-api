import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpEntityType,
  type ErpItem,
  type ErpPartnerKind,
  type ErpSupplierApprovalPolicy,
  Prisma,
} from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  type CreateErpItemDto,
  ERP_MODULES,
  type ErpCreateTradingPartnerDto,
  type ErpCreateWarehouseDto,
  type ErpItemDto,
  type ErpItemListQuery,
  type ErpSettingsDto,
  type ErpTradingPartnerListQuery,
  type ErpUpdateTradingPartnerDto,
  type ErpUpdateWarehouseDto,
  type UpdateErpItemDto,
  type UpdateErpSettingsDto,
} from './erp.dto';
import { dec } from './erp.math';
import { ErpPricingService } from './erp-pricing.service';
import { factoryUser } from './erp-sales.shared';
import { ErpStockService } from './erp-stock.service';
import { itemDto, partnerEtag, tradingPartnerDto, warehouseDto } from './erp-views';
import { DEFAULT_PREFIXES, type ErpScope, ErpWorkspace } from './erp-workspace.service';

const ITEM_INCLUDE = { material: true, defaultSupplier: true } as const;
const CODE_PREFIX: Record<ErpPartnerKind, string> = { supplier: 'S', customer: 'C', both: 'P' };

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Master data of the factory's ERP (M1, M2, M13; D-317 – D-320): trading partners, warehouses, items and the
 * ERP settings. Every row belongs to the factory in the path; another factory's ids are 404.
 */
@Injectable()
export class ErpMasterService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly audit: AuditService,
    private readonly pricing: ErpPricingService,
  ) {}

  // -------------------------------------------------------------------------------- settings

  async getSettings(scope: ErpScope): Promise<ErpSettingsDto> {
    const s = await this.workspace.settings(this.workspace.db, scope.factory.id);
    return this.settingsDto(scope, s, await this.logoPublicId(this.workspace.db, s.documentLogoFileId));
  }

  async updateSettings(scope: ErpScope, ifMatch: string | undefined, body: UpdateErpSettingsDto) {
    if (body.prefixes) {
      const bad = Object.entries(body.prefixes).filter(
        ([k, v]) => !(k in DEFAULT_PREFIXES) || typeof v !== 'string' || !/^[A-Z0-9]{1,6}$/.test(v),
      );
      if (bad.length)
        throw new DomainException('validation.failed', {
          errors: bad.map(([k]) => ({
            path: `prefixes.${k}`,
            code: 'invalid',
            message: 'A-Z and 0-9, up to 6',
          })),
        });
    }
    return this.workspace.tx(async (tx) => {
      const current = await this.workspace.settings(tx, scope.factory.id);
      assertIfMatch(ifMatch, settingsEtag(scope.factory.publicId, current.rowVersion));
      const updated = await tx.erpFactorySettings.update({
        where: { id: current.id },
        data: {
          ...(body.modules && { disabledModules: ERP_MODULES.filter((m) => !body.modules!.includes(m)) }),
          ...(body.allowNegativeStock !== undefined && { allowNegativeStock: body.allowNegativeStock }),
          ...(body.overReceiptPct !== undefined && { overReceiptPct: body.overReceiptPct }),
          ...(body.priceTolerancePct !== undefined && { priceTolerancePct: body.priceTolerancePct }),
          ...(body.requireRequestApproval !== undefined && {
            requireRequestApproval: body.requireRequestApproval,
          }),
          ...(body.priceAlertPct !== undefined && { priceAlertPct: body.priceAlertPct }),
          ...(body.quoteExpiryDays !== undefined && { quoteExpiryDays: body.quoteExpiryDays }),
          ...(body.supplierApproval !== undefined && {
            supplierApproval: body.supplierApproval as ErpSupplierApprovalPolicy,
          }),
          ...(body.prefixes && { prefixes: { ...(current.prefixes as object), ...body.prefixes } }),
          ...(body.quoteValidDays !== undefined && { quoteValidDays: body.quoteValidDays }),
          ...(body.documentLogoFileId !== undefined && {
            documentLogoFileId: await this.logoFile(tx, scope, body.documentLogoFileId),
          }),
          ...(body.documentFooter !== undefined && { documentFooter: body.documentFooter }),
          ...(body.bankDetails !== undefined && { bankDetails: body.bankDetails }),
          ...(body.signatoryName !== undefined && { signatoryName: body.signatoryName }),
          ...(body.labourRatePerHour !== undefined && { labourRatePerHour: body.labourRatePerHour }),
          ...(body.overheadPct !== undefined && { overheadPct: body.overheadPct }),
          ...(body.dailySummary !== undefined && { dailySummary: body.dailySummary }),
          ...(body.oeeAlertPct !== undefined && { oeeAlertPct: body.oeeAlertPct }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      // D-428: the logo is also the first entry of the factory's document branding history.
      if (body.documentLogoFileId !== undefined && updated.documentLogoFileId !== current.documentLogoFileId)
        await tx.documentBrandMark.create({
          data: {
            ownerKind: 'factory',
            factoryId: scope.factory.id,
            kind: 'logo',
            fileId: updated.documentLogoFileId,
            createdById: scope.actor.userId,
          },
        });
      await this.audit.record(tx, {
        category: 'config',
        action: 'erp.settings_updated',
        resourceType: 'factory',
        resourcePublicId: scope.factory.publicId,
        data: { fields: Object.keys(body) },
      });
      await this.workspace.record(tx, scope, 'erp_settings.updated', 'factory', scope.factory.publicId, {
        fields: Object.keys(body),
      });
      return this.settingsDto(scope, updated, await this.logoPublicId(tx, updated.documentLogoFileId));
    });
  }

  private async logoPublicId(tx: ErpTx, id: bigint | null): Promise<string | null> {
    if (!id) return null;
    return (await tx.fileObject.findUnique({ where: { id }, select: { publicId: true } }))?.publicId ?? null;
  }

  /** D-368: the logo must be an uploaded, clean image owned by this factory. */
  private async logoFile(tx: ErpTx, scope: ErpScope, publicId: string | null): Promise<bigint | null> {
    if (publicId === null) return null;
    const f = await tx.fileObject.findUnique({ where: { publicId } });
    if (
      !f ||
      f.ownerFactoryId !== scope.factory.id ||
      f.uploadStatus !== 'uploaded' ||
      f.scanStatus === 'infected' ||
      !f.mimeType.startsWith('image/')
    )
      throw new DomainException('erp.file_not_usable');
    return f.id;
  }

  private settingsDto(
    scope: ErpScope,
    s: {
      disabledModules: string[];
      allowNegativeStock: boolean;
      overReceiptPct: Prisma.Decimal;
      priceTolerancePct: Prisma.Decimal;
      requireRequestApproval: boolean;
      priceAlertPct: Prisma.Decimal;
      quoteExpiryDays: number;
      supplierApproval: string;
      prefixes: unknown;
      rowVersion: number;
      quoteValidDays: number;
      documentLogoFileId: bigint | null;
      documentFooter: string | null;
      bankDetails: string | null;
      signatoryName: string | null;
      labourRatePerHour: Prisma.Decimal;
      overheadPct: Prisma.Decimal;
      dailySummary: boolean;
      oeeAlertPct: Prisma.Decimal;
    },
    logoPublicId: string | null = null,
  ): ErpSettingsDto {
    return {
      modules: ERP_MODULES.filter((m) => !s.disabledModules.includes(m)),
      allowNegativeStock: s.allowNegativeStock,
      overReceiptPct: dec(s.overReceiptPct).toFixed(4),
      priceTolerancePct: dec(s.priceTolerancePct).toFixed(4),
      requireRequestApproval: s.requireRequestApproval,
      priceAlertPct: dec(s.priceAlertPct).toFixed(4),
      quoteExpiryDays: s.quoteExpiryDays,
      supplierApproval: s.supplierApproval,
      prefixes: { ...DEFAULT_PREFIXES, ...(s.prefixes as Record<string, string>) },
      vatRegistered: scope.factory.isVatRegistered,
      quoteValidDays: s.quoteValidDays,
      documentLogoFileId: logoPublicId,
      documentFooter: s.documentFooter,
      bankDetails: s.bankDetails,
      signatoryName: s.signatoryName,
      labourRatePerHour: dec(s.labourRatePerHour).toFixed(2),
      overheadPct: dec(s.overheadPct).toFixed(4),
      dailySummary: s.dailySummary,
      oeeAlertPct: dec(s.oeeAlertPct).toFixed(4),
      version: s.rowVersion,
    };
  }

  // ------------------------------------------------------------------------ trading partners

  async listPartners(scope: ErpScope, q: ErpTradingPartnerListQuery) {
    const search = q.q?.trim();
    const where: Prisma.ErpTradingPartnerWhereInput = {
      factoryId: scope.factory.id,
      status: (q.status as 'active' | 'archived' | undefined) ?? 'active',
      ...(q.role && { kind: { in: [q.role, 'both'] } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { taxId: { contains: search } },
          { phone: { contains: search } },
          { contactName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpTradingPartner.findMany({
        where,
        include: { salesperson: true },
        orderBy: [{ code: 'asc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpTradingPartner.count({ where }),
    ]);
    return paginated(rows.map(tradingPartnerDto), total, q);
  }

  async getPartner(scope: ErpScope, publicId: string) {
    const row = await this.workspace.db.erpTradingPartner.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: { salesperson: true },
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createPartner(scope: ErpScope, body: ErpCreateTradingPartnerDto) {
    const kind = body.kind as ErpPartnerKind;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.workspace.tx(async (tx) => {
          const code = body.code ?? (await this.nextPartnerCode(tx, scope.factory.id, kind));
          const row = await tx.erpTradingPartner.create({
            data: {
              factoryId: scope.factory.id,
              code,
              kind,
              name: body.name,
              taxId: body.taxId ?? null,
              branchCode: body.branchCode ?? (body.taxId ? '00000' : null),
              contactName: body.contactName ?? null,
              phone: body.phone ?? null,
              email: body.email ?? null,
              address: body.address ?? null,
              paymentTermDays: body.paymentTermDays ?? 0,
              creditLimit: body.creditLimit ?? null,
              note: body.note ?? null,
              entityType: (body.entityType ?? 'juristic') as ErpEntityType,
              salespersonId: body.salespersonId
                ? (await factoryUser(tx, scope.factory.id, body.salespersonId)).id
                : null,
              createdById: scope.actor.userId,
            },
            include: { salesperson: true },
          });
          await this.workspace.record(tx, scope, 'erp_partner.created', 'erp_trading_partner', row.publicId, {
            code: row.code,
          });
          return row;
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (body.code || attempt >= 3)
          throw new DomainException('erp.code_taken', { params: { code: body.code ?? '' } });
      }
    }
  }

  private async nextPartnerCode(tx: ErpTx, factoryId: bigint, kind: ErpPartnerKind): Promise<string> {
    const prefix = CODE_PREFIX[kind];
    const rows = await tx.$queryRaw<{ n: number | null }[]>(Prisma.sql`
      SELECT MAX(substring(code FROM 2)::int) AS n FROM erp_trading_partners
       WHERE factory_id = ${factoryId} AND code ~ ${`^${prefix}[0-9]{4,}$`}`);
    return `${prefix}${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async updatePartner(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateTradingPartnerDto,
  ) {
    return this.workspace.tx(async (tx) => {
      const current = await tx.erpTradingPartner.findFirst({
        where: { factoryId: scope.factory.id, publicId },
      });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, partnerEtag(current));
      const row = await tx.erpTradingPartner.update({
        where: { id: current.id },
        data: {
          ...(body.kind !== undefined && { kind: body.kind as ErpPartnerKind }),
          ...(body.name !== undefined && { name: body.name }),
          ...(body.taxId !== undefined && { taxId: body.taxId }),
          ...(body.branchCode !== undefined && { branchCode: body.branchCode }),
          ...(body.contactName !== undefined && { contactName: body.contactName }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.email !== undefined && { email: body.email }),
          ...(body.address !== undefined && { address: body.address }),
          ...(body.paymentTermDays !== undefined && { paymentTermDays: body.paymentTermDays }),
          ...(body.creditLimit !== undefined && { creditLimit: body.creditLimit }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.status !== undefined && { status: body.status as 'active' | 'archived' }),
          ...(body.entityType !== undefined && { entityType: body.entityType as ErpEntityType }),
          ...(body.salespersonId !== undefined && {
            salespersonId: body.salespersonId
              ? (await factoryUser(tx, scope.factory.id, body.salespersonId)).id
              : null,
          }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
        include: { salesperson: true },
      });
      await this.workspace.record(tx, scope, 'erp_partner.updated', 'erp_trading_partner', row.publicId, {
        fields: Object.keys(body),
      });
      return row;
    });
  }

  // -------------------------------------------------------------------------------- warehouses

  async listWarehouses(scope: ErpScope) {
    const rows = await this.workspace.tx(async (tx) => {
      await this.workspace.defaultWarehouse(tx, scope.factory.id, scope.actor.userId);
      return tx.erpWarehouse.findMany({
        where: { factoryId: scope.factory.id },
        orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      });
    });
    return rows.map(warehouseDto);
  }

  async createWarehouse(scope: ErpScope, body: ErpCreateWarehouseDto) {
    try {
      return await this.workspace.tx(async (tx) => {
        await this.workspace.defaultWarehouse(tx, scope.factory.id, scope.actor.userId);
        if (body.isDefault)
          await tx.erpWarehouse.updateMany({
            where: { factoryId: scope.factory.id, isDefault: true },
            data: { isDefault: false },
          });
        const row = await tx.erpWarehouse.create({
          data: {
            factoryId: scope.factory.id,
            code: body.code.toUpperCase(),
            name: body.name,
            isDefault: body.isDefault ?? false,
            createdById: scope.actor.userId,
          },
        });
        await this.workspace.record(tx, scope, 'erp_warehouse.created', 'erp_warehouse', row.publicId, {
          code: row.code,
        });
        return warehouseDto(row);
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new DomainException('erp.code_taken', { params: { code: body.code.toUpperCase() } });
      throw e;
    }
  }

  async updateWarehouse(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateWarehouseDto,
  ) {
    return this.workspace.tx(async (tx) => {
      const current = await tx.erpWarehouse.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, partnerEtag(current));
      if (body.status === 'archived' && (current.isDefault || body.isDefault))
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'status',
              code: 'default_warehouse',
              message: 'Make another warehouse the default first',
            },
          ],
        });
      if (body.isDefault)
        await tx.erpWarehouse.updateMany({
          where: { factoryId: scope.factory.id, isDefault: true, id: { not: current.id } },
          data: { isDefault: false },
        });
      const row = await tx.erpWarehouse.update({
        where: { id: current.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.isDefault !== undefined && current.isDefault === false && { isDefault: body.isDefault }),
          ...(body.status !== undefined && { status: body.status as 'active' | 'archived' }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_warehouse.updated', 'erp_warehouse', row.publicId, {
        fields: Object.keys(body),
      });
      return warehouseDto(row);
    });
  }

  // ------------------------------------------------------------------------------------ items

  async listItems(scope: ErpScope, q: ErpItemListQuery) {
    const factoryId = scope.factory.id;
    const search = q.q?.trim();
    const where: Prisma.ErpItemWhereInput = {
      factoryId,
      status: (q.status as 'active' | 'archived' | undefined) ?? 'active',
      ...(q.kind && { kind: q.kind as ErpItem['kind'] }),
      ...(search && {
        OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    if (q.low) {
      const rows = await this.workspace.db.erpItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: { sku: 'asc' },
      });
      const dtos = await this.withStock(factoryId, rows);
      const low = dtos.filter((d) => d.stock.low);
      const { skip, take } = toSkipTake(q);
      return paginated(low.slice(skip, skip + take), low.length, q);
    }
    const [rows, total] = await Promise.all([
      this.workspace.db.erpItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: { sku: 'asc' },
        ...toSkipTake(q),
      }),
      this.workspace.db.erpItem.count({ where }),
    ]);
    return paginated(await this.withStock(factoryId, rows), total, q);
  }

  private async withStock(
    factoryId: bigint,
    rows: Prisma.ErpItemGetPayload<{ include: typeof ITEM_INCLUDE }>[],
  ): Promise<ErpItemDto[]> {
    const [totals, onOrder] = await Promise.all([
      this.stock.totals(
        factoryId,
        rows.map((r) => r.id),
      ),
      this.stock.onOrder(factoryId),
    ]);
    return rows.map((r) =>
      itemDto(r, {
        ...(totals.get(r.id) ?? { onHand: '0', reserved: '0', value: '0' }),
        onOrder: (onOrder.get(r.id) ?? dec(0)).toString(),
      }),
    );
  }

  async getItem(scope: ErpScope, publicId: string) {
    const row = await this.workspace.db.erpItem.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: ITEM_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async itemView(scope: ErpScope, publicId: string): Promise<ErpItemDto> {
    const row = await this.getItem(scope, publicId);
    return (await this.withStock(scope.factory.id, [row]))[0]!;
  }

  private async refs(
    tx: ErpTx,
    scope: ErpScope,
    body: { materialId?: string | null; defaultSupplierId?: string | null },
  ) {
    let materialId: bigint | null | undefined;
    if (body.materialId !== undefined) {
      if (body.materialId === null) materialId = null;
      else {
        const m = await tx.material.findUnique({ where: { publicId: body.materialId } });
        if (!m)
          throw new DomainException('validation.failed', {
            errors: [{ path: 'materialId', code: 'not_found', message: 'Unknown material' }],
          });
        materialId = m.id;
      }
    }
    let defaultSupplierId: bigint | null | undefined;
    if (body.defaultSupplierId !== undefined) {
      if (body.defaultSupplierId === null) defaultSupplierId = null;
      else {
        const s = await tx.erpTradingPartner.findFirst({
          where: { factoryId: scope.factory.id, publicId: body.defaultSupplierId },
        });
        if (!s) throw new DomainException('http.not_found');
        if (s.kind === 'customer')
          throw new DomainException('erp.not_a_supplier', { params: { name: s.name } });
        defaultSupplierId = s.id;
      }
    }
    return { materialId, defaultSupplierId };
  }

  private units(base: string, purchaseUnit: string | null | undefined, factor: string | undefined) {
    if (purchaseUnit && purchaseUnit !== base && factor === undefined)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'purchaseFactor', code: 'required', message: 'How many base units in one purchase unit' },
        ],
      });
    if (factor !== undefined && !dec(factor).gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'purchaseFactor', code: 'invalid', message: 'Must be more than zero' }],
      });
  }

  async createItem(scope: ErpScope, body: CreateErpItemDto): Promise<ErpItemDto> {
    this.units(body.baseUnit, body.purchaseUnit, body.purchaseFactor);
    const sku = body.sku.toUpperCase();
    try {
      const row = await this.workspace.tx(async (tx) => {
        const refs = await this.refs(tx, scope, body);
        const samePurchase = !body.purchaseUnit || body.purchaseUnit === body.baseUnit;
        const created = await tx.erpItem.create({
          data: {
            factoryId: scope.factory.id,
            sku,
            name: body.name,
            kind: body.kind as ErpItem['kind'],
            materialId: refs.materialId ?? null,
            baseUnit: body.baseUnit as ErpItem['baseUnit'],
            purchaseUnit: samePurchase ? null : (body.purchaseUnit as ErpItem['baseUnit']),
            purchaseFactor: samePurchase ? '1' : body.purchaseFactor!,
            reorderPoint: body.reorderPoint ?? null,
            reorderQty: body.reorderQty ?? null,
            leadTimeDays: body.leadTimeDays ?? null,
            defaultSupplierId: refs.defaultSupplierId ?? null,
            trackLots: body.trackLots ?? false,
            note: body.note ?? null,
            createdById: scope.actor.userId,
          },
          include: ITEM_INCLUDE,
        });
        if (created.defaultSupplierId !== null)
          await this.pricing.syncDefault(tx, created, created.defaultSupplierId, scope.actor.userId);
        await this.workspace.record(tx, scope, 'erp_item.created', 'erp_item', created.publicId, { sku });
        return created;
      });
      return itemDto(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainException('erp.sku_taken', { params: { sku } });
      throw e;
    }
  }

  async updateItem(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: UpdateErpItemDto) {
    await this.workspace.tx(async (tx) => {
      const current = await tx.erpItem.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, partnerEtag(current));
      const purchaseUnit = body.purchaseUnit === undefined ? current.purchaseUnit : body.purchaseUnit;
      const samePurchase = !purchaseUnit || purchaseUnit === current.baseUnit;
      if (body.purchaseUnit !== undefined || body.purchaseFactor !== undefined)
        this.units(
          current.baseUnit,
          purchaseUnit,
          body.purchaseFactor ?? (samePurchase ? undefined : current.purchaseFactor.toString()),
        );
      const refs = await this.refs(tx, scope, body);
      const row = await tx.erpItem.update({
        where: { id: current.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.kind !== undefined && { kind: body.kind as ErpItem['kind'] }),
          ...(refs.materialId !== undefined && { materialId: refs.materialId }),
          ...((body.purchaseUnit !== undefined || body.purchaseFactor !== undefined) && {
            purchaseUnit: samePurchase ? null : (purchaseUnit as ErpItem['baseUnit']),
            purchaseFactor: samePurchase ? '1' : (body.purchaseFactor ?? current.purchaseFactor),
          }),
          ...(body.reorderPoint !== undefined && { reorderPoint: body.reorderPoint }),
          ...(body.reorderQty !== undefined && { reorderQty: body.reorderQty }),
          ...(body.leadTimeDays !== undefined && { leadTimeDays: body.leadTimeDays }),
          ...(refs.defaultSupplierId !== undefined && { defaultSupplierId: refs.defaultSupplierId }),
          ...(body.trackLots !== undefined && { trackLots: body.trackLots }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.status !== undefined && { status: body.status as 'active' | 'archived' }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (refs.defaultSupplierId !== undefined && refs.defaultSupplierId !== current.defaultSupplierId)
        await this.pricing.syncDefault(tx, row, refs.defaultSupplierId, scope.actor.userId);
      await this.workspace.record(tx, scope, 'erp_item.updated', 'erp_item', row.publicId, {
        fields: Object.keys(body),
      });
    });
    return this.itemView(scope, publicId);
  }
}

export const settingsEtag = (factoryPublicId: string, version: number) =>
  partnerEtag({ publicId: `${factoryPublicId}:erp`, rowVersion: version });
