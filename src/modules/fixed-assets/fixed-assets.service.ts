import { type Actor, actorColumns, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Account,
  type AccountStatus,
  type AssetSource,
  type FiscalPeriod,
  type Prisma,
} from '@generated/prisma/client';
import { addMonths, dateOnly, dayOf, isDay } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const invalid = (path: string, message: string) =>
  new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });

export const CATEGORY_INCLUDE = {
  assetAccount: { select: { code: true } },
  accumulatedAccount: { select: { code: true } },
  expenseAccount: { select: { code: true } },
  gainLossAccount: { select: { code: true } },
} as const satisfies Prisma.AssetCategoryInclude;
export type CategoryRow = Prisma.AssetCategoryGetPayload<{ include: typeof CATEGORY_INCLUDE }>;

export const ASSET_INCLUDE = {
  category: { select: { publicId: true, code: true } },
  assetAccount: { select: { code: true } },
  accumulatedAccount: { select: { code: true } },
  expenseAccount: { select: { code: true } },
  creditAccount: { select: { code: true } },
  vendorInvoice: { select: { publicId: true, vendorInvoiceNo: true } },
  custodian: { select: { publicId: true, displayName: true } },
  costCentre: { select: { code: true } },
} as const satisfies Prisma.FixedAssetInclude;
export type AssetRow = Prisma.FixedAssetGetPayload<{ include: typeof ASSET_INCLUDE }>;

export interface CategoryInput {
  code: string;
  nameTh: string;
  nameEn: string;
  usefulLifeMonths: number;
  assetAccountCode: string;
  accumulatedAccountCode: string;
  expenseAccountCode: string;
  gainLossAccountCode: string;
}

export interface AssetInput {
  categoryId: string;
  name: string;
  acquiredOn: string;
  cost: string;
  residualValue?: string;
  source: AssetSource;
  vendorInvoiceId?: string;
  creditAccountCode?: string;
  location?: string | null;
  custodianUserId?: string | null;
  costCentreCode?: string | null;
}

/** Months from the first depreciated month to `periodStart` inclusive (both first days of months). */
const monthIndex = (start: Date, periodStart: Date) =>
  (periodStart.getUTCFullYear() - start.getUTCFullYear()) * 12 +
  (periodStart.getUTCMonth() - start.getUTCMonth()) +
  1;

/**
 * Fixed assets (D-150): categories with their life and GL accounts, a register (from a vendor bill, already
 * capitalised by P25, or manual with the credited account — FA01) whose snapshot never changes, straight-line
 * depreciation by month (accumulated = round(depreciable × months / life), so the last month takes the
 * rounding and the asset ends exactly at cost − residual; missed months are caught up), one run per month
 * posted as FA02, and disposal or write-off with gain / loss (FA03). No barcode tagging (D-150).
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly periods: PeriodsService,
    private readonly settings: SettingsService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // --- categories -------------------------------------------------------------------------------------------

  async categories(): Promise<CategoryRow[]> {
    return this.prisma.assetCategory.findMany({ include: CATEGORY_INCLUDE, orderBy: { code: 'asc' } });
  }

  async category(publicId: string, db: Tx = this.prisma): Promise<CategoryRow> {
    const row = await db.assetCategory.findUnique({ where: { publicId }, include: CATEGORY_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createCategory(actor: UserActor, input: CategoryInput): Promise<CategoryRow> {
    const entityId = await this.entities.defaultEntityId();
    const id = await this.prisma.withTx(async (tx) => {
      if (await tx.assetCategory.findUnique({ where: { entityId_code: { entityId, code: input.code } } }))
        throw new DomainException('fixed_assets.category_exists', { params: { code: input.code } });
      const [asset, accumulated, expense, gainLoss] = await Promise.all([
        this.account(
          tx,
          entityId,
          input.assetAccountCode,
          'assetAccountCode',
          (a) => a.accountType === 'asset' && a.normalSide === 'debit' && a.cashFlowClass === 'investing',
        ),
        this.account(
          tx,
          entityId,
          input.accumulatedAccountCode,
          'accumulatedAccountCode',
          (a) => a.accountType === 'asset' && a.normalSide === 'credit',
        ),
        this.account(
          tx,
          entityId,
          input.expenseAccountCode,
          'expenseAccountCode',
          (a) => a.accountType === 'expense',
        ),
        this.account(
          tx,
          entityId,
          input.gainLossAccountCode,
          'gainLossAccountCode',
          (a) => a.accountType === 'expense' || a.accountType === 'revenue',
        ),
      ]);
      const row = await tx.assetCategory.create({
        data: {
          entityId,
          code: input.code,
          nameTh: input.nameTh,
          nameEn: input.nameEn,
          usefulLifeMonths: input.usefulLifeMonths,
          assetAccountId: asset.id,
          accumulatedAccountId: accumulated.id,
          expenseAccountId: expense.id,
          disposalGainLossAccountId: gainLoss.id,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'asset_category.created',
        actor,
        resourceType: 'asset_category',
        resourcePublicId: row.publicId,
        entityId,
        data: { ...input },
      });
      return row.publicId;
    });
    return this.category(id);
  }

  /** Names, life (new assets only — registered ones keep their snapshot) and status. */
  async updateCategory(
    actor: UserActor,
    publicId: string,
    rowVersion: number,
    input: { nameTh?: string; nameEn?: string; usefulLifeMonths?: number; status?: AccountStatus },
  ) {
    await this.prisma.withTx(async (tx) => {
      const row = await this.category(publicId, tx);
      const updated = await tx.assetCategory.updateMany({
        where: { id: row.id, rowVersion },
        data: { ...input, rowVersion: { increment: 1 } },
      });
      if (updated.count === 0) throw new DomainException('concurrency.stale');
      await this.audit.record(tx, {
        category: 'finance',
        action: 'asset_category.updated',
        actor,
        resourceType: 'asset_category',
        resourcePublicId: row.publicId,
        entityId: row.entityId,
        data: {
          before: {
            nameTh: row.nameTh,
            nameEn: row.nameEn,
            usefulLifeMonths: row.usefulLifeMonths,
            status: row.status,
          },
          after: input,
        },
      });
    });
    return this.category(publicId);
  }

  private async account(
    tx: Tx,
    entityId: bigint,
    code: string,
    path: string,
    ok: (a: Account) => boolean,
  ): Promise<Account> {
    const a = await tx.account.findUnique({ where: { entityId_code: { entityId, code } } });
    if (!a || a.status !== 'active' || !a.isPostable || a.isControl || !ok(a))
      throw new DomainException('fixed_assets.account_invalid', { params: { code, field: path } });
    return a;
  }

  // --- register -----------------------------------------------------------------------------------------------

  async get(publicId: string, db: Tx = this.prisma): Promise<AssetRow> {
    const row = await db.fixedAsset.findUnique({ where: { publicId }, include: ASSET_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.FixedAssetWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        include: ASSET_INCLUDE,
        orderBy: { assetNo: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return { rows, total };
  }

  async schedule(publicId: string) {
    const asset = await this.get(publicId);
    return this.prisma.depreciationLine.findMany({
      where: { assetId: asset.id },
      include: { fiscalPeriod: { select: { startDate: true } }, run: { select: { publicId: true } } },
      orderBy: { fiscalPeriod: { startDate: 'asc' } },
    });
  }

  async register(actor: UserActor, input: AssetInput): Promise<AssetRow> {
    if (!isDay(input.acquiredOn)) throw invalid('acquiredOn', 'YYYY-MM-DD');
    const cost = D(input.cost);
    const residual = D(input.residualValue ?? '0');
    if (!cost.gt(0) || residual.isNegative() || !residual.lt(cost))
      throw invalid('residualValue', 'residual value must be ≥ 0 and below cost');
    const entityId = await this.entities.defaultEntityId();
    const id = await this.prisma.withTx(async (tx) => {
      const category = await tx.assetCategory.findUnique({
        where: { publicId: input.categoryId },
        include: CATEGORY_INCLUDE,
      });
      if (!category || category.status !== 'active') throw new DomainException('http.not_found');
      let vendorInvoiceId: bigint | null = null;
      let credit: Account | null = null;
      if (input.source === 'vendor_bill') {
        if (!input.vendorInvoiceId)
          throw invalid('vendorInvoiceId', 'required for an asset from a vendor bill');
        const invoice = await tx.vendorInvoice.findUnique({
          where: { publicId: input.vendorInvoiceId },
          include: { lines: true },
        });
        if (!invoice || !['recorded', 'validated'].includes(invoice.status))
          throw new DomainException('http.not_found');
        // The bill capitalised this much on the category's asset account (P25); assets never exceed it.
        const capitalised = invoice.lines
          .filter((l) => l.accountId === category.assetAccountId)
          .reduce((a, l) => a.add(D(l.netAmount)), ZERO());
        const registered =
          (await tx.fixedAsset.aggregate({ where: { vendorInvoiceId: invoice.id }, _sum: { cost: true } }))
            ._sum.cost ?? 0;
        if (cost.add(D(registered)).gt(capitalised))
          throw new DomainException('fixed_assets.cost_exceeds_bill', {
            params: { capitalised: formatMoney(capitalised), registered: formatMoney(D(registered)) },
          });
        vendorInvoiceId = invoice.id;
      } else {
        if (!input.creditAccountCode) throw invalid('creditAccountCode', 'required for a manual acquisition');
        credit = await this.account(
          tx,
          entityId,
          input.creditAccountCode,
          'creditAccountCode',
          (a) => ['asset', 'liability', 'equity'].includes(a.accountType) && a.id !== category.assetAccountId,
        );
      }
      const custodian = input.custodianUserId
        ? await tx.user.findUnique({ where: { publicId: input.custodianUserId } })
        : null;
      if (input.custodianUserId && !custodian) throw new DomainException('http.not_found');
      const costCentre = input.costCentreCode
        ? await tx.costCentre.findUnique({
            where: { entityId_code: { entityId, code: input.costCentreCode } },
          })
        : null;
      if (input.costCentreCode && (!costCentre || costCentre.status !== 'active'))
        throw invalid('costCentreCode', 'unknown or inactive cost centre');
      const start = (
        await this.settings.at('fixed_assets.depreciation_start', { at: dateOnly(input.acquiredOn), tx })
      ).value;
      const firstOfMonth = `${input.acquiredOn.slice(0, 7)}-01`;
      const row = await tx.fixedAsset.create({
        data: {
          entityId,
          assetNo: await this.numbering.next(tx, 'fa', dateOnly(input.acquiredOn), entityId),
          categoryId: category.id,
          name: input.name,
          source: input.source,
          acquiredOn: dateOnly(input.acquiredOn),
          depreciationStartOn: dateOnly(start === 'next_month' ? addMonths(firstOfMonth, 1) : firstOfMonth),
          cost: formatMoney(cost),
          residualValue: formatMoney(residual),
          usefulLifeMonths: category.usefulLifeMonths,
          method: category.method,
          assetAccountId: category.assetAccountId,
          accumulatedAccountId: category.accumulatedAccountId,
          expenseAccountId: category.expenseAccountId,
          disposalGainLossAccountId: category.disposalGainLossAccountId,
          vendorInvoiceId,
          creditAccountId: credit?.id ?? null,
          location: input.location ?? null,
          custodianUserId: custodian?.id ?? null,
          costCentreId: costCentre?.id ?? null,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'fixed_asset.registered',
        actor,
        resourceType: 'fixed_asset',
        resourcePublicId: row.publicId,
        entityId,
        data: {
          assetNo: row.assetNo,
          source: input.source,
          cost: formatMoney(cost),
          category: category.code,
        },
      });
      await this.events.record(
        tx,
        {
          type: 'fixed_asset.acquired',
          aggregateType: 'fixed_asset',
          aggregateId: row.publicId,
          entityId,
          payload: {
            source: input.source,
            assetId: row.publicId,
            assetNo: row.assetNo,
            acquiredOn: input.acquiredOn,
            assetAccountCode: category.assetAccount.code,
            creditAccountCode: credit?.code ?? null,
            costCentreCode: costCentre?.code ?? null,
            cost: formatMoney(cost),
          },
        },
        actor,
      );
      return row.publicId;
    });
    return this.get(id);
  }

  // --- depreciation ---------------------------------------------------------------------------------------

  /** Accumulated depreciation an asset should carry at the end of the month starting `periodStart`. */
  expectedAccumulated(
    asset: {
      cost: { toString(): string };
      residualValue: { toString(): string };
      usefulLifeMonths: number;
      depreciationStartOn: Date;
    },
    periodStart: Date,
  ): MoneyValue {
    const months = Math.min(
      Math.max(monthIndex(asset.depreciationStartOn, periodStart), 0),
      asset.usefulLifeMonths,
    );
    const depreciable = D(asset.cost).sub(D(asset.residualValue));
    return months === asset.usefulLifeMonths
      ? depreciable
      : round(depreciable.mul(months).div(asset.usefulLifeMonths));
  }

  /** The month's run (FA02): once per month, into an open month only. */
  async run(actor: Actor, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw invalid('period', 'YYYY-MM');
    const entityId = await this.entities.defaultEntityId();
    const period = await this.periods.periodOf(entityId, `${month}-01`);
    const id = await this.prisma.withTx(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM fiscal_periods WHERE id = ${period.id} FOR UPDATE`;
        const fresh = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: period.id } });
        if (fresh.status !== 'open')
          throw new DomainException('ledger.period_closed', { params: { period: month } });
        if (
          await tx.depreciationRun.findUnique({
            where: { entityId_fiscalPeriodId: { entityId, fiscalPeriodId: period.id } },
          })
        )
          throw new DomainException('fixed_assets.run_exists', { params: { period: month } });
        return this.runIn(tx, actor, fresh);
      },
      { timeout: 120_000 },
    );
    return this.prisma.depreciationRun.findUniqueOrThrow({
      where: { publicId: id },
      include: { lines: true, fiscalPeriod: { select: { startDate: true } } },
    });
  }

  /** What the month's run depreciates, catch-up included: shared by the run and its preview (U-B0.3). */
  private async dueFor(db: Tx, period: FiscalPeriod) {
    const assets = await db.fixedAsset.findMany({
      where: { entityId: period.entityId, status: 'active', depreciationStartOn: { lte: period.startDate } },
      include: {
        expenseAccount: { select: { code: true } },
        accumulatedAccount: { select: { code: true } },
        costCentre: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
    });
    return assets
      .map((a) => ({
        asset: a,
        amount: this.expectedAccumulated(a, period.startDate).sub(D(a.accumulatedDepreciation)),
      }))
      .filter((d) => d.amount.gt(0));
  }

  /** Dry run of the month (U-B0.3): exactly what `run` would post, nothing written. */
  async preview(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw invalid('period', 'YYYY-MM');
    const entityId = await this.entities.defaultEntityId();
    const period = await this.periods.periodOf(entityId, `${month}-01`);
    const [due, existing] = await Promise.all([
      this.dueFor(this.prisma, period),
      this.prisma.depreciationRun.findUnique({
        where: { entityId_fiscalPeriodId: { entityId, fiscalPeriodId: period.id } },
      }),
    ]);
    return {
      period,
      alreadyRun: existing !== null,
      lines: existing
        ? []
        : due.map(({ asset, amount }) => ({
            asset,
            amount,
            accumulatedAfter: D(asset.accumulatedDepreciation).add(amount),
          })),
    };
  }

  private async runIn(tx: Tx, actor: Actor, period: FiscalPeriod): Promise<string> {
    const due = await this.dueFor(tx, period);
    const total = due.reduce((a, d) => a.add(d.amount), ZERO());
    const run = await tx.depreciationRun.create({
      data: {
        entityId: period.entityId,
        fiscalPeriodId: period.id,
        runOn: period.endDate,
        totalAmount: formatMoney(total),
        assetCount: due.length,
        createdById: actorColumns(actor).actorUserId,
      },
    });
    const grouped = new Map<
      string,
      {
        expenseAccountCode: string;
        accumulatedAccountCode: string;
        costCentreCode: string | null;
        amount: MoneyValue;
      }
    >();
    for (const { asset, amount } of due) {
      const after = D(asset.accumulatedDepreciation).add(amount);
      await tx.depreciationLine.create({
        data: {
          runId: run.id,
          assetId: asset.id,
          fiscalPeriodId: period.id,
          amount: formatMoney(amount),
          accumulatedAfter: formatMoney(after),
        },
      });
      const fully = after.eq(D(asset.cost).sub(D(asset.residualValue)));
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          accumulatedDepreciation: formatMoney(after),
          ...(fully && { status: 'fully_depreciated' }),
          rowVersion: { increment: 1 },
        },
      });
      const key = `${asset.expenseAccount.code}|${asset.accumulatedAccount.code}|${asset.costCentre?.code ?? ''}`;
      const g = grouped.get(key) ?? {
        expenseAccountCode: asset.expenseAccount.code,
        accumulatedAccountCode: asset.accumulatedAccount.code,
        costCentreCode: asset.costCentre?.code ?? null,
        amount: ZERO(),
      };
      g.amount = g.amount.add(amount);
      grouped.set(key, g);
    }
    const label = dayOf(period.startDate).slice(0, 7);
    await this.audit.record(tx, {
      category: 'finance',
      action: 'depreciation_run.posted',
      actor,
      resourceType: 'depreciation_run',
      resourcePublicId: run.publicId,
      entityId: period.entityId,
      data: { period: label, total: formatMoney(total), assets: due.length },
    });
    if (due.length > 0)
      await this.events.record(
        tx,
        {
          type: 'depreciation_run.posted',
          aggregateType: 'depreciation_run',
          aggregateId: run.publicId,
          entityId: period.entityId,
          payload: {
            runId: run.publicId,
            periodLabel: label,
            runOn: dayOf(period.endDate),
            total: formatMoney(total),
            lines: [...grouped.values()].map((g) => ({ ...g, amount: formatMoney(g.amount) })),
          },
        },
        actor,
      );
    return run.publicId;
  }

  /** The job: last month's run when it is still open and not yet run (idempotent). */
  async runDue(today: string): Promise<number> {
    const month = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const entityId = await this.entities.defaultEntityId();
    const period = await this.periods.periodOf(entityId, `${month}-01`);
    if (period.status !== 'open') return 0;
    if (
      await this.prisma.depreciationRun.findUnique({
        where: { entityId_fiscalPeriodId: { entityId, fiscalPeriodId: period.id } },
      })
    )
      return 0;
    const run = await this.run(systemActor('fixed_assets.depreciation'), month);
    return run.assetCount;
  }

  async runs() {
    return this.prisma.depreciationRun.findMany({
      include: { fiscalPeriod: { select: { startDate: true } } },
      orderBy: { runOn: 'desc' },
      take: 60,
    });
  }

  // --- disposal (FA03) ------------------------------------------------------------------------------------

  /**
   * Sold or written off: depreciation must be up to date to the month before (no depreciation in the month of
   * disposal); cost and accumulated depreciation leave the books, proceeds are recorded, the rest is gain / loss.
   */
  async dispose(
    actor: UserActor,
    publicId: string,
    input: {
      kind: 'sold' | 'written_off';
      disposedOn: string;
      proceeds?: string;
      proceedsAccountCode?: string;
      reason: string;
    },
  ) {
    if (!isDay(input.disposedOn)) throw invalid('disposedOn', 'YYYY-MM-DD');
    const proceeds = input.kind === 'written_off' ? ZERO() : D(input.proceeds ?? '0');
    if (proceeds.isNegative()) throw invalid('proceeds', 'must be ≥ 0');
    await this.prisma.withTx(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({
        where: { publicId },
        include: { assetAccount: true, accumulatedAccount: true, gainLossAccount: true },
      });
      if (!asset) throw new DomainException('http.not_found');
      if (!['active', 'fully_depreciated'].includes(asset.status))
        throw new DomainException('fixed_assets.already_disposed');
      if (input.disposedOn < dayOf(asset.acquiredOn)) throw invalid('disposedOn', 'before the acquisition');
      const lastMonth = dateOnly(addMonths(`${input.disposedOn.slice(0, 7)}-01`, -1));
      const expected = this.expectedAccumulated(asset, lastMonth);
      if (!D(asset.accumulatedDepreciation).eq(expected))
        throw new DomainException('fixed_assets.depreciation_pending', {
          params: {
            expected: formatMoney(expected),
            accumulated: formatMoney(D(asset.accumulatedDepreciation)),
          },
        });
      let proceedsAccount: Account | null = null;
      if (proceeds.gt(0)) {
        if (!input.proceedsAccountCode)
          throw invalid('proceedsAccountCode', 'required when there are proceeds');
        proceedsAccount = await this.account(
          tx,
          asset.entityId,
          input.proceedsAccountCode,
          'proceedsAccountCode',
          (a) => a.accountType === 'asset',
        );
      }
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          status: input.kind === 'sold' ? 'disposed' : 'written_off',
          disposedOn: dateOnly(input.disposedOn),
          disposalProceeds: formatMoney(proceeds),
          proceedsAccountId: proceedsAccount?.id ?? null,
          disposalReason: input.reason,
          rowVersion: { increment: 1 },
        },
      });
      const gainLoss = D(asset.cost).sub(D(asset.accumulatedDepreciation)).sub(proceeds);
      await this.audit.record(tx, {
        category: 'finance',
        action: `fixed_asset.${input.kind}`,
        actor,
        resourceType: 'fixed_asset',
        resourcePublicId: asset.publicId,
        entityId: asset.entityId,
        data: {
          disposedOn: input.disposedOn,
          proceeds: formatMoney(proceeds),
          gainLoss: formatMoney(gainLoss.neg()),
          reason: input.reason,
        },
      });
      await this.events.record(
        tx,
        {
          type: 'fixed_asset.disposed',
          aggregateType: 'fixed_asset',
          aggregateId: asset.publicId,
          entityId: asset.entityId,
          payload: {
            assetId: asset.publicId,
            assetNo: asset.assetNo,
            kind: input.kind,
            disposedOn: input.disposedOn,
            cost: formatMoney(D(asset.cost)),
            accumulated: formatMoney(D(asset.accumulatedDepreciation)),
            proceeds: formatMoney(proceeds),
            assetAccountCode: asset.assetAccount.code,
            accumulatedAccountCode: asset.accumulatedAccount.code,
            proceedsAccountCode: proceedsAccount?.code ?? asset.accumulatedAccount.code,
            gainLossAccountCode: asset.gainLossAccount.code,
          },
        },
        actor,
      );
    });
    return this.get(publicId);
  }

  // --- reports ----------------------------------------------------------------------------------------------

  /**
   * Roll-forward per category for months `from`..`to` (cost and accumulated depreciation: opening, additions,
   * depreciation, disposals, closing, net book value) and the reconciliation of the register to the GL balances
   * of each asset / accumulated-depreciation account at the end of `to` (difference must be 0, §7 step 8).
   */
  async rollForward(from: string, to: string) {
    const entityId = await this.entities.defaultEntityId();
    const start = dateOnly(`${from}-01`);
    const endPeriod = await this.periods.periodOf(entityId, `${to}-01`);
    const end = endPeriod.endDate;
    const assets = await this.prisma.fixedAsset.findMany({
      where: { entityId, acquiredOn: { lte: end } },
      include: {
        category: true,
        assetAccount: { select: { code: true } },
        accumulatedAccount: { select: { code: true } },
        depreciationLines: { include: { fiscalPeriod: { select: { startDate: true } } } },
      },
    });
    const byCategory = new Map<string, Record<string, MoneyValue | string>>();
    const reg = new Map<string, MoneyValue>();
    const add = (m: Map<string, MoneyValue>, k: string, v: MoneyValue) =>
      m.set(k, (m.get(k) ?? ZERO()).add(v));
    for (const a of assets) {
      const row = byCategory.get(a.category.code) ?? {
        category: a.category.code,
        name: a.category.nameTh,
        openingCost: ZERO(),
        additions: ZERO(),
        disposalsCost: ZERO(),
        openingAccumulated: ZERO(),
        depreciation: ZERO(),
        disposalsAccumulated: ZERO(),
      };
      const m = (k: string, v: MoneyValue) => (row[k] = (row[k] as MoneyValue).add(v));
      const cost = D(a.cost);
      const disposedBefore = a.disposedOn !== null && a.disposedOn < start;
      const disposedIn = a.disposedOn !== null && a.disposedOn >= start && a.disposedOn <= end;
      const accBefore = a.depreciationLines
        .filter((l) => l.fiscalPeriod.startDate < start)
        .reduce((s, l) => s.add(D(l.amount)), ZERO());
      const accIn = a.depreciationLines
        .filter((l) => l.fiscalPeriod.startDate >= start && l.fiscalPeriod.startDate <= end)
        .reduce((s, l) => s.add(D(l.amount)), ZERO());
      if (!disposedBefore) {
        if (a.acquiredOn < start) {
          m('openingCost', cost);
          m('openingAccumulated', accBefore);
        } else m('additions', cost);
        m('depreciation', accIn);
        if (disposedIn) {
          m('disposalsCost', cost);
          m('disposalsAccumulated', accBefore.add(accIn));
        } else {
          add(reg, a.assetAccount.code, cost);
          add(reg, a.accumulatedAccount.code, accBefore.add(accIn).neg());
        }
      }
      byCategory.set(a.category.code, row);
    }
    const rows = [...byCategory.values()].map((r) => {
      const n = (k: string) => r[k] as MoneyValue;
      const closingCost = n('openingCost').add(n('additions')).sub(n('disposalsCost'));
      const closingAccumulated = n('openingAccumulated')
        .add(n('depreciation'))
        .sub(n('disposalsAccumulated'));
      return {
        category: r['category'] as string,
        name: r['name'] as string,
        openingCost: formatMoney(n('openingCost')),
        additions: formatMoney(n('additions')),
        disposalsCost: formatMoney(n('disposalsCost')),
        closingCost: formatMoney(closingCost),
        openingAccumulated: formatMoney(n('openingAccumulated')),
        depreciation: formatMoney(n('depreciation')),
        disposalsAccumulated: formatMoney(n('disposalsAccumulated')),
        closingAccumulated: formatMoney(closingAccumulated),
        netBookValue: formatMoney(closingCost.sub(closingAccumulated)),
      };
    });
    const reconciliation = [];
    for (const [code, register] of reg) {
      const sum = await this.prisma.journalLine.aggregate({
        where: { entityId, account: { code }, entryDate: { lte: end }, journalEntry: { status: 'posted' } },
        _sum: { debit: true, credit: true },
      });
      const gl = D(sum._sum.debit ?? 0).sub(D(sum._sum.credit ?? 0));
      reconciliation.push({
        accountCode: code,
        register: formatMoney(register),
        gl: formatMoney(gl),
        difference: formatMoney(gl.sub(register)),
      });
    }
    reconciliation.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return { from, to, categories: rows, reconciliation };
  }
}
