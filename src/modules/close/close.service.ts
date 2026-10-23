import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { dayOf } from '@common/ledger-core/dates';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type FiscalPeriod,
  type PeriodStatus,
  type Prisma,
  type TaxReportKind,
} from '@generated/prisma/client';
import { FinancialReportsService } from '@modules/financial-reports/financial-reports.service';
import { FixedAssetsService } from '@modules/fixed-assets/fixed-assets.service';
import { type PeriodCloseGate, PeriodsService } from '@modules/ledger/periods.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal((v ?? 0).toString());
const ZERO = () => new MoneyDecimal(0);
const DAY_MS = 86_400_000;

/** accounting-design §7: the nine steps; `auto` steps have blocking checks, the others record a review. */
export const CLOSE_TASKS = [
  { step: 1, key: 'statements_imported', auto: true },
  { step: 2, key: 'slips_and_unidentified', auto: true },
  { step: 3, key: 'deliveries_received', auto: true },
  { step: 4, key: 'receivables_reviewed', auto: false },
  { step: 5, key: 'rollforwards_reviewed', auto: false },
  { step: 6, key: 'accruals_recorded', auto: true },
  { step: 7, key: 'tax_papers_reconciled', auto: true },
  { step: 8, key: 'subledgers_reconciled', auto: true },
  { step: 9, key: 'review', auto: false },
] as const;
export type CloseTaskKey = (typeof CLOSE_TASKS)[number]['key'];
const REQUIRED_TAX_PAPERS: TaxReportKind[] = ['sales_tax', 'purchase_tax', 'pp30', 'pnd3', 'pnd53'];

export interface CheckResult {
  passed: boolean;
  summary: string;
  figures: Record<string, string | number>;
  items: {
    type: string;
    id: string | null;
    date: string | null;
    amount: string | null;
    description: string;
  }[];
}

export const CHECKLIST_INCLUDE = {
  fiscalPeriod: { select: { publicId: true, startDate: true, endDate: true, status: true, periodNo: true } },
  tasks: {
    orderBy: { stepNo: 'asc' },
    include: {
      owner: { select: { publicId: true, displayName: true } },
      completedBy: { select: { publicId: true, displayName: true } },
    },
  },
  submittedBy: { select: { publicId: true, displayName: true } },
  closedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.CloseChecklistInclude;
export type ChecklistRow = Prisma.CloseChecklistGetPayload<{ include: typeof CHECKLIST_INCLUDE }>;

/**
 * The period close (accounting-design §7): a checklist per month with the nine steps, each with an owner,
 * evidence (attachments) and — for steps 1, 2, 3, 6, 7, 8 — a blocking check: unmatched cash within the
 * threshold (`close.unmatched_items_threshold`), no slip awaiting verification, no POD without GR, no manual
 * journal waiting for approval, the tax papers final (GL difference 0), sub-ledgers equal to the GL (AR, AP,
 * advances, retention, store credit, fixed assets). A failing check is fixed or waived with a reason by a
 * Finance Manager. Submitting soft-closes the month; a Finance Manager other than the submitter approves and
 * closes it (§8); locking needs the auditor's sign-off at year end. The ledger's own close / lock actions are
 * gated by the same rules (`PERIOD_CLOSE_GATE`).
 */
@Injectable()
export class CloseService implements PeriodCloseGate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly periods: PeriodsService,
    private readonly settings: SettingsService,
    private readonly reports: FinancialReportsService,
    private readonly assets: FixedAssetsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  private async period(month: string): Promise<FiscalPeriod> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'period', code: 'pattern', message: 'YYYY-MM' }],
      });
    return this.periods.periodOf(await this.entities.defaultEntityId(), `${month}-01`);
  }

  async get(month: string, db: Tx = this.prisma): Promise<ChecklistRow> {
    const period = await this.period(month);
    const row = await db.closeChecklist.findUnique({
      where: { fiscalPeriodId: period.id },
      include: CHECKLIST_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async evidence(checklistId: bigint) {
    const tasks = await this.prisma.closeTask.findMany({ where: { checklistId }, select: { id: true } });
    const rows = await this.prisma.attachment.findMany({
      where: { subjectType: 'close_task', subjectId: { in: tasks.map((t) => t.id) } },
      include: { fileObject: { select: { publicId: true, originalName: true } } },
    });
    const byTask = new Map<bigint, { fileId: string; name: string }[]>();
    for (const r of rows)
      byTask.set(r.subjectId, [
        ...(byTask.get(r.subjectId) ?? []),
        { fileId: r.fileObject.publicId, name: r.fileObject.originalName },
      ]);
    return byTask;
  }

  async open(actor: UserActor, month: string): Promise<ChecklistRow> {
    const period = await this.period(month);
    await this.prisma.withTx(async (tx) => {
      if (await tx.closeChecklist.findUnique({ where: { fiscalPeriodId: period.id } })) return;
      const row = await tx.closeChecklist.create({
        data: {
          entityId: period.entityId,
          fiscalPeriodId: period.id,
          createdById: actor.userId,
          tasks: { create: CLOSE_TASKS.map((t) => ({ stepNo: t.step, key: t.key })) },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_checklist.opened',
        actor,
        resourceType: 'close_checklist',
        resourcePublicId: row.publicId,
        entityId: row.entityId,
        data: { period: month },
      });
    });
    return this.get(month);
  }

  private async task(tx: Tx, month: string, key: string) {
    const checklist = await this.get(month, tx);
    const task = checklist.tasks.find((t) => t.key === key);
    if (!task) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM close_tasks WHERE id = ${task.id} FOR UPDATE`;
    return { checklist, task };
  }

  private editable(checklist: { status: string }) {
    if (checklist.status !== 'open')
      throw new DomainException('close.checklist_not_open', { params: { status: checklist.status } });
  }

  /** Runs the task's check and keeps its result (a failing automatic check blocks the task). */
  async check(actor: UserActor, month: string, key: string): Promise<ChecklistRow> {
    const period = await this.period(month);
    await this.prisma.withTx(async (tx) => {
      const { checklist, task } = await this.task(tx, month, key);
      this.editable(checklist);
      const result = await this.run(tx, period, key as CloseTaskKey);
      const auto = CLOSE_TASKS.find((t) => t.key === key)!.auto;
      await tx.closeTask.update({
        where: { id: task.id },
        data: {
          checkResult: result as unknown as Prisma.InputJsonValue,
          checkedAt: new Date(),
          ...(task.status === 'pending' || task.status === 'blocked'
            ? { status: auto && !result.passed ? 'blocked' : 'pending' }
            : {}),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_task.checked',
        actor,
        resourceType: 'close_task',
        resourcePublicId: task.publicId,
        entityId: checklist.entityId,
        data: { key, passed: result.passed, summary: result.summary },
      });
    });
    return this.get(month);
  }

  /** Done: the check (re-run now) passes; a note and evidence document the review. */
  async complete(actor: UserActor, month: string, key: string, note: string | null): Promise<ChecklistRow> {
    if (key === 'review') throw new DomainException('close.review_by_approval');
    const period = await this.period(month);
    await this.prisma.withTx(async (tx) => {
      const { checklist, task } = await this.task(tx, month, key);
      this.editable(checklist);
      if (task.status === 'done' || task.status === 'waived') throw new DomainException('close.task_done');
      const result = await this.run(tx, period, key as CloseTaskKey);
      if (!result.passed) {
        await tx.closeTask.update({
          where: { id: task.id },
          data: {
            status: 'blocked',
            checkResult: result as unknown as Prisma.InputJsonValue,
            checkedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        throw new DomainException('close.check_failed', { params: { key, summary: result.summary } });
      }
      await tx.closeTask.update({
        where: { id: task.id },
        data: {
          status: 'done',
          note,
          checkResult: result as unknown as Prisma.InputJsonValue,
          checkedAt: new Date(),
          completedById: actor.userId,
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_task.completed',
        actor,
        resourceType: 'close_task',
        resourcePublicId: task.publicId,
        entityId: checklist.entityId,
        data: { key, note },
      });
    });
    return this.get(month);
  }

  /** A Finance Manager accepts an explained exception (e.g. unmatched items under investigation). */
  async waive(actor: UserActor, month: string, key: string, reason: string): Promise<ChecklistRow> {
    if (key === 'review') throw new DomainException('close.review_by_approval');
    await this.prisma.withTx(async (tx) => {
      const { checklist, task } = await this.task(tx, month, key);
      this.editable(checklist);
      if (task.status === 'done' || task.status === 'waived') throw new DomainException('close.task_done');
      await tx.closeTask.update({
        where: { id: task.id },
        data: {
          status: 'waived',
          waivedReason: reason,
          completedById: actor.userId,
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_task.waived',
        actor,
        resourceType: 'close_task',
        resourcePublicId: task.publicId,
        entityId: checklist.entityId,
        data: { key, reason },
      });
    });
    return this.get(month);
  }

  async assign(actor: UserActor, month: string, key: string, ownerPublicId: string): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const { checklist, task } = await this.task(tx, month, key);
      const owner = await tx.user.findUnique({ where: { publicId: ownerPublicId } });
      if (!owner || owner.kind !== 'staff') throw new DomainException('http.not_found');
      await tx.closeTask.update({
        where: { id: task.id },
        data: { ownerUserId: owner.id, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_task.assigned',
        actor,
        resourceType: 'close_task',
        resourcePublicId: task.publicId,
        entityId: checklist.entityId,
        data: { key, owner: owner.publicId },
      });
    });
    return this.get(month);
  }

  async addEvidence(
    actor: UserActor,
    month: string,
    key: string,
    filePublicId: string,
    description: string | null,
  ): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const { checklist, task } = await this.task(tx, month, key);
      const file = await tx.fileObject.findUnique({ where: { publicId: filePublicId } });
      if (!file) throw new DomainException('http.not_found');
      if (file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected')
        throw new DomainException('file.not_ready');
      await tx.fileObject.update({ where: { id: file.id }, data: { retentionClass: 'financial_record' } });
      await tx.attachment.upsert({
        where: {
          subjectType_subjectId_fileObjectId_role: {
            subjectType: 'close_task',
            subjectId: task.id,
            fileObjectId: file.id,
            role: 'evidence',
          },
        },
        create: {
          subjectType: 'close_task',
          subjectId: task.id,
          fileObjectId: file.id,
          role: 'evidence',
          createdById: actor.userId,
        },
        update: {},
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'close_task.evidence_added',
        actor,
        resourceType: 'close_task',
        resourcePublicId: task.publicId,
        entityId: checklist.entityId,
        data: { key, fileId: file.publicId, description },
      });
    });
    return this.get(month);
  }

  /** Steps 1–8 done or waived → in review; the month is soft-closed (§7 step 9). */
  async submit(actor: UserActor, month: string): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const checklist = await this.lockChecklist(tx, month);
      this.editable(checklist);
      const open = checklist.tasks.filter(
        (t) => t.key !== 'review' && t.status !== 'done' && t.status !== 'waived',
      );
      if (open.length > 0)
        throw new DomainException('close.tasks_open', {
          params: { tasks: open.map((t) => t.key).join(', ') },
        });
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: checklist.fiscalPeriodId } });
      if (period.status === 'open')
        await this.periods.transitionIn(tx, actor, period, 'soft_closed', `close checklist submitted`);
      await tx.closeChecklist.update({
        where: { id: checklist.id },
        data: {
          status: 'in_review',
          submittedAt: new Date(),
          submittedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, checklist, 'submitted', { period: month });
    });
    return this.get(month);
  }

  /** A Finance Manager other than the submitter approves: step 9 done, the month closed (§8 SoD). */
  async approve(actor: UserActor, month: string, note: string | null): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const checklist = await this.lockChecklist(tx, month);
      if (checklist.status !== 'in_review')
        throw new DomainException('close.checklist_not_in_review', { params: { status: checklist.status } });
      if (checklist.submittedById === actor.userId)
        throw new DomainException('iam.sod_conflict', {
          params: { rule: 'the submitter of a close checklist cannot approve it' },
        });
      const review = checklist.tasks.find((t) => t.key === 'review')!;
      await tx.closeTask.update({
        where: { id: review.id },
        data: {
          status: 'done',
          note,
          completedById: actor.userId,
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: checklist.fiscalPeriodId } });
      await this.periods.transitionIn(tx, actor, period, 'closed', note);
      await tx.closeChecklist.update({
        where: { id: checklist.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, checklist, 'closed', { period: month, note });
    });
    return this.get(month);
  }

  /** The reviewer sends it back: the month reopens (from soft-closed) and the checklist is open again. */
  async returnForWork(actor: UserActor, month: string, reason: string): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const checklist = await this.lockChecklist(tx, month);
      if (checklist.status !== 'in_review')
        throw new DomainException('close.checklist_not_in_review', { params: { status: checklist.status } });
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: checklist.fiscalPeriodId } });
      if (period.status === 'soft_closed') await this.periods.transitionIn(tx, actor, period, 'open', reason);
      await tx.closeChecklist.update({
        where: { id: checklist.id },
        data: { status: 'open', submittedAt: null, submittedById: null, rowVersion: { increment: 1 } },
      });
      await this.record(tx, actor, checklist, 'returned', { period: month, reason });
    });
    return this.get(month);
  }

  /** The auditor's sign-off (required before locking the last month of a fiscal year, §7 step 9). */
  async signOff(actor: UserActor, month: string): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const checklist = await this.lockChecklist(tx, month);
      if (checklist.status !== 'closed')
        throw new DomainException('close.checklist_not_closed', { params: { status: checklist.status } });
      if (checklist.auditorSignedOffAt) return;
      await tx.closeChecklist.update({
        where: { id: checklist.id },
        data: {
          auditorSignedOffAt: new Date(),
          auditorSignedOffById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, checklist, 'signed_off', { period: month });
    });
    return this.get(month);
  }

  async lock(actor: UserActor, month: string): Promise<ChecklistRow> {
    await this.prisma.withTx(async (tx) => {
      const checklist = await this.lockChecklist(tx, month);
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: checklist.fiscalPeriodId } });
      await this.periods.transitionIn(tx, actor, period, 'locked', 'close checklist locked');
      await tx.closeChecklist.update({
        where: { id: checklist.id },
        data: {
          status: 'locked',
          lockedAt: new Date(),
          lockedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, actor, checklist, 'locked', { period: month });
    });
    return this.get(month);
  }

  private async lockChecklist(tx: Tx, month: string) {
    const checklist = await this.get(month, tx);
    await tx.$queryRaw`SELECT id FROM close_checklists WHERE id = ${checklist.id} FOR UPDATE`;
    return this.get(month, tx);
  }

  private async record(
    tx: Tx,
    actor: Actor,
    checklist: { publicId: string; entityId: bigint },
    what: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'finance',
      action: `close_checklist.${what}`,
      actor,
      resourceType: 'close_checklist',
      resourcePublicId: checklist.publicId,
      entityId: checklist.entityId,
      data,
    });
    await this.events.record(
      tx,
      {
        type: `close_checklist.${what}`,
        aggregateType: 'close_checklist',
        aggregateId: checklist.publicId,
        entityId: checklist.entityId,
        payload: { checklistId: checklist.publicId, ...data },
      },
      actor,
    );
  }

  // --- gate (ledger close / lock) ----------------------------------------------------------------------

  async assertMayTransition(tx: Tx, period: FiscalPeriod, to: PeriodStatus): Promise<void> {
    const checklist = await tx.closeChecklist.findUnique({
      where: { fiscalPeriodId: period.id },
      include: { tasks: true },
    });
    const month = dayOf(period.startDate).slice(0, 7);
    if (to === 'closed') {
      const review = checklist?.tasks.find((t) => t.key === 'review');
      if (checklist?.status !== 'in_review' || review?.status !== 'done')
        throw new DomainException('close.checklist_incomplete', {
          params: { period: month, status: checklist?.status ?? 'none' },
        });
    }
    if (to === 'locked') {
      if (checklist?.status !== 'closed')
        throw new DomainException('close.checklist_incomplete', {
          params: { period: month, status: checklist?.status ?? 'none' },
        });
      const yearEnd = await tx.fiscalPeriod.count({
        where: { fiscalYearId: period.fiscalYearId, periodNo: { gt: period.periodNo } },
      });
      if (yearEnd === 0 && !checklist.auditorSignedOffAt)
        throw new DomainException('close.auditor_sign_off_required', { params: { period: month } });
    }
  }

  // --- checks ------------------------------------------------------------------------------------------

  async run(tx: Tx, period: FiscalPeriod, key: CloseTaskKey): Promise<CheckResult> {
    const end = period.endDate;
    const endOfDay = new Date(Date.parse(`${dayOf(end)}T00:00:00+07:00`) + DAY_MS);
    switch (key) {
      case 'statements_imported': {
        const threshold = (await this.settings.at('close.unmatched_items_threshold', { at: end, tx })).value;
        const unmatched = await tx.bankStatementLine.findMany({
          where: {
            matchStatus: 'unmatched',
            txnDate: { lte: end },
            companyBankAccount: { entityId: period.entityId },
          },
          take: 50,
          orderBy: { txnDate: 'asc' },
        });
        const unmatchedCount = await tx.bankStatementLine.count({
          where: {
            matchStatus: 'unmatched',
            txnDate: { lte: end },
            companyBankAccount: { entityId: period.entityId },
          },
        });
        const settlements = await tx.gatewaySettlement.count({
          where: { entityId: period.entityId, status: 'imported', settlementDate: { lte: end } },
        });
        const accounts = await tx.companyBankAccount.findMany({
          where: { entityId: period.entityId, status: 'active' },
          include: { imports: { where: { periodTo: { gte: end } }, take: 1 } },
        });
        const missing = accounts.filter((a) => a.imports.length === 0);
        const items = unmatched.length + settlements;
        return {
          passed: unmatchedCount + settlements <= threshold && missing.length === 0,
          summary: `${unmatchedCount} unmatched statement line(s), ${settlements} settlement(s) not in the bank, ${missing.length} account(s) without a statement to ${dayOf(end)} (threshold ${threshold})`,
          figures: {
            unmatchedLines: unmatchedCount,
            settlementsNotMatched: settlements,
            accountsWithoutStatement: missing.length,
            threshold,
            items,
          },
          items: [
            ...unmatched.map((l) => ({
              type: 'statement_line',
              id: l.publicId,
              date: dayOf(l.txnDate),
              amount: l.amount.toFixed(2),
              description: l.description,
            })),
            ...missing.map((a) => ({
              type: 'bank_account',
              id: a.publicId,
              date: null,
              amount: null,
              description: `x${a.accountNoLast4}`,
            })),
          ],
        };
      }
      case 'slips_and_unidentified': {
        const slips = await tx.payment.findMany({
          where: { entityId: period.entityId, status: 'awaiting_verification', createdAt: { lt: endOfDay } },
          take: 50,
        });
        const slipCount = await tx.payment.count({
          where: { entityId: period.entityId, status: 'awaiting_verification', createdAt: { lt: endOfDay } },
        });
        const unidentified = await tx.unidentifiedReceipt.aggregate({
          where: { entityId: period.entityId, status: 'open', createdAt: { lt: endOfDay } },
          _count: true,
          _sum: { amount: true },
        });
        return {
          passed: slipCount === 0,
          summary: `${slipCount} slip(s) awaiting verification; ${unidentified._count} unidentified receipt(s) open`,
          figures: {
            slipsAwaitingVerification: slipCount,
            unidentifiedOpen: unidentified._count,
            unidentifiedAmount: formatMoney(D(unidentified._sum.amount)),
          },
          items: slips.map((p) => ({
            type: 'payment',
            id: p.publicId,
            date: dayOf(p.createdAt),
            amount: p.amount.toFixed(2),
            description: p.referenceCode,
          })),
        };
      }
      case 'deliveries_received': {
        const where: Prisma.PurchaseOrderWhereInput = {
          entityId: period.entityId,
          poKind: 'production',
          status: { in: ['issued', 'accepted'] },
          order: { deliveryReconciliation: { is: { evaluatedAt: { lt: endOfDay } } } },
        };
        const missing = await tx.purchaseOrder.findMany({
          where,
          include: { order: { select: { orderCode: true } } },
          take: 50,
        });
        const missingCount = await tx.purchaseOrder.count({ where });
        const noInvoice = await tx.goodsReceipt.count({
          where: {
            entityId: period.entityId,
            receivedOn: { lte: end },
            statementLines: { none: { statement: { vendorInvoices: { some: { status: 'validated' } } } } },
          },
        });
        return {
          passed: missingCount === 0,
          summary: `${missingCount} delivery(ies) with POD but no GR; ${noInvoice} GR(s) without a validated factory tax invoice (input VAT pending)`,
          figures: { podWithoutGr: missingCount, grWithoutTaxInvoice: noInvoice },
          items: missing.map((p) => ({
            type: 'purchase_order',
            id: p.publicId,
            date: null,
            amount: p.netAmount.toFixed(2),
            description: `${p.poNumber} ${p.order.orderCode}`,
          })),
        };
      }
      case 'receivables_reviewed': {
        const overdue = await tx.receivableItem.aggregate({
          where: {
            entityId: period.entityId,
            status: { in: ['open', 'partially_paid'] },
            dueDate: { lte: end },
          },
          _count: true,
          _sum: { openAmount: true },
        });
        const provisions = await tx.badDebtProvision.count({ where: { fiscalPeriodId: period.id } });
        return {
          passed: true,
          summary: `${overdue._count} receivable(s) overdue at ${dayOf(end)} (${formatMoney(D(overdue._sum.openAmount))}); ${provisions} allowance update(s) this month`,
          figures: {
            overdueItems: overdue._count,
            overdueAmount: formatMoney(D(overdue._sum.openAmount)),
            allowanceUpdates: provisions,
          },
          items: [],
        };
      }
      case 'rollforwards_reviewed': {
        const [points, retention] = await Promise.all([
          this.reports.balanceOf(period.entityId, ['2330'], dayOf(end)),
          this.reports.balanceOf(period.entityId, ['2130'], dayOf(end)),
        ]);
        return {
          passed: true,
          summary: `Points liability ${formatMoney(points.neg())}; retention payable ${formatMoney(retention.neg())} at ${dayOf(end)}`,
          figures: {
            pointsLiability: formatMoney(points.neg()),
            retentionPayable: formatMoney(retention.neg()),
          },
          items: [],
        };
      }
      case 'accruals_recorded': {
        const where: Prisma.JournalEntryWhereInput = {
          entityId: period.entityId,
          kind: { in: ['manual', 'reversal', 'recurring'] },
          status: 'pending_approval',
          documentDate: { gte: period.startDate, lte: end },
        };
        const pending = await tx.journalEntry.findMany({ where, take: 50 });
        const count = await tx.journalEntry.count({ where });
        return {
          passed: count === 0,
          summary: `${count} manual journal(s) of the month waiting for approval`,
          figures: { pendingJournals: count },
          items: pending.map((j) => ({
            type: 'journal_entry',
            id: j.publicId,
            date: dayOf(j.documentDate),
            amount: j.totalDebit.toFixed(2),
            description: j.description,
          })),
        };
      }
      case 'tax_papers_reconciled': {
        const final = await tx.taxReport.findMany({
          where: {
            fiscalPeriodId: period.id,
            status: { in: ['final', 'filed'] },
            kind: { in: REQUIRED_TAX_PAPERS },
          },
        });
        const missing = REQUIRED_TAX_PAPERS.filter((k) => !final.some((r) => r.kind === k));
        return {
          passed: missing.length === 0,
          summary: missing.length
            ? `Not final: ${missing.join(', ')}`
            : 'VAT and WHT papers final and reconciled to the GL',
          figures: { final: final.length, required: REQUIRED_TAX_PAPERS.length },
          items: missing.map((k) => ({
            type: 'tax_report',
            id: null,
            date: null,
            amount: null,
            description: k,
          })),
        };
      }
      case 'subledgers_reconciled': {
        const rows = await this.subledgers(tx, period);
        const off = rows.filter((r) => r.difference !== '0.00');
        return {
          passed: off.length === 0,
          summary: off.length
            ? `Differences: ${off.map((r) => `${r.key} ${r.difference}`).join('; ')}`
            : 'Sub-ledgers agree with the GL',
          figures: Object.fromEntries(rows.map((r) => [r.key, r.difference])),
          items: rows.map((r) => ({
            type: 'reconciliation',
            id: r.key,
            date: null,
            amount: r.difference,
            description: `${r.accounts}: sub-ledger ${r.subledger}, GL ${r.gl}`,
          })),
        };
      }
      case 'review':
        return {
          passed: true,
          summary: 'Reviewed and closed by a Finance Manager other than the submitter',
          figures: {},
          items: [],
        };
    }
  }

  /**
   * Sub-ledger ↔ GL (§7 step 8), both at the time of the check (the sub-ledgers hold current open amounts):
   * AR (1210), factory AP (2110: open GR balances + advances not yet applied), other vendors (2120), advances to
   * factories (1250: paid advances whose PO has no GR), retention (2130), store credit (2320); fixed assets at the
   * period end (register vs 15xx).
   */
  /** The §7 step 8 rows as of now, outside a close (U-B0.3): read-only; `month` places the fixed-asset rows. */
  async reconciliation(month: string) {
    const period = await this.periods.periodOf(await this.entities.defaultEntityId(), `${month}-01`);
    return this.subledgers(this.prisma, period);
  }

  async subledgers(tx: Tx, period: FiscalPeriod) {
    const entityId = period.entityId;
    // The sub-ledgers hold what is open now, including documents dated ahead: compare with every posted line.
    const gl = async (codes: string[], credit: boolean) => {
      const b = await this.reports.balanceOf(entityId, codes, '9999-12-31');
      return credit ? b.neg() : b;
    };
    const sum = async (where: Prisma.PayableItemWhereInput, withVat: boolean) => {
      const s = await tx.payableItem.aggregate({
        where: { entityId, ...where },
        _sum: { openNetAmount: true, openVatAmount: true, netAmount: true },
      });
      return withVat ? D(s._sum.openNetAmount).add(D(s._sum.openVatAmount)) : D(s._sum.openNetAmount);
    };
    const open = { in: ['open', 'eligible', 'in_run'] as ('open' | 'eligible' | 'in_run')[] };
    const unappliedAdvances = await tx.payableItem.aggregate({
      where: {
        entityId,
        source: 'advance',
        status: { in: ['eligible', 'in_run'] },
        purchaseOrder: { goodsReceipts: { some: {} } },
      },
      _sum: { netAmount: true },
    });
    const paidAdvances = await tx.payableItem.aggregate({
      where: { entityId, source: 'advance', status: 'paid', purchaseOrder: { goodsReceipts: { none: {} } } },
      _sum: { netAmount: true },
    });
    const ar = await tx.receivableItem.aggregate({
      where: { entityId, status: { in: ['open', 'partially_paid'] } },
      _sum: { openAmount: true },
    });
    const wallets = await tx.storeCreditEntry.aggregate({
      where: { account: { entityId } },
      _sum: { amount: true },
    });
    const rows: { key: string; accounts: string; subledger: MoneyValue; gl: MoneyValue }[] = [
      {
        key: 'receivables',
        accounts: '1210',
        subledger: D(ar._sum.openAmount),
        gl: await gl(['1210'], false),
      },
      {
        key: 'factory_payables',
        accounts: '2110',
        subledger: (await sum({ source: 'goods_receipt', status: open }, false)).add(
          D(unappliedAdvances._sum.netAmount),
        ),
        gl: await gl(['2110'], true),
      },
      {
        key: 'vendor_payables',
        accounts: '2120',
        subledger: await sum({ source: 'vendor_invoice', status: open }, true),
        gl: await gl(['2120'], true),
      },
      {
        key: 'factory_advances',
        accounts: '1250',
        subledger: D(paidAdvances._sum.netAmount),
        gl: await gl(['1250'], false),
      },
      {
        key: 'retention',
        accounts: '2130',
        subledger: await sum({ source: 'retention', status: open }, false),
        gl: await gl(['2130'], true),
      },
      {
        key: 'store_credit',
        accounts: '2320',
        subledger: D(wallets._sum.amount),
        gl: await gl(['2320'], true),
      },
    ];
    const month = dayOf(period.startDate).slice(0, 7);
    const fa = await this.assets.rollForward(month, month);
    const out = rows.map((r) => ({
      key: r.key,
      accounts: r.accounts,
      subledger: formatMoney(r.subledger),
      gl: formatMoney(r.gl),
      difference: formatMoney(r.gl.sub(r.subledger)),
    }));
    for (const r of fa.reconciliation)
      out.push({
        key: `fixed_assets_${r.accountCode}`,
        accounts: r.accountCode,
        subledger: r.register,
        gl: r.gl,
        difference: r.difference,
      });
    return out;
  }

  static zero = ZERO;
}
