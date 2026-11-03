import { randomUUID } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { EntitiesService } from '@platform/entities/entities.service';
import ExcelJS from 'exceljs';

import {
  type PnlCellDto,
  type PnlGridDto,
  type PnlLineCatalogueDto,
  type PnlLineDto,
  type PnlMonthDto,
  type PnlPlanDto,
  type PnlSourceItemDto,
  type PnlVarianceCellDto,
  type PnlVarianceDto,
} from './pnl.dto';
import { monthInfos, yearMonths } from './pnl-auto';
import { PnlComputeService } from './pnl-compute.service';
import { matchesMapping, monthDate, monthOf, PnlDataService } from './pnl-data.service';
import { computePlan, type LineValues, pctOf, planTotals } from './pnl-engine';
import {
  isPnlLineKey,
  PNL_LINE_BY_KEY,
  PNL_LINES,
  type PnlLineCatalogue,
  type PnlLineDef,
  type PnlLineKey,
} from './pnl-lines';
import { cellEtag, planEtag, type PlanRow, PnlPlansService } from './pnl-plans.service';

const URL_TTL_SECONDS = 5 * 60;
const D = (v: { toString(): string } | null | undefined) =>
  v === null || v === undefined ? null : new MoneyDecimal(v.toString());
const s2 = (v: MoneyValue | null | undefined) =>
  v === null || v === undefined ? null : v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
const DRILLABLE = new Set([
  'gl',
  'pipeline_run_rate',
  'trailing_ratio',
  'trailing_average',
  'commission_rates',
  'fixed_assets',
  'balances',
]);

export function planDto(p: PlanRow): PnlPlanDto {
  return {
    id: p.publicId,
    name: p.name,
    fiscalYear: p.fiscalYear,
    scenario: p.scenario,
    status: p.status,
    version: p.version,
    note: p.note,
    owner: { id: p.owner.publicId, displayName: p.owner.displayName ?? '' },
    copiedFromId: p.copiedFrom?.publicId ?? null,
    computedAt: p.computedAt ? toBangkokIso(p.computedAt) : null,
    lockedAt: p.lockedAt ? toBangkokIso(p.lockedAt) : null,
    lockedBy: p.lockedBy ? { id: p.lockedBy.publicId, displayName: p.lockedBy.displayName ?? '' } : null,
    snapshotSha256: p.snapshotSha256 ? Buffer.from(p.snapshotSha256).toString('hex') : null,
    etag: planEtag(p),
    createdAt: toBangkokIso(p.createdAt),
    updatedAt: toBangkokIso(p.updatedAt),
  };
}

const CELL_INCLUDE = {
  updatedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.PnlPlanCellInclude;

/**
 * D-472: what the P&L screens read — the line catalogue with tooltips, the grid with totals and the summary strip,
 * plan vs actual, the drill-down to source records — and the watermarked export. Grid, variance and export views are
 * written to the append-only access log (D-444 pattern); exports are audited.
 */
@Injectable()
export class PnlViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PnlPlansService,
    private readonly compute: PnlComputeService,
    private readonly data: PnlDataService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  // --- catalogue ---------------------------------------------------------------------------------------------------

  private async lineDtos(catalogue: PnlLineCatalogue): Promise<Map<PnlLineKey, PnlLineDto>> {
    const entityId = await this.entities.defaultEntityId();
    const codes = [
      ...new Set(PNL_LINES.flatMap((l) => catalogue.lines[l.key].glAccounts.map((g) => g.code))),
    ];
    const accounts = await this.prisma.account.findMany({
      where: { entityId, code: { in: codes } },
      select: { code: true, nameTh: true, nameEn: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    return new Map(
      PNL_LINES.map((l) => {
        const e = catalogue.lines[l.key];
        return [
          l.key,
          {
            key: l.key,
            group: l.group,
            unit: l.unit,
            calc: l.calc,
            inTotal: l.inTotal,
            editable: l.editable,
            mapped: e.glAccounts.length > 0,
            labelTh: e.labelTh,
            labelEn: e.labelEn,
            definition: e.definition,
            formula: e.formula,
            source: e.source,
            howToFill: e.howToFill,
            glAccounts: e.glAccounts.map((g) => ({
              code: g.code,
              nameTh: byCode.get(g.code)?.nameTh ?? null,
              nameEn: byCode.get(g.code)?.nameEn ?? null,
              onlyRules: g.onlyRules ?? [],
              excludeRules: g.excludeRules ?? [],
            })),
          },
        ];
      }),
    );
  }

  async catalogue(): Promise<PnlLineCatalogueDto> {
    const now = new Date();
    const settings = await this.compute.settingsInForce(now);
    const lines = await this.lineDtos(settings.catalogue);
    const version = await this.prisma.settingVersion.findUniqueOrThrow({
      where: { id: settings.catalogueVersionId },
      select: { effectiveFrom: true },
    });
    return {
      effectiveFrom: toBangkokIso(version.effectiveFrom),
      lines: PNL_LINES.map((l) => lines.get(l.key)!),
    };
  }

  // --- access log --------------------------------------------------------------------------------------------------

  async logAccess(actor: UserActor, plan: PlanRow, purpose: 'view' | 'variance' | 'export', format?: string) {
    await this.prisma.pnlAccessLog.create({
      data: {
        planId: plan.id,
        viewerUserId: actor.userId,
        purpose,
        format: format ?? null,
        requestId: RequestContext.current()?.requestId ?? null,
      },
    });
  }

  private async monthDtos(plan: PlanRow): Promise<PnlMonthDto[]> {
    const months = yearMonths(plan.fiscalYear);
    const status = await this.data.periodStatus(plan.entityId, months);
    return monthInfos(plan.fiscalYear, bangkokDate(new Date()).slice(0, 7), status);
  }

  // --- grid --------------------------------------------------------------------------------------------------------

  async grid(plan: PlanRow): Promise<PnlGridDto> {
    const [settings, cells, months] = await Promise.all([
      this.compute.settingsInForce(new Date()),
      this.prisma.pnlPlanCell.findMany({ where: { planId: plan.id }, include: CELL_INCLUDE }),
      this.monthDtos(plan),
    ]);
    const lines = await this.lineDtos(settings.catalogue);
    const byKey = new Map(cells.map((c) => [`${c.lineKey}|${monthOf(c.month)}`, c]));
    const monthKeys = months.map((m) => m.month);
    const values = {} as Record<PnlLineKey, (MoneyValue | null)[]>;
    for (const l of PNL_LINES) values[l.key] = monthKeys.map((m) => D(byKey.get(`${l.key}|${m}`)?.value));
    const totals = planTotals(values, monthKeys.length);
    let emptyManualCells = 0;
    const rows = PNL_LINES.map((l) => ({
      line: lines.get(l.key)!,
      total: s2(totals[l.key]),
      cells: monthKeys.map((m): PnlCellDto => {
        const c = byKey.get(`${l.key}|${m}`);
        if (!c) {
          if (l.editable) emptyManualCells += 1;
          return {
            month: m,
            value: null,
            mode: l.calc === 'formula' ? 'calculated' : 'manual',
            autoValue: null,
            source: 'none',
            sourceRef: null,
            note: null,
            periodOpen: false,
            asOf: null,
            updatedBy: null,
            updatedAt: null,
            etag: cellEtag(plan.publicId, l.key, m, 0),
            drillable: false,
          };
        }
        if (l.editable && c.value === null) emptyManualCells += 1;
        return {
          month: m,
          value: c.value?.toFixed(2) ?? null,
          mode: c.mode,
          autoValue: c.autoValue?.toFixed(2) ?? null,
          source: c.source,
          sourceRef: (c.sourceRef as Record<string, unknown> | null) ?? null,
          note: c.note,
          periodOpen: c.periodOpen,
          asOf: c.asOf ? toBangkokIso(c.asOf) : null,
          updatedBy: c.updatedBy
            ? { id: c.updatedBy.publicId, displayName: c.updatedBy.displayName ?? '' }
            : null,
          updatedAt: toBangkokIso(c.updatedAt),
          etag: cellEtag(plan.publicId, l.key, m, c.rowVersion),
          drillable: DRILLABLE.has(c.source) && c.autoValue !== null,
        };
      }),
    }));
    const t = (k: PnlLineKey) => totals[k];
    const commissions =
      t('agent_commission') === null && t('employee_commission') === null
        ? null
        : (t('agent_commission') ?? new MoneyDecimal(0)).add(t('employee_commission') ?? 0);
    const contribution = t('gross_margin') === null ? null : t('gross_margin')!.sub(commissions ?? 0);
    const net = t('net_revenue');
    const citRef = byKey.get(`cit_estimate|${monthKeys[0]}`)?.sourceRef as { smeApplied?: boolean } | null;
    return {
      plan: planDto(plan),
      currency: 'THB',
      months,
      lines: rows,
      summary: {
        netRevenue: s2(net),
        grossMargin: s2(t('gross_margin')),
        grossMarginPct: net && t('gross_margin') ? s2(pctOf(t('gross_margin')!, net)) : null,
        contributionAfterCommission: s2(contribution),
        contributionAfterCommissionPct: net && contribution ? s2(pctOf(contribution, net)) : null,
        ebitda: s2(t('memo_ebitda')),
        netProfit: s2(t('net_profit')),
        cashConversionDays: s2(t('memo_ccc')),
        breakEvenRevenue: s2(t('memo_break_even')),
        citSmeApplied: citRef?.smeApplied === true,
        emptyManualCells,
      },
    };
  }

  // --- plan vs actual ------------------------------------------------------------------------------------------------

  async variance(plan: PlanRow): Promise<PnlVarianceDto> {
    const auto = await this.compute.autoValues(plan.fiscalYear);
    const [cells, notes, lines] = await Promise.all([
      this.prisma.pnlPlanCell.findMany({ where: { planId: plan.id } }),
      this.prisma.pnlVarianceNote.findMany({
        where: { planId: plan.id },
        include: { updatedBy: { select: { publicId: true, displayName: true } } },
      }),
      this.lineDtos(auto.settings.catalogue),
    ]);
    const byKey = new Map(cells.map((c) => [`${c.lineKey}|${monthOf(c.month)}`, c]));
    const noteByKey = new Map(notes.map((n) => [`${n.lineKey}|${monthOf(n.month)}`, n]));
    const months = auto.months.map((m) => m.month);
    const actualIdx = auto.months.flatMap((m, i) => (m.kind === 'actual' ? [i] : []));
    const planValues = {} as Record<PnlLineKey, (MoneyValue | null)[]>;
    for (const l of PNL_LINES) planValues[l.key] = months.map((m) => D(byKey.get(`${l.key}|${m}`)?.value));
    // Actuals: posted figures where the line has an actual source, else the plan value (flagged on formulas).
    const actualInput: LineValues = {};
    const fromPlan = months.map(() => false);
    const hasActual = new Map<PnlLineKey, boolean[]>();
    for (const l of PNL_LINES) {
      if (l.calc !== 'source') continue;
      const auto_ = auto.cells.get(l.key)!;
      const flags = months.map((_, i) => {
        const a = auto_[i]!;
        return (
          auto.months[i]!.kind === 'actual' &&
          (a.source === 'gl' || a.source === 'balances') &&
          a.value !== null
        );
      });
      hasActual.set(l.key, flags);
      actualInput[l.key] = months.map((_, i) => {
        if (flags[i]) return auto_[i]!.value;
        if (l.inTotal && auto.months[i]!.kind === 'actual' && planValues[l.key][i] !== null)
          fromPlan[i] = true;
        return planValues[l.key][i] ?? null;
      });
    }
    const actual = computePlan({
      months,
      values: actualInput,
      cit: auto.settings.cit,
      costOfCapitalPct: auto.settings.costOfCapitalPct,
    });
    const subset = (v: Record<PnlLineKey, (MoneyValue | null)[]>) => {
      const out = {} as Record<PnlLineKey, (MoneyValue | null)[]>;
      for (const l of PNL_LINES) out[l.key] = actualIdx.map((i) => v[l.key][i] ?? null);
      return out;
    };
    const planT = planTotals(subset(planValues), actualIdx.length);
    const actualT = planTotals(subset(actual.months), actualIdx.length);
    const diff = (a: MoneyValue | null, p: MoneyValue | null) => {
      if (a === null || p === null) return { variance: null, variancePct: null };
      const v = a.sub(p);
      return { variance: s2(v), variancePct: p.isZero() ? null : s2(v.div(p.abs()).mul(100)) };
    };
    return {
      plan: planDto(plan),
      currency: 'THB',
      asOf: toBangkokIso(auto.asOf),
      months: auto.months,
      lines: PNL_LINES.map((l) => {
        const cellsOut = months.map((m, i): PnlVarianceCellDto => {
          const n = noteByKey.get(`${l.key}|${m}`);
          const isActual = auto.months[i]!.kind === 'actual';
          const p = planValues[l.key][i] ?? null;
          const basis: PnlVarianceCellDto['actualBasis'] = !isActual
            ? 'not_yet'
            : l.calc === 'formula'
              ? fromPlan[i]
                ? 'includes_plan_values'
                : 'calculated'
              : hasActual.get(l.key)![i]
                ? 'ledger'
                : 'none';
          const a = basis === 'not_yet' || basis === 'none' ? null : (actual.months[l.key][i] ?? null);
          return {
            month: m,
            plan: s2(p),
            actual: s2(a),
            ...diff(a, p),
            actualBasis: basis,
            note: n?.note ?? null,
            noteBy: n ? { id: n.updatedBy.publicId, displayName: n.updatedBy.displayName ?? '' } : null,
            noteUpdatedAt: n ? toBangkokIso(n.updatedAt) : null,
          };
        });
        const totalActual = actualIdx.length === 0 ? null : actualT[l.key];
        const totalPlan = actualIdx.length === 0 ? null : planT[l.key];
        const td = diff(totalActual, totalPlan);
        return {
          line: lines.get(l.key)!,
          cells: cellsOut,
          totalPlan: s2(totalPlan),
          totalActual: s2(totalActual),
          totalVariance: td.variance,
          totalVariancePct: td.variancePct,
        };
      }),
    };
  }

  async setVarianceNote(actor: UserActor, plan: PlanRow, lineKey: string, month: string, note: string) {
    if (!isPnlLineKey(lineKey) || !yearMonths(plan.fiscalYear).includes(month))
      throw new DomainException('http.not_found');
    await this.prisma.withTx(async (tx) => {
      const key = { planId: plan.id, lineKey, month: monthDate(month) };
      const prior = await tx.pnlVarianceNote.findUnique({ where: { planId_lineKey_month: key } });
      await tx.pnlVarianceNote.upsert({
        where: { planId_lineKey_month: key },
        create: { ...key, note: note.trim(), updatedById: actor.userId },
        update: { note: note.trim(), updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'pnl_variance_note.set',
        actor,
        resourceType: 'pnl_plan',
        resourcePublicId: plan.publicId,
        data: { lineKey, month, before: prior?.note ?? null, after: note.trim() },
      });
      await this.plans.recordEvent(tx, plan, 'pnl_variance_note.set', actor, { lineKey, month });
    });
  }

  // --- drill-down -------------------------------------------------------------------------------------------------------

  async sources(
    plan: PlanRow,
    lineKey: string,
    month: string,
    page: number,
    perPage: number,
    kind?: PnlSourceItemDto['kind'],
  ): Promise<{ data: PnlSourceItemDto[]; total: number }> {
    if (!isPnlLineKey(lineKey) || !yearMonths(plan.fiscalYear).includes(month))
      throw new DomainException('http.not_found');
    const line = PNL_LINE_BY_KEY.get(lineKey)!;
    const cell = await this.prisma.pnlPlanCell.findUnique({
      where: { planId_lineKey_month: { planId: plan.id, lineKey, month: monthDate(month) } },
    });
    if (!cell || line.calc === 'formula') return { data: [], total: 0 };
    const settings = await this.compute.settingsInForce(new Date());
    const catalogue = settings.catalogue;
    const window = ((cell.sourceRef as { window?: string[] } | null)?.window ?? []).filter((m) =>
      /^\d{4}-\d{2}$/.test(m),
    );
    switch (kind ?? this.defaultKind(cell.source)) {
      case 'commission':
        return this.commissionItems(line, month, page, perPage);
      case 'lead':
        return this.leadItems(settings.rules.stageProbabilityPct, line, page, perPage);
      case 'fixed_asset':
        return this.assetItems(plan.entityId, page, perPage);
      case 'customer_run_rate':
        return this.runRateItems(
          plan.entityId,
          catalogue,
          window,
          settings.rules.repeatMinMonths,
          page,
          perPage,
        );
      case 'gl_line': {
        const months = cell.source === 'gl' || cell.source === 'balances' ? [month] : window;
        return this.glItems(plan.entityId, catalogue, line, months, page, perPage);
      }
      default:
        return { data: [], total: 0 };
    }
  }

  private defaultKind(source: string): PnlSourceItemDto['kind'] | null {
    if (source === 'pipeline_run_rate' || source === 'commission_rates') return 'lead';
    if (source === 'fixed_assets') return 'fixed_asset';
    if (['gl', 'balances', 'trailing_ratio', 'trailing_average'].includes(source)) return 'gl_line';
    return null;
  }

  private async glItems(
    entityId: bigint,
    catalogue: PnlLineCatalogue,
    line: PnlLineDef,
    months: string[],
    page: number,
    perPage: number,
  ) {
    const mapping = catalogue.lines[line.key].glAccounts;
    if (mapping.length === 0 || months.length === 0) return { data: [], total: 0 };
    const sorted = [...months].sort();
    const where: Prisma.JournalLineWhereInput = {
      entityId,
      account: { code: { in: mapping.map((g) => g.code) } },
      journalEntry: { status: 'posted' },
      fiscalPeriod: { startDate: { gte: monthDate(sorted[0]!), lte: monthDate(sorted.at(-1)!) } },
    };
    // Posting-rule filters (6160 split) are applied in memory on the page's candidates, so the whole set is read
    // as ids first; P&L months are small enough for that.
    const candidates = await this.prisma.journalLine.findMany({
      where,
      select: {
        id: true,
        account: { select: { code: true } },
        journalEntry: {
          select: {
            postingRule: { select: { key: true } },
            reverses: { select: { postingRule: { select: { key: true } } } },
          },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    });
    const ids = candidates
      .filter((c) => {
        const rule = c.journalEntry.postingRule?.key ?? c.journalEntry.reverses?.postingRule?.key ?? null;
        return mapping.some((g) => matchesMapping(g, c.account.code, rule));
      })
      .map((c) => c.id);
    const pageIds = ids.slice((page - 1) * perPage, page * perPage);
    const rows = await this.prisma.journalLine.findMany({
      where: { id: { in: pageIds } },
      include: {
        account: { select: { code: true } },
        order: { select: { publicId: true, orderCode: true } },
        journalEntry: {
          select: {
            publicId: true,
            entryNo: true,
            description: true,
            sourceDocumentType: true,
            sourceDocumentPublicId: true,
            sourceDocumentNo: true,
          },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    });
    const credit = line.key === 'revenue_goods' || line.key === 'revenue_shipping' || line.key === 'memo_dpo';
    return {
      total: ids.length,
      data: rows.map((l) => ({
        kind: 'gl_line' as const,
        id: l.journalEntry.publicId,
        code: l.journalEntry.entryNo,
        date: l.entryDate.toISOString().slice(0, 10),
        amount: (credit ? l.credit.sub(l.debit) : l.debit.sub(l.credit)).toFixed(2),
        accountCode: l.account.code,
        description: l.description ?? l.journalEntry.description,
        sourceDocumentType: l.journalEntry.sourceDocumentType,
        sourceDocumentId: l.journalEntry.sourceDocumentPublicId,
        sourceDocumentNo: l.journalEntry.sourceDocumentNo,
        orderId: l.order?.publicId ?? null,
        orderCode: l.order?.orderCode ?? null,
      })),
    };
  }

  private async commissionItems(line: PnlLineDef, month: string, page: number, perPage: number) {
    if (line.key !== 'agent_commission' && line.key !== 'employee_commission') return { data: [], total: 0 };
    const start = monthDate(month);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    // Earned in the Bangkok month (the window shifted by 7 hours).
    const shift = 7 * 3600 * 1000;
    const where: Prisma.SalesAgentCommissionWhereInput = {
      status: { not: 'cancelled' },
      earnedAt: { gte: new Date(start.getTime() - shift), lt: new Date(end.getTime() - shift) },
      agent: { kind: line.key === 'agent_commission' ? 'freelance' : 'employee' },
    };
    const [rows, total] = await Promise.all([
      this.prisma.salesAgentCommission.findMany({
        where,
        include: {
          order: { select: { publicId: true, orderCode: true } },
          agent: { select: { code: true } },
        },
        orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentCommission.count({ where }),
    ]);
    return {
      total,
      data: rows.map((c) => ({
        kind: 'commission' as const,
        id: c.publicId,
        code: c.agent.code,
        date: c.earnedAt ? bangkokDate(c.earnedAt) : null,
        amount: c.amount.toFixed(2),
        accountCode: null,
        description: null,
        sourceDocumentType: null,
        sourceDocumentId: null,
        sourceDocumentNo: null,
        orderId: c.order?.publicId ?? null,
        orderCode: c.order?.orderCode ?? null,
      })),
    };
  }

  private async leadItems(
    probability: Record<string, string>,
    line: PnlLineDef,
    page: number,
    perPage: number,
  ) {
    const leads = (await this.data.pipeline(new Date())).filter(
      (l) =>
        line.key === 'revenue_goods' ||
        (line.key === 'agent_commission' && l.agentKind === 'freelance') ||
        (line.key === 'employee_commission' && l.agentKind === 'employee'),
    );
    const isCommission = line.key !== 'revenue_goods';
    return {
      total: leads.length,
      data: leads.slice((page - 1) * perPage, page * perPage).map((l) => {
        const weighted = new MoneyDecimal(l.value).mul(probability[l.stage] ?? 0).div(100);
        const amount = isCommission ? weighted.mul(l.ratePct ?? 0).div(100) : weighted;
        return {
          kind: 'lead' as const,
          id: l.leadId,
          code: null,
          date: null,
          amount: s2(amount),
          accountCode: null,
          // Stage only: no contact data in the P&L.
          description: l.stage,
          sourceDocumentType: null,
          sourceDocumentId: null,
          sourceDocumentNo: null,
          orderId: null,
          orderCode: null,
        };
      }),
    };
  }

  private async assetItems(entityId: bigint, page: number, perPage: number) {
    const where: Prisma.FixedAssetWhereInput = { entityId, status: { in: ['active', 'fully_depreciated'] } };
    const [rows, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        select: { publicId: true, assetNo: true, name: true, acquiredOn: true, cost: true },
        orderBy: { id: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return {
      total,
      data: rows.map((a) => ({
        kind: 'fixed_asset' as const,
        id: a.publicId,
        code: a.assetNo,
        date: a.acquiredOn.toISOString().slice(0, 10),
        amount: a.cost.toFixed(2),
        accountCode: null,
        description: a.name,
        sourceDocumentType: null,
        sourceDocumentId: null,
        sourceDocumentNo: null,
        orderId: null,
        orderCode: null,
      })),
    };
  }

  private async runRateItems(
    entityId: bigint,
    catalogue: PnlLineCatalogue,
    window: string[],
    minMonths: number,
    page: number,
    perPage: number,
  ) {
    const rows = await this.data.revenueByCustomer(entityId, catalogue, window);
    const byCustomer = new Map<string, { months: Set<string>; amount: MoneyValue }>();
    for (const r of rows) {
      const c = byCustomer.get(r.customerKey) ?? { months: new Set<string>(), amount: new MoneyDecimal(0) };
      if (new MoneyDecimal(r.amount).gt(0)) c.months.add(r.month);
      c.amount = c.amount.add(r.amount);
      byCustomer.set(r.customerKey, c);
    }
    const repeat = [...byCustomer].filter(([, c]) => c.months.size >= minMonths && c.amount.gt(0));
    const companyIds = repeat.filter(([k]) => k.startsWith('c:')).map(([k]) => BigInt(k.slice(2)));
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, publicId: true },
    });
    const companyId = new Map(companies.map((c) => [`c:${c.id}`, c.publicId]));
    return {
      total: repeat.length,
      data: repeat.slice((page - 1) * perPage, page * perPage).map(([k, c]) => ({
        kind: 'customer_run_rate' as const,
        // Company ids only; a person (no company) stays anonymous in the P&L.
        id: companyId.get(k) ?? null,
        code: null,
        date: null,
        amount: s2(c.amount.div(Math.max(1, window.length))),
        accountCode: null,
        description: k.startsWith('c:') ? 'company' : 'customer',
        sourceDocumentType: null,
        sourceDocumentId: null,
        sourceDocumentNo: null,
        orderId: null,
        orderCode: null,
      })),
    };
  }

  // --- export ---------------------------------------------------------------------------------------------------------

  async export(
    actor: UserActor,
    plan: PlanRow,
    format: 'xlsx' | 'pdf',
    view: 'plan' | 'variance',
  ): Promise<{ url: string; expiresAt: string }> {
    const viewer = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { displayName: true, publicId: true },
    });
    const now = new Date();
    const watermark = `ลับ — ${viewer.displayName ?? viewer.publicId} · ${toBangkokIso(now)}`;
    const table = view === 'plan' ? await this.planTable(plan) : await this.varianceTable(plan);
    const title = `${plan.name} · ${plan.fiscalYear} · ${plan.scenario} · v${plan.version}${view === 'variance' ? ' · เทียบกับจริง' : ''}`;
    const body =
      format === 'xlsx'
        ? await this.xlsx(title, watermark, table)
        : await this.pdf.render(this.html(title, watermark, table));
    const mime =
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: `pnl-${plan.fiscalYear}-${plan.scenario}-v${plan.version}-${view}-${bangkokDate(now)}.${format}`,
        mimeType: mime,
        sizeBytes: BigInt(body.length),
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: 'transient',
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `transient/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, body, mime);
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    await this.logAccess(actor, plan, 'export', format);
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: 'pnl_plan',
      resourcePublicId: plan.publicId,
      data: { kind: `pnl_${view}`, format, rows: table.rows.length, fileId: file.publicId, watermark },
    });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: mime,
    });
    return { url, expiresAt: toBangkokIso(new Date(now.getTime() + URL_TTL_SECONDS * 1000)) };
  }

  private async planTable(plan: PlanRow) {
    const grid = await this.grid(plan);
    const mark = { auto: 'ระบบ', calculated: 'คำนวณ', manual: 'กรอกเอง', override: 'แก้ทับ' } as const;
    return {
      header: ['บรรทัด', ...grid.months.map((m) => m.month), 'รวมทั้งปี'],
      rows: grid.lines.map((l) => [
        l.line.labelTh,
        ...l.cells.map(
          (c) =>
            (c.value === null ? '' : c.value) +
            (c.mode === 'override' || c.mode === 'manual' ? ` (${mark[c.mode]})` : ''),
        ),
        l.total ?? '',
      ]),
      notes: grid.lines.flatMap((l) =>
        l.cells
          .filter((c) => c.note)
          .map((c) => [l.line.labelTh, c.month, mark[c.mode], c.note ?? '', c.autoValue ?? '']),
      ),
    };
  }

  private async varianceTable(plan: PlanRow) {
    const v = await this.variance(plan);
    const actualMonths = v.months.filter((m) => m.kind === 'actual').map((m) => m.month);
    return {
      header: [
        'บรรทัด',
        ...actualMonths.flatMap((m) => [`${m} แผน`, `${m} จริง`, `${m} ต่าง`]),
        'รวม แผน',
        'รวม จริง',
        'รวม ต่าง',
      ],
      rows: v.lines.map((l) => [
        l.line.labelTh,
        ...l.cells
          .filter((c) => actualMonths.includes(c.month))
          .flatMap((c) => [c.plan ?? '', c.actual ?? '', c.variance ?? '']),
        l.totalPlan ?? '',
        l.totalActual ?? '',
        l.totalVariance ?? '',
      ]),
      notes: v.lines.flatMap((l) =>
        l.cells
          .filter((c) => c.note)
          .map((c) => [l.line.labelTh, c.month, 'หมายเหตุผลต่าง', c.note ?? '', '']),
      ),
    };
  }

  private async xlsx(
    title: string,
    watermark: string,
    table: { header: string[]; rows: string[][]; notes: string[][] },
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'getpack';
    const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v);
    const cell = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : safe(v));
    const ws = wb.addWorksheet('P&L', {
      headerFooter: { oddHeader: `&C${watermark}`, oddFooter: `&C${watermark}` },
      views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
    });
    ws.addRow([title]).font = { bold: true };
    ws.addRow([watermark]).font = { italic: true, color: { argb: 'FF9A9A9A' } };
    ws.addRow(table.header).font = { bold: true };
    for (const r of table.rows) ws.addRow(r.map(cell));
    ws.getColumn(1).width = 36;
    for (let i = 2; i <= table.header.length; i++) {
      ws.getColumn(i).width = 16;
      ws.getColumn(i).numFmt = '#,##0.00';
    }
    const notes = wb.addWorksheet('หมายเหตุ', {
      headerFooter: { oddHeader: `&C${watermark}`, oddFooter: `&C${watermark}` },
    });
    notes.addRow([watermark]).font = { italic: true };
    notes.addRow(['บรรทัด', 'เดือน', 'ประเภท', 'หมายเหตุ / เหตุผล', 'ค่าระบบ']).font = { bold: true };
    for (const n of table.notes) notes.addRow(n.map(safe));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private html(
    title: string,
    watermark: string,
    table: { header: string[]; rows: string[][]; notes: string[][] },
  ) {
    const esc = (v: string) =>
      v.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
      );
    const marks = Array.from(
      { length: 12 },
      (_, i) => `<div class="wm" style="top:${8 + i * 8}%">${esc(watermark)}</div>`,
    ).join('');
    const tr = (cells: string[], tag = 'td') =>
      `<tr>${cells.map((c, i) => `<${tag}${i ? ' class="n"' : ''}>${esc(c)}</${tag}>`).join('')}</tr>`;
    return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 landscape; margin: 10mm; }
body { font-family: 'Anuphan', 'Sarabun', sans-serif; font-size: 7.5pt; color: #111; }
h1 { font-size: 11pt; margin: 0 0 2mm; } .sub { color: #666; margin-bottom: 3mm; }
table { border-collapse: collapse; width: 100%; } th, td { border: 0.5px solid #ccc; padding: 1mm 1.2mm; }
th { background: #f2f2f2; } td.n, th.n { text-align: right; white-space: nowrap; }
.wm { position: fixed; left: 5%; transform: rotate(-18deg); font-size: 16pt; color: #999; opacity: .18; white-space: nowrap; pointer-events: none; }
</style></head><body>${marks}<h1>${esc(title)}</h1><div class="sub">${esc(watermark)} · ไม่ใช่งบการเงินตามกฎหมาย (ข้อมูลบริหาร)</div>
<table><thead>${tr(table.header, 'th')}</thead><tbody>${table.rows.map((r) => tr(r)).join('')}</tbody></table>
${table.notes.length ? `<h1 style="margin-top:4mm">หมายเหตุ</h1><table><tbody>${table.notes.map((r) => tr(r)).join('')}</tbody></table>` : ''}
</body></html>`;
  }
}
