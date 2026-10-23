import { type Actor, actorColumns, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { addMonths, dateOnly, dayOf } from '@common/ledger-core/dates';
import { MoneyDecimal } from '@common/money/money';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type ErpGlRecurringJournal,
  type JournalKind,
  type JournalStatus,
  Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { dec } from './erp.math';
import { type ErpTaxExportResultDto } from './erp-e4.dto';
import {
  type ErpGlJournalDto,
  type ErpGlJournalLineDto,
  type ErpGlJournalListQuery,
  type ErpGlRecurringDto,
  type ErpGlRecurringLineDto,
  type ErpGlReverseJournalDto,
  type ErpGlSaveJournalDto,
  type ErpGlSaveRecurringDto,
  type ErpGlSourceDocDto,
} from './erp-e6.dto';
import { ErpFilesService } from './erp-files.service';
import { accountRef, ErpLedgerService, type GlDraftLine, money, monthOf } from './erp-ledger.service';
import { isoTs, userRef } from './erp-sales.shared';
import { itemRef, partnerRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * E6 journals (D-389): the journal list and detail with drill-down to the source document; manual journals
 * under maker-checker (draft → pending approval → posted / rejected, never self-approved); reversals of posted
 * entries; recurring journals and accruals that reverse themselves (two daily jobs); the CSV export for an
 * accountant's own software (D-396).
 */

const JOURNAL_INCLUDE = {
  lines: {
    include: {
      account: true,
      item: true,
      partner: true,
      warehouse: true,
      productionOrder: true,
      machine: true,
      bankAccount: true,
    },
    orderBy: { lineNo: 'asc' as const },
  },
  postingRule: true,
  reverses: true,
  reversedBy: true,
  createdBy: true,
  approvedBy: true,
} satisfies Prisma.ErpGlJournalEntryInclude;
type JournalRow = Prisma.ErpGlJournalEntryGetPayload<{ include: typeof JOURNAL_INCLUDE }>;

type JournalFacts = { kind: JournalKind; status: JournalStatus; own: boolean; reversed: boolean };
const JOURNAL_ACTIONS: ActionRule<JournalFacts>[] = [
  {
    key: 'erp_journal.edit',
    permissions: ['factory_ledger.post'],
    when: (j) => j.kind === 'manual' && j.status === 'draft',
  },
  {
    key: 'erp_journal.submit',
    permissions: ['factory_ledger.post'],
    when: (j) => j.kind === 'manual' && j.status === 'draft',
  },
  {
    key: 'erp_journal.approve',
    permissions: ['factory_ledger.approve'],
    when: (j) =>
      j.status === 'pending_approval'
        ? j.own
          ? 'ต้องให้ผู้อนุมัติคนอื่นอนุมัติรายการของตัวเอง'
          : true
        : false,
  },
  {
    key: 'erp_journal.reject',
    permissions: ['factory_ledger.approve'],
    when: (j) => j.status === 'pending_approval',
  },
  {
    key: 'erp_journal.delete',
    permissions: ['factory_ledger.post'],
    when: (j) => j.kind === 'manual' && j.status === 'draft',
  },
  {
    key: 'erp_journal.reverse',
    permissions: ['factory_ledger.post'],
    irreversible: true,
    when: (j) =>
      j.status === 'posted' && j.kind !== 'reversal' ? (j.reversed ? 'กลับรายการแล้ว' : true) : false,
  },
];
const RECURRING_ACTIONS: ActionRule<{ status: string }>[] = [
  { key: 'erp_recurring.edit', permissions: ['factory_ledger.post'], when: () => true },
  { key: 'erp_recurring.run', permissions: ['factory_ledger.post'], when: (r) => r.status === 'active' },
];

const sourceDto = (e: {
  sourceDocumentType: string | null;
  sourceDocumentPublicId: string | null;
  sourceDocumentNo: string | null;
}): ErpGlSourceDocDto | null =>
  e.sourceDocumentType && e.sourceDocumentPublicId
    ? { type: e.sourceDocumentType, id: e.sourceDocumentPublicId, number: e.sourceDocumentNo }
    : null;
const entryRef = (e: { publicId: string; entryNo: string | null } | null): ErpGlSourceDocDto | null =>
  e ? { type: 'erp_gl_journal_entry', id: e.publicId, number: e.entryNo } : null;

@Injectable()
export class ErpLedgerJournalsService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
    private readonly audit: AuditService,
    private readonly files: ErpFilesService,
  ) {}

  // ============================================================================================ read

  lineDto(l: JournalRow['lines'][number]): ErpGlJournalLineDto {
    return {
      lineNo: l.lineNo,
      account: accountRef(l.account),
      debit: money(dec(l.debit)),
      credit: money(dec(l.credit)),
      description: l.description,
      item: l.item ? itemRef(l.item) : null,
      partner: l.partner ? partnerRef(l.partner) : null,
      warehouse: l.warehouse ? warehouseRef(l.warehouse) : null,
      productionOrder: l.productionOrder
        ? { id: l.productionOrder.publicId, code: l.productionOrder.moNo, name: l.productionOrder.title }
        : null,
      machine: l.machine ? { id: l.machine.publicId, name: l.machine.name } : null,
      bankAccount: l.bankAccount ? { id: l.bankAccount.publicId, name: l.bankAccount.name } : null,
      taxCode: l.taxCode,
      taxBaseAmount: l.taxBaseAmount ? money(dec(l.taxBaseAmount)) : null,
    };
  }

  journalDto(e: JournalRow, scope: ErpScope, perms: ReadonlySet<string>): ErpGlJournalDto {
    return {
      id: e.publicId,
      entryNo: e.entryNo,
      entryDate: dayOf(e.entryDate),
      documentDate: dayOf(e.documentDate),
      month: monthOf(e.entryDate),
      kind: e.kind,
      status: e.status,
      description: e.description,
      source: sourceDto(e),
      ruleKey: e.postingRule?.key ?? null,
      reverses: entryRef(e.reverses),
      reversedBy: entryRef(e.reversedBy),
      autoReverseOn: e.autoReverseOn ? dayOf(e.autoReverseOn) : null,
      totalDebit: money(dec(e.totalDebit)),
      totalCredit: money(dec(e.totalCredit)),
      rejectionReason: e.rejectionReason,
      lines: e.lines.map((l) => this.lineDto(l)),
      createdBy: e.createdBy?.displayName ?? (e.postingRule ? `ระบบ (กฎ ${e.postingRule.key})` : 'ระบบ'),
      createdAt: isoTs(e.createdAt)!,
      approvedBy: e.approvedBy?.displayName ?? null,
      postedAt: isoTs(e.postedAt),
      nextActions: nextActions(
        {
          kind: e.kind,
          status: e.status,
          own: e.createdById === scope.actor.userId,
          reversed: !!e.reversedBy,
        },
        JOURNAL_ACTIONS,
        perms,
      ),
      version: e.rowVersion,
    };
  }

  async list(scope: ErpScope, q: ErpGlJournalListQuery, perms: ReadonlySet<string>) {
    await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const where: Prisma.ErpGlJournalEntryWhereInput = {
      factoryId: scope.factory.id,
      ...(q.kind && { kind: q.kind as JournalKind }),
      ...(q.status && { status: q.status as JournalStatus }),
      ...(q.month && {
        entryDate: { gte: dateOnly(`${q.month}-01`), lt: dateOnly(addMonths(`${q.month}-01`, 1)) },
      }),
      ...(q.accountCode && { lines: { some: { account: { code: q.accountCode } } } }),
      ...(q.sourceId && { sourceDocumentPublicId: q.sourceId }),
      ...(q.q && {
        OR: [
          { entryNo: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { sourceDocumentNo: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpGlJournalEntry.findMany({
        where,
        include: JOURNAL_INCLUDE,
        orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpGlJournalEntry.count({ where }),
    ]);
    return paginated(
      rows.map((e) => this.journalDto(e, scope, perms)),
      total,
      q,
    );
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlJournalDto> {
    const e = await this.workspace.db.erpGlJournalEntry.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: JOURNAL_INCLUDE,
    });
    if (!e) throw new DomainException('http.not_found');
    return this.journalDto(e, scope, perms);
  }

  private async row(tx: Tx, scope: ErpScope, publicId: string): Promise<JournalRow> {
    const e = await tx.erpGlJournalEntry.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: JOURNAL_INCLUDE,
    });
    if (!e) throw new DomainException('http.not_found');
    return e;
  }

  // ========================================================================================== manual

  private draftLines(body: { lines: ErpGlSaveJournalDto['lines'] }): GlDraftLine[] {
    return body.lines.map((l) => ({
      accountCode: l.accountCode,
      side: l.side as 'debit' | 'credit',
      amount: l.amount,
      description: l.description ?? null,
      dimensions: {
        ...(l.itemId && { item: l.itemId }),
        ...(l.partnerId && { partner: l.partnerId }),
        ...(l.warehouseId && { warehouse: l.warehouseId }),
        ...(l.productionOrderId && { productionOrder: l.productionOrderId }),
        ...(l.machineId && { machine: l.machineId }),
        ...(l.bankAccountId && { bankAccount: l.bankAccountId }),
      },
      taxCode: l.taxCode ?? null,
      taxBase: l.taxBaseAmount ?? null,
    }));
  }

  async create(
    scope: ErpScope,
    body: ErpGlSaveJournalDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlJournalDto> {
    const id = await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      if (body.documentDate < dayOf(settings.ledgerStartOn))
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'documentDate',
              code: 'invalid',
              message: `Before the ledger start ${dayOf(settings.ledgerStartOn)}`,
            },
          ],
        });
      const entry = await this.ledger.createEntry(
        tx,
        scope.factory.id,
        settings,
        {
          kind: 'manual',
          documentDate: body.documentDate,
          description: body.description,
          autoReverseOn: body.autoReverseOn ?? null,
          createdById: scope.actor.userId,
          lines: this.draftLines(body),
        },
        body.submit ? 'pending_approval' : 'draft',
      );
      await this.workspace.record(
        tx,
        scope,
        body.submit ? 'erp_journal.submitted' : 'erp_journal.drafted',
        'erp_gl_journal_entry',
        entry.publicId,
        {},
      );
      return entry.publicId;
    });
    return this.get(scope, id, perms);
  }

  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpGlSaveJournalDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlJournalDto> {
    await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const e = await this.row(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(e.publicId, e.rowVersion));
      if (e.kind !== 'manual' || e.status !== 'draft')
        throw new DomainException('erp.ledger_journal_not_editable', { params: { status: e.status } });
      const lines = await this.ledger.validateLines(tx, scope.factory.id, 'manual', this.draftLines(body));
      const { period, entryDate } = await this.ledger.postingPeriod(
        tx,
        scope.factory.id,
        settings.fiscalYearStartMonth,
        body.documentDate,
      );
      const total = lines.reduce((a, l) => a.plus(l.debit), new MoneyDecimal(0));
      await tx.erpGlJournalLine.deleteMany({ where: { entryId: e.id } });
      await tx.erpGlJournalEntry.update({
        where: { id: e.id },
        data: {
          periodId: period.id,
          entryDate: dateOnly(entryDate),
          documentDate: dateOnly(body.documentDate),
          description: body.description,
          autoReverseOn: body.autoReverseOn ? dateOnly(body.autoReverseOn) : null,
          totalDebit: money(total),
          totalCredit: money(total),
          status: body.submit ? 'pending_approval' : 'draft',
          rowVersion: { increment: 1 },
          lines: {
            create: lines.map((l, i) => ({
              lineNo: i + 1,
              accountId: l.account.id,
              debit: l.debit,
              credit: l.credit,
              description: l.description,
              ...l.dims,
              taxCode: l.taxCode,
              taxBaseAmount: l.taxBase,
              factoryId: scope.factory.id,
              periodId: period.id,
              entryDate: dateOnly(entryDate),
            })),
          },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        body.submit ? 'erp_journal.submitted' : 'erp_journal.updated',
        'erp_gl_journal_entry',
        e.publicId,
        {},
      );
    });
    return this.get(scope, publicId, perms);
  }

  async submit(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlJournalDto> {
    await this.workspace.tx(async (tx) => {
      const e = await this.row(tx, scope, publicId);
      if (e.kind !== 'manual' || e.status !== 'draft')
        throw new DomainException('erp.ledger_journal_not_editable', { params: { status: e.status } });
      await tx.erpGlJournalEntry.update({
        where: { id: e.id },
        data: { status: 'pending_approval', rowVersion: { increment: 1 } },
      });
      await this.workspace.record(tx, scope, 'erp_journal.submitted', 'erp_gl_journal_entry', e.publicId, {});
    });
    return this.get(scope, publicId, perms);
  }

  async approve(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpGlJournalDto> {
    await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const e = await this.row(tx, scope, publicId);
      if (e.status !== 'pending_approval')
        throw new DomainException('erp.ledger_journal_not_editable', { params: { status: e.status } });
      if (e.createdById === scope.actor.userId) throw new DomainException('erp.ledger_self_approval');
      const posted = await this.ledger.postExisting(tx, settings, e.id, scope.actor, {
        approvedById: scope.actor.userId,
        allowSoftClosed: perms.has('factory_ledger.close'),
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'erp_ledger.journal_approved',
        resourceType: 'erp_gl_journal_entry',
        resourcePublicId: e.publicId,
        data: { entryNo: posted.entryNo, total: money(dec(posted.totalDebit)) },
      });
      await this.workspace.record(tx, scope, 'erp_journal.posted', 'erp_gl_journal_entry', e.publicId, {
        entryNo: posted.entryNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  async reject(
    scope: ErpScope,
    publicId: string,
    reason: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlJournalDto> {
    await this.workspace.tx(async (tx) => {
      const e = await this.row(tx, scope, publicId);
      if (e.status !== 'pending_approval')
        throw new DomainException('erp.ledger_journal_not_editable', { params: { status: e.status } });
      await tx.erpGlJournalEntry.update({
        where: { id: e.id },
        data: { status: 'rejected', rejectionReason: reason, rowVersion: { increment: 1 } },
      });
      await this.workspace.record(tx, scope, 'erp_journal.rejected', 'erp_gl_journal_entry', e.publicId, {});
    });
    return this.get(scope, publicId, perms);
  }

  async remove(scope: ErpScope, publicId: string): Promise<void> {
    await this.workspace.tx(async (tx) => {
      const e = await this.row(tx, scope, publicId);
      if (e.kind !== 'manual' || e.status !== 'draft')
        throw new DomainException('erp.ledger_journal_not_editable', { params: { status: e.status } });
      await tx.erpGlJournalLine.deleteMany({ where: { entryId: e.id } });
      await tx.erpGlJournalEntry.delete({ where: { id: e.id } });
      await this.workspace.record(tx, scope, 'erp_journal.deleted', 'erp_gl_journal_entry', e.publicId, {});
    });
  }

  async reverse(
    scope: ErpScope,
    publicId: string,
    body: ErpGlReverseJournalDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlJournalDto> {
    const id = await this.workspace.tx(async (tx) => {
      const settings = await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      const e = await this.row(tx, scope, publicId);
      const reversal = await this.ledger.reverse(
        tx,
        settings,
        e,
        body.documentDate,
        body.reason,
        scope.actor,
        scope.actor.userId,
      );
      await this.audit.record(tx, {
        category: 'finance',
        action: 'erp_ledger.journal_reversed',
        resourceType: 'erp_gl_journal_entry',
        resourcePublicId: e.publicId,
        data: { reversal: reversal.entryNo, reason: body.reason },
      });
      await this.workspace.record(tx, scope, 'erp_journal.reversed', 'erp_gl_journal_entry', e.publicId, {
        reversal: reversal.entryNo,
      });
      return reversal.publicId;
    });
    return this.get(scope, id, perms);
  }

  // ======================================================================================= recurring

  recurringDto(r: ErpGlRecurringJournal, perms: ReadonlySet<string>): ErpGlRecurringDto {
    const lines = r.lines as unknown as ErpGlRecurringLineDto[];
    return {
      id: r.publicId,
      name: r.name,
      description: r.description,
      dayOfMonth: r.dayOfMonth,
      startOn: dayOf(r.startOn),
      endOn: r.endOn ? dayOf(r.endOn) : null,
      autoReverse: r.autoReverse,
      lines,
      status: r.status,
      lastRunMonth: r.lastRunMonth,
      total: money(
        lines.filter((l) => l.side === 'debit').reduce((a, l) => a.plus(dec(l.amount)), new MoneyDecimal(0)),
      ),
      nextActions: nextActions({ status: r.status }, RECURRING_ACTIONS, perms),
      version: r.rowVersion,
    };
  }

  async listRecurring(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpGlRecurringDto[]> {
    const rows = await this.workspace.db.erpGlRecurringJournal.findMany({
      where: { factoryId: scope.factory.id },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.recurringDto(r, perms));
  }

  private async checkRecurring(tx: Tx, scope: ErpScope, body: ErpGlSaveRecurringDto): Promise<void> {
    await this.ledger.validateLines(
      tx,
      scope.factory.id,
      'recurring',
      body.lines.map((l) => ({
        accountCode: l.accountCode,
        side: l.side as 'debit',
        amount: l.amount,
        description: l.description ?? null,
      })),
    );
    if (body.endOn && body.endOn < body.startOn)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'endOn', code: 'invalid', message: 'Before the start' }],
      });
  }

  async createRecurring(
    scope: ErpScope,
    body: ErpGlSaveRecurringDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlRecurringDto> {
    const r = await this.workspace.tx(async (tx) => {
      await this.ledger.book(tx, scope.factory.id, scope.actor.userId);
      await this.checkRecurring(tx, scope, body);
      const row = await tx.erpGlRecurringJournal.create({
        data: {
          factoryId: scope.factory.id,
          name: body.name,
          description: body.description,
          dayOfMonth: body.dayOfMonth,
          startOn: dateOnly(body.startOn),
          endOn: body.endOn ? dateOnly(body.endOn) : null,
          autoReverse: body.autoReverse ?? false,
          lines: body.lines as unknown as Prisma.InputJsonValue,
          status: (body.status as 'active' | 'inactive' | undefined) ?? 'active',
          createdById: scope.actor.userId,
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_recurring_journal.created',
        'erp_gl_recurring_journal',
        row.publicId,
        {},
      );
      return row;
    });
    return this.recurringDto(r, perms);
  }

  async updateRecurring(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpGlSaveRecurringDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlRecurringDto> {
    const r = await this.workspace.tx(async (tx) => {
      const row = await tx.erpGlRecurringJournal.findFirst({
        where: { factoryId: scope.factory.id, publicId },
      });
      if (!row) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(row.publicId, row.rowVersion));
      await this.checkRecurring(tx, scope, body);
      const updated = await tx.erpGlRecurringJournal.update({
        where: { id: row.id },
        data: {
          name: body.name,
          description: body.description,
          dayOfMonth: body.dayOfMonth,
          startOn: dateOnly(body.startOn),
          endOn: body.endOn ? dateOnly(body.endOn) : null,
          autoReverse: body.autoReverse ?? false,
          lines: body.lines as unknown as Prisma.InputJsonValue,
          status: (body.status as 'active' | 'inactive' | undefined) ?? row.status,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_recurring_journal.updated',
        'erp_gl_recurring_journal',
        row.publicId,
        {},
      );
      return updated;
    });
    return this.recurringDto(r, perms);
  }

  /** Posts one recurring journal for `month` now (the job, or "run now"); `null` when it already ran that month. */
  async runRecurring(tx: Tx, r: ErpGlRecurringJournal, month: string, factoryPublicId: string, actor: Actor) {
    if (r.lastRunMonth && r.lastRunMonth >= month) return null;
    const byUserId = actorColumns(actor).actorUserId;
    const settings = await this.ledger.book(tx, r.factoryId, byUserId);
    const day = `${month}-${String(r.dayOfMonth).padStart(2, '0')}`;
    const lines = r.lines as unknown as ErpGlRecurringLineDto[];
    const entry = await this.ledger.post(
      tx,
      r.factoryId,
      settings,
      {
        kind: 'recurring',
        documentDate: day,
        description: r.description.replace('{month}', month),
        recurringJournalId: r.id,
        autoReverseOn: r.autoReverse ? addMonths(`${month}-01`, 1) : null,
        createdById: byUserId,
        approvedById: byUserId,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          side: l.side as 'debit',
          amount: l.amount,
          description: l.description ?? null,
        })),
      },
      actor,
    );
    await tx.erpGlRecurringJournal.update({ where: { id: r.id }, data: { lastRunMonth: month } });
    await this.workspace.recordSystem(
      tx,
      factoryPublicId,
      'erp_recurring_journal.posted',
      'erp_gl_recurring_journal',
      r.publicId,
      { entryNo: entry.entryNo, month },
    );
    return entry;
  }

  async runRecurringNow(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpGlJournalDto> {
    const id = await this.workspace.tx(async (tx) => {
      const r = await tx.erpGlRecurringJournal.findFirst({
        where: { factoryId: scope.factory.id, publicId },
      });
      if (!r) throw new DomainException('http.not_found');
      if (r.status !== 'active') throw new DomainException('erp.archived', { params: { name: r.name } });
      const month = bangkokDate(new Date()).slice(0, 7);
      const entry = await this.runRecurring(tx, r, month, scope.factory.publicId, scope.actor);
      if (!entry)
        throw new DomainException('erp.ledger_already_posted', { params: { entryNo: `${r.name} ${month}` } });
      return entry.publicId;
    });
    return this.get(scope, id, perms);
  }

  /** D-389: recurring journals due today (day of month reached, month not yet run). */
  @ScheduledJob({ name: 'factory_erp.recurring_journals', cron: '30 0 * * *' })
  async recurringJob(): Promise<number> {
    const today = bangkokDate(new Date());
    const month = today.slice(0, 7);
    const dayNo = Number(today.slice(8, 10));
    const due = await this.workspace.db.erpGlRecurringJournal.findMany({
      where: {
        status: 'active',
        dayOfMonth: { lte: dayNo },
        startOn: { lte: dateOnly(today) },
        OR: [{ endOn: null }, { endOn: { gte: dateOnly(`${month}-01`) } }],
        NOT: { lastRunMonth: month },
      },
      include: { factory: { select: { publicId: true } } },
    });
    let posted = 0;
    for (const r of due) {
      try {
        await this.workspace.tx(async (tx) => {
          if (await this.runRecurring(tx, r, month, r.factory.publicId, systemActor('factory-erp.recurring')))
            posted++;
        });
      } catch {
        // a closed period or a retired account: the next run retries; the owner sees the gap in the journal list
      }
    }
    return posted;
  }

  /** D-389: accruals reverse themselves on their auto-reverse day. */
  @ScheduledJob({ name: 'factory_erp.auto_reversals', cron: '40 0 * * *' })
  async autoReverseJob(): Promise<number> {
    const today = bangkokDate(new Date());
    const due = await this.workspace.db.erpGlJournalEntry.findMany({
      where: { status: 'posted', autoReverseOn: { lte: dateOnly(today) }, reversedBy: null },
      include: { factory: { select: { publicId: true } } },
    });
    let posted = 0;
    for (const e of due) {
      try {
        await this.workspace.tx(async (tx) => {
          const settings = await this.ledger.book(tx, e.factoryId, null);
          const reversal = await this.ledger.reverse(
            tx,
            settings,
            e,
            dayOf(e.autoReverseOn!),
            'กลับรายการค้างรับ/ค้างจ่ายอัตโนมัติ',
            systemActor('factory-erp.auto_reverse'),
            null,
          );
          await this.workspace.recordSystem(
            tx,
            e.factory.publicId,
            'erp_journal.auto_reversed',
            'erp_gl_journal_entry',
            e.publicId,
            { reversal: reversal.entryNo },
          );
          posted++;
        });
      } catch {
        // retried tomorrow
      }
    }
    return posted;
  }

  // ============================================================================================= csv

  /** Posted lines of a month as CSV (UTF-8 with BOM) for Express / PEAK / FlowAccount style imports. */
  async exportCsv(scope: ErpScope, month: string): Promise<ErpTaxExportResultDto> {
    await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rows = await this.workspace.db.erpGlJournalLine.findMany({
      where: {
        factoryId: scope.factory.id,
        entry: { status: 'posted' },
        entryDate: { gte: dateOnly(`${month}-01`), lt: dateOnly(addMonths(`${month}-01`, 1)) },
      },
      include: { account: true, entry: true, partner: true },
      orderBy: [{ entryDate: 'asc' }, { entry: { entryNo: 'asc' } }, { lineNo: 'asc' }],
    });
    const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'entry_no',
      'entry_date',
      'document_date',
      'kind',
      'account_code',
      'account_name',
      'debit',
      'credit',
      'description',
      'source_type',
      'source_no',
      'partner',
      'tax_code',
      'tax_base',
    ];
    const lines = rows.map((l) =>
      [
        l.entry.entryNo,
        dayOf(l.entryDate),
        dayOf(l.entry.documentDate),
        l.entry.kind,
        l.account.code,
        l.account.nameTh,
        money(dec(l.debit)),
        money(dec(l.credit)),
        l.description ?? l.entry.description,
        l.entry.sourceDocumentType,
        l.entry.sourceDocumentNo,
        l.partner?.name,
        l.taxCode,
        l.taxBaseAmount ? money(dec(l.taxBaseAmount)) : '',
      ]
        .map((v) => esc(v == null ? '' : String(v)))
        .join(','),
    );
    await this.audit.record(this.workspace.db, {
      category: 'export',
      action: 'erp_ledger.journals_exported',
      resourceType: 'factory',
      resourcePublicId: scope.factory.publicId,
      data: { month, lines: rows.length },
      actor: scope.actor,
    });
    const body = Buffer.from(`\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`, 'utf8');
    const stored = await this.files.store(scope, body, `journals-${month}.csv`, 'text/csv');
    return { url: stored.url, fileName: stored.fileName, expiresAt: stored.expiresAt, rows: rows.length };
  }

  userName = userRef;
}
