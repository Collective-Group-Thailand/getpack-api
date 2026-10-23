import { systemActor } from '@common/context/actor';
import { dateOnly } from '@common/ledger-core/dates';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { JournalPostingService } from '@modules/ledger/journal-posting.service';
import { PeriodsService } from '@modules/ledger/periods.service';
import { PostingEngine } from '@modules/ledger/posting/posting-engine.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { Client } from 'pg';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy, SQLSTATE } from '../support/database';

/**
 * Ledger guards (B5.1, accounting-design §1, schema-design §3.8): balanced entries (deferred check), posted
 * entries and their lines immutable, period discipline, control accounts and required dimensions, one
 * posting per event and rule; and the posting service / engine on top of them.
 */
describe('ledger schema and posting (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let client: Client;
  let entityId: bigint;
  let periods: PeriodsService;
  let posting: JournalPostingService;
  let engine: PostingEngine;
  const actor = systemActor('test');

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
    await seedDev(prisma);
    entityId = (await prisma.entity.findFirstOrThrow({ where: { isDefault: true } })).id;
    periods = new PeriodsService(prisma, new AuditService(prisma), new DomainEvents());
    posting = new JournalPostingService(periods);
    engine = new PostingEngine(posting, new EntitiesService(prisma));
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  async function state(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  const account = async (code: string) =>
    (await prisma.account.findFirstOrThrow({ where: { entityId, code } })).id;
  const line = (accountCode: string, side: 'debit' | 'credit', amount: string, dimensions = {}) => ({
    accountCode,
    side,
    amount,
    dimensions,
  });

  it('creates a fiscal year of 12 open months on demand, without overlaps', async () => {
    await prisma.withTx((tx) => periods.ensureYear(tx, entityId, '2031-05-17'));
    await prisma.withTx((tx) => periods.ensureYear(tx, entityId, '2031-08-01'));
    const year = await prisma.fiscalYear.findFirstOrThrow({
      where: { entityId, label: 'FY2031' },
      include: { periods: true },
    });
    expect(year.periods).toHaveLength(12);
    expect(year.periods.every((p) => p.status === 'open')).toBe(true);
    const period = year.periods.find((p) => p.periodNo === 2)!;
    expect(
      await state(
        `INSERT INTO fiscal_periods (entity_id, fiscal_year_id, period_no, start_date, end_date) VALUES ($1, $2, 13, '2031-02-10', '2031-02-12')`,
        [entityId, year.id],
      ),
    ).toBe(SQLSTATE.exclusionViolation);
    expect(await state(`UPDATE fiscal_periods SET end_date = '2031-02-27' WHERE id = $1`, [period.id])).toBe(
      SQLSTATE.restrictViolation,
    );
  });

  it('posts a balanced manual journal and keeps it and its lines immutable', async () => {
    const entry = await prisma.withTx((tx) =>
      posting.post(
        tx,
        {
          entityId,
          kind: 'manual',
          documentDate: '2031-03-31',
          description: 'accrual (fake)',
          lines: [line('6900', 'debit', '100.00'), line('2410', 'credit', '100.00')],
        },
        actor,
      ),
    );
    expect(entry).toMatchObject({ status: 'posted', totalDebit: expect.anything() });
    expect(entry.entryNo).toMatch(/^JE203103-\d{6}$/);
    expect(await state(`UPDATE journal_entries SET description = 'x' WHERE id = $1`, [entry.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state(`DELETE FROM journal_entries WHERE id = $1`, [entry.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(
      await state(`UPDATE journal_lines SET debit = 1 WHERE journal_entry_id = $1 AND debit > 0`, [entry.id]),
    ).toBe(SQLSTATE.restrictViolation);
    expect(await state(`DELETE FROM journal_lines WHERE journal_entry_id = $1`, [entry.id])).toBe(
      SQLSTATE.restrictViolation,
    );
  });

  it('refuses an unbalanced posted entry at commit (deferred check) and in the service', async () => {
    await prisma.withTx((tx) => periods.ensureYear(tx, entityId, '2031-04-15'));
    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { entityId, startDate: dateOnly('2031-04-01') },
    });
    const [a, b] = [await account('6900'), await account('2410')];
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `INSERT INTO journal_entries (entity_id, fiscal_period_id, entry_date, document_date, kind, status, description)
         VALUES ($1, $2, '2031-04-15', '2031-04-15', 'manual', 'draft', 'raw') RETURNING id`,
        [entityId, period.id],
      );
      const id = rows[0].id as string;
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, line_no, account_id, debit, credit, entity_id, fiscal_period_id, entry_date)
         VALUES ($1, 1, $2, 100, 0, $3, $4, '2031-04-15'), ($1, 2, $5, 0, 90, $3, $4, '2031-04-15')`,
        [id, a, entityId, period.id, b],
      );
      await client.query(
        `UPDATE journal_entries SET status = 'posted', entry_no = 'X-1', posted_at = now(), total_debit = 100, total_credit = 100 WHERE id = $1`,
        [id],
      );
      expect(await state('SET CONSTRAINTS ALL IMMEDIATE')).toBe(SQLSTATE.checkViolation);
    } finally {
      await client.query('ROLLBACK');
    }
    await expect(
      prisma.withTx((tx) =>
        posting.post(
          tx,
          {
            entityId,
            kind: 'manual',
            documentDate: '2031-04-15',
            description: 'x',
            lines: [line('6900', 'debit', '100.00'), line('2410', 'credit', '90.00')],
          },
          actor,
        ),
      ),
    ).rejects.toMatchObject({ code: 'ledger.unbalanced' });
  });

  it('keeps control accounts for sub-ledger entries and enforces required dimensions', async () => {
    const manual = (lines: ReturnType<typeof line>[]) =>
      prisma.withTx((tx) =>
        posting.post(
          tx,
          { entityId, kind: 'manual', documentDate: '2031-04-20', description: 'x', lines },
          actor,
        ),
      );
    await expect(
      manual([line('1210', 'debit', '10.00'), line('4990', 'credit', '10.00')]),
    ).rejects.toMatchObject({
      code: 'ledger.account_invalid',
    });
    await expect(
      manual([line('2320', 'debit', '10.00'), line('4990', 'credit', '10.00')]),
    ).rejects.toMatchObject({
      code: 'ledger.account_invalid',
    });
    await expect(
      manual([line('1000', 'debit', '10.00'), line('4990', 'credit', '10.00')]),
    ).rejects.toMatchObject({
      code: 'ledger.account_invalid',
    });
  });

  it('posts into the next open period when the document period is closed, keeping the document date', async () => {
    await prisma.withTx((tx) => periods.ensureYear(tx, entityId, '2032-01-10'));
    const jan = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { entityId, startDate: dateOnly('2032-01-01') },
    });
    await prisma.withTx((tx) => periods.transitionIn(tx, actor, jan, 'soft_closed', 'test'));
    // Soft-closed: only with the permission (session flag).
    const soft = await prisma.withTx((tx) =>
      posting.post(
        tx,
        {
          entityId,
          kind: 'manual',
          documentDate: '2032-01-10',
          description: 'soft',
          allowSoftClosed: true,
          lines: [line('6900', 'debit', '5.00'), line('2410', 'credit', '5.00')],
        },
        actor,
      ),
    );
    expect(soft.entryDate.toISOString().slice(0, 10)).toBe('2032-01-10');
    const late = await prisma.withTx((tx) =>
      posting.post(
        tx,
        {
          entityId,
          kind: 'manual',
          documentDate: '2032-01-10',
          description: 'late',
          lines: [line('6900', 'debit', '5.00'), line('2410', 'credit', '5.00')],
        },
        actor,
      ),
    );
    expect(late.entryDate.toISOString().slice(0, 10)).toBe('2032-02-01');
    expect(late.documentDate.toISOString().slice(0, 10)).toBe('2032-01-10');
    // The trigger refuses a direct posting into a closed month, whatever the application does.
    const [a, b] = [await account('6900'), await account('2410')];
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `INSERT INTO journal_entries (entity_id, fiscal_period_id, entry_date, document_date, kind, status, description)
         VALUES ($1, $2, '2032-01-11', '2032-01-11', 'manual', 'draft', 'raw') RETURNING id`,
        [entityId, jan.id],
      );
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, line_no, account_id, debit, credit, entity_id, fiscal_period_id, entry_date)
         VALUES ($1, 1, $2, 1, 0, $3, $4, '2032-01-11'), ($1, 2, $5, 0, 1, $3, $4, '2032-01-11')`,
        [rows[0].id, a, entityId, jan.id, b],
      );
      expect(
        await state(
          `UPDATE journal_entries SET status = 'posted', entry_no = 'X-2', posted_at = now(), total_debit = 1, total_credit = 1 WHERE id = $1`,
          [rows[0].id],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('closes periods in sequence and never reopens a locked one', async () => {
    const other = await prisma.entity.create({
      data: { code: 'LEDGERTEST', displayName: 'Ledger test (fake)' },
    });
    await prisma.withTx((tx) => periods.ensureYear(tx, other.id, '2033-01-15'));
    const month = (n: number) =>
      prisma.fiscalPeriod.findFirstOrThrow({
        where: { entityId: other.id, startDate: dateOnly(`2033-0${n}-01`) },
      });
    const feb = await month(2);
    await prisma.withTx((tx) => periods.transitionIn(tx, actor, feb, 'soft_closed', 'test'));
    await expect(
      prisma.withTx(async (tx) => periods.transitionIn(tx, actor, await month(2), 'closed', 'x')),
    ).rejects.toMatchObject({
      code: 'ledger.period_transition',
    });
    await expect(
      prisma.withTx(async (tx) => periods.transitionIn(tx, actor, await month(1), 'locked', 'x')),
    ).rejects.toMatchObject({
      code: 'ledger.period_transition',
    });
    for (const to of ['soft_closed', 'closed', 'locked'] as const)
      await prisma.withTx(async (tx) => periods.transitionIn(tx, actor, await month(1), to, 'test'));
    const jan = await month(1);
    expect(await state(`UPDATE fiscal_periods SET status = 'open' WHERE id = $1`, [jan.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    await expect(
      prisma.withTx((tx) => periods.transitionIn(tx, actor, jan, 'open', 'x')),
    ).rejects.toMatchObject({
      code: 'ledger.period_transition',
    });
  });

  it('turns an event into rule-driven journals once per event and rule (P01 + P03)', async () => {
    const order = await prisma.order.findFirst();
    const customer = await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } });
    const event = await prisma.withTx(async (tx) =>
      new DomainEvents().record(
        tx,
        {
          type: 'customer_document.issued',
          aggregateType: 'customer_document',
          aggregateId: '0192f3a0-0000-7000-8000-00000000abcd',
          entityId,
          payload: {
            documentId: '0192f3a0-0000-7000-8000-00000000abcd',
            docType: 'tr',
            docKind: 'instalment',
            docNumber: 'TR-TEST-1',
            documentDate: '2031-05-05',
            receiptVia: 'scb',
            customerId: customer.publicId,
            orderId: order?.publicId ?? null,
            netAmount: '1000.00',
            vatAmount: '70.00',
            grossAmount: '1070.00',
            whtAmount: '30.00',
            whtBase: '1000.00',
          },
        },
        actor,
      ),
    );
    const posted = await prisma.withTx((tx) => engine.postEvent(tx, event as DomainEventEnvelope));
    expect(posted.map((e) => e.status)).toEqual(['posted', 'posted']);
    const lines = await prisma.journalLine.findMany({
      where: { journalEntry: { domainEventId: event.id } },
      include: { account: true },
      orderBy: [{ journalEntryId: 'asc' }, { lineNo: 'asc' }],
    });
    expect(lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.taxCode])).toEqual([
      ['1132', '1070.00', '0.00', null],
      ['2310', '0.00', '1000.00', null],
      ['2210', '0.00', '70.00', 'output_vat'],
      ['1230', '30.00', '0.00', 'wht_receivable'],
      ['1132', '0.00', '30.00', null],
    ]);
    expect(lines.every((l) => l.customerUserId === customer.id)).toBe(true);
    // A second run of the same event and rule is refused by the unique key.
    await expect(
      prisma.withTx((tx) => engine.postEvent(tx, event as DomainEventEnvelope)),
    ).rejects.toBeTruthy();
  });
});
