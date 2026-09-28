import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ApprovalRequest,
  type Prisma,
  type RecurringJournal,
  type RecurringJournalStatus,
} from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import { JournalPostingService } from './journal-posting.service';
import { addMonths, dateOnly, dayOf, isDay, monthEnd } from './ledger-dates';
import { type ManualLineInput } from './manual-journals.service';

export interface RecurringJournalInput {
  name: string;
  description: string;
  dayOfMonth: number;
  startOn: string;
  endOn?: string | null;
  autoReverse: boolean;
  lines: ManualLineInput[];
}

/** The run date in the month of `monthStart` for `dayOfMonth` (1–28, so it always exists). */
const runDate = (monthStart: string, dayOfMonth: number) =>
  `${monthStart.slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`;

/**
 * Recurring journals (B5.1): a definition approved once like a manual journal (`recurring_journal`, D-169);
 * each month the job posts a `recurring` entry on the run day, optionally auto-reversed on the first day of
 * the next month (accruals, accounting-design §7 step 6).
 */
@Injectable()
export class RecurringJournalsService {
  private readonly logger = new Logger(RecurringJournalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: JournalPostingService,
    private readonly approvals: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list() {
    return this.prisma.recurringJournal.findMany({
      orderBy: { createdAt: 'desc' },
      include: { approvalRequest: true },
    });
  }

  async get(publicId: string, db: Tx = this.prisma) {
    const row = await db.recurringJournal.findUnique({
      where: { publicId },
      include: { approvalRequest: true },
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async create(actor: UserActor, input: RecurringJournalInput) {
    const entityId = await this.entities.defaultEntityId();
    if (!isDay(input.startOn) || (input.endOn && (!isDay(input.endOn) || input.endOn < input.startOn)))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'startOn', code: 'date', message: 'YYYY-MM-DD, endOn not before startOn' }],
      });
    return this.prisma.withTx(async (tx) => {
      await this.posting.validate(tx, {
        entityId,
        kind: 'recurring',
        strictDimensions: true,
        lines: input.lines.map((l) => ({ ...l, dimensions: l.dimensions ?? {} })),
      });
      const first = runDate(input.startOn, input.dayOfMonth);
      const nextRunOn =
        first >= input.startOn ? first : runDate(addMonths(input.startOn, 1), input.dayOfMonth);
      const row = await tx.recurringJournal.create({
        data: {
          entityId,
          name: input.name,
          description: input.description,
          dayOfMonth: input.dayOfMonth,
          template: { lines: input.lines } as unknown as Prisma.InputJsonValue,
          autoReverse: input.autoReverse,
          startOn: dateOnly(input.startOn),
          endOn: input.endOn ? dateOnly(input.endOn) : null,
          nextRunOn: dateOnly(nextRunOn),
          createdById: actor.userId,
        },
      });
      const total = input.lines
        .filter((l) => l.side === 'debit')
        .reduce((a, l) => a.add(l.amount), new MoneyDecimal(0));
      const request = await this.approvals.create(tx, {
        policyKey: 'recurring_journal',
        subject: { type: 'recurring_journal', id: row.id, publicId: row.publicId },
        requester: actor,
        amount: formatMoney(total),
        entityId,
        payload: {
          recurring: true,
          name: input.name,
          dayOfMonth: input.dayOfMonth,
          total: formatMoney(total),
        },
      });
      await tx.recurringJournal.update({ where: { id: row.id }, data: { approvalRequestId: request.id } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'recurring_journal.create',
        actor,
        resourceType: 'recurring_journal',
        resourcePublicId: row.publicId,
        entityId,
        data: { name: input.name, total: formatMoney(total) },
      });
      return this.get(row.publicId, tx);
    });
  }

  async onDecided(tx: Tx, request: ApprovalRequest, approved: boolean): Promise<void> {
    const row = await tx.recurringJournal.findUnique({ where: { id: request.subjectId } });
    if (!row || row.status !== 'pending_approval') return;
    const approver = await tx.approvalAction.findFirst({
      where: { requestId: request.id, action: 'approve' },
      orderBy: { createdAt: 'desc' },
    });
    const updated = await tx.recurringJournal.update({
      where: { id: row.id },
      data: approved
        ? {
            status: 'active',
            approvedAt: new Date(),
            approvedById: approver?.actorUserId ?? null,
            rowVersion: { increment: 1 },
          }
        : { status: 'rejected', rowVersion: { increment: 1 } },
    });
    await this.record(tx, updated, approved ? 'recurring_journal.activated' : 'recurring_journal.rejected');
  }

  /** Pause / resume / end (Finance Manager; audited). */
  async setStatus(
    actor: UserActor,
    publicId: string,
    to: Extract<RecurringJournalStatus, 'active' | 'paused' | 'ended'>,
  ) {
    return this.prisma.withTx(async (tx) => {
      const row = await this.get(publicId, tx);
      const allowed: Record<string, RecurringJournalStatus[]> = {
        active: ['paused', 'ended'],
        paused: ['active', 'ended'],
      };
      if (!allowed[row.status]?.includes(to))
        throw new DomainException('ledger.journal_not_editable', { params: { status: row.status } });
      const updated = await tx.recurringJournal.update({
        where: { id: row.id },
        data: { status: to, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: `recurring_journal.${to}`,
        actor,
        resourceType: 'recurring_journal',
        resourcePublicId: row.publicId,
        entityId: row.entityId,
      });
      await this.record(tx, updated, `recurring_journal.${to}`);
      return this.get(publicId, tx);
    });
  }

  /** Scheduled: posts every active definition whose run day has come (once per month). */
  async runDue(now = new Date()): Promise<number> {
    const today = bangkokDate(now);
    const due = await this.prisma.recurringJournal.findMany({
      where: { status: 'active', nextRunOn: { lte: dateOnly(today) } },
      take: 100,
    });
    let posted = 0;
    for (const def of due) {
      try {
        await this.prisma.withTx(async (tx) => {
          const [locked] = await tx.$queryRaw<{ next_run_on: Date; status: string }[]>`
            SELECT next_run_on, status FROM recurring_journals WHERE id = ${def.id} FOR UPDATE`;
          if (!locked || locked.status !== 'active' || dayOf(locked.next_run_on) > today) return;
          const runOn = dayOf(locked.next_run_on);
          const lines = (def.template as unknown as { lines: ManualLineInput[] }).lines;
          const entry = await this.posting.post(
            tx,
            {
              entityId: def.entityId,
              kind: 'recurring',
              documentDate: runOn,
              description: `${def.name} (${runOn.slice(0, 7)})`,
              recurringJournalId: def.id,
              approvalRequestId: def.approvalRequestId,
              approvedById: def.approvedById,
              createdById: def.createdById,
              jvNumber: await this.numbering.next(tx, 'jv', dateOnly(runOn), def.entityId),
              autoReverseOn: def.autoReverse ? addMonths(runOn, 1) : null,
              strictDimensions: true,
              lines: lines.map((l) => ({ ...l, dimensions: l.dimensions ?? {} })),
            },
            systemActor('ledger.recurring'),
          );
          const next = runDate(addMonths(runOn, 1), def.dayOfMonth);
          const ended = def.endOn !== null && next > dayOf(def.endOn);
          await tx.recurringJournal.update({
            where: { id: def.id },
            data: { nextRunOn: dateOnly(ended ? monthEnd(runOn) : next), status: ended ? 'ended' : 'active' },
          });
          await this.events.record(
            tx,
            {
              type: 'recurring_journal.posted',
              aggregateType: 'recurring_journal',
              aggregateId: def.publicId,
              entityId: def.entityId,
              payload: { recurringJournalId: def.publicId, journalEntryId: entry.publicId, runOn },
            },
            systemActor('ledger.recurring'),
          );
        });
        posted++;
      } catch (error) {
        this.logger.error(`recurring journal ${def.publicId} failed: ${(error as Error).message}`);
      }
    }
    return posted;
  }

  private async record(tx: Tx, row: RecurringJournal, type: string) {
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'recurring_journal',
        aggregateId: row.publicId,
        entityId: row.entityId,
        payload: { recurringJournalId: row.publicId, status: row.status },
      },
      systemActor('ledger.recurring'),
    );
  }
}
