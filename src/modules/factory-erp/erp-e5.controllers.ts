import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { DomainException } from '@common/errors/domain.exception';
import { type ErrorCode } from '@common/errors/error-codes';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { SETTINGS } from './erp.controllers';
import { ErpMonthQuery, ErpPdfLinkDto } from './erp-e4.dto';
import {
  E5_IDS,
  ErpCostReportDto,
  ErpCreateNcrDto,
  ErpCreateQualityCheckDto,
  ErpDashboardDto,
  ErpDisposeNcrDto,
  ErpGrantSupportDto,
  ErpInspectionTemplateDto,
  ErpJobCostDto,
  ErpMachineRateDto,
  ErpNcrDto,
  ErpNcrListQuery,
  ErpOeeQuery,
  ErpOeeReportDto,
  ErpOperatorSkillDto,
  ErpOverrideCheckDto,
  ErpProfitQuery,
  ErpProfitReportDto,
  ErpQualityCheckDto,
  ErpQualityCheckListQuery,
  ErpRecordQualityCheckDto,
  ErpSaveInspectionTemplateDto,
  ErpSaveMachineRateDto,
  ErpSaveShiftDto,
  ErpSaveSkillDto,
  ErpShiftDto,
  ErpSkillListQuery,
  ErpSupportGrantDto,
  ErpSupportViewDto,
  ErpTemplateListQuery,
  ErpUpdateNcrDto,
  ErpVerifyNcrDto,
  ErpWorkLogDto,
  ErpWorkLogQuery,
} from './erp-e5.dto';
import { ErpInsightService } from './erp-insight.service';
import { ErpPeopleService } from './erp-people.service';
import { ErpQualityService } from './erp-quality.service';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP E5 (docs/prompts/E1-factory-erp.md §12, D-372 – D-383): quality, insight (dashboard,
 * costing, profitability, OEE) and people under `/v1/partner/factories/{factoryId}/erp/*`, factory-private
 * (D-317); and Packio support's read under the owner's grant at `/v1/admin/factories/{factoryId}/erp/support-view`.
 */

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const byVersion = (b: { id: string; version: number }) => etagOf(b.id, b.version);
const ACTION = (key: string, irreversible = false) => ({ key, irreversible, disabledReason: null });
const perms = (resolver: PermissionResolver, actor: Actor) => permissionsOf(resolver, actor);

function Op(o: {
  id: string;
  summary: string;
  description: string;
  implements: string[];
  can?: PermissionKey;
  params?: string[];
  success?: { status: 200 | 201 | 204; description: string; type?: Type<unknown> | [Type<unknown>]; example?: unknown };
  paginated?: { type: Type<unknown>; example: unknown };
  body?: { type: Type<unknown>; example: unknown };
  errors?: readonly ErrorCode[];
  idempotent?: boolean;
  etag?: boolean;
  concurrency?: boolean;
  status?: 200 | 204;
  factory?: boolean;
}) {
  return applyDecorators(
    ...(o.status ? [HttpCode(o.status)] : []),
    ...(o.idempotent ? [Idempotent()] : []),
    ...(o.can ? [Can(o.can)] : []),
    ...(o.factory === false ? [] : [factoryParam]),
    ...(o.params ?? []).map((name) => ApiParam({ name, format: 'uuid' })),
    ...(o.concurrency ? [ApiConcurrency()] : []),
    ...(o.etag ? [UseEtag(byVersion)] : []),
    ApiEndpoint({ id: o.id, summary: o.summary, description: o.description, implements: o.implements }),
    ...(o.body ? [ApiBody({ type: o.body.type, examples: { default: { value: o.body.example } } })] : []),
    ...(o.paginated ? [ApiPaginated(o.paginated.type, { example: o.paginated.example })] : []),
    ...(o.success ? [ApiSuccess(o.success.status, o.success)] : []),
    ApiStandardErrors(...((o.errors ?? ['http.not_found']) as ErrorCode[])),
  );
}

// ------------------------------------------------------------------------------------- examples

const ITEM = { id: E5_IDS.item, sku: 'BOX-RSC-302015', name: 'กล่องลูกฟูก RSC 30×20×15', kind: 'finished_good', baseUnit: 'pcs' };
const MACHINE = { id: E5_IDS.machine, name: 'เครื่องพิมพ์ออฟเซ็ท 4 สี (ทดสอบ)' };
const INSPECTOR = { id: E5_IDS.inspector, name: 'ฝ่าย QC ทดสอบ' };
const SPEC = {
  seq: 1,
  name: 'ความหนาบอร์ด',
  type: 'measurement',
  unit: 'mm',
  minValue: '2.9000',
  maxValue: '3.3000',
  targetValue: '3.1000',
  instruction: 'วัด 5 จุดด้วยไมโครมิเตอร์',
};
const TEMPLATE: ErpInspectionTemplateDto = {
  id: E5_IDS.template,
  name: 'ตรวจขั้นสุดท้ายกล่อง RSC',
  kind: 'final',
  item: ITEM,
  sampleSizeHint: 'สุ่ม 13 ใบต่อล็อต',
  note: null,
  status: 'active',
  checkpoints: [SPEC, { ...SPEC, seq: 2, name: 'สีตรงตามตัวอย่าง', type: 'pass_fail', unit: null, minValue: null, maxValue: null, targetValue: null, instruction: null }],
  checks: 4,
  nextActions: [ACTION('erp_template.edit'), ACTION('erp_template.use')],
  version: 1,
};
const CHECK: ErpQualityCheckDto = {
  id: E5_IDS.check,
  qcNo: 'QC-2610-0004',
  kind: 'final',
  result: 'pass',
  resultOverridden: false,
  template: { id: E5_IDS.template, code: 'final', name: 'ตรวจขั้นสุดท้ายกล่อง RSC' },
  item: ITEM,
  goodsReceipt: null,
  lineNo: null,
  productionOrder: { id: E5_IDS.productionOrder, number: 'MO-2610-0007' },
  operation: null,
  supplier: null,
  inspector: INSPECTOR,
  lotNo: 'LOT-2610-07',
  sampleSize: '13.000',
  inspectedQty: '4950.000',
  acceptedQty: '4950.000',
  rejectedQty: '0.000',
  remarks: null,
  inspectedAt: '2026-10-13T14:20:00+07:00',
  checkpoints: [
    { ...SPEC, instruction: null, measured: '3.0500', outcome: 'pass', note: null },
    { ...SPEC, seq: 2, name: 'สีตรงตามตัวอย่าง', type: 'pass_fail', unit: null, minValue: null, maxValue: null, targetValue: null, instruction: null, measured: null, outcome: 'pass', note: null },
  ],
  photos: [],
  ncrs: [],
  nextActions: [ACTION('erp_qc.override'), ACTION('erp_qc.coa')],
  version: 2,
};
const NCR: ErpNcrDto = {
  id: E5_IDS.ncr,
  ncrNo: 'NCR-2610-0001',
  source: 'quality_check',
  severity: 'major',
  status: 'in_progress',
  title: 'QC-2610-0003 ไม่ผ่าน — กล่องลูกฟูก RSC 30×20×15',
  description: 'ไม่ผ่าน: สีตรงตามตัวอย่าง',
  check: { id: E5_IDS.check, number: 'QC-2610-0003' },
  item: ITEM,
  supplier: null,
  customer: null,
  machine: MACHINE,
  productionOrder: { id: E5_IDS.productionOrder, number: 'MO-2610-0007' },
  goodsReceipt: null,
  warehouse: { id: E5_IDS.factory, code: 'MAIN', name: 'คลังหลัก' },
  quantity: '200.000',
  unit: 'pcs',
  disposition: 'rework',
  dispositionNote: 'พิมพ์ทับใหม่',
  dispositionAt: '2026-10-13T15:00:00+07:00',
  rootCause: 'ผสมหมึกผิดสูตร',
  correctiveAction: 'พิมพ์ใหม่ 200 ใบ',
  preventiveAction: 'เทียบสีกับแผ่นมาตรฐานทุกล็อต',
  owner: INSPECTOR,
  actionDueOn: '2026-10-20',
  overdue: false,
  verifiedBy: null,
  verifiedAt: null,
  verificationNote: null,
  closedAt: null,
  cancelReason: null,
  photos: [],
  createdBy: 'ฝ่าย QC ทดสอบ',
  createdAt: '2026-10-13T14:25:00+07:00',
  nextActions: [ACTION('erp_ncr.edit'), ACTION('erp_ncr.verify')],
  version: 3,
};
const PDF_LINK: ErpPdfLinkDto = {
  url: 'https://files.packio.example/erp/COA-QC-2610-0004.pdf?sig=example',
  fileName: 'COA-QC-2610-0004.pdf',
  expiresAt: '2026-10-13T15:05:00+07:00',
};
const RATE: ErpMachineRateDto = { machine: MACHINE, hourlyRate: '850.00', note: 'ค่าเสื่อม + ไฟ + ซ่อมบำรุง', updatedAt: '2026-10-01T09:00:00+07:00' };
const JOB: ErpJobCostDto = {
  productionOrder: { id: E5_IDS.productionOrder, number: 'MO-2610-0007' },
  title: 'กล่องลูกฟูก RSC 30×20×15 — 5,000 ใบ',
  item: ITEM,
  status: 'completed',
  goodQty: '4950.000',
  scrapQty: '50.000',
  material: '31250.00',
  machine: '4250.00',
  labour: '600.00',
  overhead: '5415.00',
  total: '41515.00',
  unitCost: '8.386869',
  plannedMinutes: 300,
  runMinutes: 300,
  completedAt: '2026-10-12T17:30:00+07:00',
  operations: [
    { seq: 1, name: 'พิมพ์ 2 สี', machine: MACHINE, plannedMinutes: 300, runMinutes: 300, machineRate: '850.00', machineCost: '4250.00' },
  ],
};
const COSTS: ErpCostReportDto = {
  month: '2026-10',
  orders: [{ ...JOB, operations: [] }],
  totals: { orders: 1, material: '31250.00', machine: '4250.00', labour: '600.00', overhead: '5415.00', total: '41515.00' },
};
const PROFIT: ErpProfitReportDto = {
  month: '2026-10',
  by: 'customer',
  rows: [
    {
      key: { id: E5_IDS.customer, code: 'C0007', name: 'ร้านขนมบ้านสวน' },
      revenue: '62500.00',
      cost: '41515.00',
      grossProfit: '20985.00',
      grossProfitPct: '33.6',
    },
  ],
  revenue: '62500.00',
  cost: '41515.00',
  grossProfit: '20985.00',
  grossProfitPct: '33.6',
};
const OEE_DAY = {
  day: '2026-10-12',
  plannedMinutes: 480,
  runMinutes: 395,
  availabilityPct: '82.3',
  performancePct: '91.0',
  qualityPct: '99.0',
  oeePct: '74.1',
};
const OEE: ErpOeeReportDto = {
  from: '2026-10-12',
  to: '2026-10-12',
  oeePct: '74.1',
  machines: [
    {
      machine: MACHINE,
      plannedMinutes: 480,
      runMinutes: 395,
      good: '4950.000',
      scrap: '50.000',
      availabilityPct: '82.3',
      performancePct: '91.0',
      qualityPct: '99.0',
      oeePct: '74.1',
      days: [OEE_DAY],
      losses: [{ reason: 'setup', minutes: 45 }],
    },
  ],
};
const DASHBOARD: ErpDashboardDto = {
  asOf: '2026-10-13',
  month: '2026-10',
  sales: { invoicedNet: '245000.00', target: '300000.00', achievementPct: '81.7', invoices: 12 },
  receivables: { open: '182000.00', overdue: '42000.00', overdueInvoices: 3 },
  payables: { dueThisWeek: '56000.00', dueThisWeekCount: 4, overdueAmount: '0.00' },
  stock: {
    value: '845000.00',
    lowItems: 1,
    low: [{ item: { ...ITEM, sku: 'PAP-KA-350', name: 'กระดาษคราฟท์ 350 แกรม', kind: 'raw_material', baseUnit: 'sheet' }, available: '120.000', reorderPoint: '500.000' }],
  },
  production: {
    inProgress: 5,
    late: 1,
    completedThisMonth: 14,
    lateOrders: [{ order: { id: E5_IDS.productionOrder, number: 'MO-2610-0007' }, title: 'กล่องลูกฟูก RSC 30×20×15', dueOn: '2026-10-10', status: 'in_progress' }],
  },
  machines: { total: 6, down: 1, oeeYesterdayPct: '68.4' },
  quality: { openNcrs: 3, overdueNcrs: 1, checksThisMonth: 42, passRatePct: '95.2' },
  followUps: { dueToday: 4, overdue: 2, alerts: 5 },
};
const SHIFT: ErpShiftDto = {
  id: E5_IDS.shift,
  name: 'กะเช้า',
  startTime: '08:00',
  endTime: '17:00',
  days: [1, 2, 3, 4, 5, 6],
  minutes: 540,
  note: 'พัก 12:00–13:00',
  status: 'active',
  version: 1,
};
const SKILL: ErpOperatorSkillDto = {
  id: E5_IDS.skill,
  user: { id: E5_IDS.operator, name: 'ช่างพิมพ์ ทดสอบ' },
  machine: MACHINE,
  level: 'competent',
  certifiedOn: '2026-09-15',
  note: null,
  version: 1,
};
const WORK_LOG: ErpWorkLogDto = {
  from: '2026-10-12',
  to: '2026-10-12',
  rows: [
    {
      user: { id: E5_IDS.operator, name: 'ช่างพิมพ์ ทดสอบ' },
      day: '2026-10-12',
      operations: 2,
      runMinutes: 395,
      good: '4950.000',
      scrap: '50.000',
      machines: [MACHINE.name],
    },
  ],
};
const GRANT: ErpSupportGrantDto = {
  id: E5_IDS.grant,
  reason: 'ให้ทีม Packio ช่วยตรวจตัวเลขต้นทุน',
  expiresAt: '2026-10-16T10:00:00+07:00',
  active: true,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  viewCount: 1,
  grantedBy: 'เจ้าของโรงงาน ทดสอบ',
  createdAt: '2026-10-13T10:00:00+07:00',
  views: [{ at: '2026-10-13T10:12:00+07:00', staff: 'ทีมพาร์ทเนอร์ Packio (ทดสอบ)', what: 'dashboard,settings' }],
  nextActions: [ACTION('erp_support.revoke')],
};

// ====================================================================================== quality

@ApiSurface('partner', 'erpQuality')
@Controller('factories/:factoryId/erp')
export class PartnerErpQualityController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly quality: ErpQualityService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('inspection-templates')
  @Op({
    id: 'partner.erpQuality.listTemplates',
    summary: 'Inspection templates',
    description: 'By kind and name; `itemId` also lists the templates for any item (D-373).',
    implements: ['D-373'],
    can: 'factory_quality.read',
    paginated: { type: ErpInspectionTemplateDto, example: TEMPLATE },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listTemplates(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpTemplateListQuery) {
    return this.quality.listTemplates(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('inspection-templates')
  @Op({
    id: 'partner.erpQuality.createTemplate',
    summary: 'Add an inspection template',
    description: 'A checklist for one kind of check, optionally for one item: pass / fail, measurements with limits, notes (D-373).',
    implements: ['D-373'],
    can: 'factory_quality.manage',
    etag: true,
    body: {
      type: ErpSaveInspectionTemplateDto,
      example: { name: 'ตรวจขั้นสุดท้ายกล่อง RSC', kind: 'final', checkpoints: [{ name: 'ความหนาบอร์ด', type: 'measurement', unit: 'mm', minValue: '2.9', maxValue: '3.3' }] },
    },
    success: { status: 201, description: 'Added', type: ErpInspectionTemplateDto, example: TEMPLATE },
    errors: [...WRITE, 'erp.archived'],
  })
  async createTemplate(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveInspectionTemplateDto) {
    return this.quality.createTemplate(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('inspection-templates/:templateId')
  @Op({
    id: 'partner.erpQuality.getTemplate',
    summary: 'One inspection template',
    description: 'With its ETag for `PUT` (D-373).',
    implements: ['D-373'],
    can: 'factory_quality.read',
    params: ['templateId'],
    etag: true,
    success: { status: 200, description: 'The template', type: ErpInspectionTemplateDto, example: TEMPLATE },
  })
  async getTemplate(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return this.quality.getTemplate(await this.workspace.open(actor, factoryId), templateId, await perms(this.permissions, actor));
  }

  @Put('inspection-templates/:templateId')
  @Op({
    id: 'partner.erpQuality.updateTemplate',
    summary: 'Edit an inspection template',
    description: 'Replaces its checkpoints; checks already made keep their copy. `status: archived` retires it (D-373).',
    implements: ['D-373'],
    can: 'factory_quality.manage',
    params: ['templateId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveInspectionTemplateDto, example: { name: 'ตรวจขั้นสุดท้ายกล่อง RSC', kind: 'final', checkpoints: [{ name: 'สีตรงตามตัวอย่าง', type: 'pass_fail' }] } },
    success: { status: 200, description: 'Saved', type: ErpInspectionTemplateDto, example: TEMPLATE },
    errors: WRITE,
  })
  async updateTemplate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveInspectionTemplateDto,
  ) {
    return this.quality.updateTemplate(await this.workspace.open(actor, factoryId), templateId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Get('quality-checks')
  @Op({
    id: 'partner.erpQuality.listChecks',
    summary: 'Quality checks',
    description: 'Newest first; by kind, result, item, supplier, production order and date (D-372).',
    implements: ['D-372'],
    can: 'factory_quality.read',
    paginated: { type: ErpQualityCheckDto, example: CHECK },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listChecks(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpQualityCheckListQuery) {
    return this.quality.listChecks(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('quality-checks')
  @Op({
    id: 'partner.erpQuality.createCheck',
    summary: 'Start a quality check',
    description:
      '`QC-YYMM-NNNN` of a goods receipt line (incoming), an operation (in-process), a production order (final) or an item; ' +
      'its points come from the template or the body; the result is pending until they are recorded (D-372).',
    implements: ['D-372', 'D-373'],
    can: 'factory_quality.record',
    etag: true,
    body: { type: ErpCreateQualityCheckDto, example: { kind: 'final', templateId: E5_IDS.template, productionOrderId: E5_IDS.productionOrder, lotNo: 'LOT-2610-07', sampleSize: '13' } },
    success: { status: 201, description: 'Started', type: ErpQualityCheckDto, example: { ...CHECK, result: 'pending', nextActions: [ACTION('erp_qc.record')] } },
    errors: [...WRITE, 'erp.archived'],
  })
  async createCheck(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateQualityCheckDto) {
    return this.quality.createCheck(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('quality-checks/:checkId')
  @Op({
    id: 'partner.erpQuality.getCheck',
    summary: 'One quality check',
    description: 'Its points, photos and NCRs, with its ETag for `PUT` (D-372).',
    implements: ['D-372'],
    can: 'factory_quality.read',
    params: ['checkId'],
    etag: true,
    success: { status: 200, description: 'The check', type: ErpQualityCheckDto, example: CHECK },
  })
  async getCheck(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('checkId', ParseUUIDPipe) checkId: string) {
    return this.quality.getCheck(await this.workspace.open(actor, factoryId), checkId, await perms(this.permissions, actor));
  }

  @Put('quality-checks/:checkId')
  @Op({
    id: 'partner.erpQuality.recordCheck',
    summary: 'Record a check’s results',
    description:
      'Readings (judged against their limits), pass / fail outcomes, quantities and photos; the result follows the points. ' +
      'A decided check changes only with quality.manage. A fail opens an NCR (D-372, D-374).',
    implements: ['D-372', 'D-374'],
    can: 'factory_quality.record',
    params: ['checkId'],
    concurrency: true,
    etag: true,
    body: { type: ErpRecordQualityCheckDto, example: { points: [{ seq: 1, measured: '3.05' }, { seq: 2, outcome: 'pass' }], inspectedQty: '4950', acceptedQty: '4950', rejectedQty: '0' } },
    success: { status: 200, description: 'Recorded', type: ErpQualityCheckDto, example: CHECK },
    errors: [...WRITE, 'erp.invalid_status', 'erp.file_not_usable'],
  })
  async recordCheck(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpRecordQualityCheckDto,
  ) {
    return this.quality.recordCheck(await this.workspace.open(actor, factoryId), checkId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('quality-checks/:checkId/actions/override')
  @Op({
    id: 'partner.erpQuality.overrideCheck',
    summary: 'Set a check’s result',
    description: 'Pass, fail or conditional with the reason, whatever the points say (D-372).',
    implements: ['D-372'],
    can: 'factory_quality.manage',
    params: ['checkId'],
    idempotent: true,
    status: 200,
    body: { type: ErpOverrideCheckDto, example: { result: 'conditional', reason: 'ลูกค้ายอมรับสีเพี้ยนเล็กน้อย' } },
    success: { status: 200, description: 'Set', type: ErpQualityCheckDto, example: { ...CHECK, result: 'conditional', resultOverridden: true } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async overrideCheck(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() body: ErpOverrideCheckDto,
  ) {
    return this.quality.overrideCheck(await this.workspace.open(actor, factoryId), checkId, body, await perms(this.permissions, actor));
  }

  @Get('quality-checks/:checkId/coa')
  @Op({
    id: 'partner.erpQuality.coa',
    summary: 'Certificate of analysis',
    description: 'The PDF of a final check that passed (or passed with conditions), under the factory’s name (D-375).',
    implements: ['D-375'],
    can: 'factory_quality.read',
    params: ['checkId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: PDF_LINK },
    errors: ['http.not_found', 'erp.check_not_passed'],
  })
  async coa(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('checkId', ParseUUIDPipe) checkId: string) {
    return this.quality.coa(await this.workspace.open(actor, factoryId), checkId);
  }

  @Get('ncrs')
  @Op({
    id: 'partner.erpQuality.listNcrs',
    summary: 'Nonconformance reports',
    description: 'Newest first; `status=active` = open, in progress or verified; `overdue=true` = past the action date (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.read',
    paginated: { type: ErpNcrDto, example: NCR },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listNcrs(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpNcrListQuery) {
    return this.quality.listNcrs(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('ncrs')
  @Op({
    id: 'partner.erpQuality.createNcr',
    summary: 'Raise an NCR',
    description: '`NCR-YYMM-NNNN` from a check, a receipt, a production order, a customer complaint or internally (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.record',
    etag: true,
    body: { type: ErpCreateNcrDto, example: { source: 'customer_complaint', severity: 'major', title: 'กล่องพิมพ์สีเพี้ยน ล็อต 2610-07', description: 'ลูกค้าแจ้งสีแดงอ่อนกว่าตัวอย่าง', itemId: E5_IDS.item, quantity: '200' } },
    success: { status: 201, description: 'Raised', type: ErpNcrDto, example: { ...NCR, status: 'open' } },
    errors: [...WRITE, 'erp.archived', 'erp.file_not_usable'],
  })
  async createNcr(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateNcrDto) {
    return this.quality.createNcr(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('ncrs/:ncrId')
  @Op({
    id: 'partner.erpQuality.getNcr',
    summary: 'One NCR',
    description: 'With its ETag for `PUT` (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.read',
    params: ['ncrId'],
    etag: true,
    success: { status: 200, description: 'The NCR', type: ErpNcrDto, example: NCR },
  })
  async getNcr(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ncrId', ParseUUIDPipe) ncrId: string) {
    return this.quality.getNcr(await this.workspace.open(actor, factoryId), ncrId, await perms(this.permissions, actor));
  }

  @Put('ncrs/:ncrId')
  @Op({
    id: 'partner.erpQuality.updateNcr',
    summary: 'Work an NCR',
    description: 'Root cause, corrective and preventive action, owner and due date; an open NCR becomes in progress (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.record',
    params: ['ncrId'],
    concurrency: true,
    etag: true,
    body: { type: ErpUpdateNcrDto, example: { rootCause: 'ผสมหมึกผิดสูตร', correctiveAction: 'พิมพ์ใหม่ 200 ใบ', actionDueOn: '2026-10-20' } },
    success: { status: 200, description: 'Saved', type: ErpNcrDto, example: NCR },
    errors: [...WRITE, 'erp.invalid_status', 'erp.file_not_usable'],
  })
  async updateNcr(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('ncrId', ParseUUIDPipe) ncrId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateNcrDto,
  ) {
    return this.quality.updateNcr(await this.workspace.open(actor, factoryId), ncrId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('ncrs/:ncrId/actions/dispose')
  @Op({
    id: 'partner.erpQuality.disposeNcr',
    summary: 'Decide what happens to the goods',
    description: 'Rework, scrap (the quantity leaves stock now), return to supplier, use as is or hold (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.manage',
    params: ['ncrId'],
    idempotent: true,
    status: 200,
    body: { type: ErpDisposeNcrDto, example: { disposition: 'rework', note: 'พิมพ์ทับใหม่' } },
    success: { status: 200, description: 'Decided', type: ErpNcrDto, example: NCR },
    errors: [...WRITE, 'erp.invalid_status', 'erp.stock_insufficient'],
  })
  async disposeNcr(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('ncrId', ParseUUIDPipe) ncrId: string,
    @Body() body: ErpDisposeNcrDto,
  ) {
    return this.quality.disposeNcr(await this.workspace.open(actor, factoryId), ncrId, body, await perms(this.permissions, actor));
  }

  @Post('ncrs/:ncrId/actions/verify')
  @Op({
    id: 'partner.erpQuality.verifyNcr',
    summary: 'Verify the correction',
    description: 'Needs the disposition and the corrective action (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.manage',
    params: ['ncrId'],
    idempotent: true,
    status: 200,
    body: { type: ErpVerifyNcrDto, example: { note: 'ล็อตถัดไปสีตรงมาตรฐาน' } },
    success: { status: 200, description: 'Verified', type: ErpNcrDto, example: { ...NCR, status: 'verified', nextActions: [ACTION('erp_ncr.close', true)] } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.ncr_action_required'],
  })
  async verifyNcr(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('ncrId', ParseUUIDPipe) ncrId: string,
    @Body() body: ErpVerifyNcrDto,
  ) {
    return this.quality.verifyNcr(await this.workspace.open(actor, factoryId), ncrId, body.note, await perms(this.permissions, actor));
  }

  @Post('ncrs/:ncrId/actions/close')
  @Op({
    id: 'partner.erpQuality.closeNcr',
    summary: 'Close a verified NCR',
    description: 'Final; the checks it came from no longer change (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.manage',
    params: ['ncrId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Closed', type: ErpNcrDto, example: { ...NCR, status: 'closed', closedAt: '2026-10-21T09:00:00+07:00', nextActions: [] } },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async closeNcr(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('ncrId', ParseUUIDPipe) ncrId: string) {
    return this.quality.closeNcr(await this.workspace.open(actor, factoryId), ncrId, await perms(this.permissions, actor));
  }

  @Post('ncrs/:ncrId/actions/cancel')
  @Op({
    id: 'partner.erpQuality.cancelNcr',
    summary: 'Cancel an NCR',
    description: 'Raised by mistake; not after a scrap (D-374).',
    implements: ['D-374'],
    can: 'factory_quality.manage',
    params: ['ncrId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'เปิดซ้ำกับ NCR-2610-0001' } },
    success: { status: 200, description: 'Cancelled', type: ErpNcrDto, example: { ...NCR, status: 'cancelled', cancelReason: 'เปิดซ้ำกับ NCR-2610-0001', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async cancelNcr(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('ncrId', ParseUUIDPipe) ncrId: string,
    @Body() body: ReasonDto,
  ) {
    return this.quality.cancelNcr(await this.workspace.open(actor, factoryId), ncrId, body.reason, await perms(this.permissions, actor));
  }
}

// ====================================================================================== insight

@ApiSurface('partner', 'erpInsight')
@Controller('factories/:factoryId/erp')
export class PartnerErpInsightController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly insight: ErpInsightService,
  ) {}

  @Get('dashboard')
  @Op({
    id: 'partner.erpInsight.dashboard',
    summary: 'The owner’s dashboard',
    description:
      'Sales against target, receivables, payables due this week, stock value and low stock, production in progress and ' +
      'late, machines down and yesterday’s OEE, quality, follow-ups and alerts (D-378).',
    implements: ['D-378'],
    can: 'factory_insight.read',
    success: { status: 200, description: 'The dashboard', type: ErpDashboardDto, example: DASHBOARD },
  })
  async dashboard(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.insight.dashboard(await this.workspace.open(actor, factoryId));
  }

  @Get('machine-rates')
  @Op({
    id: 'partner.erpInsight.machineRates',
    summary: 'Machine hourly rates',
    description: 'Every active machine with its rate (null = not set) for job costing (D-376).',
    implements: ['D-376'],
    can: 'factory_insight.read',
    success: { status: 200, description: 'Rates', type: [ErpMachineRateDto], example: [RATE] },
  })
  async machineRates(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.insight.machineRates(await this.workspace.open(actor, factoryId));
  }

  @Put('machine-rates/:machineId')
  @Op({
    id: 'partner.erpInsight.saveMachineRate',
    summary: 'Set a machine’s hourly rate',
    description: 'Used for orders completed from now on (D-376).',
    implements: ['D-376'],
    can: 'factory_erp.configure',
    params: ['machineId'],
    body: { type: ErpSaveMachineRateDto, example: { hourlyRate: '850', note: 'ค่าเสื่อม + ไฟ + ซ่อมบำรุง' } },
    success: { status: 200, description: 'Rates', type: [ErpMachineRateDto], example: [RATE] },
    errors: WRITE,
  })
  async saveMachineRate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Body() body: ErpSaveMachineRateDto,
  ) {
    return this.insight.saveMachineRate(await this.workspace.open(actor, factoryId), machineId, body);
  }

  @Get('production-orders/:orderId/cost')
  @Op({
    id: 'partner.erpInsight.jobCost',
    summary: 'A production order’s cost',
    description: 'Materials, machine (run minutes × rate), labour and overhead, per operation; at today’s rates (D-376).',
    implements: ['D-376'],
    can: 'factory_insight.read',
    params: ['orderId'],
    success: { status: 200, description: 'The cost', type: ErpJobCostDto, example: JOB },
  })
  async jobCost(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.insight.jobCost(await this.workspace.open(actor, factoryId), orderId);
  }

  @Get('insight/costs')
  @Op({
    id: 'partner.erpInsight.costReport',
    summary: 'Job costs of the month',
    description: 'Production orders completed in the month with their cost breakdown and totals (D-376).',
    implements: ['D-376'],
    can: 'factory_insight.read',
    success: { status: 200, description: 'The report', type: ErpCostReportDto, example: COSTS },
    errors: ['http.not_found', 'validation.failed'],
  })
  async costReport(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpMonthQuery) {
    return this.insight.costReport(await this.workspace.open(actor, factoryId), q.month);
  }

  @Get('insight/profitability')
  @Op({
    id: 'partner.erpInsight.profitability',
    summary: 'Gross profit of the month',
    description: 'Net invoiced less the cost of what was delivered, by sales order, customer or item (D-376).',
    implements: ['D-376'],
    can: 'factory_insight.read',
    success: { status: 200, description: 'The report', type: ErpProfitReportDto, example: PROFIT },
    errors: ['http.not_found', 'validation.failed'],
  })
  async profitability(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpProfitQuery) {
    return this.insight.profit(await this.workspace.open(actor, factoryId), q.month, (q.by ?? 'customer') as 'customer');
  }

  @Get('insight/oee')
  @Op({
    id: 'partner.erpInsight.oee',
    summary: 'OEE by machine and day',
    description:
      'Availability (run ÷ shift or calendar time), performance (planned ÷ run, ≤ 100%) and quality (good ÷ made), with the ' +
      'paused minutes by reason; up to 31 days (D-377).',
    implements: ['D-377'],
    can: 'factory_insight.read',
    success: { status: 200, description: 'The report', type: ErpOeeReportDto, example: OEE },
    errors: ['http.not_found', 'validation.failed'],
  })
  async oee(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpOeeQuery) {
    return this.insight.oee(await this.workspace.open(actor, factoryId), q.from, q.to);
  }
}

// ======================================================================================= people

@ApiSurface('partner', 'erpPeople')
@Controller('factories/:factoryId/erp')
export class PartnerErpPeopleController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly people: ErpPeopleService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('shifts')
  @Op({
    id: 'partner.erpPeople.shifts',
    summary: 'Shifts',
    description: 'Active first, by start time; OEE takes its planned time from them (D-380, D-377).',
    implements: ['D-380'],
    can: 'factory_people.read',
    success: { status: 200, description: 'Shifts', type: [ErpShiftDto], example: [SHIFT] },
  })
  async shifts(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.people.shifts(await this.workspace.open(actor, factoryId));
  }

  @Post('shifts')
  @Op({
    id: 'partner.erpPeople.createShift',
    summary: 'Add a shift',
    description: 'Name, hours (an end at or before the start runs past midnight) and days of the week (D-380).',
    implements: ['D-380'],
    can: 'factory_people.manage',
    etag: true,
    body: { type: ErpSaveShiftDto, example: { name: 'กะเช้า', startTime: '08:00', endTime: '17:00', days: [1, 2, 3, 4, 5, 6] } },
    success: { status: 201, description: 'Added', type: ErpShiftDto, example: SHIFT },
    errors: [...WRITE, 'erp.code_taken'],
  })
  async createShift(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveShiftDto) {
    return this.people.createShift(await this.workspace.open(actor, factoryId), body);
  }

  @Put('shifts/:shiftId')
  @Op({
    id: 'partner.erpPeople.updateShift',
    summary: 'Edit a shift',
    description: '`status: archived` retires it (D-380).',
    implements: ['D-380'],
    can: 'factory_people.manage',
    params: ['shiftId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveShiftDto, example: { name: 'กะเช้า', startTime: '08:00', endTime: '17:00', days: [1, 2, 3, 4, 5] } },
    success: { status: 200, description: 'Saved', type: ErpShiftDto, example: SHIFT },
    errors: [...WRITE, 'erp.code_taken'],
  })
  async updateShift(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveShiftDto,
  ) {
    return this.people.updateShift(await this.workspace.open(actor, factoryId), shiftId, ifMatch, body);
  }

  @Get('operator-skills')
  @Op({
    id: 'partner.erpPeople.skills',
    summary: 'Operator skills',
    description: 'Who can run which machine, and how well (D-380).',
    implements: ['D-380'],
    can: 'factory_people.read',
    success: { status: 200, description: 'Skills', type: [ErpOperatorSkillDto], example: [SKILL] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async skills(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpSkillListQuery) {
    return this.people.skills(await this.workspace.open(actor, factoryId), q);
  }

  @Put('operator-skills')
  @Op({
    id: 'partner.erpPeople.saveSkill',
    summary: 'Set an operator’s skill on a machine',
    description: 'One per person and machine: learner, competent or expert, with the date certified (D-380).',
    implements: ['D-380'],
    can: 'factory_people.manage',
    body: { type: ErpSaveSkillDto, example: { userId: E5_IDS.operator, machineId: E5_IDS.machine, level: 'competent', certifiedOn: '2026-09-15' } },
    success: { status: 200, description: 'Saved', type: ErpOperatorSkillDto, example: SKILL },
    errors: WRITE,
  })
  async saveSkill(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveSkillDto) {
    return this.people.saveSkill(await this.workspace.open(actor, factoryId), body);
  }

  @Delete('operator-skills/:skillId')
  @Op({
    id: 'partner.erpPeople.deleteSkill',
    summary: 'Remove an operator’s skill',
    description: 'D-380.',
    implements: ['D-380'],
    can: 'factory_people.manage',
    params: ['skillId'],
    status: 204,
    success: { status: 204, description: 'Removed' },
  })
  async deleteSkill(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('skillId', ParseUUIDPipe) skillId: string) {
    await this.people.deleteSkill(await this.workspace.open(actor, factoryId), skillId);
  }

  @Get('work-log')
  @Op({
    id: 'partner.erpPeople.workLog',
    summary: 'Work log',
    description: 'Per person and day from the shop floor’s events: operations, run minutes, good and scrap; up to 31 days (D-380).',
    implements: ['D-380'],
    can: 'factory_people.read',
    success: { status: 200, description: 'The log', type: ErpWorkLogDto, example: WORK_LOG },
    errors: ['http.not_found', 'validation.failed'],
  })
  async workLog(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpWorkLogQuery) {
    return this.people.workLog(await this.workspace.open(actor, factoryId), q.from, q.to, q.userId);
  }

  @Get('support-grants')
  @Op({
    id: 'partner.erpPeople.supportGrants',
    summary: 'Packio support access',
    description: 'The latest 20 grants, each with who read what (D-381).',
    implements: ['D-381'],
    can: 'factory_support.grant',
    success: { status: 200, description: 'Grants', type: [ErpSupportGrantDto], example: [GRANT] },
  })
  async grants(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.people.grants(await this.workspace.open(actor, factoryId), await perms(this.permissions, actor));
  }

  @Post('support-grants')
  @Op({
    id: 'partner.erpPeople.grantSupport',
    summary: 'Let Packio support read the ERP',
    description: 'Read-only, the dashboard and settings, for 1–7 days; one at a time; revocable (D-381).',
    implements: ['D-381'],
    can: 'factory_support.grant',
    idempotent: true,
    body: { type: ErpGrantSupportDto, example: { reason: 'ให้ทีม Packio ช่วยตรวจตัวเลขต้นทุน', days: 3 } },
    success: { status: 201, description: 'Granted', type: ErpSupportGrantDto, example: { ...GRANT, viewCount: 0, views: [] } },
    errors: [...WRITE, 'erp.support_grant_active'],
  })
  async grant(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpGrantSupportDto) {
    return this.people.grant(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Post('support-grants/:grantId/actions/revoke')
  @Op({
    id: 'partner.erpPeople.revokeSupport',
    summary: 'Revoke Packio support access',
    description: 'Ends the grant now (D-381).',
    implements: ['D-381'],
    can: 'factory_support.grant',
    params: ['grantId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'ตรวจเสร็จแล้ว' } },
    success: { status: 200, description: 'Revoked', type: ErpSupportGrantDto, example: { ...GRANT, active: false, revokedAt: '2026-10-14T09:00:00+07:00', revokedBy: 'เจ้าของโรงงาน ทดสอบ', revokeReason: 'ตรวจเสร็จแล้ว', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async revoke(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: ReasonDto,
  ) {
    return this.people.revoke(await this.workspace.open(actor, factoryId), grantId, body.reason, await perms(this.permissions, actor));
  }
}

// ======================================================================================== admin

@ApiSurface('admin', 'erpSupport')
@Controller('factories/:factoryId/erp')
export class AdminErpSupportController {
  constructor(private readonly people: ErpPeopleService) {}

  @Get('support-view')
  @Op({
    id: 'admin.erpSupport.view',
    summary: 'A factory’s ERP dashboard and settings (support)',
    description:
      'Only while the owner’s grant is active; each read is audited (`erp_support.viewed`) and listed to the owner. Refused ' +
      'reads are audited too (D-381).',
    implements: ['D-381'],
    can: 'partners.read',
    success: { status: 200, description: 'What support may see', type: ErpSupportViewDto, example: { factory: { id: E5_IDS.factory, code: 'F0001', name: 'บจก. กล่องดี แพคเกจจิ้ง (ทดสอบ)' }, expiresAt: GRANT.expiresAt, reason: GRANT.reason, dashboard: DASHBOARD, settings: SETTINGS } },
    errors: ['http.not_found', 'erp.support_not_granted'],
  })
  async view(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    if (actor.type !== 'user') throw new DomainException('auth.forbidden');
    return this.people.supportView(actor, factoryId);
  }
}
