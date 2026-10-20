import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { CreateMachineDto, UpdateMachineDto } from '@modules/partners/capability/capability.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
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
import { FILE_TEXT_STATE_EXAMPLE } from '@platform/file-search/file-search.examples';

import { GR } from './erp.controllers';
import { ERP_IDS, ErpChargeInput, ErpDraftFromReorderResultDto, ErpGoodsReceiptDto } from './erp.dto';
import { ErpAlertsService } from './erp-alerts.service';
import { ErpDocsService } from './erp-docs.service';
import { LINK, MO, OPERATION, PO_SUMMARY } from './erp-e2.controllers';
import { E2_IDS, ErpItemSupplierDto, ErpProductionOrderDto } from './erp-e2.dto';
import {
  E3_IDS,
  ErpAddDocVersionDto,
  ErpAlertCountDto,
  ErpAlertDto,
  ErpAlertListQuery,
  ErpApproveSupplierDto,
  ErpAutoPlanResultDto,
  ErpAwardRfqDto,
  ErpCreateDocDto,
  ErpDispatchDto,
  ErpDispatchQuery,
  ErpDocDto,
  ErpDocFolderDto,
  ErpDocListQuery,
  ErpDocSummaryDto,
  ErpFinishMaintenanceDto,
  ErpLockOperationDto,
  ErpMachineDto,
  ErpMaintenanceListQuery,
  ErpMaintenanceOrderDto,
  ErpMaintenanceOrderSummaryDto,
  ErpMaintenancePartsDto,
  ErpMaintenancePlanDto,
  ErpMoveOperationDto,
  ErpOperationEventDto,
  ErpPauseOperationDto,
  ErpRecordQuoteDto,
  ErpReportBreakdownDto,
  ErpRfqComparisonDto,
  ErpRfqDto,
  ErpRfqListQuery,
  ErpRfqSummaryDto,
  ErpSaveFolderDto,
  ErpSaveMaintenancePlanDto,
  ErpSavePriceBreaksDto,
  ErpSaveRfqDto,
  ErpScheduleDto,
  ErpScheduleMaintenanceDto,
  ErpScheduleQuery,
  ErpScheduleSlotDto,
  ErpSupplierScorecardDto,
  ErpUpdateDocDto,
} from './erp-e3.dto';
import { ErpMaintenanceService } from './erp-maintenance.service';
import { ErpPricingService } from './erp-pricing.service';
import { ErpProductionService } from './erp-production.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpScheduleService } from './erp-schedule.service';
import { ErpSourcingService } from './erp-sourcing.service';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * getpack Factory ERP E2.1 + E3 (docs/prompts/E1-factory-erp.md §10): quantity breaks, supplier approval and
 * scores, landed charges, alerts, requests for quotation; machines, the schedule, the shop-floor kiosk,
 * maintenance and documents — under `/v1/partner/factories/{factoryId}/erp/*`, factory-private (D-317).
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
const MACHINE_REF = { id: E2_IDS.machine, name: 'Heidelberg SM 74 (ทดสอบ)' };
const ACTION = (key: string, irreversible = false) => ({ key, irreversible, disabledReason: null });

// ----------------------------------------------------------------------------------- examples

const SCORECARD: ErpSupplierScorecardDto = {
  ...LINK.score,
  supplier: SUPPLIER_REF,
  approvedItems: 4,
  pendingItems: 1,
  rejections: [
    {
      goodsReceipt: { id: ERP_IDS.gr, code: 'GR-2610-0003', name: 'GR-2610-0003' },
      receivedOn: '2026-10-12',
      item: ITEM_REF,
      rejectedQuantity: '2.000',
      unit: 'ream',
      reason: 'กระดาษชื้น ขอบยับ',
    },
  ],
};

const ALERT: ErpAlertDto = {
  id: E3_IDS.alert,
  kind: 'price_rise',
  status: 'open',
  subjectType: 'item',
  subjectId: ERP_IDS.item,
  payload: {
    item: 'กระดาษคราฟท์ 350 แกรม',
    sku: 'PAP-KA-350',
    supplier: 'บจก. กระดาษไทย (ทดสอบ)',
    changePct: '7.02',
    price: '3.050000',
    previous: '2.850000',
    unit: 'sheet',
    documentNo: 'GR-2610-0004',
  },
  dueOn: null,
  createdAt: '2026-10-12T14:02:00+07:00',
  acknowledgedAt: null,
  acknowledgedBy: null,
};

const RFQ_SUMMARY: ErpRfqSummaryDto = {
  id: E3_IDS.rfq,
  rfqNo: 'RFQ-2610-0002',
  status: 'sent',
  title: 'กระดาษคราฟท์ ไตรมาส 4',
  quoteBy: '2026-10-16',
  neededBy: '2026-10-25',
  lineCount: 1,
  supplierCount: 2,
  answered: 1,
  createdBy: 'จัดซื้อ ทดสอบ',
  createdAt: '2026-10-12T09:00:00+07:00',
};

const RFQ_LINE = { id: E3_IDS.rfqLine, lineNo: 1, item: ITEM_REF, quantity: '25000.000', note: null };

const RFQ: ErpRfqDto = {
  ...RFQ_SUMMARY,
  note: 'ส่งราคารวมค่าขนส่งถึงโรงงาน',
  purchaseRequest: null,
  sentAt: '2026-10-12T09:30:00+07:00',
  awardedAt: null,
  cancelReason: null,
  lines: [RFQ_LINE],
  suppliers: [
    {
      id: E3_IDS.rfqSupplier,
      supplier: SUPPLIER_REF,
      status: 'quoted',
      respondedOn: '2026-10-14',
      reference: 'QT-6610-220',
      note: null,
      quotes: [
        {
          id: E3_IDS.rfqQuote,
          rfqLineId: E3_IDS.rfqLine,
          unit: 'ream',
          factor: '500.000000',
          unitPrice: '1390.000000',
          baseUnitPrice: '2.780000',
          minOrderQty: '10.000',
          leadTimeDays: 5,
          validUntil: '2026-11-30',
          note: null,
          awarded: false,
          purchaseOrder: null,
        },
      ],
    },
  ],
  nextActions: [ACTION('erp_rfq.record'), ACTION('erp_rfq.award', true), ACTION('erp_rfq.cancel', true)],
  version: 3,
};

const SAVE_RFQ = {
  title: 'กระดาษคราฟท์ ไตรมาส 4',
  quoteBy: '2026-10-16',
  lines: [{ itemId: ERP_IDS.item, quantity: '25000' }],
  supplierIds: [ERP_IDS.supplier],
};

const COMPARISON: ErpRfqComparisonDto = {
  rfq: RFQ_SUMMARY,
  lines: [
    {
      line: RFQ_LINE,
      offers: [
        {
          quoteId: E3_IDS.rfqQuote,
          supplier: SUPPLIER_REF,
          unit: 'ream',
          unitPrice: '1390.000000',
          baseUnitPrice: '2.780000',
          orderQty: '50.000',
          orderBaseQty: '25000.000',
          amount: '69500.00',
          leadTimeDays: 5,
          validUntil: '2026-11-30',
          expired: false,
          approval: 'approved',
          score: '92.73',
          grade: 'B',
          cheapest: true,
          fastest: true,
          awarded: false,
        },
      ],
    },
  ],
  cheapestTotal: '69500.00',
};

const SLOT: ErpScheduleSlotDto = {
  operationId: E2_IDS.moOperation,
  seq: 10,
  name: 'พิมพ์ออฟเซ็ท 4 สี',
  order: {
    id: E2_IDS.mo,
    moNo: 'MO-2610-0005',
    title: 'กล่องครีม 30 ml',
    priority: 5,
    dueOn: '2026-10-20',
    status: 'released',
  },
  status: 'pending',
  start: '2026-10-13T08:30:00+07:00',
  end: '2026-10-13T09:20:00+07:00',
  locked: false,
  plannedMinutes: 50,
  late: false,
};

const MAINTENANCE_REF = {
  id: E3_IDS.mt,
  mtNo: 'MT-2610-0003',
  title: 'ลูกกลิ้งหมึกมีเสียงดัง',
  status: 'open',
  priority: 'high',
};

const MACHINE: ErpMachineDto = {
  id: E2_IDS.machine,
  name: 'Heidelberg SM 74 (ทดสอบ)',
  details: 'ออฟเซ็ท 4 สี',
  maxWidthMm: 520,
  maxLengthMm: 740,
  status: 'active',
  state: 'running',
  running: {
    operation: { ...OPERATION, status: 'in_progress', startedAt: '2026-10-13T08:32:00+07:00' },
    order: MO,
  },
  queued: 3,
  openMaintenance: null,
  plans: [
    {
      planId: E3_IDS.plan,
      title: 'ล้างระบบหมึก + อัดจาระบี',
      daysLeft: 4,
      impressionsLeft: 120000,
      due: false,
    },
  ],
  impressions30d: '182000',
};

const SCHEDULE: ErpScheduleDto = {
  from: '2026-10-13T00:00:00+07:00',
  to: '2026-10-20T00:00:00+07:00',
  hours: { '2026-10-13': { from: '08:00', to: '17:00' }, '2026-10-18': null },
  machines: [
    {
      machine: MACHINE_REF,
      state: 'running',
      slots: [SLOT],
      blocks: [
        {
          maintenanceOrder: { id: E3_IDS.mt, code: 'MT-2610-0004', name: 'ล้างระบบหมึก' },
          kind: 'preventive',
          start: '2026-10-14T13:00:00+07:00',
          end: '2026-10-14T15:00:00+07:00',
        },
      ],
      loadMinutes: 50,
    },
  ],
  unassigned: [],
  unscheduled: 0,
};

const EVENT: ErpOperationEventDto = {
  id: E3_IDS.event,
  kind: 'pause',
  reason: 'material_shortage',
  note: 'รอกระดาษจากคลัง',
  goodQty: null,
  scrapQty: null,
  at: '2026-10-13T09:02:00+07:00',
  by: 'ช่างพิมพ์ ทดสอบ',
};

const PLAN: ErpMaintenancePlanDto = {
  id: E3_IDS.plan,
  machine: MACHINE_REF,
  title: 'ล้างระบบหมึก + อัดจาระบี',
  instructions: '1) ล้างลูกกลิ้ง 2) อัดจาระบีจุด A–F',
  everyDays: 30,
  everyImpressions: 500000,
  durationMinutes: 120,
  lastDoneAt: '2026-09-15T16:00:00+07:00',
  daysLeft: 4,
  impressionsLeft: 120000,
  due: false,
  parts: [{ item: ITEM_REF, quantity: '1.000' }],
  status: 'active',
  openOrder: null,
  version: 1,
};

const SAVE_PLAN = {
  machineId: E2_IDS.machine,
  title: 'ล้างระบบหมึก + อัดจาระบี',
  everyDays: 30,
  everyImpressions: 500000,
  durationMinutes: 120,
};

const MT_SUMMARY: ErpMaintenanceOrderSummaryDto = {
  ...MAINTENANCE_REF,
  kind: 'breakdown',
  machine: MACHINE_REF,
  reportedAt: '2026-10-13T09:05:00+07:00',
  reportedBy: 'ช่างพิมพ์ ทดสอบ',
  scheduledStart: null,
  scheduledEnd: null,
  downtimeMinutes: null,
};

const MT: ErpMaintenanceOrderDto = {
  ...MT_SUMMARY,
  description: 'เสียงดังจากชุดหมึกหน่วยที่ 3',
  plan: null,
  instructions: null,
  startedAt: null,
  finishedAt: null,
  resolution: null,
  cancelReason: null,
  photos: [{ fileId: E3_IDS.file, name: 'roller.jpg', mimeType: 'image/jpeg' }],
  parts: [],
  partsValue: '0.00',
  plannedParts: [],
  nextActions: [
    ACTION('erp_mt.schedule'),
    ACTION('erp_mt.start'),
    ACTION('erp_mt.parts'),
    ACTION('erp_mt.finish', true),
    ACTION('erp_mt.cancel', true),
  ],
  version: 1,
};

const FOLDER: ErpDocFolderDto = { id: E3_IDS.folder, name: 'ใบรับรอง', parentId: null, docCount: 4 };
const FILE = {
  id: E3_IDS.file,
  name: 'FSC-certificate-2026.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 284311,
  text: FILE_TEXT_STATE_EXAMPLE,
};
const DOC_SUMMARY: ErpDocSummaryDto = {
  id: E3_IDS.doc,
  title: 'ใบรับรอง FSC — กระดาษไทย',
  category: 'certificate',
  tags: ['FSC'],
  folder: FOLDER,
  link: { type: 'trading_partner', id: ERP_IDS.supplier, label: 'S0001 · บจก. กระดาษไทย (ทดสอบ)' },
  expiresOn: '2027-03-31',
  expiry: 'valid',
  currentVersion: 1,
  file: FILE,
  status: 'active',
  updatedAt: '2026-10-12T10:00:00+07:00',
};
const DOC: ErpDocDto = {
  ...DOC_SUMMARY,
  note: null,
  remindDays: 30,
  versions: [
    {
      id: E3_IDS.docVersion,
      version: 1,
      file: FILE,
      note: null,
      createdAt: '2026-10-12T10:00:00+07:00',
      by: 'เจ้าของ ทดสอบ',
    },
  ],
  version: 1,
};

async function perms(resolver: PermissionResolver, actor: Actor) {
  return permissionsOf(resolver, actor);
}

// ===================================================================== sourcing (D-346, D-349 – D-351)

@ApiSurface('partner', 'erpItemSuppliers')
@Controller('factories/:factoryId/erp')
export class PartnerErpSourcingController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly pricing: ErpPricingService,
    private readonly purchasing: ErpPurchasingService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Put('items/:itemId/suppliers/:linkId/price-breaks')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.saveBreaks',
    summary: 'Set a supplier’s quantity breaks',
    description:
      'Replaces the breaks (from a minimum in the supplier’s unit, a net price per that unit) with an optional ' +
      'date they hold until; each is kept in the price history as a quotation (D-346).',
    implements: ['D-346', 'D-334'],
  })
  @ApiBody({
    type: ErpSavePriceBreaksDto,
    examples: {
      default: {
        value: {
          breaks: [
            { minQty: '10', unitPrice: '1425' },
            { minQty: '50', unitPrice: '1380' },
          ],
          validUntil: '2026-12-31',
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Saved', type: ErpItemSupplierDto, example: LINK })
  @ApiStandardErrors(...WRITE)
  async saveBreaks(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSavePriceBreaksDto,
  ) {
    return this.pricing.saveBreaks(
      await this.workspace.open(actor, factoryId),
      itemId,
      linkId,
      ifMatch,
      body,
    );
  }

  @Post('items/:itemId/suppliers/:linkId/actions/approve')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.approve')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.approve',
    summary: 'Approve a supplier for an item',
    description: 'On the approved supplier list, with a note and an optional review date; audited (D-351).',
    implements: ['D-351'],
  })
  @ApiBody({
    type: ErpApproveSupplierDto,
    examples: { default: { value: { note: 'ผ่านการตรวจโรงงาน', reviewOn: '2027-10-01' } } },
  })
  @ApiSuccess(200, { description: 'Approved', type: ErpItemSupplierDto, example: LINK })
  @ApiStandardErrors(...WRITE)
  async approve(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: ErpApproveSupplierDto,
  ) {
    return this.pricing.decideApproval(
      await this.workspace.open(actor, factoryId),
      itemId,
      linkId,
      'approved',
      body,
    );
  }

  @Post('items/:itemId/suppliers/:linkId/actions/suspend')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.approve')
  @factoryParam
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.suspend',
    summary: 'Suspend a supplier for an item',
    description: 'Off the approved list with a reason (no longer preferred); audited (D-351).',
    implements: ['D-351'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ของเสียซ้ำ 3 ครั้ง' } } } })
  @ApiSuccess(200, {
    description: 'Suspended',
    type: ErpItemSupplierDto,
    example: { ...LINK, approval: 'suspended', preferred: false },
  })
  @ApiStandardErrors(...WRITE)
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: ReasonDto,
  ) {
    return this.pricing.decideApproval(
      await this.workspace.open(actor, factoryId),
      itemId,
      linkId,
      'suspended',
      {
        note: body.reason,
      },
    );
  }

  @Get('partners/:partnerId/scorecard')
  @Can('factory_trading_partners.read')
  @factoryParam
  @ApiParam({ name: 'partnerId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.scorecard',
    summary: 'A supplier’s scorecard',
    description:
      '12 months: quality (accepted ÷ delivered value), on time, score and grade, approved and pending items and ' +
      'the latest rejections (D-349, D-351).',
    implements: ['D-349', 'D-351'],
  })
  @ApiSuccess(200, { description: 'The scorecard', type: ErpSupplierScorecardDto, example: SCORECARD })
  @ApiStandardErrors('http.not_found')
  async scorecard(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
  ) {
    return this.pricing.scorecard(await this.workspace.open(actor, factoryId), partnerId);
  }

  @Post('goods-receipts/:grId/charges')
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'grId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpItemSuppliers.addCharge',
    summary: 'Add a landed charge to a goods receipt',
    description:
      'Freight, duty, ... that came after the receipt: split by value or quantity over its lines; what is still ' +
      'on hand of each line is revalued (a `landed_cost` movement), the rest is reported as not absorbed (D-350).',
    implements: ['D-350'],
  })
  @ApiBody({
    type: ErpChargeInput,
    examples: { default: { value: { kind: 'freight', amount: '1200', reference: 'INV-TR-0912' } } },
  })
  @ApiSuccess(201, { description: 'Added', type: ErpGoodsReceiptDto, example: GR })
  @ApiStandardErrors(...WRITE)
  async addCharge(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('grId', ParseUUIDPipe) grId: string,
    @Body() body: ErpChargeInput,
  ) {
    return this.purchasing.addCharge(
      await this.workspace.open(actor, factoryId),
      grId,
      body,
      await perms(this.permissions, actor),
    );
  }
}

// ================================================================================= alerts (D-347, D-358)

@ApiSurface('partner', 'erpAlerts')
@Controller('factories/:factoryId/erp/alerts')
export class PartnerErpAlertsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly alerts: ErpAlertsService,
  ) {}

  @Get()
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpAlerts.list',
    summary: 'My factory’s ERP alerts',
    description:
      'Price rises, quotations and supplier reviews ending, maintenance due, breakdowns, documents expiring — newest ' +
      'first (D-347, D-358).',
    implements: ['D-347', 'D-358'],
  })
  @ApiPaginated(ErpAlertDto, { example: ALERT })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpAlertListQuery,
  ) {
    return this.alerts.list(await this.workspace.open(actor, factoryId), q);
  }

  @Get('count')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpAlerts.count',
    summary: 'How many alerts are open',
    description: 'For the menu badge, by kind (D-358).',
    implements: ['D-358'],
  })
  @ApiSuccess(200, {
    description: 'Open alerts',
    type: ErpAlertCountDto,
    example: { open: 3, byKind: { price_rise: 1, maintenance_due: 2 } },
  })
  @ApiStandardErrors('http.not_found')
  async count(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.alerts.count(await this.workspace.open(actor, factoryId));
  }

  @Post(':alertId/actions/acknowledge')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_profile.read')
  @factoryParam
  @ApiParam({ name: 'alertId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpAlerts.acknowledge',
    summary: 'Acknowledge an alert',
    description: 'It leaves the open list; who and when are kept (D-358).',
    implements: ['D-358'],
  })
  @ApiSuccess(200, {
    description: 'Acknowledged',
    type: ErpAlertDto,
    example: {
      ...ALERT,
      status: 'acknowledged',
      acknowledgedAt: '2026-10-12T15:00:00+07:00',
      acknowledgedBy: 'จัดซื้อ ทดสอบ',
    },
  })
  @ApiStandardErrors('http.not_found')
  async acknowledge(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.alerts.acknowledge(await this.workspace.open(actor, factoryId), alertId);
  }

  @Post('actions/acknowledge-all')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpAlerts.acknowledgeAll',
    summary: 'Acknowledge every open alert',
    description: 'Marks them all read (D-358).',
    implements: ['D-358'],
  })
  @ApiSuccess(200, { description: 'None open', type: ErpAlertCountDto, example: { open: 0, byKind: {} } })
  @ApiStandardErrors('http.not_found')
  async acknowledgeAll(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.alerts.acknowledgeAll(await this.workspace.open(actor, factoryId));
  }
}

// ==================================================================== requests for quotation (D-348)

@ApiSurface('partner', 'erpRfqs')
@Controller('factories/:factoryId/erp/rfqs')
export class PartnerErpRfqsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly sourcing: ErpSourcingService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Can('factory_procurement.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpRfqs.list',
    summary: 'My factory’s requests for quotation',
    description: 'Newest first; `status=open` = draft or sent (D-348).',
    implements: ['D-348'],
  })
  @ApiPaginated(ErpRfqSummaryDto, { example: RFQ_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpRfqListQuery,
  ) {
    return this.sourcing.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_procurement.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.create',
    summary: 'Ask suppliers for quotations',
    description:
      'A draft `RFQ-YYMM-NNNN` with lines (base units) and 1–20 suppliers; from an approved purchase request its ' +
      'open lines are used when none are given (D-348).',
    implements: ['D-348'],
  })
  @ApiBody({ type: ErpSaveRfqDto, examples: { default: { value: SAVE_RFQ } } })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpRfqDto,
    example: { ...RFQ, status: 'draft', nextActions: [ACTION('erp_rfq.edit'), ACTION('erp_rfq.send')] },
  })
  @ApiStandardErrors(...WRITE, 'erp.not_a_supplier', 'erp.archived', 'erp.invalid_status')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSaveRfqDto,
  ) {
    return this.sourcing.create(
      await this.workspace.open(actor, factoryId),
      body,
      await perms(this.permissions, actor),
    );
  }

  @Get(':rfqId')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.get',
    summary: 'One request for quotation',
    description: 'Lines, suppliers with their answers and the actions offered (D-348).',
    implements: ['D-348'],
  })
  @ApiSuccess(200, { description: 'The RFQ', type: ErpRfqDto, example: RFQ })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
  ) {
    return this.sourcing.get(
      await this.workspace.open(actor, factoryId),
      rfqId,
      await perms(this.permissions, actor),
    );
  }

  @Put(':rfqId')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.update',
    summary: 'Edit a draft request for quotation',
    description: 'Replaces lines and suppliers; drafts only (D-348).',
    implements: ['D-348'],
  })
  @ApiBody({ type: ErpSaveRfqDto, examples: { default: { value: SAVE_RFQ } } })
  @ApiSuccess(200, { description: 'The draft', type: ErpRfqDto, example: { ...RFQ, status: 'draft' } })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.not_a_supplier', 'erp.archived')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveRfqDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.sourcing.update(scope, rfqId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post(':rfqId/actions/send')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.send',
    summary: 'Mark a request for quotation sent',
    description:
      'The factory sends it by its own channel (print, e-mail, LINE); answers can now be recorded (D-348).',
    implements: ['D-348'],
  })
  @ApiSuccess(200, { description: 'Sent', type: ErpRfqDto, example: RFQ })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status')
  async send(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
  ) {
    return this.sourcing.send(
      await this.workspace.open(actor, factoryId),
      rfqId,
      await perms(this.permissions, actor),
    );
  }

  @Put(':rfqId/suppliers/:rfqSupplierId/quote')
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @ApiParam({ name: 'rfqSupplierId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.recordQuote',
    summary: 'Record a supplier’s quotation',
    description:
      'Its price per line in its unit, minimum, lead time and validity — replacing what was recorded for it — also ' +
      'kept in the price history (D-348, D-334).',
    implements: ['D-348', 'D-334'],
  })
  @ApiBody({
    type: ErpRecordQuoteDto,
    examples: {
      default: {
        value: {
          reference: 'QT-6610-220',
          quotes: [
            { rfqLineId: E3_IDS.rfqLine, unitPrice: '1390', leadTimeDays: 5, validUntil: '2026-11-30' },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Recorded', type: ErpRfqDto, example: RFQ })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.unit_not_allowed')
  async recordQuote(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Param('rfqSupplierId', ParseUUIDPipe) rfqSupplierId: string,
    @Body() body: ErpRecordQuoteDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.sourcing.recordQuote(scope, rfqId, rfqSupplierId, body, await perms(this.permissions, actor));
  }

  @Post(':rfqId/suppliers/:rfqSupplierId/actions/decline')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @ApiParam({ name: 'rfqSupplierId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.decline',
    summary: 'A supplier declined to quote',
    description: 'With its reason (D-348).',
    implements: ['D-348'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ไม่มีสินค้าขนาดนี้' } } } })
  @ApiSuccess(200, { description: 'Declined', type: ErpRfqDto, example: RFQ })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async decline(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Param('rfqSupplierId', ParseUUIDPipe) rfqSupplierId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.sourcing.decline(
      scope,
      rfqId,
      rfqSupplierId,
      body.reason,
      await perms(this.permissions, actor),
    );
  }

  @Get(':rfqId/comparison')
  @Can('factory_procurement.read')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpRfqs.comparison',
    summary: 'Compare the quotations',
    description:
      'Per line every quote per base unit, the amount for the quantity rounded to the supplier’s unit and minimum, ' +
      'lead time, validity, approval and score; cheapest and fastest flagged (D-348, D-349, D-351).',
    implements: ['D-348', 'D-349', 'D-351'],
  })
  @ApiSuccess(200, { description: 'The comparison', type: ErpRfqComparisonDto, example: COMPARISON })
  @ApiStandardErrors('http.not_found')
  async comparison(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
  ) {
    return this.sourcing.comparison(await this.workspace.open(actor, factoryId), rfqId);
  }

  @Post(':rfqId/actions/award')
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpRfqs.award',
    summary: 'Award the quotations',
    description:
      'One quote per line; draft purchase orders, one per supplier, in the quoted unit rounded to its minimum at ' +
      'the quoted price; the RFQ is awarded (D-348).',
    implements: ['D-348'],
  })
  @ApiBody({
    type: ErpAwardRfqDto,
    examples: { default: { value: { awards: [{ rfqLineId: E3_IDS.rfqLine, quoteId: E3_IDS.rfqQuote }] } } },
  })
  @ApiSuccess(201, {
    description: 'Drafted',
    type: ErpDraftFromReorderResultDto,
    example: { created: [PO_SUMMARY], skipped: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status', 'erp.archived', 'erp.unit_not_allowed')
  async award(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: ErpAwardRfqDto,
  ) {
    return this.sourcing.award(await this.workspace.open(actor, factoryId), rfqId, body);
  }

  @Post(':rfqId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_procurement.manage')
  @factoryParam
  @ApiParam({ name: 'rfqId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpRfqs.cancel',
    summary: 'Cancel a request for quotation',
    description: 'A draft or sent RFQ, with a reason (D-348).',
    implements: ['D-348'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ใช้ราคาสัญญาปีแทน' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpRfqDto,
    example: { ...RFQ, status: 'cancelled', cancelReason: 'ใช้ราคาสัญญาปีแทน', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.sourcing.cancel(scope, rfqId, body.reason, await perms(this.permissions, actor));
  }
}

// ================================================================== machines, schedule and floor (D-352 – D-354)

@ApiSurface('partner', 'erpMachines')
@Controller('factories/:factoryId/erp/machines')
export class PartnerErpMachinesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly maintenance: ErpMaintenanceService,
    private readonly production: ErpProductionService,
  ) {}

  @Get()
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpMachines.list',
    summary: 'My factory’s machines',
    description:
      'Each with its state (running, idle, down, maintenance), what runs on it, its queue, open maintenance and ' +
      'how far its preventive plans are from due (D-353, D-355).',
    implements: ['D-353', 'D-355'],
  })
  @ApiSuccess(200, { description: 'Machines', type: [ErpMachineDto], example: [MACHINE] })
  @ApiStandardErrors('http.not_found')
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.maintenance.machines(await this.workspace.open(actor, factoryId));
  }

  @Post()
  @Can('factory_erp.configure')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpMachines.create',
    summary: 'Add a machine',
    description:
      'The same record as the factory’s capability profile (name, print type, sheet size) (D-352).',
    implements: ['D-352'],
  })
  @ApiBody({
    type: CreateMachineDto,
    examples: { default: { value: { name: 'Heidelberg SM 74', maxWidthMm: 520, maxLengthMm: 740 } } },
  })
  @ApiSuccess(201, {
    description: 'Added',
    type: ErpMachineDto,
    example: { ...MACHINE, state: 'idle', running: null },
  })
  @ApiStandardErrors(...WRITE)
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateMachineDto,
  ) {
    return this.maintenance.saveMachine(await this.workspace.open(actor, factoryId), body);
  }

  @Get(':machineId')
  @Can('factory_planning.read')
  @factoryParam
  @ApiParam({ name: 'machineId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpMachines.get',
    summary: 'One machine',
    description: 'State, running operation, queue, open maintenance and plans (D-353, D-355).',
    implements: ['D-353', 'D-355'],
  })
  @ApiSuccess(200, { description: 'The machine', type: ErpMachineDto, example: MACHINE })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('machineId', ParseUUIDPipe) machineId: string,
  ) {
    return (await this.maintenance.machines(await this.workspace.open(actor, factoryId), machineId))[0]!;
  }

  @Patch(':machineId')
  @Can('factory_erp.configure')
  @factoryParam
  @ApiParam({ name: 'machineId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpMachines.update',
    summary: 'Edit a machine',
    description: 'Name, sheet size, details, active / inactive (D-352).',
    implements: ['D-352'],
  })
  @ApiBody({ type: UpdateMachineDto, examples: { default: { value: { details: 'ออฟเซ็ท 4 สี + เคลือบ' } } } })
  @ApiSuccess(200, { description: 'Updated', type: ErpMachineDto, example: MACHINE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Body() body: UpdateMachineDto,
  ) {
    return this.maintenance.saveMachine(await this.workspace.open(actor, factoryId), body, machineId);
  }

  @Get(':machineId/dispatch')
  @Can('factory_planning.read')
  @factoryParam
  @ApiParam({ name: 'machineId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpMachines.dispatch',
    summary: 'The kiosk’s dispatch list for a machine',
    description:
      'What runs (or is paused) on it now and what comes next in planned order; `q` narrows to an order number ' +
      'typed or scanned (D-353).',
    implements: ['D-353', 'D-352'],
  })
  @ApiSuccess(200, {
    description: 'The dispatch list',
    type: ErpDispatchDto,
    example: { machine: MACHINE, current: MACHINE.running, next: [{ operation: OPERATION, order: MO }] },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async dispatch(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Query() q: ErpDispatchQuery,
  ): Promise<ErpDispatchDto> {
    const scope = await this.workspace.open(actor, factoryId);
    const [machine] = await this.maintenance.machines(scope, machineId);
    const search = q.q?.trim().toUpperCase();
    const queue = (await this.production.queue(scope, machineId)).filter(
      (x) =>
        !search ||
        x.order.moNo.toUpperCase().includes(search) ||
        x.order.title.toUpperCase().includes(search),
    );
    return {
      machine: machine!,
      current: queue.find((x) => x.operation.status !== 'pending') ?? null,
      next: queue.filter((x) => x.operation.status === 'pending'),
    };
  }
}

@ApiSurface('partner', 'erpSchedule')
@Controller('factories/:factoryId/erp')
export class PartnerErpScheduleController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly schedule: ErpScheduleService,
    private readonly production: ErpProductionService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('schedule')
  @Can('factory_planning.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSchedule.board',
    summary: 'The machine schedule',
    description:
      'Per machine its operations’ slots and maintenance windows for `days` days from `from`, the opening hours ' +
      'per day, operations without a machine and how many are not planned yet (D-352).',
    implements: ['D-352', 'D-292'],
  })
  @ApiSuccess(200, { description: 'The board', type: ErpScheduleDto, example: SCHEDULE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async board(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpScheduleQuery,
  ) {
    return this.schedule.board(await this.workspace.open(actor, factoryId), q);
  }

  @Post('schedule/actions/auto-plan')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_planning.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpSchedule.autoPlan',
    summary: 'Plan the schedule automatically',
    description:
      'Every not-started, unlocked operation of the open orders gets a slot forward from now in business hours — ' +
      'priority, due date, age — around running and locked operations and maintenance; late orders listed (D-352).',
    implements: ['D-352', 'D-292'],
  })
  @ApiSuccess(200, {
    description: 'Planned',
    type: ErpAutoPlanResultDto,
    example: { placed: 6, kept: 2, late: [] },
  })
  @ApiStandardErrors('http.not_found')
  async autoPlan(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.schedule.autoPlan(await this.workspace.open(actor, factoryId));
  }

  @Put('production-orders/:moId/operations/:operationId/schedule')
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSchedule.move',
    summary: 'Move an operation on the schedule',
    description:
      'To a start (moved into business hours), maybe another machine or length; it is locked unless `locked=false` ' +
      '(D-352).',
    implements: ['D-352'],
  })
  @ApiBody({
    type: ErpMoveOperationDto,
    examples: { default: { value: { start: '2026-10-13T13:00:00+07:00', machineId: E2_IDS.machine } } },
  })
  @ApiSuccess(200, { description: 'Moved', type: ErpScheduleSlotDto, example: { ...SLOT, locked: true } })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async move(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() body: ErpMoveOperationDto,
  ) {
    return this.schedule.move(await this.workspace.open(actor, factoryId), moId, operationId, body);
  }

  @Post('production-orders/:moId/operations/:operationId/actions/lock')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_planning.manage')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSchedule.lock',
    summary: 'Lock or unlock an operation’s slot',
    description: 'A locked slot stays where it is when the schedule is planned again (D-352).',
    implements: ['D-352'],
  })
  @ApiBody({ type: ErpLockOperationDto, examples: { default: { value: { locked: false } } } })
  @ApiSuccess(200, { description: 'Changed', type: ErpScheduleSlotDto, example: SLOT })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async lock(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() body: ErpLockOperationDto,
  ) {
    return this.schedule.lock(await this.workspace.open(actor, factoryId), moId, operationId, body.locked);
  }

  @Post('production-orders/:moId/operations/:operationId/actions/pause')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_production.record')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSchedule.pause',
    summary: 'Pause an operation',
    description:
      'With a reason (material, breakdown, setup, quality, approval, break, other); time paused is kept (D-353).',
    implements: ['D-353'],
  })
  @ApiBody({
    type: ErpPauseOperationDto,
    examples: { default: { value: { reason: 'material_shortage', note: 'รอกระดาษจากคลัง' } } },
  })
  @ApiSuccess(200, { description: 'Paused', type: ErpProductionOrderDto, example: MO })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async pause(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() body: ErpPauseOperationDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.operate(
      scope,
      moId,
      operationId,
      'pause',
      body,
      await perms(this.permissions, actor),
    );
  }

  @Post('production-orders/:moId/operations/:operationId/actions/resume')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_production.record')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpSchedule.resume',
    summary: 'Resume a paused operation',
    description: 'Not while its machine has an open breakdown (D-353, D-355).',
    implements: ['D-353', 'D-355'],
  })
  @ApiSuccess(200, { description: 'Running again', type: ErpProductionOrderDto, example: MO })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status', 'erp.machine_down')
  async resume(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.production.operate(
      scope,
      moId,
      operationId,
      'resume',
      {},
      await perms(this.permissions, actor),
    );
  }

  @Get('production-orders/:moId/operations/:operationId/events')
  @Can('factory_planning.read')
  @factoryParam
  @ApiParam({ name: 'moId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpSchedule.events',
    summary: 'What happened on an operation',
    description: 'Every start, pause (why), resume, finish and skip with who and when (D-353).',
    implements: ['D-353'],
  })
  @ApiSuccess(200, { description: 'Events, oldest first', type: [ErpOperationEventDto], example: [EVENT] })
  @ApiStandardErrors('http.not_found')
  async events(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('moId', ParseUUIDPipe) moId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    return this.production.events(await this.workspace.open(actor, factoryId), moId, operationId);
  }
}

// ============================================================================== maintenance (D-355)

@ApiSurface('partner', 'erpMaintenance')
@Controller('factories/:factoryId/erp/maintenance')
export class PartnerErpMaintenanceController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly maintenance: ErpMaintenanceService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('orders')
  @Can('factory_maintenance.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpMaintenance.list',
    summary: 'Maintenance orders',
    description: 'Newest first; `status=open_all` = open, scheduled or in progress (D-355).',
    implements: ['D-355'],
  })
  @ApiPaginated(ErpMaintenanceOrderSummaryDto, { example: MT_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpMaintenanceListQuery,
  ) {
    return this.maintenance.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post('orders/breakdowns')
  @Idempotent()
  @Can('factory_maintenance.report')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.report',
    summary: 'Report a breakdown',
    description:
      'With photos and a priority (default high): numbered `MT-YYMM-NNNN`, the machine is down until it is done ' +
      'and the factory is notified (D-355, D-358).',
    implements: ['D-355', 'D-358'],
  })
  @ApiBody({
    type: ErpReportBreakdownDto,
    examples: {
      default: { value: { machineId: E2_IDS.machine, title: 'ลูกกลิ้งหมึกมีเสียงดัง', priority: 'high' } },
    },
  })
  @ApiSuccess(201, { description: 'Reported', type: ErpMaintenanceOrderDto, example: MT })
  @ApiStandardErrors(...WRITE, 'erp.file_not_usable')
  async report(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpReportBreakdownDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.reportBreakdown(scope, body, await perms(this.permissions, actor));
  }

  @Get('orders/:mtId')
  @Can('factory_maintenance.read')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.get',
    summary: 'One maintenance order',
    description: 'Photos, parts issued, the plan’s parts and the actions offered (D-355).',
    implements: ['D-355'],
  })
  @ApiSuccess(200, { description: 'The order', type: ErpMaintenanceOrderDto, example: MT })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
  ) {
    return this.maintenance.get(
      await this.workspace.open(actor, factoryId),
      mtId,
      await perms(this.permissions, actor),
    );
  }

  @Post('orders/:mtId/actions/schedule')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.schedule',
    summary: 'Give a maintenance order a window',
    description: 'The machine is kept free then when the schedule is planned (D-352, D-355).',
    implements: ['D-352', 'D-355'],
  })
  @ApiBody({
    type: ErpScheduleMaintenanceDto,
    examples: {
      default: { value: { start: '2026-10-14T13:00:00+07:00', end: '2026-10-14T15:00:00+07:00' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Scheduled',
    type: ErpMaintenanceOrderDto,
    example: { ...MT, status: 'scheduled' },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async schedule(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
    @Body() body: ErpScheduleMaintenanceDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.schedule(scope, mtId, body, await perms(this.permissions, actor));
  }

  @Post('orders/:mtId/actions/start')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.start',
    summary: 'Start a maintenance order',
    description: 'The machine is under maintenance (D-355).',
    implements: ['D-355'],
  })
  @ApiSuccess(200, {
    description: 'Started',
    type: ErpMaintenanceOrderDto,
    example: { ...MT, status: 'in_progress' },
  })
  @ApiStandardErrors('http.not_found', 'erp.invalid_status')
  async start(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
  ) {
    return this.maintenance.start(
      await this.workspace.open(actor, factoryId),
      mtId,
      await perms(this.permissions, actor),
    );
  }

  @Post('orders/:mtId/actions/parts')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.parts',
    summary: 'Issue spare parts to a maintenance order',
    description: 'Out of stock at the average cost (`maintenance_issue` movements, D-322) (D-355).',
    implements: ['D-355', 'D-321', 'D-322'],
  })
  @ApiBody({
    type: ErpMaintenancePartsDto,
    examples: { default: { value: { lines: [{ itemId: ERP_IDS.item, quantity: '2' }] } } },
  })
  @ApiSuccess(200, { description: 'Issued', type: ErpMaintenanceOrderDto, example: MT })
  @ApiStandardErrors(
    ...WRITE,
    'erp.invalid_status',
    'erp.stock_insufficient',
    'erp.lot_required',
    'erp.archived',
  )
  async parts(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
    @Body() body: ErpMaintenancePartsDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.issueParts(scope, mtId, body, await perms(this.permissions, actor));
  }

  @Post('orders/:mtId/actions/finish')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.finish',
    summary: 'Finish a maintenance order',
    description:
      'With the resolution and the downtime; the machine is back, a preventive plan counts again from now (D-355).',
    implements: ['D-355'],
  })
  @ApiBody({
    type: ErpFinishMaintenanceDto,
    examples: {
      default: { value: { resolution: 'เปลี่ยนลูกปืนลูกกลิ้ง ทดสอบเดินเครื่องปกติ', downtimeMinutes: 95 } },
    },
  })
  @ApiSuccess(200, {
    description: 'Done',
    type: ErpMaintenanceOrderDto,
    example: {
      ...MT,
      status: 'done',
      resolution: 'เปลี่ยนลูกปืนลูกกลิ้ง',
      downtimeMinutes: 95,
      nextActions: [],
    },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async finish(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
    @Body() body: ErpFinishMaintenanceDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.finish(scope, mtId, body, await perms(this.permissions, actor));
  }

  @Post('orders/:mtId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'mtId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.cancel',
    summary: 'Cancel a maintenance order',
    description: 'Open or scheduled, with a reason (D-355).',
    implements: ['D-355'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'แจ้งซ้ำกับ MT-2610-0002' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: ErpMaintenanceOrderDto,
    example: { ...MT, status: 'cancelled', nextActions: [] },
  })
  @ApiStandardErrors(...WRITE, 'erp.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('mtId', ParseUUIDPipe) mtId: string,
    @Body() body: ReasonDto,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.cancel(scope, mtId, body.reason, await perms(this.permissions, actor));
  }

  @Get('plans')
  @Can('factory_maintenance.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpMaintenance.plans',
    summary: 'Preventive maintenance plans',
    description: 'Each with days and impressions left and its open order (D-355).',
    implements: ['D-355'],
  })
  @ApiSuccess(200, { description: 'Plans', type: [ErpMaintenancePlanDto], example: [PLAN] })
  @ApiStandardErrors('http.not_found')
  async plans(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.maintenance.listPlans(await this.workspace.open(actor, factoryId));
  }

  @Post('plans')
  @Can('factory_maintenance.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.createPlan',
    summary: 'Add a preventive plan',
    description: 'Every N days and / or every N impressions on a machine, its duration and parts (D-355).',
    implements: ['D-355'],
  })
  @ApiBody({ type: ErpSaveMaintenancePlanDto, examples: { default: { value: SAVE_PLAN } } })
  @ApiSuccess(201, { description: 'Added', type: ErpMaintenancePlanDto, example: PLAN })
  @ApiStandardErrors(...WRITE, 'erp.archived')
  async createPlan(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSaveMaintenancePlanDto,
  ) {
    return this.maintenance.createPlan(await this.workspace.open(actor, factoryId), body);
  }

  @Get('plans/:planId')
  @Can('factory_maintenance.read')
  @factoryParam
  @ApiParam({ name: 'planId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.plan',
    summary: 'One preventive plan',
    description: 'With how far it is from due (D-355).',
    implements: ['D-355'],
  })
  @ApiSuccess(200, { description: 'The plan', type: ErpMaintenancePlanDto, example: PLAN })
  @ApiStandardErrors('http.not_found')
  async plan(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.maintenance.getPlan(await this.workspace.open(actor, factoryId), planId);
  }

  @Put('plans/:planId')
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.updatePlan',
    summary: 'Edit a preventive plan',
    description: 'Replaces its intervals and parts; `status=archived` stops it (D-355).',
    implements: ['D-355'],
  })
  @ApiBody({ type: ErpSaveMaintenancePlanDto, examples: { default: { value: SAVE_PLAN } } })
  @ApiSuccess(200, { description: 'Updated', type: ErpMaintenancePlanDto, example: PLAN })
  @ApiStandardErrors(...WRITE)
  async updatePlan(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveMaintenancePlanDto,
  ) {
    return this.maintenance.updatePlan(await this.workspace.open(actor, factoryId), planId, ifMatch, body);
  }

  @Post('plans/:planId/actions/open')
  @Idempotent()
  @Can('factory_maintenance.manage')
  @factoryParam
  @ApiParam({ name: 'planId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpMaintenance.openPlan',
    summary: 'Open the plan’s maintenance order now',
    description: 'Before it is due; the open one is returned when there already is one (D-355).',
    implements: ['D-355'],
  })
  @ApiSuccess(201, {
    description: 'Opened',
    type: ErpMaintenanceOrderDto,
    example: {
      ...MT,
      kind: 'preventive',
      priority: 'normal',
      plan: { id: E3_IDS.plan, code: 'Heidelberg SM 74', name: PLAN.title },
    },
  })
  @ApiStandardErrors('http.not_found', 'erp.archived')
  async openPlan(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    const scope = await this.workspace.open(actor, factoryId);
    return this.maintenance.openPlanNow(scope, planId, await perms(this.permissions, actor));
  }
}

// ================================================================================ documents (D-356)

@ApiSurface('partner', 'erpDocuments')
@Controller('factories/:factoryId/erp/documents')
export class PartnerErpDocumentsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly docs: ErpDocsService,
  ) {}

  @Get('folders')
  @Can('factory_documents.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpDocuments.folders',
    summary: 'Document folders',
    description: 'All folders (a flat list with parents) and how many active documents each holds (D-356).',
    implements: ['D-356'],
  })
  @ApiSuccess(200, { description: 'Folders', type: [ErpDocFolderDto], example: [FOLDER] })
  @ApiStandardErrors('http.not_found')
  async folders(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.docs.folders(await this.workspace.open(actor, factoryId));
  }

  @Post('folders')
  @Can('factory_documents.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpDocuments.createFolder',
    summary: 'Add a folder',
    description: 'Names are unique among their siblings (D-356).',
    implements: ['D-356'],
  })
  @ApiBody({ type: ErpSaveFolderDto, examples: { default: { value: { name: 'ใบรับรอง' } } } })
  @ApiSuccess(201, { description: 'Added', type: ErpDocFolderDto, example: { ...FOLDER, docCount: 0 } })
  @ApiStandardErrors(...WRITE, 'erp.folder_exists')
  async createFolder(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpSaveFolderDto,
  ) {
    return this.docs.createFolder(await this.workspace.open(actor, factoryId), body);
  }

  @Patch('folders/:folderId')
  @Can('factory_documents.manage')
  @factoryParam
  @ApiParam({ name: 'folderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpDocuments.updateFolder',
    summary: 'Rename or move a folder',
    description: 'Not into itself (D-356).',
    implements: ['D-356'],
  })
  @ApiBody({ type: ErpSaveFolderDto, examples: { default: { value: { name: 'ใบรับรองผู้ขาย' } } } })
  @ApiSuccess(200, { description: 'Updated', type: ErpDocFolderDto, example: FOLDER })
  @ApiStandardErrors(...WRITE, 'erp.folder_exists')
  async updateFolder(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() body: ErpSaveFolderDto,
  ) {
    return this.docs.renameFolder(await this.workspace.open(actor, factoryId), folderId, body);
  }

  @Delete('folders/:folderId')
  @HttpCode(204)
  @Can('factory_documents.manage')
  @factoryParam
  @ApiParam({ name: 'folderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.erpDocuments.deleteFolder',
    summary: 'Delete an empty folder',
    description: 'Only with no sub-folders and no documents (D-356).',
    implements: ['D-356'],
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'erp.folder_not_empty')
  async deleteFolder(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
  ): Promise<void> {
    await this.docs.deleteFolder(await this.workspace.open(actor, factoryId), folderId);
  }

  @Get()
  @Can('factory_documents.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.erpDocuments.list',
    summary: 'Documents',
    description:
      'Active ones by default, newest change first; by folder, linked record, category, or expiring / expired ' +
      '(soonest first) (D-356).',
    implements: ['D-356'],
  })
  @ApiPaginated(ErpDocSummaryDto, { example: DOC_SUMMARY })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ErpDocListQuery,
  ) {
    return this.docs.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Can('factory_documents.manage')
  @factoryParam
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpDocuments.create',
    summary: 'Add a document',
    description:
      'Its first version is an uploaded file of this factory; optionally in a folder, linked to one ERP record, ' +
      'with an expiry and reminder (D-356).',
    implements: ['D-356'],
  })
  @ApiBody({
    type: ErpCreateDocDto,
    examples: {
      default: {
        value: {
          title: 'ใบรับรอง FSC — กระดาษไทย',
          category: 'certificate',
          linkType: 'trading_partner',
          linkId: ERP_IDS.supplier,
          expiresOn: '2027-03-31',
          fileId: E3_IDS.file,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Added', type: ErpDocDto, example: DOC })
  @ApiStandardErrors(...WRITE, 'erp.file_not_usable')
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ErpCreateDocDto,
  ) {
    return this.docs.create(await this.workspace.open(actor, factoryId), body);
  }

  @Get(':docId')
  @Can('factory_documents.read')
  @factoryParam
  @ApiParam({ name: 'docId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpDocuments.get',
    summary: 'One document',
    description: 'With every version, newest first (D-356).',
    implements: ['D-356'],
  })
  @ApiSuccess(200, { description: 'The document', type: ErpDocDto, example: DOC })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.docs.get(await this.workspace.open(actor, factoryId), docId);
  }

  @Patch(':docId')
  @Can('factory_documents.manage')
  @factoryParam
  @ApiParam({ name: 'docId', format: 'uuid' })
  @ApiConcurrency()
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpDocuments.update',
    summary: 'Edit a document',
    description: 'Title, category, tags, folder, link, expiry and reminder; `status=archived` (D-356).',
    implements: ['D-356'],
  })
  @ApiBody({ type: ErpUpdateDocDto, examples: { default: { value: { expiresOn: '2027-06-30' } } } })
  @ApiSuccess(200, { description: 'Updated', type: ErpDocDto, example: DOC })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateDocDto,
  ) {
    return this.docs.update(await this.workspace.open(actor, factoryId), docId, ifMatch, body);
  }

  @Post(':docId/versions')
  @Idempotent()
  @Can('factory_documents.manage')
  @factoryParam
  @ApiParam({ name: 'docId', format: 'uuid' })
  @UseEtag(byVersion)
  @ApiEndpoint({
    id: 'partner.erpDocuments.addVersion',
    summary: 'Upload a new version',
    description: 'Appended (earlier versions stay); may carry the renewed expiry (D-356).',
    implements: ['D-356'],
  })
  @ApiBody({
    type: ErpAddDocVersionDto,
    examples: { default: { value: { fileId: E3_IDS.file, note: 'ต่ออายุ 2027', expiresOn: '2028-03-31' } } },
  })
  @ApiSuccess(201, { description: 'Added', type: ErpDocDto, example: { ...DOC, currentVersion: 2 } })
  @ApiStandardErrors(...WRITE, 'erp.file_not_usable')
  async addVersion(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() body: ErpAddDocVersionDto,
  ) {
    return this.docs.addVersion(await this.workspace.open(actor, factoryId), docId, body);
  }
}
