import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  CreateErpItemDto,
  ERP_IDS,
  ErpCreateGoodsReceiptDto,
  ErpCreateTradingPartnerDto,
  ErpCreateWarehouseDto,
  ErpDraftFromReorderDto,
  ErpDraftFromReorderResultDto,
  ErpGoodsReceiptDto,
  ErpGoodsReceiptListQuery,
  ErpItemDto,
  ErpItemListQuery,
  ErpMovementListQuery,
  ErpPurchaseOrderDto,
  ErpPurchaseOrderListQuery,
  ErpPurchaseOrderSummaryDto,
  ErpReorderSuggestionDto,
  ErpSavePurchaseOrderDto,
  ErpSettingsDto,
  ErpStockAdjustDto,
  ErpStockBalanceDto,
  ErpStockIssueDto,
  ErpStockListQuery,
  ErpStockMovementDto,
  ErpStockOverviewDto,
  ErpStockPostingDto,
  ErpStockTransferDto,
  ErpTradingPartnerDto,
  ErpTradingPartnerListQuery,
  ErpUpdateTradingPartnerDto,
  ErpUpdateWarehouseDto,
  ErpWarehouseDto,
  UpdateErpItemDto,
  UpdateErpSettingsDto,
} from './erp.dto';
import { ErpMasterService, settingsEtag } from './erp-master.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpStockService } from './erp-stock.service';
import { poDto, tradingPartnerDto } from './erp-views';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP, phase E1 (docs/prompts/E1-factory-erp.md): `/v1/partner/factories/{factoryId}/erp/*`.
 * The factory comes from the path and must be one of the caller's (another factory's id → 404, D-044);
 * only the factory's own people read or write it (D-317).
 */

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const byVersion = (b: { id: string; version: number }) => etagOf(b.id, b.version);

const SUPPLIER: ErpTradingPartnerDto = {
  id: ERP_IDS.supplier,
  code: 'S0001',
  kind: 'supplier',
  name: 'บจก. กระดาษไทย (ทดสอบ)',
  taxId: '0000500000001',
  branchCode: '00000',
  contactName: 'คุณสมชาย ทดสอบ',
  phone: '020000000',
  email: 'sales@supplier.example.invalid',
  address: '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10000',
  paymentTermDays: 30,
  creditLimit: null,
  note: null,
  status: 'active',
  entityType: 'juristic',
  salesperson: null,
  version: 1,
  createdAt: '2026-10-10T09:00:00+07:00',
  updatedAt: '2026-10-10T09:00:00+07:00',
};
const ITEM_REF = {
  id: ERP_IDS.item,
  sku: 'PAP-KA-350',
  name: 'กระดาษคราฟท์ 350 แกรม',
  kind: 'raw_material',
  baseUnit: 'sheet',
};
const WAREHOUSE: ErpWarehouseDto = {
  id: ERP_IDS.warehouse,
  code: 'MAIN',
  name: 'คลังหลัก',
  isDefault: true,
  status: 'active',
  version: 1,
};
const WAREHOUSE_REF = { id: ERP_IDS.warehouse, code: 'MAIN', name: 'คลังหลัก' };
const SUPPLIER_REF = { id: ERP_IDS.supplier, code: 'S0001', name: SUPPLIER.name };
const ITEM: ErpItemDto = {
  id: ERP_IDS.item,
  sku: 'PAP-KA-350',
  name: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว',
  kind: 'raw_material',
  material: null,
  baseUnit: 'sheet',
  purchaseUnit: 'ream',
  purchaseFactor: '500.000000',
  reorderPoint: '5000.000',
  reorderQty: '10000.000',
  leadTimeDays: 7,
  defaultSupplier: SUPPLIER_REF,
  trackLots: false,
  lastPurchasePrice: '1425.000000',
  note: null,
  status: 'active',
  stock: {
    onHand: '12500.000',
    reserved: '0.000',
    onOrder: '0.000',
    available: '12500.000',
    avgCost: '2.850000',
    value: '35625.00',
    low: false,
  },
  version: 1,
};
const MOVEMENT: ErpStockMovementDto = {
  id: ERP_IDS.movement,
  occurredAt: '2026-10-12T14:02:00+07:00',
  kind: 'receipt',
  item: ITEM_REF,
  warehouse: WAREHOUSE_REF,
  quantity: '5000.000',
  unitCost: '2.850000',
  value: '14250.00',
  balanceAfter: '12500.000',
  lotNo: null,
  documentNo: 'GR-2610-0003',
  sourceType: 'goods_receipt',
  sourceId: ERP_IDS.gr,
  reason: null,
  by: 'คลัง ทดสอบ',
};
const PO: ErpPurchaseOrderDto = {
  id: ERP_IDS.po,
  poNo: 'PO-2610-0007',
  status: 'partially_received',
  supplier: SUPPLIER_REF,
  orderedOn: '2026-10-10',
  expectedOn: '2026-10-17',
  late: false,
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  subtotal: '28500.00',
  vatAmount: '1995.00',
  total: '30495.00',
  currency: 'THB',
  supplierRef: 'QT-6610-112',
  deliverTo: null,
  note: null,
  issuedAt: '2026-10-10T10:00:00+07:00',
  closedAt: null,
  cancelReason: null,
  lines: [
    {
      id: ERP_IDS.poLine,
      lineNo: 1,
      item: ITEM_REF,
      description: null,
      quantity: '20.000',
      unit: 'ream',
      factor: '500.000000',
      unitPrice: '1425.000000',
      discountPct: '0.0000',
      amount: '28500.00',
      receivedQty: '10.000',
      remainingQty: '10.000',
    },
  ],
  receipts: [{ id: ERP_IDS.gr, grNo: 'GR-2610-0003', receivedOn: '2026-10-12', total: '14250.00' }],
  warnings: [],
  nextActions: [
    { key: 'erp_po.receive', irreversible: false, disabledReason: null },
    { key: 'erp_po.close', irreversible: false, disabledReason: null },
  ],
  version: 3,
};
const PO_SUMMARY: ErpPurchaseOrderSummaryDto = {
  id: ERP_IDS.po,
  poNo: 'PO-2610-0007',
  status: 'partially_received',
  supplier: SUPPLIER_REF,
  orderedOn: '2026-10-10',
  expectedOn: '2026-10-17',
  late: false,
  total: '30495.00',
  currency: 'THB',
  lineCount: 1,
  receivedPct: '50.00',
};
export const GR: ErpGoodsReceiptDto = {
  id: ERP_IDS.gr,
  grNo: 'GR-2610-0003',
  purchaseOrder: { id: ERP_IDS.po, code: 'PO-2610-0007', name: 'PO-2610-0007' },
  supplier: SUPPLIER_REF,
  warehouse: WAREHOUSE_REF,
  receivedOn: '2026-10-12',
  deliveryNoteNo: 'DO-55012',
  note: null,
  total: '14250.00',
  currency: 'THB',
  by: 'คลัง ทดสอบ',
  createdAt: '2026-10-12T14:02:00+07:00',
  lines: [
    {
      lineNo: 1,
      item: ITEM_REF,
      quantity: '10.000',
      unit: 'ream',
      baseQuantity: '5000.000',
      unitCost: '2.850000',
      amount: '14250.00',
      lotNo: null,
      rejectedQuantity: '0.000',
      rejectReason: null,
      landedAmount: '1200.00',
      landedUnitCost: '3.090000',
    },
  ],
  chargesTotal: '1200.00',
  charges: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000ee21',
      kind: 'freight',
      description: 'ค่าขนส่งรถ 6 ล้อ',
      amount: '1200.00',
      allocation: 'by_value',
      partner: null,
      reference: 'INV-TR-0912',
      atReceipt: true,
      absorbed: '1200.00',
      notAbsorbed: '0.00',
      by: 'คลัง ทดสอบ',
      createdAt: '2026-10-12T14:02:00+07:00',
      lines: [{ lineNo: 1, amount: '1200.00', absorbed: '1200.00' }],
    },
  ],
  nextActions: [{ key: 'erp_gr.add_charge', irreversible: false, disabledReason: null }],
};
const SAVE_PO_EXAMPLE = {
  supplierId: ERP_IDS.supplier,
  expectedOn: '2026-10-17',
  vatMode: 'exclusive',
  lines: [{ itemId: ERP_IDS.item, quantity: '20', unit: 'ream', unitPrice: '1425' }],
};

// ------------------------------------------------------------------------------------ settings

const SETTINGS: ErpSettingsDto = {
  modules: ['inventory', 'procurement', 'partners'],
  allowNegativeStock: false,
  overReceiptPct: '10.0000',
  priceTolerancePct: '2.0000',
  requireRequestApproval: true,
  priceAlertPct: '5.0000',
  quoteExpiryDays: 7,
  supplierApproval: 'warn',
  prefixes: {
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
  },
  vatRegistered: true,
  quoteValidDays: 30,
  documentLogoFileId: null,
  documentFooter: 'ขอบคุณที่ใช้บริการ',
  bankDetails: 'ธนาคารทดสอบ สาขาทดสอบ บัญชีออมทรัพย์ 000-0-00000-0 ชื่อบัญชี บจก. ทดสอบ',
  signatoryName: 'คุณเจ้าของ ทดสอบ',
  version: 1,
};

@ApiSurface('partner', 'erpSettings')
@Controller('factories/:factoryId/erp/settings')
export class PartnerErpSettingsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly master: ErpMasterService,
  ) {}

  @Get()
  @Can('factory_profile.read')
  @factoryParam
  @ApiEtag()
  @ApiEndpoint({
    id: 'partner.erpSettings.get',
    summary: 'My factory’s ERP settings',
    description:
      'Modules switched on, document prefixes, negative-stock and over-receipt rules, VAT registration.',
    implements: ['D-318', 'D-322', 'D-323'],
  })
  @ApiSuccess(200, {
    description: 'Settings',
    type: ErpSettingsDto,
    example: SETTINGS,
  })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    const dto = await this.master.getSettings(scope);
    res.setHeader('ETag', settingsEtag(scope.factory.publicId, dto.version));
    return dto;
  }

  @Patch()
  @Can('factory_erp.configure')
  @factoryParam
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'partner.erpSettings.update',
    summary: 'Change my factory’s ERP settings',
    description: 'Owner only by default (D-319). Audited.',
    implements: ['D-318', 'D-322', 'D-323'],
  })
  @ApiBody({
    type: UpdateErpSettingsDto,
    examples: { default: { value: { overReceiptPct: '5', prefixes: { po: 'PO' } } } },
  })
  @ApiSuccess(200, { description: 'Settings', type: ErpSettingsDto, example: SETTINGS })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateErpSettingsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    const dto = await this.master.updateSettings(scope, ifMatch, body);
    res.setHeader('ETag', settingsEtag(scope.factory.publicId, dto.version));
    return dto;
  }
}

// ----------------------------------------------------------------------------- trading partners

@ApiSurface('partner', 'erpPartners')
@Controller('factories/:factoryId/erp/partners')
export class PartnerErpPartnersController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly master: ErpMasterService,
  ) {}

  @Get()
  @Can('factory_trading_partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPartners.list',
    summary: 'My factory’s suppliers and customers',
    description:
      '`role=supplier` lists suppliers and both-ways partners, `role=customer` customers and both; `q` searches name, ' +
      'code, tax id, phone and contact. Active ones unless `status=archived`.',
    implements: ['D-317', 'D-319'],
  })
  @ApiPaginated(ErpTradingPartnerDto, { example: SUPPLIER })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpTradingPartnerListQuery,
  ) {
    return this.master.listPartners(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_trading_partners.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPartners.create',
    summary: 'Add a supplier or customer',
    description:
      'The code is generated (`S0001`, `C0001`, `P0001` by kind) unless given; unique in the factory.',
    implements: ['D-317', 'D-319'],
  })
  @ApiBody({
    type: ErpCreateTradingPartnerDto,
    examples: {
      default: { value: { kind: 'supplier', name: SUPPLIER.name, phone: '020000000', paymentTermDays: 30 } },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: ErpTradingPartnerDto, example: SUPPLIER })
  @ApiStandardErrors(...WRITE, 'erp.code_taken')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateTradingPartnerDto,
  ) {
    return tradingPartnerDto(
      await this.master.createPartner(await this.workspace.open(actor, factoryId), body),
    );
  }

  @Get(':partnerId')
  @Can('factory_trading_partners.read')
  @factoryParam
  @ApiParam({ name: 'partnerId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPartners.get',
    summary: 'One supplier or customer',
    description: 'With its ETag for `PATCH`.',
    implements: ['D-317'],
  })
  @ApiSuccess(200, { description: 'The partner', type: ErpTradingPartnerDto, example: SUPPLIER })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
  ) {
    return tradingPartnerDto(
      await this.master.getPartner(await this.workspace.open(actor, factoryId), partnerId),
    );
  }

  @Patch(':partnerId')
  @Can('factory_trading_partners.manage')
  @factoryParam
  @ApiParam({ name: 'partnerId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPartners.update',
    summary: 'Edit or archive a supplier or customer',
    description: 'Archived partners stay on old documents and cannot be used on new ones.',
    implements: ['D-317', 'D-319'],
  })
  @ApiBody({ type: ErpUpdateTradingPartnerDto, examples: { default: { value: { paymentTermDays: 45 } } } })
  @ApiSuccess(200, { description: 'The partner', type: ErpTradingPartnerDto, example: SUPPLIER })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateTradingPartnerDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return tradingPartnerDto(await this.master.updatePartner(scope, partnerId, ifMatch, body));
  }
}

// ----------------------------------------------------------------------------------- warehouses

@ApiSurface('partner', 'erpWarehouses')
@Controller('factories/:factoryId/erp/warehouses')
export class PartnerErpWarehousesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly master: ErpMasterService,
  ) {}

  @Get()
  @Can('factory_inventory.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpWarehouses.list',
    summary: 'My factory’s warehouses',
    description: 'The default one first; a factory without any gets `MAIN` ("คลังหลัก").',
    implements: ['D-320'],
  })
  @ApiSuccess(200, { description: 'Warehouses', type: [ErpWarehouseDto], example: [WAREHOUSE] })
  @ApiStandardErrors('http.not_found')
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.master.listWarehouses(await this.workspace.open(actor, factoryId));
  }

  @Post()
  @Can('factory_inventory.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpWarehouses.create',
    summary: 'Add a warehouse',
    description: 'The code is unique in the factory (upper case).',
    implements: ['D-320'],
  })
  @ApiBody({
    type: ErpCreateWarehouseDto,
    examples: { default: { value: { code: 'WH2', name: 'คลังกระดาษ' } } },
  })
  @ApiSuccess(201, { description: 'Created', type: ErpWarehouseDto, example: WAREHOUSE })
  @ApiStandardErrors(...WRITE, 'erp.code_taken')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateWarehouseDto,
  ) {
    return this.master.createWarehouse(await this.workspace.open(actor, factoryId), body);
  }

  @Patch(':warehouseId')
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiParam({ name: 'warehouseId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpWarehouses.update',
    summary: 'Rename, make default or archive a warehouse',
    description: 'The default warehouse cannot be archived.',
    implements: ['D-320'],
  })
  @ApiBody({ type: ErpUpdateWarehouseDto, examples: { default: { value: { name: 'คลังวัตถุดิบ' } } } })
  @ApiSuccess(200, { description: 'The warehouse', type: ErpWarehouseDto, example: WAREHOUSE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateWarehouseDto,
  ) {
    return this.master.updateWarehouse(
      await this.workspace.open(actor, factoryId),
      warehouseId,
      ifMatch,
      body,
    );
  }
}

// ---------------------------------------------------------------------------------------- items

@ApiSurface('partner', 'erpItems')
@Controller('factories/:factoryId/erp/items')
export class PartnerErpItemsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly master: ErpMasterService,
  ) {}

  @Get()
  @Can('factory_inventory.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpItems.list',
    summary: 'My factory’s items with their stock',
    description:
      'Every item with on hand, on order, available, average cost and value across warehouses; `low=true` only those ' +
      'at or below their reorder point (D-326); `q` searches SKU and name.',
    implements: ['D-320', 'D-321', 'D-326'],
  })
  @ApiPaginated(ErpItemDto, { example: ITEM })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpItemListQuery,
  ) {
    return this.master.listItems(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_inventory.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItems.create',
    summary: 'Add an item',
    description:
      'SKU unique in the factory (upper case); stock is kept in the base unit, bought in the purchase unit with a ' +
      'fixed factor (D-320); may stock a platform material.',
    implements: ['D-320'],
  })
  @ApiBody({
    type: CreateErpItemDto,
    examples: {
      default: {
        value: {
          sku: 'PAP-KA-350',
          name: ITEM.name,
          kind: 'raw_material',
          baseUnit: 'sheet',
          purchaseUnit: 'ream',
          purchaseFactor: '500',
          reorderPoint: '5000',
          reorderQty: '10000',
          defaultSupplierId: ERP_IDS.supplier,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: ErpItemDto, example: ITEM })
  @ApiStandardErrors(...WRITE, 'erp.sku_taken', 'erp.not_a_supplier')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateErpItemDto,
  ) {
    return this.master.createItem(await this.workspace.open(actor, factoryId), body);
  }

  @Get(':itemId')
  @Can('factory_inventory.read')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItems.get',
    summary: 'One item with its stock',
    description: 'With its ETag for `PATCH`; the ledger is `GET …/erp/stock/movements?itemId=`.',
    implements: ['D-320'],
  })
  @ApiSuccess(200, { description: 'The item', type: ErpItemDto, example: ITEM })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.master.itemView(await this.workspace.open(actor, factoryId), itemId);
  }

  @Patch(':itemId')
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItems.update',
    summary: 'Edit or archive an item',
    description: 'The SKU and base unit never change; archived items stay on old documents.',
    implements: ['D-320'],
  })
  @ApiBody({ type: UpdateErpItemDto, examples: { default: { value: { reorderPoint: '6000' } } } })
  @ApiSuccess(200, { description: 'The item', type: ErpItemDto, example: ITEM })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateErpItemDto,
  ) {
    return this.master.updateItem(await this.workspace.open(actor, factoryId), itemId, ifMatch, body);
  }
}

// ---------------------------------------------------------------------------------------- stock

const POSTING_EXAMPLE: ErpStockPostingDto = {
  id: ERP_IDS.movement,
  documentNo: 'ADJ-2610-0001',
  movements: [MOVEMENT],
};
const STOCK_ERRORS = [...WRITE, 'erp.stock_insufficient', 'erp.lot_required', 'erp.archived'] as const;

@ApiSurface('partner', 'erpStock')
@Controller('factories/:factoryId/erp/stock')
export class PartnerErpStockController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly purchasing: ErpPurchasingService,
  ) {}

  @Get()
  @Can('factory_inventory.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.list',
    summary: 'Stock balances',
    description: 'On hand, reserved, available, average cost and value per item and warehouse (D-321).',
    implements: ['D-321', 'D-326'],
  })
  @ApiPaginated(ErpStockBalanceDto, {
    example: {
      item: ITEM_REF,
      warehouse: WAREHOUSE_REF,
      onHand: '12500.000',
      reserved: '0.000',
      available: '12500.000',
      avgCost: '2.850000',
      value: '35625.00',
      reorderPoint: '5000.000',
      low: false,
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpStockListQuery,
  ) {
    return this.stock.balances(await this.workspace.open(actor, factoryId), q);
  }

  @Get('overview')
  @Can('factory_inventory.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.overview',
    summary: 'Stock at a glance',
    description: 'Items, items to reorder, negative balances, stock value, open and late purchase orders.',
    implements: ['D-321', 'D-326'],
  })
  @ApiSuccess(200, {
    description: 'Overview',
    type: ErpStockOverviewDto,
    example: {
      items: 42,
      low: 3,
      negative: 0,
      value: '1250000.00',
      currency: 'THB',
      openPurchaseOrders: 4,
      latePurchaseOrders: 1,
    },
  })
  @ApiStandardErrors('http.not_found')
  async overview(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.stock.overview(await this.workspace.open(actor, factoryId));
  }

  @Get('movements')
  @Can('factory_inventory.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.movements',
    summary: 'The stock ledger',
    description:
      'Every movement, newest first, with the balance it left (D-324); filter by item, warehouse, kind and Bangkok ' +
      'dates; `q` searches document, lot, item.',
    implements: ['D-324'],
  })
  @ApiPaginated(ErpStockMovementDto, { example: MOVEMENT })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async movements(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpMovementListQuery,
  ) {
    return this.stock.movements(await this.workspace.open(actor, factoryId), q);
  }

  @Get('reorder')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.reorder',
    summary: 'What to buy now',
    description:
      'Items whose available stock plus what is on order is at or below the reorder point, with the quantity to buy ' +
      'rounded up to whole purchase units and the default supplier, most urgent first (D-326).',
    implements: ['D-326'],
  })
  @ApiSuccess(200, {
    description: 'Suggestions',
    type: [ErpReorderSuggestionDto],
    example: [
      {
        item: ITEM_REF,
        supplier: SUPPLIER_REF,
        available: '3200.000',
        onOrder: '0.000',
        reorderPoint: '5000.000',
        toOrderQty: '10000.000',
        toOrderPurchaseQty: '20.000',
        purchaseUnit: 'ream',
        lastPurchasePrice: '1425.000000',
        needBy: '2026-10-17',
      },
    ],
  })
  @ApiStandardErrors('http.not_found')
  async reorder(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.purchasing.reorder(await this.workspace.open(actor, factoryId));
  }

  @Post('actions/adjust')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_inventory.adjust')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.adjust',
    summary: 'Opening balances, adjustments and counts',
    description:
      '`opening` brings stock in at a cost; `adjustment` adds or removes (signed); `count` sets the counted quantity ' +
      '(only differences are posted; a matching count posts nothing). Numbered `ADJ-YYMM-NNNN`; a reason is required ' +
      'except for openings. Audited.',
    implements: ['D-321', 'D-322', 'D-324'],
  })
  @ApiBody({
    type: ErpStockAdjustDto,
    examples: {
      default: {
        value: {
          kind: 'count',
          reason: 'นับสต็อกสิ้นเดือน',
          lines: [{ itemId: ERP_IDS.item, quantity: '12480' }],
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Posted', type: ErpStockPostingDto, example: POSTING_EXAMPLE })
  @ApiStandardErrors(...STOCK_ERRORS)
  async adjust(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpStockAdjustDto,
  ) {
    return this.stock.adjust(await this.workspace.open(actor, factoryId), body);
  }

  @Post('actions/issue')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.issue',
    summary: 'Issue stock to production, or return what was not used',
    description:
      'At the average cost (D-321); refused beyond what is available unless allowed (D-322). Numbered `ISS-YYMM-NNNN`.',
    implements: ['D-321', 'D-322', 'D-324'],
  })
  @ApiBody({
    type: ErpStockIssueDto,
    examples: {
      default: {
        value: {
          kind: 'issue',
          reference: 'JOB-2610-00012',
          lines: [{ itemId: ERP_IDS.item, quantity: '1200' }],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Posted',
    type: ErpStockPostingDto,
    example: { ...POSTING_EXAMPLE, documentNo: 'ISS-2610-0001' },
  })
  @ApiStandardErrors(...STOCK_ERRORS)
  async issue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpStockIssueDto,
  ) {
    return this.stock.issue(await this.workspace.open(actor, factoryId), body);
  }

  @Post('actions/transfer')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpStock.transfer',
    summary: 'Move stock between warehouses',
    description:
      'Out of one warehouse and into the other at the same cost (D-321). Numbered `TRF-YYMM-NNNN`.',
    implements: ['D-321', 'D-324'],
  })
  @ApiBody({
    type: ErpStockTransferDto,
    examples: {
      default: {
        value: {
          fromWarehouseId: ERP_IDS.warehouse,
          toWarehouseId: ERP_IDS.factory,
          lines: [{ itemId: ERP_IDS.item, quantity: '500' }],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Posted',
    type: ErpStockPostingDto,
    example: { ...POSTING_EXAMPLE, documentNo: 'TRF-2610-0001' },
  })
  @ApiStandardErrors(...STOCK_ERRORS, 'erp.same_warehouse')
  async transfer(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpStockTransferDto,
  ) {
    return this.stock.transfer(await this.workspace.open(actor, factoryId), body);
  }
}

// ------------------------------------------------------------------------------ purchase orders

@ApiSurface('partner', 'erpPurchaseOrders')
@Controller('factories/:factoryId/erp/purchase-orders')
export class PartnerErpPurchaseOrdersController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly purchasing: ErpPurchasingService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async view(actor: Actor, row: Parameters<typeof poDto>[0]) {
    return poDto(row, await permissionsOf(this.permissions, actor));
  }

  @Get()
  @Can('factory_procurement.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.list',
    summary: 'My factory’s purchase orders',
    description:
      'Newest first; `status=open` = issued or partly received; `q` searches number, supplier, item.',
    implements: ['D-325'],
  })
  @ApiPaginated(ErpPurchaseOrderSummaryDto, { example: PO_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpPurchaseOrderListQuery,
  ) {
    return this.purchasing.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_procurement.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.create',
    summary: 'Draft a purchase order',
    description: 'Editable until issued; totals by VAT mode (exclusive, inclusive, none).',
    implements: ['D-325'],
  })
  @ApiBody({ type: ErpSavePurchaseOrderDto, examples: { default: { value: SAVE_PO_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpPurchaseOrderDto,
    example: { ...PO, poNo: null, status: 'draft' },
  })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier', 'erp.archived', 'erp.unit_not_allowed')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSavePurchaseOrderDto,
  ) {
    return this.view(actor, await this.purchasing.create(await this.workspace.open(actor, factoryId), body));
  }

  @Post('actions/from-reorder')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.fromReorder',
    summary: 'Draft purchase orders from the reorder list',
    description:
      'One draft per default supplier for the chosen items, at the suggested quantity and the last price (D-326); ' +
      'items without a supplier or need are returned as skipped.',
    implements: ['D-326'],
  })
  @ApiBody({ type: ErpDraftFromReorderDto, examples: { default: { value: { itemIds: [ERP_IDS.item] } } } })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpDraftFromReorderResultDto,
    example: { created: [{ ...PO_SUMMARY, poNo: null, status: 'draft', receivedPct: '0.00' }], skipped: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.archived')
  async fromReorder(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpDraftFromReorderDto,
  ) {
    return this.purchasing.draftFromReorder(await this.workspace.open(actor, factoryId), body.itemIds);
  }

  @Get(':poId')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiParam({ name: 'poId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.get',
    summary: 'One purchase order',
    description: 'Lines with what is received, its receipts and the actions offered (`nextActions`).',
    implements: ['D-325'],
  })
  @ApiSuccess(200, { description: 'The purchase order', type: ErpPurchaseOrderDto, example: PO })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('poId', ParseUUIDPipe) poId: string,
  ) {
    return this.view(actor, await this.purchasing.get(await this.workspace.open(actor, factoryId), poId));
  }

  @Put(':poId')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'poId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.update',
    summary: 'Edit a draft purchase order',
    description: 'Replaces the header and lines; only drafts (D-325).',
    implements: ['D-325'],
  })
  @ApiBody({ type: ErpSavePurchaseOrderDto, examples: { default: { value: SAVE_PO_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'The draft',
    type: ErpPurchaseOrderDto,
    example: { ...PO, poNo: null, status: 'draft' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'erp.invalid_status',
    'erp.not_a_supplier',
    'erp.archived',
    'erp.unit_not_allowed',
  )
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('poId', ParseUUIDPipe) poId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSavePurchaseOrderDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.view(actor, await this.purchasing.update(scope, poId, ifMatch, body));
  }

  @Post(':poId/actions/issue')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.approve')
  @factoryParam
  @ApiParam({ name: 'poId', format: 'uuid' })
  @ApiConcurrency({ optional: true })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.issue',
    summary: 'Issue (approve) a purchase order',
    description:
      'Numbers it `PO-YYMM-NNNN` and freezes it; it can then be sent and received (D-325). Refused with ' +
      '`erp.supplier_not_approved` when the factory requires approved suppliers and a line’s link is not (D-351). Audited.',
    implements: ['D-319', 'D-323', 'D-325', 'D-351'],
  })
  @ApiSuccess(200, { description: 'Issued', type: ErpPurchaseOrderDto, example: { ...PO, status: 'issued' } })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status', 'erp.archived', 'erp.supplier_not_approved')
  async issue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('poId', ParseUUIDPipe) poId: string,
    @IfMatch() ifMatch: string | undefined,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.view(actor, await this.purchasing.issue(scope, poId, ifMatch));
  }

  @Post(':poId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'poId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.cancel',
    summary: 'Cancel a purchase order',
    description:
      'A draft, or an issued order with nothing received; with a reason (D-325). The number is kept.',
    implements: ['D-325'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ผู้ขายแจ้งว่าไม่มีของ' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpPurchaseOrderDto,
    example: { ...PO, status: 'cancelled', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('poId', ParseUUIDPipe) poId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.view(actor, await this.purchasing.cancel(scope, poId, body.reason));
  }

  @Post(':poId/actions/close')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'poId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseOrders.close',
    summary: 'Close a partly received purchase order',
    description: 'The rest will not come; with a reason (D-325).',
    implements: ['D-325'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ผู้ขายส่งได้แค่นี้' } } } })
  @ApiSuccess(200, {
    description: 'Closed',
    type: ErpPurchaseOrderDto,
    example: { ...PO, status: 'closed', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async close(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('poId', ParseUUIDPipe) poId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.view(actor, await this.purchasing.close(scope, poId, body.reason));
  }
}

// ------------------------------------------------------------------------------- goods receipts

@ApiSurface('partner', 'erpGoodsReceipts')
@Controller('factories/:factoryId/erp/goods-receipts')
export class PartnerErpGoodsReceiptsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly purchasing: ErpPurchasingService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_procurement.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpGoodsReceipts.list',
    summary: 'Goods received',
    description: 'Newest first; by purchase order or supplier; `q` searches GR, delivery note, supplier, PO.',
    implements: ['D-325'],
  })
  @ApiPaginated(ErpGoodsReceiptDto, { example: GR })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpGoodsReceiptListQuery,
  ) {
    return this.purchasing.listReceipts(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Idempotent()
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpGoodsReceipts.create',
    summary: 'Receive goods into stock',
    description:
      'Against an open purchase order (by PO line, at the order’s price, up to the over-receipt tolerance) or ' +
      'without one (item and price per line). Stock comes in at cost (D-321); numbered `GR-YYMM-NNNN`; final once ' +
      'posted (D-325).',
    implements: ['D-321', 'D-325', 'D-327'],
  })
  @ApiBody({
    type: ErpCreateGoodsReceiptDto,
    examples: {
      default: {
        value: {
          purchaseOrderId: ERP_IDS.po,
          deliveryNoteNo: 'DO-55012',
          lines: [{ purchaseOrderLineId: ERP_IDS.poLine, quantity: '10' }],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Posted', type: ErpGoodsReceiptDto, example: GR })
  @ApiStandardErrors(
    ...WRITE,
    'erp.invalid_status',
    'erp.over_receipt',
    'erp.lot_required',
    'erp.not_a_supplier',
    'erp.archived',
    'erp.unit_not_allowed',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateGoodsReceiptDto,
  ) {
    return this.purchasing.receive(await this.workspace.open(actor, factoryId), body);
  }

  @Get(':grId')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiParam({ name: 'grId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpGoodsReceipts.get',
    summary: 'One goods receipt',
    description: 'Lines with base quantity and unit cost (D-321).',
    implements: ['D-325'],
  })
  @ApiSuccess(200, { description: 'The goods receipt', type: ErpGoodsReceiptDto, example: GR })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('grId', ParseUUIDPipe) grId: string,
  ) {
    return this.purchasing.getReceipt(
      await this.workspace.open(actor, factoryId),
      grId,
      await permissionsOf(this.permissions, actor),
    );
  }
}
