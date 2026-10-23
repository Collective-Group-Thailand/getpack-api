import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { type ErpPrismaService, type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpCheckKind,
  type ErpCheckpointType,
  type ErpCheckResult,
  type ErpNcr,
  type ErpNcrDisposition,
  type ErpNcrSeverity,
  type ErpNcrSource,
  type ErpNcrStatus,
  type ErpQualityCheck,
  type ErpRecordStatus,
  type ErpUnit,
  Prisma,
} from '@generated/prisma-erp/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { Inject, Injectable } from '@nestjs/common';

import { dec, fmtQty } from './erp.math';
import { renderCoaHtml } from './erp-documents.render';
import { type ErpPdfLinkDto } from './erp-e4.dto';
import {
  type ErpCheckpointInput,
  type ErpCreateNcrDto,
  type ErpCreateQualityCheckDto,
  type ErpDisposeNcrDto,
  type ErpInspectionTemplateDto,
  type ErpNcrDto,
  type ErpNcrListQuery,
  type ErpOverrideCheckDto,
  type ErpQualityCheckDto,
  type ErpQualityCheckListQuery,
  type ErpRecordQualityCheckDto,
  type ErpSaveInspectionTemplateDto,
  type ErpTemplateListQuery,
  type ErpUpdateNcrDto,
} from './erp-e5.dto';
import { type CheckpointOutcome, checkResult, measurementOutcome } from './erp-e5.math';
import { ErpFilesService } from './erp-files.service';
import { day, factoryUser, iso, isoTs, partnerRef, today, userRef } from './erp-sales.shared';
import { ErpStockService } from './erp-stock.service';
import { itemRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const TEMPLATE_INCLUDE = {
  item: true,
  checkpoints: { orderBy: { seq: 'asc' } },
  _count: { select: { checks: true } },
} as const;
type TemplateRow = Prisma.ErpInspectionTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const CHECK_INCLUDE = {
  template: true,
  item: true,
  goodsReceiptLine: { include: { goodsReceipt: true } },
  operation: true,
  productionOrder: true,
  supplier: true,
  inspector: true,
  checkpoints: { orderBy: { seq: 'asc' } },
  ncrs: { orderBy: { id: 'asc' } },
} as const;
type CheckRow = Prisma.ErpQualityCheckGetPayload<{ include: typeof CHECK_INCLUDE }>;

const NCR_INCLUDE = {
  check: true,
  item: true,
  supplier: true,
  customer: true,
  machine: true,
  productionOrder: true,
  goodsReceipt: true,
  warehouse: true,
  owner: true,
  verifiedBy: true,
  createdBy: true,
} as const;
type NcrRow = Prisma.ErpNcrGetPayload<{ include: typeof NCR_INCLUDE }>;

type Photo = { fileId: string; name: string; mimeType: string };

const OPEN_NCR: ErpNcrStatus[] = ['open', 'in_progress'];
const ACTIVE_NCR: ErpNcrStatus[] = ['open', 'in_progress', 'verified'];

export const TEMPLATE_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_template.edit', permissions: ['factory_quality.manage'], when: () => true },
  { key: 'erp_template.use', permissions: ['factory_quality.record'], when: (t) => t.status === 'active' },
];

export const CHECK_ACTIONS: ActionRule<{ result: ErpCheckResult; kind: ErpCheckKind; locked: boolean }>[] = [
  {
    key: 'erp_qc.record',
    permissions: ['factory_quality.record'],
    when: (c) => c.result === 'pending' && !c.locked,
  },
  { key: 'erp_qc.override', permissions: ['factory_quality.manage'], when: (c) => !c.locked },
  {
    key: 'erp_qc.coa',
    permissions: ['factory_quality.read'],
    when: (c) => c.kind === 'final' && (c.result === 'pass' || c.result === 'conditional'),
  },
];

export const NCR_ACTIONS: ActionRule<{
  status: ErpNcrStatus;
  disposition: ErpNcrDisposition | null;
  ready: boolean;
}>[] = [
  { key: 'erp_ncr.edit', permissions: ['factory_quality.record'], when: (n) => OPEN_NCR.includes(n.status) },
  {
    key: 'erp_ncr.dispose',
    permissions: ['factory_quality.manage'],
    when: (n) => OPEN_NCR.includes(n.status) && n.disposition === null,
  },
  {
    key: 'erp_ncr.verify',
    permissions: ['factory_quality.manage'],
    when: (n) => (OPEN_NCR.includes(n.status) ? (n.ready ? true : 'บันทึกวิธีจัดการและการแก้ไขก่อน') : false),
  },
  {
    key: 'erp_ncr.close',
    permissions: ['factory_quality.manage'],
    irreversible: true,
    when: (n) => n.status === 'verified',
  },
  {
    key: 'erp_ncr.cancel',
    permissions: ['factory_quality.manage'],
    irreversible: true,
    when: (n) => OPEN_NCR.includes(n.status) && n.disposition !== 'scrap',
  },
];

/**
 * Quality (D-372 – D-375): inspection templates, checks on receipts, operations and finished orders — their
 * result follows from the checkpoints — NCRs with a disposition (a scrap leaves stock) and corrective action
 * through to close, and the certificate of analysis of a passed final check.
 */
@Injectable()
export class ErpQualityService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly files: ErpFilesService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  // -------------------------------------------------------------------------------- templates

  async listTemplates(scope: ErpScope, q: ErpTemplateListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpInspectionTemplateWhereInput = {
      factoryId: scope.factory.id,
      status: (q.status ?? 'active') as ErpRecordStatus,
    };
    if (q.kind) where.kind = q.kind as ErpCheckKind;
    if (q.itemId) where.OR = [{ item: { publicId: q.itemId } }, { itemId: null }];
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpInspectionTemplate.findMany({
        where,
        include: TEMPLATE_INCLUDE,
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpInspectionTemplate.count({ where }),
    ]);
    return paginated(
      rows.map((r) => templateDto(r, perms)),
      total,
      q,
    );
  }

  async getTemplate(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpInspectionTemplateDto> {
    const row = await this.workspace.db.erpInspectionTemplate.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: TEMPLATE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return templateDto(row, perms);
  }

  async createTemplate(scope: ErpScope, body: ErpSaveInspectionTemplateDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const t = await tx.erpInspectionTemplate.create({
        data: {
          factoryId: scope.factory.id,
          name: body.name,
          kind: body.kind as ErpCheckKind,
          itemId: body.itemId ? (await this.item(tx, scope, body.itemId)).id : null,
          sampleSizeHint: body.sampleSizeHint ?? null,
          note: body.note ?? null,
          status: (body.status ?? 'active') as ErpRecordStatus,
          createdById: scope.actor.userId,
          checkpoints: { create: body.checkpoints.map((c, i) => checkpointData(c, i)) },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_inspection_template.created',
        'erp_inspection_template',
        t.publicId,
      );
      return t.publicId;
    });
    return this.getTemplate(scope, id, perms);
  }

  async updateTemplate(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveInspectionTemplateDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const t = await tx.erpInspectionTemplate.findFirst({
        where: { publicId, factoryId: scope.factory.id },
      });
      if (!t) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM erp_inspection_templates WHERE id = ${t.id} FOR UPDATE`;
      assertIfMatch(ifMatch, etagOf(t.publicId, t.rowVersion));
      await tx.erpInspectionCheckpoint.deleteMany({ where: { templateId: t.id } });
      await tx.erpInspectionTemplate.update({
        where: { id: t.id },
        data: {
          name: body.name,
          kind: body.kind as ErpCheckKind,
          itemId: body.itemId ? (await this.item(tx, scope, body.itemId)).id : null,
          sampleSizeHint: body.sampleSizeHint ?? null,
          note: body.note ?? null,
          ...(body.status && { status: body.status as ErpRecordStatus }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          checkpoints: { create: body.checkpoints.map((c, i) => checkpointData(c, i)) },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_inspection_template.updated',
        'erp_inspection_template',
        publicId,
      );
    });
    return this.getTemplate(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------------- checks

  async listChecks(scope: ErpScope, q: ErpQualityCheckListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpQualityCheckWhereInput = { factoryId: scope.factory.id };
    if (q.kind) where.kind = q.kind as ErpCheckKind;
    if (q.result) where.result = q.result as ErpCheckResult;
    if (q.itemId) where.item = { publicId: q.itemId };
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    if (q.productionOrderId) where.productionOrder = { publicId: q.productionOrderId };
    if (q.from || q.to)
      where.inspectedAt = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00+07:00`) }),
        ...(q.to && { lt: new Date(Date.parse(`${q.to}T00:00:00+07:00`) + 86_400_000) }),
      };
    if (q.q)
      where.OR = [
        { qcNo: { contains: q.q, mode: 'insensitive' } },
        { lotNo: { contains: q.q, mode: 'insensitive' } },
        { item: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpQualityCheck.findMany({
        where,
        include: CHECK_INCLUDE,
        orderBy: [{ inspectedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpQualityCheck.count({ where }),
    ]);
    const photos = await this.photoMap(
      this.workspace.db,
      rows.flatMap((r) => fileIds(r.photoFileIds)),
    );
    return paginated(
      rows.map((r) => checkDto(r, photos, perms)),
      total,
      q,
    );
  }

  async getCheck(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpQualityCheckDto> {
    const row = await this.checkRow(this.workspace.db, scope, publicId);
    return checkDto(row, await this.photoMap(this.workspace.db, fileIds(row.photoFileIds)), perms);
  }

  /** D-372: a check of a receipt line, an operation, a finished order or an item; points from its template. */
  async createCheck(scope: ErpScope, body: ErpCreateQualityCheckDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const f = scope.factory.id;
      let itemId: bigint | null = null;
      let supplierId: bigint | null = null;
      let grLineId: bigint | null = null;
      let operationId: bigint | null = null;
      let moId: bigint | null = null;
      let lotNo = body.lotNo ?? null;
      let inspected = body.inspectedQty ?? null;
      if (body.goodsReceiptId) {
        const line = await tx.erpGoodsReceiptLine.findFirst({
          where: { goodsReceipt: { publicId: body.goodsReceiptId, factoryId: f }, lineNo: body.lineNo ?? 1 },
          include: { goodsReceipt: true },
        });
        if (!line) throw new DomainException('http.not_found');
        grLineId = line.id;
        itemId = line.itemId;
        supplierId = line.goodsReceipt.supplierId;
        lotNo ??= line.lotNo;
        inspected ??= fmtQty(line.quantity);
      }
      if (body.operationId) {
        const op = await tx.erpProductionOperation.findFirst({
          where: { publicId: body.operationId, productionOrder: { factoryId: f } },
          include: { productionOrder: true },
        });
        if (!op) throw new DomainException('http.not_found');
        operationId = op.id;
        moId = op.productionOrderId;
        itemId ??= op.productionOrder.itemId;
      }
      if (body.productionOrderId) {
        const mo = await tx.erpProductionOrder.findFirst({
          where: { publicId: body.productionOrderId, factoryId: f },
        });
        if (!mo) throw new DomainException('http.not_found');
        moId = mo.id;
        itemId ??= mo.itemId;
        inspected ??= dec(mo.goodQty).gt(0) ? fmtQty(mo.goodQty) : fmtQty(mo.quantity);
      }
      if (body.itemId) itemId = (await this.item(tx, scope, body.itemId)).id;
      if (body.kind === 'incoming' && !grLineId && !itemId)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'goodsReceiptId', code: 'required', message: 'A goods receipt line or an item' }],
        });
      let points: ErpCheckpointInput[] = body.checkpoints ?? [];
      let templateId: bigint | null = null;
      if (body.templateId) {
        const t = await tx.erpInspectionTemplate.findFirst({
          where: { publicId: body.templateId, factoryId: f },
          include: { checkpoints: { orderBy: { seq: 'asc' } } },
        });
        if (!t) throw new DomainException('http.not_found');
        if (t.status === 'archived') throw new DomainException('erp.archived', { params: { name: t.name } });
        templateId = t.id;
        points = t.checkpoints.map((c) => ({
          name: c.name,
          type: c.type,
          unit: c.unit,
          minValue: c.minValue?.toString() ?? null,
          maxValue: c.maxValue?.toString() ?? null,
          targetValue: c.targetValue?.toString() ?? null,
          instruction: c.instruction,
        }));
      }
      const at = body.inspectedAt ? new Date(body.inspectedAt) : new Date();
      const check = await tx.erpQualityCheck.create({
        data: {
          factoryId: f,
          qcNo: await this.workspace.nextNumber(tx, f, 'qc', at),
          kind: body.kind as ErpCheckKind,
          templateId,
          itemId,
          goodsReceiptLineId: grLineId,
          operationId,
          productionOrderId: moId,
          supplierId,
          inspectorId: scope.actor.userId,
          lotNo,
          sampleSize: body.sampleSize ?? null,
          inspectedQty: inspected,
          remarks: body.remarks ?? null,
          inspectedAt: at,
          result: 'pending',
          createdById: scope.actor.userId,
          // A check keeps the limits; the instruction stays on the template.
          checkpoints: {
            create: points.map((c, i) => {
              const { instruction: _instruction, ...point } = checkpointData(c, i);
              return point;
            }),
          },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_quality_check.created',
        'erp_quality_check',
        check.publicId,
        {
          qcNo: check.qcNo,
          kind: check.kind,
        },
      );
      return check.publicId;
    });
    return this.getCheck(scope, id, perms);
  }

  /**
   * D-372: records readings and outcomes, quantities and photos; the result follows the points unless someone
   * with quality.manage set it. Once it is decided only quality.manage may change it. A fail opens an NCR.
   */
  async recordCheck(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpRecordQualityCheckDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const check = await this.lockCheck(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(check.publicId, check.rowVersion));
      if (check.result !== 'pending' && !perms.has('factory_quality.manage'))
        throw new DomainException('erp.invalid_status', { params: { status: check.result } });
      if (await this.locked(tx, check))
        throw new DomainException('erp.invalid_status', { params: { status: check.result } });
      const points = await tx.erpQualityCheckpoint.findMany({
        where: { checkId: check.id },
        orderBy: { seq: 'asc' },
      });
      for (const input of body.points ?? []) {
        const p = points.find((x) => x.seq === input.seq);
        if (!p)
          throw new DomainException('validation.failed', {
            errors: [{ path: 'points.seq', code: 'invalid', message: `No checkpoint ${input.seq}` }],
          });
        const measured =
          input.measured === undefined ? p.measured : input.measured === null ? null : dec(input.measured);
        const outcome: CheckpointOutcome | null =
          p.type === 'measurement'
            ? input.outcome === 'na'
              ? 'na'
              : measurementOutcome(
                  measured === null ? null : dec(measured),
                  p.minValue === null ? null : dec(p.minValue),
                  p.maxValue === null ? null : dec(p.maxValue),
                )
            : p.type === 'pass_fail'
              ? input.outcome === undefined
                ? p.outcome
                : (input.outcome as CheckpointOutcome | null)
              : null;
        const updated = await tx.erpQualityCheckpoint.update({
          where: { id: p.id },
          data: {
            measured: measured === null ? null : measured.toString(),
            outcome,
            ...(input.note !== undefined && { note: input.note }),
          },
        });
        Object.assign(p, updated);
      }
      const rejected = body.rejectedQty !== undefined ? dec(body.rejectedQty) : dec(check.rejectedQty);
      const result = check.resultOverridden
        ? check.result
        : checkResult(
            points.map((p) => ({ type: p.type, outcome: p.outcome })),
            rejected,
          );
      const photos =
        body.photoFileIds === undefined ? undefined : await this.photos(tx, scope, body.photoFileIds);
      await tx.erpQualityCheck.update({
        where: { id: check.id },
        data: {
          result,
          ...(body.sampleSize !== undefined && { sampleSize: body.sampleSize }),
          ...(body.inspectedQty !== undefined && { inspectedQty: body.inspectedQty }),
          ...(body.acceptedQty !== undefined && { acceptedQty: body.acceptedQty }),
          ...(body.rejectedQty !== undefined && { rejectedQty: body.rejectedQty }),
          ...(body.lotNo !== undefined && { lotNo: body.lotNo }),
          ...(body.remarks !== undefined && { remarks: body.remarks }),
          ...(photos && { photoFileIds: photos }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.decided(tx, scope, check, result);
    });
    return this.getCheck(scope, publicId, perms);
  }

  /** D-372: someone with quality.manage sets the result (with the reason in the remarks). */
  async overrideCheck(
    scope: ErpScope,
    publicId: string,
    body: ErpOverrideCheckDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const check = await this.lockCheck(tx, scope, publicId);
      if (await this.locked(tx, check))
        throw new DomainException('erp.invalid_status', { params: { status: check.result } });
      const result = body.result as ErpCheckResult;
      await tx.erpQualityCheck.update({
        where: { id: check.id },
        data: {
          result,
          resultOverridden: true,
          remarks: check.remarks ? `${check.remarks}\n${body.reason}` : body.reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_quality_check.overridden', 'erp_quality_check', publicId, {
        qcNo: check.qcNo,
        result,
      });
      await this.decided(tx, scope, check, result);
    });
    return this.getCheck(scope, publicId, perms);
  }

  /** D-375: the certificate of analysis of a passed final check, kept per version of the check. */
  async coa(scope: ErpScope, publicId: string): Promise<ErpPdfLinkDto> {
    const c = await this.checkRow(this.workspace.db, scope, publicId);
    if (c.kind !== 'final' || (c.result !== 'pass' && c.result !== 'conditional'))
      throw new DomainException('erp.check_not_passed');
    if (c.pdfFileId && c.pdfVersion === c.rowVersion) return this.files.link(c.pdfFileId);
    const settings = await this.workspace.settings(this.workspace.db, scope.factory.id);
    const address = await this.workspace.db.factoryAddress.findFirst({
      where: { factoryId: scope.factory.id, kind: 'registered' },
      orderBy: { id: 'asc' },
    });
    const html = renderCoaHtml({
      seller: {
        name: scope.factory.legalName,
        address: address ? [address.line1, address.line2, address.postcode].filter(Boolean).join(' ') : null,
        taxId: null,
        branchCode: null,
        phone: null,
      },
      logo: await this.files.logoDataUri(settings.documentLogoFileId),
      footer: settings.documentFooter,
      qcNo: c.qcNo,
      product: c.item?.name ?? c.productionOrder?.title ?? '-',
      sku: c.item?.sku ?? null,
      lotNo: c.lotNo,
      quantity: c.inspectedQty
        ? `${Number(c.inspectedQty).toLocaleString('th-TH')} ${c.item?.baseUnit ?? ''}`.trim()
        : null,
      orderNo: c.productionOrder?.moNo ?? null,
      inspectedOn: toBangkokIso(c.inspectedAt).slice(0, 10),
      inspector: c.inspector.displayName,
      result: c.result,
      points: c.checkpoints
        .filter((p) => p.type !== 'note')
        .map((p) => ({
          name: p.name,
          spec: specText(p),
          reading:
            p.measured === null ? '-' : `${trimNum(p.measured.toString())}${p.unit ? ` ${p.unit}` : ''}`,
          outcome: p.outcome ?? '',
        })),
      remarks: c.remarks,
    });
    const pdf = await this.renderer.render(html);
    const stored = await this.files.store(
      scope,
      pdf,
      `COA-${c.qcNo}.pdf`,
      'application/pdf',
      'financial_record',
    );
    await this.workspace.db.erpQualityCheck.update({
      where: { id: c.id },
      data: { pdfFileId: stored.fileId, pdfVersion: c.rowVersion },
    });
    await this.workspace.tx((tx) =>
      this.workspace.record(tx, scope, 'erp_quality_check.coa_issued', 'erp_quality_check', c.publicId, {
        qcNo: c.qcNo,
      }),
    );
    const { fileId: _ignored, ...link } = stored;
    return link;
  }

  // ------------------------------------------------------------------------------------- NCRs

  async listNcrs(scope: ErpScope, q: ErpNcrListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpNcrWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'active') where.status = { in: ACTIVE_NCR };
    else if (q.status) where.status = q.status as ErpNcrStatus;
    if (q.severity) where.severity = q.severity as ErpNcrSeverity;
    if (q.source) where.source = q.source as ErpNcrSource;
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    if (q.overdue) {
      where.status = { in: OPEN_NCR };
      where.actionDueOn = { lt: day(today()) };
    }
    if (q.q)
      where.OR = [
        { ncrNo: { contains: q.q, mode: 'insensitive' } },
        { title: { contains: q.q, mode: 'insensitive' } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpNcr.findMany({
        where,
        include: NCR_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpNcr.count({ where }),
    ]);
    const photos = await this.photoMap(
      this.workspace.db,
      rows.flatMap((r) => fileIds(r.photoFileIds)),
    );
    return paginated(
      rows.map((r) => ncrDto(r, photos, perms)),
      total,
      q,
    );
  }

  async getNcr(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpNcrDto> {
    const row = await this.workspace.db.erpNcr.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: NCR_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return ncrDto(row, await this.photoMap(this.workspace.db, fileIds(row.photoFileIds)), perms);
  }

  async createNcr(scope: ErpScope, body: ErpCreateNcrDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const f = scope.factory.id;
      const find = async <T>(publicId: string | undefined, q: (id: string) => Promise<T | null>) => {
        if (!publicId) return null;
        const found = await q(publicId);
        if (!found) throw new DomainException('http.not_found');
        return found;
      };
      const check = await find(body.checkId, (p) =>
        tx.erpQualityCheck.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const item = await find(body.itemId, (p) =>
        tx.erpItem.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const supplier = await find(body.supplierId, (p) =>
        tx.erpTradingPartner.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const customer = await find(body.customerId, (p) =>
        tx.erpTradingPartner.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const machine = await find(body.machineId, (p) =>
        tx.factoryMachine.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const mo = await find(body.productionOrderId, (p) =>
        tx.erpProductionOrder.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const gr = await find(body.goodsReceiptId, (p) =>
        tx.erpGoodsReceipt.findFirst({ where: { publicId: p, factoryId: f } }),
      );
      const warehouse = body.warehouseId ? await this.workspace.warehouse(tx, scope, body.warehouseId) : null;
      const owner = body.ownerId ? (await factoryUser(tx, f, body.ownerId)).id : scope.actor.userId;
      const ncr = await this.openNcr(tx, scope, {
        source: body.source as ErpNcrSource,
        severity: (body.severity ?? 'minor') as ErpNcrSeverity,
        title: body.title,
        description: body.description,
        checkId: check?.id ?? null,
        itemId: item?.id ?? check?.itemId ?? mo?.itemId ?? null,
        supplierId: supplier?.id ?? check?.supplierId ?? gr?.supplierId ?? null,
        customerId: customer?.id ?? null,
        machineId: machine?.id ?? null,
        productionOrderId: mo?.id ?? check?.productionOrderId ?? null,
        goodsReceiptId: gr?.id ?? null,
        warehouseId: warehouse?.id ?? gr?.warehouseId ?? mo?.warehouseId ?? null,
        quantity: body.quantity ?? null,
        unit: (body.unit ?? item?.baseUnit ?? null) as ErpUnit | null,
        ownerId: owner,
        actionDueOn: body.actionDueOn ? day(body.actionDueOn) : null,
        photoFileIds: await this.photos(tx, scope, body.photoFileIds ?? []),
      });
      return ncr.publicId;
    });
    return this.getNcr(scope, id, perms);
  }

  async updateNcr(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateNcrDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const ncr = await this.lockNcr(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(ncr.publicId, ncr.rowVersion));
      if (!OPEN_NCR.includes(ncr.status))
        throw new DomainException('erp.invalid_status', { params: { status: ncr.status } });
      const working =
        body.rootCause || body.correctiveAction || body.preventiveAction
          ? ('in_progress' as const)
          : ncr.status;
      await tx.erpNcr.update({
        where: { id: ncr.id },
        data: {
          status: working,
          ...(body.severity && { severity: body.severity as ErpNcrSeverity }),
          ...(body.title && { title: body.title }),
          ...(body.description && { description: body.description }),
          ...(body.rootCause !== undefined && { rootCause: body.rootCause }),
          ...(body.correctiveAction !== undefined && { correctiveAction: body.correctiveAction }),
          ...(body.preventiveAction !== undefined && { preventiveAction: body.preventiveAction }),
          ...(body.ownerId !== undefined && {
            ownerId: body.ownerId ? (await factoryUser(tx, scope.factory.id, body.ownerId)).id : null,
          }),
          ...(body.actionDueOn !== undefined && {
            actionDueOn: body.actionDueOn ? day(body.actionDueOn) : null,
          }),
          ...(body.quantity !== undefined && ncr.disposition !== 'scrap' && { quantity: body.quantity }),
          ...(body.warehouseId !== undefined &&
            ncr.disposition !== 'scrap' && {
              warehouseId: body.warehouseId
                ? (await this.workspace.warehouse(tx, scope, body.warehouseId)).id
                : null,
            }),
          ...(body.photoFileIds !== undefined && {
            photoFileIds: await this.photos(tx, scope, body.photoFileIds),
          }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_ncr.updated', 'erp_ncr', publicId, { ncrNo: ncr.ncrNo });
    });
    return this.getNcr(scope, publicId, perms);
  }

  /** D-374: what happens to the nonconforming goods; a scrap takes the quantity out of stock now. */
  async disposeNcr(scope: ErpScope, publicId: string, body: ErpDisposeNcrDto, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const ncr = await this.lockNcr(tx, scope, publicId);
      if (!OPEN_NCR.includes(ncr.status) || ncr.disposition !== null)
        throw new DomainException('erp.invalid_status', { params: { status: ncr.status } });
      const disposition = body.disposition as ErpNcrDisposition;
      if (disposition === 'scrap') {
        if (!ncr.itemId || !ncr.warehouseId || !ncr.quantity || !dec(ncr.quantity).gt(0))
          throw new DomainException('validation.failed', {
            errors: [
              {
                path: 'quantity',
                code: 'required',
                message: 'A scrap needs the item, quantity and warehouse',
              },
            ],
          });
        const [item, warehouse] = await Promise.all([
          tx.erpItem.findUniqueOrThrow({ where: { id: ncr.itemId } }),
          tx.erpWarehouse.findUniqueOrThrow({ where: { id: ncr.warehouseId } }),
        ]);
        await this.stock.post(
          tx,
          scope,
          await this.workspace.settings(tx, scope.factory.id),
          [
            {
              item,
              warehouse,
              kind: 'adjustment',
              quantity: dec(ncr.quantity).negated(),
              reason: `${ncr.ncrNo} ${ncr.title}`,
            },
          ],
          { type: 'ncr', publicId: ncr.publicId, documentNo: ncr.ncrNo },
        );
      }
      await tx.erpNcr.update({
        where: { id: ncr.id },
        data: {
          disposition,
          dispositionNote: body.note ?? null,
          dispositionAt: new Date(),
          status: 'in_progress',
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_ncr.disposed', 'erp_ncr', publicId, {
        ncrNo: ncr.ncrNo,
        disposition,
      });
    });
    return this.getNcr(scope, publicId, perms);
  }

  async verifyNcr(scope: ErpScope, publicId: string, note: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const ncr = await this.lockNcr(tx, scope, publicId);
      if (!OPEN_NCR.includes(ncr.status))
        throw new DomainException('erp.invalid_status', { params: { status: ncr.status } });
      if (!ready(ncr)) throw new DomainException('erp.ncr_action_required');
      await tx.erpNcr.update({
        where: { id: ncr.id },
        data: {
          status: 'verified',
          verifiedAt: new Date(),
          verifiedById: scope.actor.userId,
          verificationNote: note,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_ncr.verified', 'erp_ncr', publicId, { ncrNo: ncr.ncrNo });
    });
    return this.getNcr(scope, publicId, perms);
  }

  async closeNcr(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const ncr = await this.lockNcr(tx, scope, publicId);
      if (ncr.status !== 'verified')
        throw new DomainException('erp.invalid_status', { params: { status: ncr.status } });
      await tx.erpNcr.update({
        where: { id: ncr.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_ncr.closed', 'erp_ncr', publicId, { ncrNo: ncr.ncrNo });
    });
    return this.getNcr(scope, publicId, perms);
  }

  async cancelNcr(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const ncr = await this.lockNcr(tx, scope, publicId);
      if (!OPEN_NCR.includes(ncr.status) || ncr.disposition === 'scrap')
        throw new DomainException('erp.invalid_status', { params: { status: ncr.status } });
      await tx.erpNcr.update({
        where: { id: ncr.id },
        data: {
          status: 'cancelled',
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_ncr.cancelled', 'erp_ncr', publicId, { ncrNo: ncr.ncrNo });
    });
    return this.getNcr(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------------- helpers

  /** A failed check opens one NCR (D-372) with what the check knew; a failed receipt names the supplier. */
  private async decided(
    tx: ErpTx,
    scope: ErpScope,
    check: ErpQualityCheck,
    result: ErpCheckResult,
  ): Promise<void> {
    if (result === check.result && check.result !== 'pending') return;
    if (result !== 'pending')
      await this.workspace.record(
        tx,
        scope,
        'erp_quality_check.decided',
        'erp_quality_check',
        check.publicId,
        {
          qcNo: check.qcNo,
          result,
        },
      );
    if (result !== 'fail') return;
    const existing = await tx.erpNcr.count({ where: { checkId: check.id, status: { not: 'cancelled' } } });
    if (existing > 0) return;
    const fresh = await tx.erpQualityCheck.findUniqueOrThrow({
      where: { id: check.id },
      include: {
        item: true,
        goodsReceiptLine: { include: { goodsReceipt: true } },
        productionOrder: true,
        checkpoints: true,
      },
    });
    const failed = fresh.checkpoints.filter((p) => p.outcome === 'fail').map((p) => p.name);
    await this.openNcr(tx, scope, {
      source: fresh.kind === 'incoming' ? 'goods_receipt' : 'quality_check',
      severity: 'major',
      title: `${fresh.qcNo} ไม่ผ่าน${fresh.item ? ` — ${fresh.item.name}` : ''}`,
      description: failed.length ? `ไม่ผ่าน: ${failed.join(', ')}` : (fresh.remarks ?? 'ผลตรวจไม่ผ่าน'),
      checkId: fresh.id,
      itemId: fresh.itemId,
      supplierId: fresh.supplierId,
      customerId: null,
      machineId: null,
      productionOrderId: fresh.productionOrderId,
      goodsReceiptId: fresh.goodsReceiptLine?.goodsReceiptId ?? null,
      warehouseId:
        fresh.goodsReceiptLine?.goodsReceipt.warehouseId ?? fresh.productionOrder?.warehouseId ?? null,
      quantity: dec(fresh.rejectedQty).gt(0) ? fmtQty(fresh.rejectedQty) : null,
      unit: fresh.item?.baseUnit ?? null,
      ownerId: scope.actor.userId,
      actionDueOn: null,
      photoFileIds: fileIds(fresh.photoFileIds),
    });
  }

  private async openNcr(
    tx: ErpTx,
    scope: ErpScope,
    d: Omit<Prisma.ErpNcrUncheckedCreateInput, 'factoryId' | 'ncrNo' | 'createdById'>,
  ): Promise<ErpNcr> {
    const ncr = await tx.erpNcr.create({
      data: {
        ...d,
        factoryId: scope.factory.id,
        ncrNo: await this.workspace.nextNumber(tx, scope.factory.id, 'ncr'),
        createdById: scope.actor.userId,
      },
    });
    await this.workspace.record(tx, scope, 'erp_ncr.opened', 'erp_ncr', ncr.publicId, {
      ncrNo: ncr.ncrNo,
      severity: ncr.severity,
      source: ncr.source,
    });
    return ncr;
  }

  /** A check an NCR of has been closed or verified no longer changes. */
  private async locked(tx: ErpTx, check: ErpQualityCheck): Promise<boolean> {
    return (
      (await tx.erpNcr.count({ where: { checkId: check.id, status: { in: ['verified', 'closed'] } } })) > 0
    );
  }

  private async checkRow(db: ErpTx | ErpPrismaService, scope: ErpScope, publicId: string): Promise<CheckRow> {
    const row = await db.erpQualityCheck.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: CHECK_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private async lockCheck(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpQualityCheck> {
    const row = await tx.erpQualityCheck.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!row) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_quality_checks WHERE id = ${row.id} FOR UPDATE`;
    return row;
  }

  private async lockNcr(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpNcr> {
    const row = await tx.erpNcr.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!row) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_ncrs WHERE id = ${row.id} FOR UPDATE`;
    return await tx.erpNcr.findUniqueOrThrow({ where: { id: row.id } });
  }

  private async item(tx: ErpTx, scope: ErpScope, publicId: string) {
    const item = await tx.erpItem.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!item) throw new DomainException('http.not_found');
    return item;
  }

  /** Photos must be clean uploads of this factory; stored by public id. */
  private async photos(tx: ErpTx, scope: ErpScope, publicIds: string[]): Promise<string[]> {
    if (publicIds.length === 0) return [];
    const files = await tx.fileObject.findMany({ where: { publicId: { in: publicIds } } });
    if (
      files.length !== new Set(publicIds).size ||
      files.some(
        (f) =>
          f.ownerFactoryId !== scope.factory.id ||
          f.uploadStatus !== 'uploaded' ||
          f.scanStatus === 'infected',
      )
    )
      throw new DomainException('erp.file_not_usable');
    return [...new Set(publicIds)];
  }

  private async photoMap(db: ErpTx | ErpPrismaService, publicIds: string[]): Promise<Map<string, Photo>> {
    if (publicIds.length === 0) return new Map();
    const files = await db.fileObject.findMany({ where: { publicId: { in: [...new Set(publicIds)] } } });
    return new Map(
      files.map((f) => [f.publicId, { fileId: f.publicId, name: f.originalName, mimeType: f.mimeType }]),
    );
  }
}

// --------------------------------------------------------------------------------------- views

const fileIds = (json: Prisma.JsonValue): string[] =>
  Array.isArray(json) ? json.filter((x): x is string => typeof x === 'string') : [];

const trimNum = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(4));

function checkpointData(c: ErpCheckpointInput, i: number) {
  return {
    seq: i + 1,
    name: c.name,
    type: c.type as ErpCheckpointType,
    unit: c.unit ?? null,
    minValue: c.type === 'measurement' ? (c.minValue ?? null) : null,
    maxValue: c.type === 'measurement' ? (c.maxValue ?? null) : null,
    targetValue: c.type === 'measurement' ? (c.targetValue ?? null) : null,
    instruction: c.instruction ?? null,
  };
}

/** The limit as printed: "2.9 – 3.3 mm", "≥ 2.9 mm", "≤ 3.3 mm", or pass / fail. */
export function specText(p: {
  type: string;
  unit: string | null;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  targetValue: Prisma.Decimal | null;
}): string {
  if (p.type !== 'measurement') return 'ผ่าน / ไม่ผ่าน';
  const u = p.unit ? ` ${p.unit}` : '';
  const min = p.minValue === null ? null : trimNum(p.minValue.toString());
  const max = p.maxValue === null ? null : trimNum(p.maxValue.toString());
  const range = min && max ? `${min} – ${max}${u}` : min ? `≥ ${min}${u}` : max ? `≤ ${max}${u}` : '-';
  return p.targetValue === null ? range : `${range} (เป้า ${trimNum(p.targetValue.toString())})`;
}

const ready = (n: Pick<ErpNcr, 'disposition' | 'correctiveAction'>) =>
  n.disposition !== null && !!n.correctiveAction;

export function templateDto(r: TemplateRow, perms: ReadonlySet<string>): ErpInspectionTemplateDto {
  return {
    id: r.publicId,
    name: r.name,
    kind: r.kind,
    item: r.item ? itemRef(r.item) : null,
    sampleSizeHint: r.sampleSizeHint,
    note: r.note,
    status: r.status,
    checkpoints: r.checkpoints.map((c) => ({
      seq: c.seq,
      name: c.name,
      type: c.type,
      unit: c.unit,
      minValue: num(c.minValue),
      maxValue: num(c.maxValue),
      targetValue: num(c.targetValue),
      instruction: c.instruction,
    })),
    checks: r._count.checks,
    nextActions: nextActions({ status: r.status }, TEMPLATE_ACTIONS, perms),
    version: r.rowVersion,
  };
}

export function checkDto(
  r: CheckRow,
  photos: Map<string, Photo>,
  perms: ReadonlySet<string>,
): ErpQualityCheckDto {
  const locked = r.ncrs.some((n) => n.status === 'verified' || n.status === 'closed');
  return {
    id: r.publicId,
    qcNo: r.qcNo,
    kind: r.kind,
    result: r.result,
    resultOverridden: r.resultOverridden,
    template: r.template ? { id: r.template.publicId, code: r.template.kind, name: r.template.name } : null,
    item: r.item ? itemRef(r.item) : null,
    goodsReceipt: r.goodsReceiptLine
      ? { id: r.goodsReceiptLine.goodsReceipt.publicId, number: r.goodsReceiptLine.goodsReceipt.grNo }
      : null,
    lineNo: r.goodsReceiptLine?.lineNo ?? null,
    productionOrder: r.productionOrder
      ? { id: r.productionOrder.publicId, number: r.productionOrder.moNo }
      : null,
    operation: r.operation?.name ?? null,
    supplier: r.supplier ? partnerRef(r.supplier) : null,
    inspector: userRef(r.inspector)!,
    lotNo: r.lotNo,
    sampleSize: r.sampleSize === null ? null : fmtQty(r.sampleSize),
    inspectedQty: r.inspectedQty === null ? null : fmtQty(r.inspectedQty),
    acceptedQty: r.acceptedQty === null ? null : fmtQty(r.acceptedQty),
    rejectedQty: fmtQty(r.rejectedQty),
    remarks: r.remarks,
    inspectedAt: toBangkokIso(r.inspectedAt),
    checkpoints: r.checkpoints.map((c) => ({
      seq: c.seq,
      name: c.name,
      type: c.type,
      unit: c.unit,
      minValue: num(c.minValue),
      maxValue: num(c.maxValue),
      targetValue: num(c.targetValue),
      instruction: null,
      measured: num(c.measured),
      outcome: c.outcome,
      note: c.note,
    })),
    photos: fileIds(r.photoFileIds).flatMap((id) => (photos.has(id) ? [photos.get(id)!] : [])),
    ncrs: r.ncrs.map((n) => ({ id: n.publicId, ncrNo: n.ncrNo, status: n.status })),
    nextActions: nextActions({ result: r.result, kind: r.kind, locked }, CHECK_ACTIONS, perms),
    version: r.rowVersion,
  };
}

export function ncrDto(r: NcrRow, photos: Map<string, Photo>, perms: ReadonlySet<string>): ErpNcrDto {
  const overdue = OPEN_NCR.includes(r.status) && !!r.actionDueOn && iso(r.actionDueOn)! < today();
  return {
    id: r.publicId,
    ncrNo: r.ncrNo,
    source: r.source,
    severity: r.severity,
    status: r.status,
    title: r.title,
    description: r.description,
    check: r.check ? { id: r.check.publicId, number: r.check.qcNo } : null,
    item: r.item ? itemRef(r.item) : null,
    supplier: r.supplier ? partnerRef(r.supplier) : null,
    customer: r.customer ? partnerRef(r.customer) : null,
    machine: r.machine ? { id: r.machine.publicId, name: r.machine.name } : null,
    productionOrder: r.productionOrder
      ? { id: r.productionOrder.publicId, number: r.productionOrder.moNo }
      : null,
    goodsReceipt: r.goodsReceipt ? { id: r.goodsReceipt.publicId, number: r.goodsReceipt.grNo } : null,
    warehouse: r.warehouse ? warehouseRef(r.warehouse) : null,
    quantity: r.quantity === null ? null : fmtQty(r.quantity),
    unit: r.unit,
    disposition: r.disposition,
    dispositionNote: r.dispositionNote,
    dispositionAt: isoTs(r.dispositionAt),
    rootCause: r.rootCause,
    correctiveAction: r.correctiveAction,
    preventiveAction: r.preventiveAction,
    owner: userRef(r.owner),
    actionDueOn: iso(r.actionDueOn),
    overdue,
    verifiedBy: userRef(r.verifiedBy),
    verifiedAt: isoTs(r.verifiedAt),
    verificationNote: r.verificationNote,
    closedAt: isoTs(r.closedAt),
    cancelReason: r.cancelReason,
    photos: fileIds(r.photoFileIds).flatMap((id) => (photos.has(id) ? [photos.get(id)!] : [])),
    createdBy: r.createdBy.displayName,
    createdAt: toBangkokIso(r.createdAt),
    nextActions: nextActions(
      { status: r.status, disposition: r.disposition, ready: ready(r) },
      NCR_ACTIONS,
      perms,
    ),
    version: r.rowVersion,
  };
}
