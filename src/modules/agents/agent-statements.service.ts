import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { dateOnly } from '@common/ledger-core/dates';
import { formatMoney } from '@common/money/money';
import { bangkokDate, startOfBangkokDay, startOfBangkokMonth, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { TaxRatesReader } from '@modules/ledger/tax-rates.reader';
import { VendorInvoicesService } from '@modules/payables/vendor-invoices.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { FilesService } from '@platform/files/files.service';

import { COMMISSION_INCLUDE } from './agent-commissions.service';
import { AGENT_REF_SELECT, D, invalid, recordAgentEvent, ZERO } from './agent-shared';

/** Excel opens a UTF-8 CSV with Thai names correctly only with a byte-order mark. */
const BOM = String.fromCharCode(0xfeff);

/** Sales commission (D-420, chart of accounts). */
export const COMMISSION_ACCOUNT = '6160';

export const STATEMENT_INCLUDE = {
  agent: { select: { ...AGENT_REF_SELECT, id: true, userId: true, employeeCode: true, vendor: true } },
  approvedBy: { select: { publicId: true, displayName: true } },
  vendorInvoice: {
    select: {
      publicId: true,
      payableItems: {
        select: {
          netAmount: true,
          allocations: {
            select: {
              netAmount: true,
              payoutItem: {
                select: {
                  id: true,
                  status: true,
                  apNetAmount: true,
                  whtAmount: true,
                  cashAmount: true,
                  whtCertificates: { select: { fileObjectId: true, status: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.SalesAgentStatementInclude;
export type StatementRow = Prisma.SalesAgentStatementGetPayload<{ include: typeof STATEMENT_INCLUDE }>;

export const statementEtag = (s: { publicId: string; rowVersion: number }) =>
  etagOf(s.publicId, s.rowVersion);

/** `YYYY-MM` → its first and last day (Bangkok calendar). */
export function periodBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` };
}

/**
 * Monthly commission statements (D-420): generated on the 1st for the earned entries up to the end of the
 * previous month (a net of zero or less carries forward), approved or voided by Finance. A freelance
 * statement becomes its vendor's bill on approval (account 6160, payout runs pay it, D-421 withholding);
 * an employee statement is accrued for payroll, exported as CSV and marked paid by Finance.
 */
@Injectable()
export class AgentStatementsService {
  private readonly logger = new Logger(AgentStatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: VendorInvoicesService,
    private readonly rates: TaxRatesReader,
    private readonly entities: EntitiesService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  /** The previous Bangkok month of `now`, `YYYY-MM`. */
  previousPeriod(now = new Date()): string {
    const first = startOfBangkokMonth(now);
    return bangkokDate(new Date(first.getTime() - 1)).slice(0, 7);
  }

  /** Statements for every agent with earned entries up to the end of `period` (idempotent per agent/month). */
  async generate(
    period: string,
    actor: { userId?: bigint } = {},
  ): Promise<{ created: number; carriedForward: number }> {
    const { start, end } = periodBounds(period);
    const endsAt = startOfBangkokDay(addDay(end));
    if (endsAt.getTime() > Date.now())
      throw new DomainException('agents.period_open', { params: { period } });
    const entityId = await this.entities.defaultEntityId();
    const agents = await this.prisma.salesAgentCommission.groupBy({
      by: ['agentId'],
      where: { status: 'earned', statementId: null, earnedAt: { lt: endsAt } },
    });
    let created = 0;
    let carriedForward = 0;
    for (const { agentId } of agents) {
      try {
        const outcome = await this.prisma.withTx(async (tx) => {
          const live = await tx.salesAgentStatement.findFirst({
            where: { agentId, periodStart: dateOnly(start), status: { not: 'voided' } },
          });
          if (live) return 'exists';
          const entries = await tx.salesAgentCommission.findMany({
            where: { agentId, status: 'earned', statementId: null, earnedAt: { lt: endsAt } },
          });
          const total = entries.reduce((a, e) => a.add(e.amount.toString()), ZERO());
          if (total.lte(0) || entries.length === 0) return 'carried';
          const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: agentId } });
          const statement = await tx.salesAgentStatement.create({
            data: {
              entityId,
              statementNo: await this.statementNo(tx, period, agent.code),
              agentId,
              periodStart: dateOnly(start),
              periodEnd: dateOnly(end),
              entryCount: entries.length,
              totalAmount: formatMoney(total),
            },
          });
          await tx.salesAgentCommission.updateMany({
            where: { id: { in: entries.map((e) => e.id) } },
            data: { status: 'statemented', statementId: statement.id },
          });
          await recordAgentEvent(this, tx, {
            type: 'sales_agent_statement.generated',
            aggregateType: 'sales_agent_statement',
            aggregateId: statement.publicId,
            payload: {
              statementId: statement.publicId,
              statementNo: statement.statementNo,
              totalAmount: formatMoney(total),
            },
            actor: actor.userId
              ? { type: 'system', name: 'agents.statements' }
              : systemActor('agents.statements'),
          });
          return 'created';
        });
        if (outcome === 'created') created += 1;
        if (outcome === 'carried') carriedForward += 1;
      } catch (error) {
        this.logger.error(
          `statement for agent ${agentId} (${period}) not generated: ${(error as Error).message}`,
        );
      }
    }
    return { created, carriedForward };
  }

  /**
   * Finance approves (D-420). Freelance: the statement becomes the agent vendor's bill (one line on 6160,
   * withholding by the agent's juristic type, D-421; VAT when the agent is VAT registered). Employee: Dr 6160
   * / Cr 2410 through the event, for payroll.
   */
  async approve(actor: UserActor, publicId: string, ifMatch: string | undefined): Promise<StatementRow> {
    await this.prisma.withTx(async (tx) => {
      const s = await this.lock(tx, publicId, ['draft']);
      assertIfMatch(ifMatch, statementEtag(s), { required: true });
      const agent = await tx.salesAgent.findUniqueOrThrow({
        where: { id: s.agentId },
        include: { vendor: true, user: true },
      });
      const now = new Date();
      let vendorInvoiceId: bigint | null = null;
      if (agent.kind === 'freelance') {
        const vendor = agent.vendor!;
        const net = D(s.totalAmount);
        const vat = vendor.isVatRegistered
          ? net
              .mul((await this.rates.rate('vat_standard', now, tx)).pct)
              .div(100)
              .toDecimalPlaces(2)
          : ZERO();
        const invoicePublicId = await this.invoices.recordBillIn(
          tx,
          actor,
          vendor.publicId,
          {
            vendorInvoiceNo: s.statementNo,
            invoiceDate: bangkokDate(now),
            isTaxInvoice: false,
            lines: [
              {
                description: `ค่านายหน้า ${s.statementNo}`,
                accountCode: COMMISSION_ACCOUNT,
                netAmount: formatMoney(net),
                vatAmount: formatMoney(vat),
                whtCategory: vendor.juristicType === 'individual' ? 'commission' : 'service',
              },
            ],
          },
          s.entityId,
        );
        vendorInvoiceId = (await tx.vendorInvoice.findUniqueOrThrow({ where: { publicId: invoicePublicId } }))
          .id;
      }
      await tx.salesAgentStatement.update({
        where: { id: s.id },
        data: {
          status: 'approved',
          approvedAt: now,
          approvedById: actor.userId,
          vendorInvoiceId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_statement.approve',
        actor,
        resourceType: 'sales_agent_statement',
        resourcePublicId: s.publicId,
        entityId: s.entityId,
        data: { total: s.totalAmount.toFixed(2), kind: agent.kind },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_statement.approved',
        aggregateType: 'sales_agent_statement',
        aggregateId: s.publicId,
        entityId: s.entityId,
        payload: {
          statementId: s.publicId,
          statementNo: s.statementNo,
          agentKind: agent.kind,
          agentId: agent.publicId,
          totalAmount: s.totalAmount.toFixed(2),
          approvedOn: bangkokDate(now),
          customerId: agent.user.publicId,
        },
        actor,
      });
    });
    return this.get(publicId);
  }

  async void(actor: UserActor, publicId: string, reason: string): Promise<StatementRow> {
    await this.prisma.withTx(async (tx) => {
      const s = await this.lock(tx, publicId, ['draft']);
      await tx.salesAgentCommission.updateMany({
        where: { statementId: s.id },
        data: { status: 'earned', statementId: null },
      });
      await tx.salesAgentStatement.update({
        where: { id: s.id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          voidReason: reason.trim(),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_statement.void',
        actor,
        resourceType: 'sales_agent_statement',
        resourcePublicId: s.publicId,
        entityId: s.entityId,
        data: { reason },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_statement.voided',
        aggregateType: 'sales_agent_statement',
        aggregateId: s.publicId,
        payload: { statementId: s.publicId, reason },
        actor,
      });
    });
    return this.get(publicId);
  }

  /** Employee statements of a month as a payroll CSV (Finance), marked exported (D-420, D-332). */
  async exportPayroll(actor: UserActor, period: string) {
    const { start } = periodBounds(period);
    const rows = await this.prisma.salesAgentStatement.findMany({
      where: {
        periodStart: dateOnly(start),
        status: { in: ['approved', 'exported'] },
        agent: { kind: 'employee' },
      },
      include: { agent: { select: { code: true, legalName: true, employeeCode: true } } },
      orderBy: { statementNo: 'asc' },
    });
    if (rows.length === 0) throw new DomainException('agents.nothing_to_export', { params: { period } });
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const csv = [
      'employee_code,name,agent_code,statement_no,period,commission_thb',
      ...rows.map((r) =>
        [
          r.agent.employeeCode ?? '',
          r.agent.legalName,
          r.agent.code,
          r.statementNo,
          period,
          r.totalAmount.toFixed(2),
        ]
          .map(esc)
          .join(','),
      ),
    ].join('\n');
    const file = await this.files.storeGenerated(actor, {
      body: Buffer.from(`${BOM}${csv}\n`, 'utf8'),
      fileName: `agent-commission-payroll-${period}.csv`,
      mimeType: 'text/csv',
      retentionClass: 'financial_record',
    });
    await this.prisma.withTx(async (tx) => {
      const now = new Date();
      for (const r of rows.filter((x) => x.status === 'approved')) {
        await tx.salesAgentStatement.update({
          where: { id: r.id },
          data: { status: 'exported', exportedAt: now, rowVersion: { increment: 1 } },
        });
      }
      await this.audit.record(tx, {
        category: 'export',
        action: 'sales_agent_statement.export_payroll',
        actor,
        resourceType: 'sales_agent_statement',
        resourcePublicId: rows[0]!.publicId,
        data: { period, statements: rows.length, fileId: file.fileId },
      });
    });
    return { ...file, statements: rows.length };
  }

  /** Payroll paid an exported employee statement (Finance records the day). */
  async markPaid(actor: UserActor, publicId: string, paidOn: string): Promise<StatementRow> {
    await this.prisma.withTx(async (tx) => {
      const s = await this.lock(tx, publicId, ['exported']);
      const agent = await tx.salesAgent.findUniqueOrThrow({
        where: { id: s.agentId },
        include: { user: true },
      });
      if (agent.kind !== 'employee') throw new DomainException('agents.statement_paid_by_payout');
      if (paidOn < bangkokDate(s.approvedAt!)) invalid('paidOn', 'not before the approval', 'date');
      await this.settlePaid(tx, s.id, startOfBangkokDay(paidOn));
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_statement.paid',
        aggregateType: 'sales_agent_statement',
        aggregateId: s.publicId,
        payload: {
          statementId: s.publicId,
          statementNo: s.statementNo,
          paidOn,
          customerId: agent.user.publicId,
        },
        actor,
      });
    });
    return this.get(publicId);
  }

  /** A freelance statement is paid when the payout item carrying its bill is (D-420). */
  @OnDomainEvent('payout_item.paid', { consumer: 'agents.statement_paid' })
  async onPayoutPaid(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['vendorKind'] !== 'sales_agent') return;
    const item = await tx.payoutItem.findUnique({
      where: { publicId: event.aggregateId },
      include: { allocations: { include: { payableItem: { select: { vendorInvoiceId: true } } } } },
    });
    if (!item) return;
    const invoiceIds = item.allocations
      .map((a) => a.payableItem.vendorInvoiceId)
      .filter((v): v is bigint => v !== null);
    const statements = await tx.salesAgentStatement.findMany({
      where: { vendorInvoiceId: { in: invoiceIds }, status: 'approved' },
      include: { agent: { select: { user: { select: { publicId: true } } } } },
    });
    const paidOn =
      typeof event.payload['paidOn'] === 'string' ? event.payload['paidOn'] : bangkokDate(new Date());
    for (const s of statements) {
      await this.settlePaid(tx, s.id, startOfBangkokDay(paidOn));
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_statement.paid',
        aggregateType: 'sales_agent_statement',
        aggregateId: s.publicId,
        payload: {
          statementId: s.publicId,
          statementNo: s.statementNo,
          paidOn,
          customerId: s.agent.user.publicId,
        },
        actor: systemActor('agents.statement_paid'),
      });
    }
  }

  private async settlePaid(tx: Tx, statementId: bigint, paidAt: Date) {
    await tx.salesAgentStatement.update({
      where: { id: statementId },
      data: { status: 'paid', paidAt, rowVersion: { increment: 1 } },
    });
    await tx.salesAgentCommission.updateMany({ where: { statementId }, data: { status: 'paid' } });
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<StatementRow> {
    const row = await db.salesAgentStatement.findUnique({ where: { publicId }, include: STATEMENT_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  entries(statementId: bigint) {
    return this.prisma.salesAgentCommission.findMany({
      where: { statementId },
      include: COMMISSION_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  list(where: Prisma.SalesAgentStatementWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentStatement.findMany({
        where,
        include: STATEMENT_INCLUDE,
        orderBy: [{ periodStart: 'desc' }, { statementNo: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentStatement.count({ where }),
    ]);
  }

  /** Withheld and transferred for this statement's bill (its share of each payout item that paid it). */
  payment(s: StatementRow): { wht: string | null; paid: string | null; certificateFileId: bigint | null } {
    const allocations = s.vendorInvoice?.payableItems.flatMap((p) => p.allocations) ?? [];
    const paid = allocations.filter((a) => a.payoutItem.status === 'paid');
    if (paid.length === 0) return { wht: null, paid: null, certificateFileId: null };
    let wht = ZERO();
    let cash = ZERO();
    for (const a of paid) {
      const item = a.payoutItem;
      const share = D(item.apNetAmount).gt(0) ? D(a.netAmount).div(item.apNetAmount.toString()) : D(1);
      wht = wht.add(D(item.whtAmount).mul(share));
      cash = cash.add(D(item.cashAmount).mul(share));
    }
    const cert = paid.flatMap((a) => a.payoutItem.whtCertificates).find((c) => c.status === 'issued');
    return { wht: formatMoney(wht), paid: formatMoney(cash), certificateFileId: cert?.fileObjectId ?? null };
  }

  async certificateUrl(s: StatementRow) {
    const fileId = this.payment(s).certificateFileId;
    if (!fileId) throw new DomainException('http.not_found');
    const file = await this.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    const signed = await this.files.signedUrl(file);
    if (!signed) throw new DomainException('http.not_found');
    return { url: signed.url, expiresAt: toBangkokIso(signed.expiresAt) };
  }

  private async lock(tx: Tx, publicId: string, allowed: string[]) {
    const s = await tx.salesAgentStatement.findUnique({ where: { publicId } });
    if (!s) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM sales_agent_statements WHERE id = ${s.id} FOR UPDATE`;
    const fresh = await tx.salesAgentStatement.findUniqueOrThrow({ where: { id: s.id } });
    if (!allowed.includes(fresh.status))
      throw new DomainException('agents.statement_invalid_status', { params: { status: fresh.status } });
    return fresh;
  }

  private async statementNo(tx: Tx, period: string, code: string): Promise<string> {
    const base = `AG${period.slice(2, 4)}${period.slice(5, 7)}-${code}`;
    const taken = await tx.salesAgentStatement.count({ where: { statementNo: { startsWith: base } } });
    return taken === 0 ? base : `${base}-${taken + 1}`;
  }
}

function addDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
