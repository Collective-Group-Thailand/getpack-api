import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { OptionalNoteDto } from '@common/dto/optional-note.dto';
import { ReasonDto } from '@common/dto/reason.dto';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
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
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { ERP_IDS, ErpDraftFromReorderDto, ErpDraftFromReorderResultDto } from './erp.dto';
import {
  E2_IDS,
  ErpApAgingDto,
  ErpCompleteProductionDto,
  ErpCreateItemSupplierDto,
  ErpCreateProductionOrderDto,
  ErpCreateSupplierInvoiceDto,
  ErpCreateSupplierPaymentDto,
  ErpItemSupplierDto,
  ErpMaterialMoveDto,
  ErpMrpRowDto,
  ErpOperationQueueItemDto,
  ErpOperationQueueQuery,
  ErpPlanningOverviewDto,
  ErpPriceListQuery,
  ErpPriceRecordDto,
  ErpProductionOrderDto,
  ErpProductionOrderListQuery,
  ErpProductionOrderSummaryDto,
  ErpPurchaseRequestDto,
  ErpPurchaseRequestListQuery,
  ErpPurchaseRequestSummaryDto,
  ErpRecipeDto,
  ErpRecipeListQuery,
  ErpRecordPriceDto,
  ErpSavePurchaseRequestDto,
  ErpSaveRecipeDto,
  ErpSupplierInvoiceDto,
  ErpSupplierInvoiceListQuery,
  ErpSupplierInvoiceSummaryDto,
  ErpSupplierPaymentDto,
  ErpSupplierPaymentListQuery,
  ErpUpdateItemSupplierDto,
  ErpUpdateProductionOrderDto,
} from './erp-e2.dto';
import { ErpFinishOperationDto } from './erp-e3.dto';
import { ErpPayablesService } from './erp-payables.service';
import { ErpPricingService } from './erp-pricing.service';
import { ErpProductionService } from './erp-production.service';
import { ErpRequestsService } from './erp-requests.service';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP E1.1 + E2 (docs/prompts/E1-factory-erp.md): supplier prices, purchase requests, payables,
 * recipes, production orders and planning under `/v1/partner/factories/{factoryId}/erp/*` — factory-private
 * (D-317), the factory from the path within the caller's scopes (D-044).
 */

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const byVersion = (b: { id: string; version: number }) => etagOf(b.id, b.version);

const SUPPLIER_REF = { id: ERP_IDS.supplier, code: 'S0001', name: 'บจก. กระดาษไทย (ทดสอบ)' };
const ITEM_REF = {
  id: ERP_IDS.item,
  sku: 'PAP-KA-350',
  name: 'กระดาษคราฟท์ 350 แกรม',
  kind: 'raw_material',
  baseUnit: 'sheet',
};
const PRODUCT_REF = {
  id: ERP_IDS.material,
  sku: 'FG-CRM-30',
  name: 'กล่องครีม 30 ml',
  kind: 'finished_good',
  baseUnit: 'pcs',
};
const WAREHOUSE_REF = { id: ERP_IDS.warehouse, code: 'MAIN', name: 'คลังหลัก' };
const MACHINE_REF = { id: E2_IDS.machine, name: 'Heidelberg SM 74 (ทดสอบ)' };

// ----------------------------------------------------------------------------------- examples

export const LINK: ErpItemSupplierDto = {
  id: E2_IDS.link,
  item: ITEM_REF,
  supplier: SUPPLIER_REF,
  supplierSku: 'KA350-3143',
  supplierName: 'Kraft 350g 31x43',
  purchaseUnit: 'ream',
  purchaseFactor: '500.000000',
  minOrderQty: '10.000',
  leadTimeDays: 7,
  lastPrice: '1425.000000',
  lastBaseUnitPrice: '2.850000',
  lastPricedOn: '2026-10-12',
  lastPurchasedOn: '2026-10-12',
  quoteValidUntil: null,
  preferred: true,
  cheapest: true,
  note: null,
  status: 'active',
  stats: {
    minBaseUnitPrice: '2.800000',
    avgBaseUnitPrice: '2.830000',
    maxBaseUnitPrice: '2.850000',
    purchases: 4,
    changePct: '1.79',
    onTimePct: '75.00',
    avgLeadDays: '6.5',
  },
  approval: 'approved',
  approvalNote: 'ผ่านการตรวจโรงงาน ได้ FSC',
  approvedAt: '2026-10-10T10:00:00+07:00',
  approvedBy: 'เจ้าของ ทดสอบ',
  reviewOn: '2027-10-01',
  priceBreaks: [
    { minQty: '10.000', unitPrice: '1425.000000', baseUnitPrice: '2.850000' },
    { minQty: '50.000', unitPrice: '1380.000000', baseUnitPrice: '2.760000' },
  ],
  breaksValidUntil: '2026-12-31',
  score: {
    receipts: 6,
    deliveredValue: '84200.00',
    acceptedValue: '83350.00',
    rejectedLines: 1,
    qualityPct: '98.99',
    onTimePct: '83.33',
    score: '92.73',
    grade: 'B',
    ncrs: 1,
  },
  version: 1,
};

const PRICE: ErpPriceRecordDto = {
  id: E2_IDS.price,
  item: ITEM_REF,
  supplier: SUPPLIER_REF,
  source: 'goods_receipt',
  unit: 'ream',
  factor: '500.000000',
  unitPrice: '1425.000000',
  baseUnitPrice: '2.850000',
  quantity: '10.000',
  pricedOn: '2026-10-12',
  validUntil: null,
  documentNo: 'GR-2610-0003',
  sourceId: ERP_IDS.gr,
  note: null,
  by: 'คลัง ทดสอบ',
  createdAt: '2026-10-12T14:02:00+07:00',
};

const PR_SUMMARY: ErpPurchaseRequestSummaryDto = {
  id: E2_IDS.pr,
  prNo: 'PR-2610-0004',
  status: 'submitted',
  source: 'manual',
  neededBy: '2026-10-20',
  estimatedTotal: '28500.00',
  currency: 'THB',
  lineCount: 1,
  requestedBy: 'คลัง ทดสอบ',
  createdAt: '2026-10-12T09:00:00+07:00',
};

const PR: ErpPurchaseRequestDto = {
  ...PR_SUMMARY,
  note: 'ใช้กับงาน JOB-2610-0012',
  submittedAt: '2026-10-12T09:05:00+07:00',
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  lines: [
    {
      id: E2_IDS.prLine,
      lineNo: 1,
      item: ITEM_REF,
      quantity: '10000.000',
      supplier: null,
      estimatedUnitCost: '2.850000',
      estimatedAmount: '28500.00',
      neededBy: '2026-10-20',
      note: null,
      purchaseOrder: null,
    },
  ],
  nextActions: [
    { key: 'erp_pr.approve', irreversible: false, disabledReason: null },
    { key: 'erp_pr.reject', irreversible: true, disabledReason: null },
  ],
  version: 2,
};

const SAVE_PR = {
  neededBy: '2026-10-20',
  note: 'ใช้กับงาน JOB-2610-0012',
  lines: [{ itemId: ERP_IDS.item, quantity: '10000' }],
};

export const PO_SUMMARY = {
  id: ERP_IDS.po,
  poNo: null,
  status: 'draft',
  supplier: SUPPLIER_REF,
  orderedOn: '2026-10-12',
  expectedOn: '2026-10-19',
  late: false,
  total: '30495.00',
  currency: 'THB',
  lineCount: 1,
  receivedPct: '0.00',
};

const INVOICE_SUMMARY: ErpSupplierInvoiceSummaryDto = {
  id: E2_IDS.invoice,
  docNo: 'AP-2610-0003',
  supplier: SUPPLIER_REF,
  invoiceNo: 'IV-55012',
  invoiceDate: '2026-10-12',
  dueDate: '2026-11-11',
  overdue: false,
  total: '15247.50',
  payableAmount: '14820.00',
  outstanding: '14820.00',
  status: 'matched',
  currency: 'THB',
};

const INVOICE: ErpSupplierInvoiceDto = {
  ...INVOICE_SUMMARY,
  purchaseOrder: { id: ERP_IDS.po, code: 'PO-2610-0007', name: 'PO-2610-0007' },
  taxInvoiceNo: 'IV-55012',
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  subtotal: '14250.00',
  vatAmount: '997.50',
  whtRatePct: '3.0000',
  whtAmount: '427.50',
  paidAmount: '0.00',
  matchNote: null,
  note: null,
  fileId: null,
  approvedAt: null,
  approvedBy: null,
  cancelReason: null,
  createdAt: '2026-10-12T14:30:00+07:00',
  lines: [
    {
      lineNo: 1,
      purchaseOrderLineId: ERP_IDS.poLine,
      item: ITEM_REF,
      description: 'กระดาษคราฟท์ 350 แกรม',
      quantity: '10.000',
      unitPrice: '1425.000000',
      amount: '14250.00',
      receivedQty: '10.000',
      orderedPrice: '1425.000000',
      variance: null,
    },
  ],
  payments: [],
  nextActions: [
    { key: 'erp_ap.pay', irreversible: false, disabledReason: null },
    { key: 'erp_ap.cancel', irreversible: true, disabledReason: null },
  ],
  version: 1,
};

const CREATE_INVOICE = {
  supplierId: ERP_IDS.supplier,
  purchaseOrderId: ERP_IDS.po,
  invoiceNo: 'IV-55012',
  taxInvoiceNo: 'IV-55012',
  invoiceDate: '2026-10-12',
  whtRatePct: '3',
  lines: [{ purchaseOrderLineId: ERP_IDS.poLine, quantity: '10', unitPrice: '1425' }],
};

const PAYMENT: ErpSupplierPaymentDto = {
  id: E2_IDS.payment,
  paymentNo: 'PV-2611-0002',
  supplier: SUPPLIER_REF,
  paidOn: '2026-11-10',
  method: 'transfer',
  reference: 'KBANK 1234',
  amount: '14820.00',
  currency: 'THB',
  note: null,
  reverses: null,
  reversedBy: null,
  allocations: [
    { invoice: { id: E2_IDS.invoice, code: 'AP-2610-0003', name: 'IV-55012' }, amount: '14820.00' },
  ],
  by: 'บัญชี ทดสอบ',
  createdAt: '2026-11-10T10:00:00+07:00',
  nextActions: [{ key: 'erp_pay.reverse', irreversible: true, disabledReason: null }],
};

const BUCKETS = {
  current: '14820.00',
  d1_30: '0.00',
  d31_60: '0.00',
  d61_90: '0.00',
  over90: '0.00',
  total: '14820.00',
};

const RECIPE: ErpRecipeDto = {
  id: E2_IDS.recipe,
  item: PRODUCT_REF,
  name: 'กล่องครีม 30 ml — มาตรฐาน',
  batchQty: '1.000',
  note: null,
  status: 'active',
  materials: [{ lineNo: 1, item: ITEM_REF, quantity: '0.125000', scrapPct: '5.0000' }],
  operations: [
    {
      seq: 10,
      name: 'พิมพ์ออฟเซ็ท 4 สี',
      machine: MACHINE_REF,
      setupMinutes: 30,
      runRatePerHour: '3000.000',
    },
    { seq: 20, name: 'ไดคัท', machine: null, setupMinutes: 20, runRatePerHour: '2500.000' },
  ],
  version: 1,
};

const SAVE_RECIPE = {
  itemId: ERP_IDS.material,
  name: 'กล่องครีม 30 ml — มาตรฐาน',
  batchQty: '1',
  materials: [{ itemId: ERP_IDS.item, quantity: '0.125', scrapPct: '5' }],
  operations: [
    { name: 'พิมพ์ออฟเซ็ท 4 สี', machineId: E2_IDS.machine, setupMinutes: 30, runRatePerHour: '3000' },
    { name: 'ไดคัท', setupMinutes: 20, runRatePerHour: '2500' },
  ],
};

export const MO_SUMMARY: ErpProductionOrderSummaryDto = {
  id: E2_IDS.mo,
  moNo: 'MO-2610-0005',
  source: 'stock',
  title: 'กล่องครีม 30 ml',
  item: PRODUCT_REF,
  quantity: '1000.000',
  unit: 'pcs',
  dueOn: '2026-10-25',
  priority: 0,
  status: 'released',
  late: false,
  progressPct: '0.00',
  short: false,
};

export const OPERATION = {
  id: E2_IDS.moOperation,
  seq: 10,
  name: 'พิมพ์ออฟเซ็ท 4 สี',
  machine: MACHINE_REF,
  plannedMinutes: 50,
  status: 'pending',
  goodQty: '0.000',
  scrapQty: '0.000',
  scheduledStart: '2026-10-20T08:30:00+07:00',
  scheduledEnd: '2026-10-20T09:20:00+07:00',
  locked: false,
  startedAt: null,
  finishedAt: null,
  pausedMinutes: 0,
  actualMinutes: null,
  pauseReason: null,
  milestone: null,
  milestoneSync: 'none',
  milestoneSyncError: null,
};

export const MO: ErpProductionOrderDto = {
  ...MO_SUMMARY,
  job: null,
  recipe: { id: E2_IDS.recipe, code: 'FG-CRM-30', name: 'กล่องครีม 30 ml — มาตรฐาน' },
  plannedStartOn: '2026-10-20',
  warehouse: WAREHOUSE_REF,
  goodQty: '0.000',
  scrapQty: '0.000',
  materialCost: '0.00',
  unitCost: null,
  note: null,
  releasedAt: '2026-10-18T08:00:00+07:00',
  completedAt: null,
  cancelReason: null,
  createdAt: '2026-10-17T10:00:00+07:00',
  materials: [
    {
      id: E2_IDS.moMaterial,
      lineNo: 1,
      item: ITEM_REF,
      requiredQty: '131.579',
      reservedQty: '131.579',
      issuedQty: '0.000',
      remainingQty: '131.579',
      shortQty: '0.000',
      origin: 'recipe',
      note: null,
    },
  ],
  operations: [OPERATION],
  nextActions: [
    { key: 'erp_mo.edit', irreversible: false, disabledReason: null },
    { key: 'erp_mo.issue', irreversible: false, disabledReason: null },
    { key: 'erp_mo.complete', irreversible: true, disabledReason: null },
    { key: 'erp_mo.cancel', irreversible: true, disabledReason: null },
  ],
  version: 2,
};

const CREATE_MO = { source: 'stock', itemId: ERP_IDS.material, quantity: '1000', dueOn: '2026-10-25' };

const MRP_ROW: ErpMrpRowDto = {
  item: ITEM_REF,
  required: '1053.000',
  reserved: '500.000',
  available: '200.000',
  onOrder: '0.000',
  shortage: '353.000',
  toOrderQty: '500.000',
  toOrderPurchaseQty: '1.000',
  purchaseUnit: 'ream',
  supplier: SUPPLIER_REF,
  unitPrice: '1425.000000',
  neededBy: '2026-10-20',
  orders: 2,
};

async function perms(resolver: PermissionResolver, actor: Actor) {
  return permissionsOf(resolver, actor);
}

// ============================================================================= supplier prices

@ApiSurface('partner', 'erpItemSuppliers')
@Controller('factories/:factoryId/erp')
export class PartnerErpItemSuppliersController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly pricing: ErpPricingService,
  ) {}

  @Get('items/:itemId/suppliers')
  @Can('factory_inventory.read')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.list',
    summary: 'Who sells this item',
    description:
      'The item’s suppliers with their own code, unit, minimum order, lead time and latest price, the 12-month ' +
      'price spread, change, on-time rate and the cheapest flag; the preferred one first (D-333 – D-335).',
    implements: ['D-333', 'D-334', 'D-335'],
  })
  @ApiSuccess(200, { description: 'Suppliers of the item', type: [ErpItemSupplierDto], example: [LINK] })
  @ApiStandardErrors('http.not_found')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.pricing.listForItem(await this.workspace.open(actor, factoryId), itemId);
  }

  @Post('items/:itemId/suppliers')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.create',
    summary: 'Add a supplier to an item',
    description:
      'In the unit the supplier sells in; optionally preferred (the item’s default supplier follows) and with a ' +
      'quoted price, recorded as a quotation (D-333, D-334).',
    implements: ['D-333', 'D-334'],
  })
  @ApiBody({
    type: ErpCreateItemSupplierDto,
    examples: {
      default: {
        value: {
          supplierId: ERP_IDS.supplier,
          purchaseUnit: 'ream',
          purchaseFactor: '500',
          price: '1450',
          preferred: false,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Linked', type: ErpItemSupplierDto, example: LINK })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier', 'erp.archived', 'erp.supplier_linked')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ErpCreateItemSupplierDto,
  ) {
    return this.pricing.createLink(await this.workspace.open(actor, factoryId), itemId, body);
  }

  @Patch('items/:itemId/suppliers/:linkId')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.update',
    summary: 'Edit an item’s supplier',
    description:
      'Code, unit (the latest price follows, unchanged per base unit), minimum order, lead time, preferred, ' +
      'archived (D-333).',
    implements: ['D-333'],
  })
  @ApiBody({
    type: ErpUpdateItemSupplierDto,
    examples: { default: { value: { preferred: true, leadTimeDays: 5 } } },
  })
  @ApiSuccess(200, { description: 'Updated', type: ErpItemSupplierDto, example: LINK })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateItemSupplierDto,
  ) {
    return this.pricing.updateLink(
      await this.workspace.open(actor, factoryId),
      itemId,
      linkId,
      ifMatch,
      body,
    );
  }

  @Get('items/:itemId/prices')
  @Can('factory_inventory.read')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.prices',
    summary: 'Price history of an item',
    description:
      'Every price met — received, ordered, quoted, noted — newest first; net, without VAT (D-334).',
    implements: ['D-334'],
  })
  @ApiPaginated(ErpPriceRecordDto, { example: PRICE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async prices(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() q: ErpPriceListQuery,
  ) {
    return this.pricing.history(await this.workspace.open(actor, factoryId), itemId, q);
  }

  @Post('items/:itemId/prices')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.recordPrice',
    summary: 'Note a quoted price',
    description:
      'A quotation (with how long it holds) or a price noted by hand; the supplier’s latest price moves when ' +
      'it is not older than the one it has (D-334).',
    implements: ['D-334'],
  })
  @ApiBody({
    type: ErpRecordPriceDto,
    examples: {
      default: {
        value: {
          supplierId: ERP_IDS.supplier,
          source: 'quotation',
          unitPrice: '1450',
          validUntil: '2026-12-31',
          documentNo: 'QT-6610-120',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Recorded',
    type: ErpPriceRecordDto,
    example: { ...PRICE, source: 'quotation' },
  })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier', 'erp.unit_not_allowed')
  async record(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ErpRecordPriceDto,
  ) {
    return this.pricing.record(await this.workspace.open(actor, factoryId), itemId, body);
  }

  @Get('partners/:partnerId/items')
  @Can('factory_trading_partners.read')
  @factoryParam
  @ApiParam({ name: 'partnerId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.ofSupplier',
    summary: 'What a supplier sells us',
    description: 'The supplier’s items with its latest prices and statistics (D-333, D-334).',
    implements: ['D-333', 'D-334'],
  })
  @ApiSuccess(200, { description: 'Items of the supplier', type: [ErpItemSupplierDto], example: [LINK] })
  @ApiStandardErrors('http.not_found')
  async ofSupplier(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
  ) {
    return this.pricing.listForSupplier(await this.workspace.open(actor, factoryId), partnerId);
  }
}

// =========================================================================== purchase requests

@ApiSurface('partner', 'erpPurchaseRequests')
@Controller('factories/:factoryId/erp/purchase-requests')
export class PartnerErpPurchaseRequestsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly requests: ErpRequestsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_procurement.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.list',
    summary: 'My factory’s purchase requests',
    description: 'Newest first; `status=open` = waiting for approval or approved (D-336).',
    implements: ['D-336'],
  })
  @ApiPaginated(ErpPurchaseRequestSummaryDto, { example: PR_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpPurchaseRequestListQuery,
  ) {
    return this.requests.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_procurement.request')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.create',
    summary: 'Ask to buy',
    description: 'A draft request numbered `PR-YYMM-NNNN`, priced at the suppliers’ latest prices (D-336).',
    implements: ['D-336'],
  })
  @ApiBody({ type: ErpSavePurchaseRequestDto, examples: { default: { value: SAVE_PR } } })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpPurchaseRequestDto,
    example: { ...PR, status: 'draft' },
  })
  @ApiStandardErrors(...WRITE, 'erp.archived', 'erp.not_a_supplier')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSavePurchaseRequestDto,
  ) {
    return this.requests.create(
      await this.workspace.open(actor, factoryId),
      body,
      await perms(this.permissions, actor),
    );
  }

  @Get(':prId')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.get',
    summary: 'One purchase request',
    description: 'Lines with the purchase orders they became and the actions offered (D-336).',
    implements: ['D-336'],
  })
  @ApiSuccess(200, { description: 'The request', type: ErpPurchaseRequestDto, example: PR })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
  ) {
    return this.requests.get(
      await this.workspace.open(actor, factoryId),
      prId,
      await perms(this.permissions, actor),
    );
  }

  @Put(':prId')
  @Can('factory_procurement.request')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.update',
    summary: 'Edit a draft purchase request',
    description: 'Replaces the lines; drafts only (D-336).',
    implements: ['D-336'],
  })
  @ApiBody({ type: ErpSavePurchaseRequestDto, examples: { default: { value: SAVE_PR } } })
  @ApiSuccess(200, {
    description: 'The draft',
    type: ErpPurchaseRequestDto,
    example: { ...PR, status: 'draft' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.archived', 'erp.not_a_supplier')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSavePurchaseRequestDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.requests.update(scope, prId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post(':prId/actions/submit')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.request')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.submit',
    summary: 'Send a purchase request for approval',
    description:
      'Approved at once when the factory switched approval off or the requester may approve purchases (D-336).',
    implements: ['D-336'],
  })
  @ApiSuccess(200, { description: 'Submitted (or approved)', type: ErpPurchaseRequestDto, example: PR })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status')
  async submit(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
  ) {
    return this.requests.submit(
      await this.workspace.open(actor, factoryId),
      prId,
      await perms(this.permissions, actor),
    );
  }

  @Post(':prId/actions/approve')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.approve')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.approve',
    summary: 'Approve a purchase request',
    description: 'With an optional note; audited (D-336).',
    implements: ['D-336'],
  })
  @ApiBody({ type: OptionalNoteDto, examples: { default: { value: { note: 'อนุมัติ ซื้อจากเจ้าประจำ' } } } })
  @ApiSuccess(200, {
    description: 'Approved',
    type: ErpPurchaseRequestDto,
    example: { ...PR, status: 'approved' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async approve(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
    @Body() body: OptionalNoteDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.requests.decide(scope, prId, true, body.note ?? null, await perms(this.permissions, actor));
  }

  @Post(':prId/actions/reject')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.approve')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.reject',
    summary: 'Reject a purchase request',
    description: 'With a reason; audited (D-336).',
    implements: ['D-336'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ยังมีของในคลังพอ' } } } })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: ErpPurchaseRequestDto,
    example: { ...PR, status: 'rejected', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async reject(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.requests.decide(scope, prId, false, body.reason, await perms(this.permissions, actor));
  }

  @Post(':prId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.request')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.cancel',
    summary: 'Cancel a purchase request',
    description: 'A draft, waiting or approved request, with a reason (D-336).',
    implements: ['D-336'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'งานลูกค้ายกเลิก' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpPurchaseRequestDto,
    example: { ...PR, status: 'cancelled', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.requests.cancel(scope, prId, body.reason, await perms(this.permissions, actor));
  }

  @Post(':prId/actions/convert')
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'prId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpPurchaseRequests.convert',
    summary: 'Turn a purchase request into purchase orders',
    description:
      'Draft purchase orders, one per supplier (the line’s or the item’s preferred), in the supplier’s unit ' +
      'rounded to its minimum order, at its latest price; lines without a supplier are returned as skipped (D-335, D-336).',
    implements: ['D-335', 'D-336'],
  })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpDraftFromReorderResultDto,
    example: { created: [PO_SUMMARY], skipped: [] },
  })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status', 'erp.archived', 'erp.unit_not_allowed')
  async convert(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('prId', ParseUUIDPipe) prId: string,
  ) {
    return this.requests.convert(await this.workspace.open(actor, factoryId), prId);
  }
}

// =========================================================================== supplier invoices

@ApiSurface('partner', 'erpSupplierInvoices')
@Controller('factories/:factoryId/erp/supplier-invoices')
export class PartnerErpSupplierInvoicesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly payables: ErpPayablesService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_ap.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.list',
    summary: 'My factory’s supplier invoices',
    description: 'By due date; `status=open` = not paid, `overdue=true` = open and past due (D-337).',
    implements: ['D-337'],
  })
  @ApiPaginated(ErpSupplierInvoiceSummaryDto, { example: INVOICE_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpSupplierInvoiceListQuery,
  ) {
    return this.payables.listInvoices(await this.workspace.open(actor, factoryId), q);
  }

  @Get('aging')
  @Can('factory_ap.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.aging',
    summary: 'What I owe suppliers, by age',
    description:
      'Open amounts per supplier: not yet due, 1–30, 31–60, 61–90 and over 90 days past due (D-338).',
    implements: ['D-338'],
  })
  @ApiSuccess(200, {
    description: 'Aging',
    type: ErpApAgingDto,
    example: {
      asOf: '2026-10-15',
      currency: 'THB',
      dueSoon: '0.00',
      totals: BUCKETS,
      suppliers: [{ supplier: SUPPLIER_REF, invoices: 1, buckets: BUCKETS }],
    },
  })
  @ApiStandardErrors('http.not_found')
  async aging(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.payables.aging(await this.workspace.open(actor, factoryId));
  }

  @Post()
  @Can('factory_ap.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.create',
    summary: 'Record a supplier invoice',
    description:
      'Numbered `AP-YYMM-NNNN` and matched 3-way: each line against its purchase-order line — quantity within what ' +
      'was received, net price within the tolerance — `matched` is payable, `variance` waits for approval; ' +
      'withholding tax on the amount before VAT; due date from the supplier’s credit days (D-337).',
    implements: ['D-337'],
  })
  @ApiBody({ type: ErpCreateSupplierInvoiceDto, examples: { default: { value: CREATE_INVOICE } } })
  @ApiSuccess(201, { description: 'Recorded', type: ErpSupplierInvoiceDto, example: INVOICE })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier', 'erp.invalid_status', 'erp.invoice_duplicate')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateSupplierInvoiceDto,
  ) {
    return this.payables.createInvoice(
      await this.workspace.open(actor, factoryId),
      body,
      await perms(this.permissions, actor),
    );
  }

  @Get(':invoiceId')
  @Can('factory_ap.read')
  @factoryParam
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.get',
    summary: 'One supplier invoice',
    description: 'Lines with what was received and ordered, the match result, payments and actions (D-337).',
    implements: ['D-337'],
  })
  @ApiSuccess(200, { description: 'The invoice', type: ErpSupplierInvoiceDto, example: INVOICE })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.payables.getInvoice(
      await this.workspace.open(actor, factoryId),
      invoiceId,
      await perms(this.permissions, actor),
    );
  }

  @Post(':invoiceId/actions/approve')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_ap.approve')
  @factoryParam
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.approve',
    summary: 'Approve an invoice that did not match',
    description: 'It can then be paid; audited with the match note (D-337).',
    implements: ['D-337'],
  })
  @ApiBody({
    type: OptionalNoteDto,
    examples: { default: { value: { note: 'ผู้ขายปรับราคาตามใบเสนอราคาใหม่' } } },
  })
  @ApiSuccess(200, {
    description: 'Approved',
    type: ErpSupplierInvoiceDto,
    example: { ...INVOICE, status: 'approved' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async approve(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: OptionalNoteDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.payables.approveInvoice(
      scope,
      invoiceId,
      body.note ?? null,
      await perms(this.permissions, actor),
    );
  }

  @Post(':invoiceId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_ap.manage')
  @factoryParam
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSupplierInvoices.cancel',
    summary: 'Cancel a supplier invoice',
    description: 'Only while nothing is paid on it; with a reason (D-337).',
    implements: ['D-337'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'บันทึกซ้ำ' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpSupplierInvoiceDto,
    example: { ...INVOICE, status: 'cancelled', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.payables.cancelInvoice(scope, invoiceId, body.reason, await perms(this.permissions, actor));
  }
}

// =========================================================================== supplier payments

@ApiSurface('partner', 'erpSupplierPayments')
@Controller('factories/:factoryId/erp/supplier-payments')
export class PartnerErpSupplierPaymentsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly payables: ErpPayablesService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_ap.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSupplierPayments.list',
    summary: 'My factory’s supplier payments',
    description: 'Newest first, with their allocations and reversals (D-338).',
    implements: ['D-338'],
  })
  @ApiPaginated(ErpSupplierPaymentDto, { example: PAYMENT })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpSupplierPaymentListQuery,
  ) {
    return this.payables.listPayments(
      await this.workspace.open(actor, factoryId),
      q,
      await perms(this.permissions, actor),
    );
  }

  @Post()
  @Idempotent()
  @Can('factory_ap.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSupplierPayments.create',
    summary: 'Pay a supplier',
    description:
      'Numbered `PV-YYMM-NNNN`, allocated to the supplier’s payable invoices — none beyond what is open; audited (D-338).',
    implements: ['D-338'],
  })
  @ApiBody({
    type: ErpCreateSupplierPaymentDto,
    examples: {
      default: {
        value: {
          supplierId: ERP_IDS.supplier,
          method: 'transfer',
          reference: 'KBANK 1234',
          allocations: [{ supplierInvoiceId: E2_IDS.invoice, amount: '14820' }],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Paid', type: ErpSupplierPaymentDto, example: PAYMENT })
  @ApiStandardErrors(...WRITE, 'erp.invoice_not_payable', 'erp.overpayment')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateSupplierPaymentDto,
  ) {
    return this.payables.pay(
      await this.workspace.open(actor, factoryId),
      body,
      await perms(this.permissions, actor),
    );
  }

  @Get(':paymentId')
  @Can('factory_ap.read')
  @factoryParam
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSupplierPayments.get',
    summary: 'One supplier payment',
    description: 'With its allocations, reversal and actions (D-338).',
    implements: ['D-338'],
  })
  @ApiSuccess(200, { description: 'The payment', type: ErpSupplierPaymentDto, example: PAYMENT })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.payables.getPayment(
      await this.workspace.open(actor, factoryId),
      paymentId,
      await perms(this.permissions, actor),
    );
  }

  @Post(':paymentId/actions/reverse')
  @Idempotent()
  @Can('factory_ap.manage')
  @factoryParam
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSupplierPayments.reverse',
    summary: 'Reverse a supplier payment',
    description:
      'A negative payment names the wrong one and its invoices are open again; nothing is edited or deleted (D-338).',
    implements: ['D-338'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'โอนผิดบัญชี โอนใหม่แล้ว' } } } })
  @ApiSuccess(201, {
    description: 'The reversal',
    type: ErpSupplierPaymentDto,
    example: {
      ...PAYMENT,
      id: E2_IDS.price,
      paymentNo: 'PV-2611-0003',
      amount: '-14820.00',
      reverses: { id: E2_IDS.payment, code: 'PV-2611-0002', name: 'PV-2611-0002' },
      allocations: [
        { invoice: { id: E2_IDS.invoice, code: 'AP-2610-0003', name: 'IV-55012' }, amount: '-14820.00' },
      ],
      nextActions: [],
    },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async reverse(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.payables.reverse(scope, paymentId, body.reason, await perms(this.permissions, actor));
  }
}

// ==================================================================================== recipes

@ApiSurface('partner', 'erpRecipes')
@Controller('factories/:factoryId/erp/recipes')
export class PartnerErpRecipesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly production: ErpProductionService,
  ) {}

  @Get()
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpRecipes.list',
    summary: 'My factory’s recipes',
    description: 'Active first; by product or name (D-339).',
    implements: ['D-339'],
  })
  @ApiPaginated(ErpRecipeDto, { example: RECIPE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpRecipeListQuery,
  ) {
    return this.production.listRecipes(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_planning.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRecipes.create',
    summary: 'Write a recipe',
    description:
      'Materials per batch with their scrap %, and the operations on the factory’s machines (D-339).',
    implements: ['D-339'],
  })
  @ApiBody({ type: ErpSaveRecipeDto, examples: { default: { value: SAVE_RECIPE } } })
  @ApiSuccess(201, { description: 'Created', type: ErpRecipeDto, example: RECIPE })
  @ApiStandardErrors(...WRITE, 'erp.archived')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSaveRecipeDto,
  ) {
    return this.production.createRecipe(await this.workspace.open(actor, factoryId), body);
  }

  @Get(':recipeId')
  @Can('factory_planning.read')
  @factoryParam
  @ApiParam({ name: 'recipeId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRecipes.get',
    summary: 'One recipe',
    description: 'Materials and operations (D-339).',
    implements: ['D-339'],
  })
  @ApiSuccess(200, { description: 'The recipe', type: ErpRecipeDto, example: RECIPE })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.production.getRecipe(await this.workspace.open(actor, factoryId), recipeId);
  }

  @Put(':recipeId')
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'recipeId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRecipes.update',
    summary: 'Edit a recipe',
    description: 'Replaces its materials and operations; orders already planned keep theirs (D-339).',
    implements: ['D-339'],
  })
  @ApiBody({ type: ErpSaveRecipeDto, examples: { default: { value: SAVE_RECIPE } } })
  @ApiSuccess(200, { description: 'Updated', type: ErpRecipeDto, example: RECIPE })
  @ApiStandardErrors(...WRITE, 'erp.archived')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveRecipeDto,
  ) {
    return this.production.updateRecipe(await this.workspace.open(actor, factoryId), recipeId, ifMatch, body);
  }
}

// ========================================================================== production orders

@ApiSurface('partner', 'erpProductionOrders')
@Controller('factories/:factoryId/erp/production-orders')
export class PartnerErpProductionOrdersController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly production: ErpProductionService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.list',
    summary: 'My factory’s production orders',
    description: 'By priority then due date; `status=open` = planned, released or in progress (D-340).',
    implements: ['D-340'],
  })
  @ApiPaginated(ErpProductionOrderSummaryDto, { example: MO_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpProductionOrderListQuery,
  ) {
    return this.production.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_planning.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.create',
    summary: 'Plan a production order',
    description:
      'For stock or a sales order; numbered `MO-YYMM-NNNN`; materials and operations from the product’s recipe ' +
      'scaled to the quantity, unless given (D-339, D-340). Packio jobs become orders on their own when accepted.',
    implements: ['D-339', 'D-340'],
  })
  @ApiBody({ type: ErpCreateProductionOrderDto, examples: { default: { value: CREATE_MO } } })
  @ApiSuccess(201, {
    description: 'Planned',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'planned' },
  })
  @ApiStandardErrors(...WRITE, 'erp.archived')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateProductionOrderDto,
  ) {
    return this.production.create(
      await this.workspace.open(actor, factoryId),
      body,
      await perms(this.permissions, actor),
    );
  }

  @Get(':moId')
  @Can('factory_planning.read')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.get',
    summary: 'One production order',
    description:
      'Materials with what is reserved, issued and short, operations, cost and actions (D-340, D-341).',
    implements: ['D-340', 'D-341'],
  })
  @ApiSuccess(200, { description: 'The order', type: ErpProductionOrderDto, example: MO })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
  ) {
    return this.production.get(
      await this.workspace.open(actor, factoryId),
      moId,
      await perms(this.permissions, actor),
    );
  }

  @Patch(':moId')
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.update',
    summary: 'Re-plan a production order',
    description:
      'Title, dates and priority while open; quantity, materials and operations only while planned (D-340).',
    implements: ['D-340'],
  })
  @ApiBody({
    type: ErpUpdateProductionOrderDto,
    examples: { default: { value: { priority: 5, dueOn: '2026-10-24' } } },
  })
  @ApiSuccess(200, { description: 'Updated', type: ErpProductionOrderDto, example: MO })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.archived')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateProductionOrderDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.update(scope, moId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post(':moId/actions/release')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.release',
    summary: 'Release a production order to the floor',
    description:
      'Reserves each material in the order’s warehouse, as much as is free; the rest shows as short (D-341).',
    implements: ['D-341'],
  })
  @ApiSuccess(200, { description: 'Released', type: ErpProductionOrderDto, example: MO })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status')
  async release(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
  ) {
    return this.production.release(
      await this.workspace.open(actor, factoryId),
      moId,
      await perms(this.permissions, actor),
    );
  }

  @Post(':moId/actions/issue')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.issue',
    summary: 'Issue materials to a production order',
    description:
      'The lines given, or every material’s remaining quantity; the reserved part first, the rest from free stock (D-322, D-341).',
    implements: ['D-322', 'D-341'],
  })
  @ApiBody({ type: ErpMaterialMoveDto, examples: { default: { value: {} } } })
  @ApiSuccess(200, {
    description: 'Issued',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'in_progress' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'erp.invalid_status',
    'erp.stock_insufficient',
    'erp.lot_required',
    'erp.nothing_to_issue',
  )
  async issue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Body() body: ErpMaterialMoveDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.issue(scope, moId, body, await perms(this.permissions, actor));
  }

  @Post(':moId/actions/return')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_inventory.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.returnMaterials',
    summary: 'Return unused materials',
    description: 'Back into the order’s warehouse at the average cost (D-341).',
    implements: ['D-341'],
  })
  @ApiBody({
    type: ErpMaterialMoveDto,
    examples: { default: { value: { lines: [{ materialId: E2_IDS.moMaterial, quantity: '20' }] } } },
  })
  @ApiSuccess(200, {
    description: 'Returned',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'in_progress' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.lot_required')
  async returnMaterials(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Body() body: ErpMaterialMoveDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.returnMaterials(scope, moId, body, await perms(this.permissions, actor));
  }

  @Post(':moId/actions/complete')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.complete',
    summary: 'Complete a production order',
    description:
      'Releases what is still reserved; a stocked product comes in at the materials consumed per good unit (D-341).',
    implements: ['D-341'],
  })
  @ApiBody({
    type: ErpCompleteProductionDto,
    examples: { default: { value: { goodQty: '980', scrapQty: '20' } } },
  })
  @ApiSuccess(200, {
    description: 'Completed',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'completed', goodQty: '980.000', scrapQty: '20.000', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async complete(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Body() body: ErpCompleteProductionDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.complete(scope, moId, body, await perms(this.permissions, actor));
  }

  @Post(':moId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.cancel',
    summary: 'Cancel a production order',
    description: 'Nothing may be issued (return it first); reservations are released (D-341).',
    implements: ['D-341'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ลูกค้ายกเลิกคำสั่งซื้อ' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'cancelled', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.materials_issued')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.cancel(scope, moId, body.reason, await perms(this.permissions, actor));
  }

  @Post(':moId/operations/:operationId/actions/start')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_production.record')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.startOperation',
    summary: 'Start an operation',
    description: 'On the floor; the order is in progress from its first operation (D-341).',
    implements: ['D-341'],
  })
  @ApiSuccess(200, {
    description: 'Started',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'in_progress' },
  })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status', 'erp.machine_down')
  async start(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.operation(
      scope,
      moId,
      operationId,
      'start',
      {},
      await perms(this.permissions, actor),
    );
  }

  @Post(':moId/operations/:operationId/actions/finish')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_production.record')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.finishOperation',
    summary: 'Finish an operation',
    description: 'With the good and scrap pieces of the step; default good = the order quantity (D-341).',
    implements: ['D-341'],
  })
  @ApiBody({
    type: ErpFinishOperationDto,
    examples: { default: { value: { goodQty: '1000', scrapQty: '12' } } },
  })
  @ApiSuccess(200, {
    description: 'Finished',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'in_progress' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async finish(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() body: ErpFinishOperationDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.operate(
      scope,
      moId,
      operationId,
      'finish',
      body,
      await perms(this.permissions, actor),
    );
  }

  @Post(':moId/operations/:operationId/actions/skip')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_production.record')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpProductionOrders.skipOperation',
    summary: 'Skip an operation',
    description: 'A step this order does not need (D-341).',
    implements: ['D-341'],
  })
  @ApiSuccess(200, {
    description: 'Skipped',
    type: ErpProductionOrderDto,
    example: { ...MO, status: 'in_progress' },
  })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status')
  async skip(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.operation(
      scope,
      moId,
      operationId,
      'skip',
      {},
      await perms(this.permissions, actor),
    );
  }
}

// ==================================================================================== planning

@ApiSurface('partner', 'erpPlanning')
@Controller('factories/:factoryId/erp/planning')
export class PartnerErpPlanningController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly production: ErpProductionService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('overview')
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPlanning.overview',
    summary: 'The planning board header',
    description:
      'Open orders by status, late and due this week, items short, and the load on each machine (D-342).',
    implements: ['D-342'],
  })
  @ApiSuccess(200, {
    description: 'Overview',
    type: ErpPlanningOverviewDto,
    example: {
      planned: 2,
      released: 3,
      inProgress: 1,
      late: 1,
      dueThisWeek: 2,
      shortItems: 1,
      machines: [{ machine: MACHINE_REF, operations: 3, plannedMinutes: 420 }],
    },
  })
  @ApiStandardErrors('http.not_found')
  async overview(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.production.overview(await this.workspace.open(actor, factoryId));
  }

  @Get('queue')
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPlanning.queue',
    summary: 'The floor queue',
    description:
      'Operations still to do on released orders, most urgent first; one machine’s with `machineId` (D-341).',
    implements: ['D-341'],
  })
  @ApiSuccess(200, {
    description: 'Queue',
    type: [ErpOperationQueueItemDto],
    example: [{ operation: OPERATION, order: MO_SUMMARY }],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async queue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpOperationQueueQuery,
  ) {
    return this.production.queue(await this.workspace.open(actor, factoryId), q.machineId);
  }

  @Get('mrp')
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPlanning.mrp',
    summary: 'What production is short of',
    description:
      'Per material: still needed by open orders against reserved, free, on order and already requested; the ' +
      'shortage rounded to the preferred supplier’s unit and minimum order (D-335, D-342).',
    implements: ['D-335', 'D-342'],
  })
  @ApiSuccess(200, { description: 'Shortages', type: [ErpMrpRowDto], example: [MRP_ROW] })
  @ApiStandardErrors('http.not_found')
  async mrp(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.production.mrp(await this.workspace.open(actor, factoryId));
  }

  @Post('mrp/actions/request')
  @Idempotent()
  @Can('factory_procurement.request')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpPlanning.requestShortages',
    summary: 'Ask to buy what production is short of',
    description: 'One purchase request (source `mrp`) for the chosen shortages (D-336, D-342).',
    implements: ['D-336', 'D-342'],
  })
  @ApiBody({ type: ErpDraftFromReorderDto, examples: { default: { value: { itemIds: [ERP_IDS.item] } } } })
  @ApiSuccess(201, {
    description: 'Requested',
    type: ErpPurchaseRequestDto,
    example: { ...PR, source: 'mrp', status: 'draft' },
  })
  @ApiStandardErrors(...WRITE, 'erp.nothing_to_request', 'erp.archived')
  async request(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpDraftFromReorderDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.requestShortages(scope, body.itemIds, await perms(this.permissions, actor));
  }
}
