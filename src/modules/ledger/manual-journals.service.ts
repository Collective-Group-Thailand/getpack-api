import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type ApprovalRequest, type JournalEntry, type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import { type JournalDraftLine, JournalPostingService } from './journal-posting.service';
import { addMonths, dateOnly, dayOf, isDay } from '@common/ledger-core/dates';
import { PeriodsService } from './periods.service';
import { type DimensionKey } from '@common/ledger-core/template';

export const JOURNAL_INCLUDE = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { code: true, nameTh: true, nameEn: true } },
      order: { select: { publicId: true, orderCode: true } },
      orderGroup: { select: { publicId: true, groupCode: true } },
      customer: { select: { publicId: true } },
      company: { select: { publicId: true } },
      factory: { select: { publicId: true } },
      vendor: { select: { publicId: true } },
      productType: { select: { publicId: true, code: true } },
      campaign: { select: { publicId: true } },
      promotion: { select: { publicId: true } },
      costCentre: { select: { code: true } },
    },
  },
  fiscalPeriod: { select: { publicId: true, status: true } },
  postingRule: { select: { key: true } },
  postingRuleVersion: { select: { publicId: true, versionNo: true } },
  reverses: { select: { publicId: true, entryNo: true } },
  reversedBy: { select: { publicId: true, entryNo: true } },
  approvalRequest: { select: { publicId: true, status: true } },
  createdBy: { select: { publicId: true, displayName: true } },
  approvedBy: { select: { publicId: true, displayName: true } },
  postedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.JournalEntryInclude;
export type JournalRow = Prisma.JournalEntryGetPayload<{ include: typeof JOURNAL_INCLUDE }>;

export interface ManualLineInput {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: string;
  description?: string;
  dimensions?: Partial<Record<DimensionKey, string>>;
}

export interface ManualJournalInput {
  documentDate: string;
  description: string;
  lines: ManualLineInput[];
  /** Auto-reversing journal (accruals): its reversal posts on this date. */
  autoReverseOn?: string | null;
}

const POLICY = 'manual_journal';

/**
 * Manual journals (accounting-design §1.1: the exception, with maker-checker §8): the maker drafts and
 * submits, a Finance Manager approves through the approvals engine (the requester never approves), and the
 * approval posts it — into the next open period when its own is no longer open (§1.4). Reversals of posted
 * manual entries follow the same path; auto-reversing journals post their reversal on the date set.
 */
@Injectable()
export class ManualJournalsService {
  private readonly logger = new Logger(ManualJournalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: JournalPostingService,
    private readonly periods: PeriodsService,
    private readonly approvals: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  static etag(entry: Pick<JournalEntry, 'publicId' | 'rowVersion'>): string {
    return etagOf(entry.publicId, entry.rowVersion);
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<JournalRow> {
    const entry = await db.journalEntry.findUnique({ where: { publicId }, include: JOURNAL_INCLUDE });
    if (!entry) throw new DomainException('http.not_found');
    return entry;
  }

  async create(actor: UserActor, input: ManualJournalInput): Promise<JournalRow> {
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      await this.periods.ensureYear(tx, entityId, input.documentDate);
      const period = await tx.fiscalPeriod.findFirstOrThrow({
        where: {
          entityId,
          startDate: { lte: dateOnly(input.documentDate) },
          endDate: { gte: dateOnly(input.documentDate) },
        },
      });
      const lines = await this.checkedLines(tx, entityId, period.id, input);
      const entry = await tx.journalEntry.create({
        data: {
          entityId,
          fiscalPeriodId: period.id,
          entryDate: dateOnly(input.documentDate),
          documentDate: dateOnly(input.documentDate),
          kind: 'manual',
          status: 'draft',
          description: input.description,
          autoReverseOn: input.autoReverseOn ? dateOnly(input.autoReverseOn) : null,
          createdById: actor.userId,
          lines: { create: lines },
        },
      });
      await this.record(tx, entry, 'journal_entry.drafted', actor);
      return this.get(entry.publicId, tx);
    });
  }

  async update(actor: UserActor, publicId: string, ifMatch: string | undefined, input: ManualJournalInput) {
    return this.prisma.withTx(async (tx) => {
      const entry = await this.editable(tx, actor, publicId);
      assertIfMatch(ifMatch, ManualJournalsService.etag(entry));
      await this.periods.ensureYear(tx, entry.entityId, input.documentDate);
      const period = await tx.fiscalPeriod.findFirstOrThrow({
        where: {
          entityId: entry.entityId,
          startDate: { lte: dateOnly(input.documentDate) },
          endDate: { gte: dateOnly(input.documentDate) },
        },
      });
      const lines = await this.checkedLines(tx, entry.entityId, period.id, input);
      await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          fiscalPeriodId: period.id,
          entryDate: dateOnly(input.documentDate),
          documentDate: dateOnly(input.documentDate),
          description: input.description,
          autoReverseOn: input.autoReverseOn ? dateOnly(input.autoReverseOn) : null,
          rowVersion: { increment: 1 },
          lines: { create: lines },
        },
      });
      return this.get(publicId, tx);
    });
  }

  /** Discards a draft (never submitted, so nothing to keep). */
  async discard(actor: UserActor, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const entry = await this.editable(tx, actor, publicId);
      await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'journal_entry.discarded',
        actor,
        resourceType: 'journal_entry',
        resourcePublicId: publicId,
        entityId: entry.entityId,
      });
    });
  }

  /** The maker submits the draft for the checker (policy `manual_journal`, D-169). */
  async submit(actor: UserActor, publicId: string): Promise<JournalRow> {
    return this.prisma.withTx(async (tx) => {
      const entry = await this.editable(tx, actor, publicId);
      await this.requireJvSeries(tx, entry.entityId);
      const lines = await tx.journalLine.findMany({ where: { journalEntryId: entry.id } });
      const total = lines.reduce((a, l) => a.add(l.debit.toString()), new MoneyDecimal(0));
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'journal_entry', id: entry.id, publicId: entry.publicId },
        requester: actor,
        amount: formatMoney(total),
        entityId: entry.entityId,
        payload: {
          kind: entry.kind,
          documentDate: dayOf(entry.documentDate),
          description: entry.description,
          total: formatMoney(total),
          lines: lines.length,
        },
      });
      const updated = await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'pending_approval', approvalRequestId: request.id, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'journal_entry.create',
        actor,
        resourceType: 'journal_entry',
        resourcePublicId: entry.publicId,
        entityId: entry.entityId,
        data: { total: formatMoney(total) },
      });
      await this.record(tx, updated, 'journal_entry.submitted', actor);
      return this.get(publicId, tx);
    });
  }

  /** Requests the reversal of a posted manual / recurring entry, approved like a manual journal. */
  async requestReversal(actor: UserActor, publicId: string, input: { documentDate: string; reason: string }) {
    return this.prisma.withTx(async (tx) => {
      const original = await tx.journalEntry.findUnique({
        where: { publicId },
        include: { lines: true, reversedBy: true },
      });
      if (!original) throw new DomainException('http.not_found');
      if (original.status !== 'posted')
        throw new DomainException('ledger.not_reversible', { params: { reason: 'not posted' } });
      if (original.reversedBy)
        throw new DomainException('ledger.not_reversible', { params: { reason: 'already reversed' } });
      if (original.kind === 'auto' || original.kind === 'reversal')
        throw new DomainException('ledger.not_reversible', {
          params: { reason: 'sub-ledger entries are corrected by their documents (void, credit note)' },
        });
      await this.requireJvSeries(tx, original.entityId);
      await this.periods.ensureYear(tx, original.entityId, input.documentDate);
      const period = await tx.fiscalPeriod.findFirstOrThrow({
        where: {
          entityId: original.entityId,
          startDate: { lte: dateOnly(input.documentDate) },
          endDate: { gte: dateOnly(input.documentDate) },
        },
      });
      const reversal = await tx.journalEntry.create({
        data: {
          entityId: original.entityId,
          fiscalPeriodId: period.id,
          entryDate: dateOnly(input.documentDate),
          documentDate: dateOnly(input.documentDate),
          kind: 'reversal',
          status: 'draft',
          reversesEntryId: original.id,
          description: `กลับรายการ ${original.entryNo}: ${input.reason}`.slice(0, 500),
          createdById: actor.userId,
          lines: { create: swappedLines(original.lines) },
        },
      });
      const total = original.totalDebit.toFixed(2);
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'journal_entry', id: reversal.id, publicId: reversal.publicId },
        requester: actor,
        amount: total,
        entityId: original.entityId,
        payload: { kind: 'reversal', reverses: original.entryNo, reason: input.reason, total },
      });
      const updated = await tx.journalEntry.update({
        where: { id: reversal.id },
        data: { status: 'pending_approval', approvalRequestId: request.id },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'journal_entry.create',
        actor,
        resourceType: 'journal_entry',
        resourcePublicId: reversal.publicId,
        entityId: original.entityId,
        data: { reverses: original.publicId, reason: input.reason },
      });
      await this.record(tx, updated, 'journal_entry.submitted', actor);
      return this.get(reversal.publicId, tx);
    });
  }

  /** Approval outcome of a manual journal (called by the ledger approvals subscriber). */
  async onDecided(tx: Tx, request: ApprovalRequest, approved: boolean, reason: string): Promise<void> {
    const entry = await tx.journalEntry.findUnique({ where: { id: request.subjectId } });
    if (!entry || entry.status !== 'pending_approval') return;
    if (!approved) {
      const rejected = await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'rejected', rejectionReason: reason },
      });
      await this.record(tx, rejected, 'journal_entry.rejected', systemActor('ledger.approvals'));
      return;
    }
    const approver = await tx.approvalAction.findFirst({
      where: { requestId: request.id, action: 'approve' },
      orderBy: { createdAt: 'desc' },
    });
    const jvNumber = await this.numbering.next(tx, 'jv', entry.documentDate, entry.entityId);
    await tx.journalEntry.update({ where: { id: entry.id }, data: { jvNumber } });
    await tx.$executeRaw`SAVEPOINT post_manual`;
    try {
      const posted = await this.posting.postExisting(tx, entry.id, systemActor('ledger.approvals'), {
        approvedById: approver?.actorUserId ?? null,
      });
      await tx.$executeRaw`RELEASE SAVEPOINT post_manual`;
      await this.record(tx, posted, 'journal_entry.posted', systemActor('ledger.approvals'));
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
      // The chart or the periods changed since submission: the journal cannot post as approved.
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT post_manual`;
      const rejected = await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'rejected', rejectionReason: `posting refused: ${error.code}` },
      });
      await this.record(tx, rejected, 'journal_entry.rejected', systemActor('ledger.approvals'));
    }
  }

  /** Scheduled: posts the reversal of every auto-reversing journal due today (approved with the original). */
  async autoReverseDue(now = new Date()): Promise<number> {
    const today = bangkokDate(now);
    const due = await this.prisma.journalEntry.findMany({
      where: { status: 'posted', autoReverseOn: { lte: dateOnly(today) }, reversedBy: null },
      include: { lines: true },
      take: 200,
    });
    let done = 0;
    for (const original of due) {
      try {
        await this.prisma.withTx(async (tx) => {
          const posted = await this.posting.post(
            tx,
            {
              entityId: original.entityId,
              kind: 'reversal',
              documentDate: dayOf(original.autoReverseOn!),
              description: `กลับรายการอัตโนมัติ ${original.entryNo}`,
              reversesEntryId: original.id,
              approvedById: original.approvedById,
              approvalRequestId: original.approvalRequestId,
              lines: await this.draftLines(tx, swappedLines(original.lines)),
            },
            systemActor('ledger.auto_reverse'),
          );
          await this.record(tx, posted, 'journal_entry.posted', systemActor('ledger.auto_reverse'));
        });
        done++;
      } catch (error) {
        this.logger.error(`auto-reversal of ${original.publicId} failed: ${(error as Error).message}`);
      }
    }
    return done;
  }

  /** The first day of the month after `day` (default reversal date of an accrual). */
  static nextMonthStart(day: string): string {
    return addMonths(day, 1);
  }

  private async editable(tx: Tx, actor: UserActor, publicId: string) {
    const entry = await tx.journalEntry.findUnique({ where: { publicId } });
    if (!entry || !['manual', 'reversal'].includes(entry.kind)) throw new DomainException('http.not_found');
    if (entry.status !== 'draft')
      throw new DomainException('ledger.journal_not_editable', { params: { status: entry.status } });
    if (entry.createdById !== actor.userId) throw new DomainException('auth.forbidden');
    return entry;
  }

  private async requireJvSeries(tx: Tx, entityId: bigint) {
    const series = await tx.documentSeries.findUnique({
      where: { entityId_docType: { entityId, docType: 'jv' } },
    });
    if (!series) throw new DomainException('numbering.series_missing', { params: { docType: 'jv' } });
  }

  /** Strictly validated lines (accounts, control accounts, dimensions, balance) ready to insert. */
  private async checkedLines(tx: Tx, entityId: bigint, periodId: bigint, input: ManualJournalInput) {
    if (!isDay(input.documentDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'documentDate', code: 'date', message: 'YYYY-MM-DD' }],
      });
    if (input.autoReverseOn && (!isDay(input.autoReverseOn) || input.autoReverseOn <= input.documentDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'autoReverseOn', code: 'after', message: 'a date after the document date' }],
      });
    const validated = await this.posting.validate(tx, {
      entityId,
      kind: 'manual',
      strictDimensions: true,
      lines: input.lines.map((l) => ({ ...l, dimensions: l.dimensions ?? {} })),
    });
    return validated.map((l, i) => ({
      lineNo: i + 1,
      accountId: l.account.id,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      ...l.dims,
      entityId,
      fiscalPeriodId: periodId,
      entryDate: dateOnly(input.documentDate),
    }));
  }

  private async draftLines(tx: Tx, lines: ReturnType<typeof swappedLines>): Promise<JournalDraftLine[]> {
    const accounts = new Map(
      (await tx.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) } } })).map((a) => [
        a.id,
        a.code,
      ]),
    );
    const out: JournalDraftLine[] = [];
    for (const l of lines) {
      const debit = new MoneyDecimal(l.debit.toString());
      out.push({
        accountCode: accounts.get(l.accountId)!,
        side: debit.gt(0) ? 'debit' : 'credit',
        amount: debit.gt(0) ? debit : new MoneyDecimal(l.credit.toString()),
        description: l.description,
        dimensions: await publicDimensions(tx, l),
        taxCode: l.taxCode,
        taxBase: l.taxBaseAmount?.toString() ?? null,
      });
    }
    return out;
  }

  private async record(
    tx: Tx,
    entry: JournalEntry,
    type: string,
    actor: UserActor | ReturnType<typeof systemActor>,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'journal_entry',
        aggregateId: entry.publicId,
        entityId: entry.entityId,
        payload: {
          journalEntryId: entry.publicId,
          kind: entry.kind,
          status: entry.status,
          entryNo: entry.entryNo,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'journal_entry',
      aggregatePublicId: entry.publicId,
      action: type,
      messageKey: `activity.${type}`,
      visibility: ['internal'],
      entityId: entry.entityId,
      domainEventId: event.id,
      actor,
    });
  }
}

type LineRow = Prisma.JournalLineGetPayload<object>;

/** The lines of `lines` with debit and credit swapped (a reversal), same dimensions and tax tagging. */
export function swappedLines(lines: LineRow[]) {
  return [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      lineNo: l.lineNo,
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      description: l.description,
      orderId: l.orderId,
      orderGroupId: l.orderGroupId,
      customerUserId: l.customerUserId,
      companyId: l.companyId,
      factoryId: l.factoryId,
      vendorId: l.vendorId,
      productTypeId: l.productTypeId,
      channel: l.channel,
      campaignId: l.campaignId,
      promotionId: l.promotionId,
      costCentreId: l.costCentreId,
      taxCode: l.taxCode,
      taxBaseAmount: l.taxBaseAmount,
      entityId: l.entityId,
      fiscalPeriodId: l.fiscalPeriodId,
      entryDate: l.entryDate,
    }));
}

/** Internal dimension ids of a line → the public ids a draft line carries. */
export async function publicDimensions(
  tx: Tx,
  l: Pick<
    LineRow,
    | 'orderId'
    | 'orderGroupId'
    | 'customerUserId'
    | 'companyId'
    | 'factoryId'
    | 'vendorId'
    | 'productTypeId'
    | 'channel'
    | 'campaignId'
    | 'promotionId'
    | 'costCentreId'
  >,
): Promise<Partial<Record<DimensionKey, string>>> {
  const out: Partial<Record<DimensionKey, string>> = {};
  const pick = async (
    key: DimensionKey,
    id: bigint | null,
    find: (id: bigint) => Promise<{ publicId: string } | null>,
  ) => {
    if (id !== null) {
      const row = await find(id);
      if (row) out[key] = row.publicId;
    }
  };
  const sel = { select: { publicId: true } } as const;
  await pick('order', l.orderId, (id) => tx.order.findUnique({ where: { id }, ...sel }));
  await pick('orderGroup', l.orderGroupId, (id) => tx.orderGroup.findUnique({ where: { id }, ...sel }));
  await pick('customer', l.customerUserId, (id) => tx.user.findUnique({ where: { id }, ...sel }));
  await pick('company', l.companyId, (id) => tx.company.findUnique({ where: { id }, ...sel }));
  await pick('factory', l.factoryId, (id) => tx.factory.findUnique({ where: { id }, ...sel }));
  await pick('vendor', l.vendorId, (id) => tx.vendor.findUnique({ where: { id }, ...sel }));
  await pick('productType', l.productTypeId, (id) => tx.productType.findUnique({ where: { id }, ...sel }));
  await pick('campaign', l.campaignId, (id) => tx.campaign.findUnique({ where: { id }, ...sel }));
  await pick('promotion', l.promotionId, (id) => tx.promotion.findUnique({ where: { id }, ...sel }));
  if (l.channel) out.channel = l.channel;
  if (l.costCentreId !== null) {
    const cc = await tx.costCentre.findUnique({ where: { id: l.costCentreId } });
    if (cc) out.costCentre = cc.code;
  }
  return out;
}
