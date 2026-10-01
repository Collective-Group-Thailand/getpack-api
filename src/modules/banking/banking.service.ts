import { createHash, randomUUID } from 'node:crypto';

import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type BankMatchTarget, type BankStatementLine, type Prisma } from '@generated/prisma/client';
import { bankFileAdapter, BankFileError, type StatementRow } from '@integrations/bank-files/bank-files';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { dateOnly, dayOf, isDay } from '@modules/ledger/ledger-dates';
import { PaymentsService } from '@modules/payments/payments.service';
import { readObject } from '@modules/payouts/read-object';
import { StoreCreditService } from '@modules/receivables/store-credit.service';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

import { CompanyBankAccountsService } from './company-bank-accounts.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const DAY_MS = 86_400_000;
const ACTOR = systemActor('banking');

export const LINE_INCLUDE = {
  companyBankAccount: { select: { publicId: true, bankCode: true, accountNoLast4: true } },
  matches: true,
  unidentified: true,
} as const satisfies Prisma.BankStatementLineInclude;
export type LineRow = Prisma.BankStatementLineGetPayload<{ include: typeof LINE_INCLUDE }>;

/**
 * Cash & bank (accounting-design §6, D-061, D-093): statement imports per company bank account (CSV adapter;
 * duplicate files and lines refused), gateway settlement reports with their fees (P04), auto-matching by
 * amount + reference + date window (setting `banking.auto_match`) of slip transfers (P05), settlements,
 * payout runs and refunds, the unmatched and unidentified queues (P29, identified later into a payment,
 * P02), refunds paid (P22) and the daily cash position.
 */
@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly accounts: CompanyBankAccountsService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly storeCredit: StoreCreditService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- statement import ------------------------------------------------------------------------------------

  async importStatement(
    actor: UserActor,
    input: { companyBankAccountId: string; fileId?: string; rows?: StatementRow[]; format?: string },
  ) {
    const bank = await this.accounts.active(input.companyBankAccountId);
    const bankRow = await this.prisma.companyBankAccount.findUniqueOrThrow({
      where: { publicId: bank.publicId },
    });
    let rows = input.rows ?? [];
    let body: Buffer;
    let fileId: bigint | null = null;
    if (input.fileId) {
      const file = await this.prisma.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (!file) throw new DomainException('http.not_found');
      if (file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected')
        throw new DomainException('file.not_ready');
      body = await readObject(this.storage, file.storageKey);
      try {
        rows = bankFileAdapter(input.format ?? 'generic_csv').parseStatement(body);
      } catch (error) {
        if (error instanceof BankFileError)
          throw new DomainException('banking.statement_invalid', { params: { reason: error.message } });
        throw error;
      }
      fileId = file.id;
    } else {
      for (const [i, r] of rows.entries())
        if (!isDay(r.txnDate) || D(r.amount).isZero())
          throw new DomainException('banking.statement_invalid', {
            params: { reason: `row ${i + 1}: a date and a non-zero amount` },
          });
      body = Buffer.from(JSON.stringify({ account: bank.publicId, rows }));
    }
    if (rows.length === 0)
      throw new DomainException('banking.statement_invalid', { params: { reason: 'no lines' } });
    const sha = createHash('sha256').update(body).digest();
    const entityId = await this.entities.defaultEntityId();
    const id = await this.prisma.withTx(async (tx) => {
      if (await tx.bankStatementImport.findUnique({ where: { fileSha256: new Uint8Array(sha) } }))
        throw new DomainException('banking.duplicate_import');
      const dates = rows.map((r) => r.txnDate).sort();
      // Lines already imported from an overlapping file are skipped (dedupe per account).
      const fresh: (StatementRow & { hash: Buffer })[] = [];
      for (const r of rows) {
        const hash = createHash('sha256')
          .update(
            [
              bankRow.id,
              r.txnDate,
              D(r.amount).toFixed(2),
              r.reference ?? '',
              r.description,
              r.balance ?? '',
            ].join('|'),
          )
          .digest();
        const exists = await tx.bankStatementLine.findUnique({
          where: {
            companyBankAccountId_dedupeHash: {
              companyBankAccountId: bankRow.id,
              dedupeHash: new Uint8Array(hash),
            },
          },
        });
        if (!exists && !fresh.some((f) => f.hash.equals(hash))) fresh.push({ ...r, hash });
      }
      const imp = await tx.bankStatementImport.create({
        data: {
          entityId,
          companyBankAccountId: bankRow.id,
          source: input.fileId ? 'csv' : 'api',
          fileObjectId: fileId,
          periodFrom: dateOnly(dates[0]!),
          periodTo: dateOnly(dates.at(-1)!),
          fileSha256: new Uint8Array(sha),
          lineCount: fresh.length,
          importedById: actor.userId,
        },
      });
      for (const r of fresh) {
        await tx.bankStatementLine.create({
          data: {
            importId: imp.id,
            companyBankAccountId: bankRow.id,
            txnDate: dateOnly(r.txnDate),
            valueDate: r.valueDate ? dateOnly(r.valueDate) : null,
            amount: formatMoney(r.amount),
            description: r.description.slice(0, 500),
            reference: r.reference,
            counterparty: r.counterparty,
            runningBalance: r.balance ? formatMoney(r.balance) : null,
            dedupeHash: new Uint8Array(r.hash),
          },
        });
      }
      const count = fresh.length;
      await this.audit.record(tx, {
        category: 'finance',
        action: 'bank_statement.imported',
        actor,
        resourceType: 'bank_statement_import',
        resourcePublicId: imp.publicId,
        entityId,
        data: { lines: count, account: bank.accountNoLast4 },
      });
      return { publicId: imp.publicId, id: imp.id, count };
    });
    const matched = await this.autoMatch(bankRow.id);
    return { importId: id.publicId, lines: id.count, matched };
  }

  // --- auto-matching -------------------------------------------------------------------------------------

  /** Matches the account's unmatched lines by amount (± tolerance), reference and date window. */
  async autoMatch(companyBankAccountId: bigint): Promise<number> {
    const rule = (await this.settings.at('banking.auto_match')).value;
    const tolerance = D(rule.amountTolerance);
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { companyBankAccountId, matchStatus: 'unmatched' },
      include: { companyBankAccount: { include: { glAccount: true } } },
      orderBy: { txnDate: 'asc' },
    });
    let matched = 0;
    for (const line of lines) {
      const done = await this.prisma.withTx(async (tx) => {
        const window = {
          gte: new Date(line.txnDate.getTime() - rule.dateWindowDays * DAY_MS - 7 * 3_600_000),
          lte: new Date(line.txnDate.getTime() + (rule.dateWindowDays + 1) * DAY_MS),
        };
        const amount = D(line.amount);
        const near = (v: { toString(): string }) => D(v).sub(amount.abs()).abs().lte(tolerance);
        if (amount.gt(0)) {
          // Slip / transfer receipts waiting in 1133 (P05).
          const payments = (
            await tx.payment.findMany({
              where: {
                provider: { in: ['slip', 'bank'] },
                status: { in: ['succeeded', 'partially_refunded', 'refunded'] },
                paidAt: window,
              },
            })
          ).filter((p) => near(p.cashAmount));
          const taken = await tx.bankMatch.findMany({
            where: { targetType: 'payment', targetPublicId: { in: payments.map((p) => p.publicId) } },
          });
          const free = payments.filter((p) => !taken.some((t) => t.targetPublicId === p.publicId));
          const byRef = free.filter(
            (p) => line.reference?.includes(p.referenceCode) || line.description.includes(p.referenceCode),
          );
          const payment = byRef[0] ?? (free.length === 1 ? free[0] : undefined);
          if (payment) {
            await this.match(tx, line, 'payment', payment.publicId, amount, true, null);
            await this.events.record(
              tx,
              {
                type: 'bank_match.recorded',
                aggregateType: 'bank_statement_line',
                aggregateId: line.publicId,
                entityId: payment.entityId,
                payload: {
                  statementLineId: line.publicId,
                  matchKind: 'slip',
                  reference: payment.referenceCode,
                  txnDate: dayOf(line.txnDate),
                  amount: amount.toFixed(2),
                  bankAccountCode: line.companyBankAccount.glAccount.code,
                  paymentId: payment.publicId,
                },
              },
              ACTOR,
            );
            return true;
          }
          // A gateway settlement arriving in this account (P04 on match).
          const settlement = (
            await tx.gatewaySettlement.findMany({
              where: {
                companyBankAccountId: line.companyBankAccountId,
                status: 'imported',
                settlementDate: {
                  gte: dateOnly(dayOf(new Date(line.txnDate.getTime() - rule.dateWindowDays * DAY_MS))),
                  lte: dateOnly(dayOf(new Date(line.txnDate.getTime() + rule.dateWindowDays * DAY_MS))),
                },
              },
            })
          ).find((s) => near(s.netAmount));
          if (settlement) {
            await this.postSettlement(tx, settlement.id, line);
            return true;
          }
          return false;
        }
        // Money out: a confirmed payout run (posted at confirmation) or a bank-transfer refund (posted at P22).
        const runs = await tx.payoutRun.findMany({
          where: {
            companyBankAccountId: line.companyBankAccountId,
            status: { in: ['confirmed', 'partially_failed'] },
            payOn: { gte: dateOnly(dayOf(window.gte)), lte: dateOnly(dayOf(window.lte)) },
          },
        });
        for (const run of runs) {
          const paid = await tx.payoutItem.aggregate({
            where: { runId: run.id, status: 'paid' },
            _sum: { cashAmount: true },
          });
          if (
            near(paid._sum.cashAmount ?? 0) &&
            !(await tx.bankMatch.findUnique({
              where: {
                targetType_targetPublicId: { targetType: 'payout_run', targetPublicId: run.publicId },
              },
            }))
          ) {
            await this.match(tx, line, 'payout_run', run.publicId, amount, true, null);
            return true;
          }
        }
        const refunds = (
          await tx.refund.findMany({
            where: { status: 'succeeded', channel: 'bank_transfer', completedAt: window },
          })
        ).filter((r) => near(r.amount));
        for (const refund of refunds) {
          if (
            await tx.bankMatch.findUnique({
              where: { targetType_targetPublicId: { targetType: 'refund', targetPublicId: refund.publicId } },
            })
          )
            continue;
          await this.match(tx, line, 'refund', refund.publicId, amount, true, null);
          return true;
        }
        return false;
      });
      if (done) matched++;
    }
    return matched;
  }

  private async match(
    tx: Tx,
    line: BankStatementLine,
    target: BankMatchTarget,
    targetPublicId: string,
    amount: MoneyValue,
    auto: boolean,
    userId: bigint | null,
  ) {
    await tx.bankMatch.create({
      data: {
        statementLineId: line.id,
        targetType: target,
        targetPublicId,
        amount: formatMoney(amount),
        auto,
        matchedById: userId,
      },
    });
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: { matchStatus: 'matched', matchedAt: new Date() },
    });
  }

  /** Finance matches a line by hand (a payment, a settlement, a run, a refund, a tax payment). */
  async manualMatch(
    actor: UserActor,
    linePublicId: string,
    input: { targetType: BankMatchTarget; targetId: string },
  ) {
    await this.prisma.withTx(async (tx) => {
      const line = await tx.bankStatementLine.findUnique({
        where: { publicId: linePublicId },
        include: { companyBankAccount: { include: { glAccount: true } } },
      });
      if (!line) throw new DomainException('http.not_found');
      if (line.matchStatus !== 'unmatched')
        throw new DomainException('banking.line_already_matched', { params: { status: line.matchStatus } });
      const amount = D(line.amount);
      if (input.targetType === 'gateway_settlement') {
        const s = await tx.gatewaySettlement.findUnique({ where: { publicId: input.targetId } });
        if (!s || s.status !== 'imported') throw new DomainException('http.not_found');
        if (!D(s.netAmount).eq(amount))
          throw new DomainException('banking.match_amount_mismatch', {
            params: { line: amount.toFixed(2), target: s.netAmount.toFixed(2) },
          });
        await this.postSettlement(tx, s.id, line);
      } else if (input.targetType === 'payment') {
        const p = await tx.payment.findUnique({ where: { publicId: input.targetId } });
        if (!p || !['slip', 'bank'].includes(p.provider)) throw new DomainException('http.not_found');
        if (!D(p.cashAmount).eq(amount))
          throw new DomainException('banking.match_amount_mismatch', {
            params: { line: amount.toFixed(2), target: p.cashAmount.toFixed(2) },
          });
        await this.match(tx, line, 'payment', p.publicId, amount, false, actor.userId);
        await this.events.record(
          tx,
          {
            type: 'bank_match.recorded',
            aggregateType: 'bank_statement_line',
            aggregateId: line.publicId,
            entityId: p.entityId,
            payload: {
              statementLineId: line.publicId,
              matchKind: 'slip',
              reference: p.referenceCode,
              txnDate: dayOf(line.txnDate),
              amount: amount.toFixed(2),
              bankAccountCode: line.companyBankAccount.glAccount.code,
              paymentId: p.publicId,
            },
          },
          actor,
        );
      } else {
        await this.match(tx, line, input.targetType, input.targetId, amount, false, actor.userId);
      }
      await this.audit.record(tx, {
        category: 'finance',
        action: 'bank_line.matched',
        actor,
        resourceType: 'bank_statement_line',
        resourcePublicId: line.publicId,
        data: { target: input.targetType },
      });
    });
    return this.line(linePublicId);
  }

  /**
   * Candidates for an unmatched line (U-B0.3), by the rule of `autoMatch` (`banking.auto_match`: amount within the
   * tolerance, date window, reference): slip / bank payments and gateway settlements for money in, payout runs and
   * bank-transfer refunds for money out, never a target already matched. Best first: a reference hit, then the
   * closest amount.
   */
  async suggestions(linePublicId: string) {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { publicId: linePublicId } });
    if (!line) throw new DomainException('http.not_found');
    if (line.matchStatus !== 'unmatched') return [];
    const rule = (await this.settings.at('banking.auto_match')).value;
    const tolerance = D(rule.amountTolerance);
    const amount = D(line.amount);
    const window = {
      gte: new Date(line.txnDate.getTime() - rule.dateWindowDays * DAY_MS - 7 * 3_600_000),
      lte: new Date(line.txnDate.getTime() + (rule.dateWindowDays + 1) * DAY_MS),
    };
    const gap = (v: { toString(): string }) => D(v).sub(amount.abs()).abs();
    const out: {
      targetType: BankMatchTarget;
      targetId: string;
      label: string;
      amount: string;
      date: string;
      reasons: ('amount' | 'reference' | 'date_window')[];
      gap: MoneyValue;
    }[] = [];
    const free = async (type: BankMatchTarget, ids: string[]) => {
      const taken = await this.prisma.bankMatch.findMany({
        where: { targetType: type, targetPublicId: { in: ids } },
        select: { targetPublicId: true },
      });
      return new Set(ids.filter((id) => !taken.some((t) => t.targetPublicId === id)));
    };
    if (amount.gt(0)) {
      const payments = (
        await this.prisma.payment.findMany({
          where: {
            provider: { in: ['slip', 'bank'] },
            status: { in: ['succeeded', 'partially_refunded', 'refunded'] },
            paidAt: window,
          },
        })
      ).filter((p) => gap(p.cashAmount).lte(tolerance));
      const open = await free(
        'payment',
        payments.map((p) => p.publicId),
      );
      for (const p of payments.filter((x) => open.has(x.publicId))) {
        const byRef =
          (line.reference?.includes(p.referenceCode) ?? false) || line.description.includes(p.referenceCode);
        out.push({
          targetType: 'payment',
          targetId: p.publicId,
          label: p.referenceCode,
          amount: p.cashAmount.toFixed(2),
          date: dayOf(p.paidAt!),
          reasons: byRef ? ['reference', 'amount', 'date_window'] : ['amount', 'date_window'],
          gap: gap(p.cashAmount),
        });
      }
      const settlements = await this.prisma.gatewaySettlement.findMany({
        where: {
          companyBankAccountId: line.companyBankAccountId,
          status: 'imported',
          settlementDate: {
            gte: dateOnly(dayOf(new Date(line.txnDate.getTime() - rule.dateWindowDays * DAY_MS))),
            lte: dateOnly(dayOf(new Date(line.txnDate.getTime() + rule.dateWindowDays * DAY_MS))),
          },
        },
      });
      for (const st of settlements.filter((x) => gap(x.netAmount).lte(tolerance)))
        out.push({
          targetType: 'gateway_settlement',
          targetId: st.publicId,
          label: `${st.provider} ${dayOf(st.settlementDate)}`,
          amount: st.netAmount.toFixed(2),
          date: dayOf(st.settlementDate),
          reasons: ['amount', 'date_window'],
          gap: gap(st.netAmount),
        });
    } else {
      const runs = await this.prisma.payoutRun.findMany({
        where: {
          companyBankAccountId: line.companyBankAccountId,
          status: { in: ['confirmed', 'partially_failed'] },
          payOn: { gte: dateOnly(dayOf(window.gte)), lte: dateOnly(dayOf(window.lte)) },
        },
      });
      const openRuns = await free(
        'payout_run',
        runs.map((r) => r.publicId),
      );
      for (const run of runs.filter((r) => openRuns.has(r.publicId))) {
        const paid = await this.prisma.payoutItem.aggregate({
          where: { runId: run.id, status: 'paid' },
          _sum: { cashAmount: true },
        });
        const total = D(paid._sum.cashAmount ?? 0);
        if (gap(total).gt(tolerance)) continue;
        out.push({
          targetType: 'payout_run',
          targetId: run.publicId,
          label: run.runNo,
          amount: total.toFixed(2),
          date: dayOf(run.payOn),
          reasons: ['amount', 'date_window'],
          gap: gap(total),
        });
      }
      const refunds = (
        await this.prisma.refund.findMany({
          where: { status: 'succeeded', channel: 'bank_transfer', completedAt: window },
        })
      ).filter((r) => gap(r.amount).lte(tolerance));
      const openRefunds = await free(
        'refund',
        refunds.map((r) => r.publicId),
      );
      for (const r of refunds.filter((x) => openRefunds.has(x.publicId)))
        out.push({
          targetType: 'refund',
          targetId: r.publicId,
          label: r.publicId,
          amount: r.amount.toFixed(2),
          date: dayOf(r.completedAt!),
          reasons: ['amount', 'date_window'],
          gap: gap(r.amount),
        });
    }
    return out
      .sort(
        (a, b) =>
          Number(b.reasons.includes('reference')) - Number(a.reasons.includes('reference')) ||
          a.gap.comparedTo(b.gap),
      )
      .map(({ gap: _gap, ...rest }) => rest);
  }

  /**
   * One line to several targets in one transaction (U-B0.3, §6): the parts add up to the line, each part equals its
   * payment (P05 per payment, like a manual match); payout runs, refunds, unidentified receipts and tax payments
   * take the part as stated. A gateway settlement is matched whole (`admin.banking.matchLine`).
   */
  async split(
    actor: UserActor,
    linePublicId: string,
    parts: { targetType: BankMatchTarget; targetId: string; amount: string }[],
  ) {
    const invalid = (path: string, message: string): never => {
      throw new DomainException('validation.failed', { errors: [{ path, code: 'split', message }] });
    };
    const keys = parts.map((p) => `${p.targetType}:${p.targetId}`);
    if (new Set(keys).size !== keys.length) invalid('parts', 'each target once');
    await this.prisma.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_statement_lines WHERE public_id = ${linePublicId}::uuid FOR UPDATE`;
      const line = await tx.bankStatementLine.findUnique({
        where: { publicId: linePublicId },
        include: { companyBankAccount: { include: { glAccount: true } } },
      });
      if (!line) throw new DomainException('http.not_found');
      if (line.matchStatus !== 'unmatched')
        throw new DomainException('banking.line_already_matched', { params: { status: line.matchStatus } });
      const total = parts.reduce((a, p) => a.add(p.amount), D(0));
      if (!total.eq(D(line.amount).abs()))
        throw new DomainException('banking.match_amount_mismatch', {
          params: { line: D(line.amount).abs().toFixed(2), target: total.toFixed(2) },
        });
      for (const [i, part] of parts.entries()) {
        if (part.targetType === 'gateway_settlement')
          invalid(`parts.${i}.targetType`, 'match a settlement whole');
        const signed = D(line.amount).isNegative() ? D(part.amount).neg() : D(part.amount);
        if (part.targetType === 'payment') {
          const p = await tx.payment.findUnique({ where: { publicId: part.targetId } });
          if (!p || !['slip', 'bank'].includes(p.provider)) throw new DomainException('http.not_found');
          if (!D(p.cashAmount).eq(part.amount))
            throw new DomainException('banking.match_amount_mismatch', {
              params: { line: D(part.amount).toFixed(2), target: p.cashAmount.toFixed(2) },
            });
          await this.match(tx, line, 'payment', p.publicId, signed, false, actor.userId);
          await this.events.record(
            tx,
            {
              type: 'bank_match.recorded',
              aggregateType: 'bank_statement_line',
              aggregateId: line.publicId,
              entityId: p.entityId,
              payload: {
                statementLineId: line.publicId,
                matchKind: 'slip',
                reference: p.referenceCode,
                txnDate: dayOf(line.txnDate),
                amount: D(part.amount).toFixed(2),
                bankAccountCode: line.companyBankAccount.glAccount.code,
                paymentId: p.publicId,
              },
            },
            actor,
          );
        } else {
          await this.match(tx, line, part.targetType, part.targetId, signed, false, actor.userId);
        }
      }
      await this.audit.record(tx, {
        category: 'finance',
        action: 'bank_line.split_matched',
        actor,
        resourceType: 'bank_statement_line',
        resourcePublicId: line.publicId,
        data: { parts: parts.map((p) => ({ target: p.targetType, amount: D(p.amount).toFixed(2) })) },
      });
    });
    return this.line(linePublicId);
  }

  async settlementAccount(companyBankAccountId: bigint): Promise<string | null> {
    return (
      (await this.prisma.companyBankAccount.findUnique({ where: { id: companyBankAccountId } }))?.publicId ??
      null
    );
  }

  /** Imported gateway settlements, newest first (U-B0.3). */
  async settlements(where: Prisma.GatewaySettlementWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.gatewaySettlement.findMany({
        where,
        include: { lines: true, companyBankAccount: { select: { publicId: true } } },
        orderBy: [{ settlementDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.gatewaySettlement.count({ where }),
    ]);
    return { rows, total };
  }

  /** A line that is not a transaction to post (e.g. an internal transfer already journalised by hand). */
  async ignore(actor: UserActor, linePublicId: string, reason: string) {
    await this.prisma.withTx(async (tx) => {
      const line = await tx.bankStatementLine.findUnique({ where: { publicId: linePublicId } });
      if (!line) throw new DomainException('http.not_found');
      if (line.matchStatus !== 'unmatched')
        throw new DomainException('banking.line_already_matched', { params: { status: line.matchStatus } });
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: { matchStatus: 'ignored', matchedAt: new Date() },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'bank_line.ignored',
        actor,
        resourceType: 'bank_statement_line',
        resourcePublicId: line.publicId,
        data: { reason },
      });
    });
    return this.line(linePublicId);
  }

  // --- unidentified receipts (P29 → P02) -------------------------------------------------------------------

  /** Money in that no order claims: parked in 1140 (P29) until identified. */
  async markUnidentified(actor: UserActor, linePublicId: string) {
    await this.prisma.withTx(async (tx) => {
      const line = await tx.bankStatementLine.findUnique({
        where: { publicId: linePublicId },
        include: { companyBankAccount: { include: { glAccount: true } } },
      });
      if (!line) throw new DomainException('http.not_found');
      if (line.matchStatus !== 'unmatched' || D(line.amount).lte(0))
        throw new DomainException('banking.line_already_matched', { params: { status: line.matchStatus } });
      const receipt = await tx.unidentifiedReceipt.create({
        data: { entityId: line.companyBankAccount.entityId, statementLineId: line.id, amount: line.amount },
      });
      await tx.bankMatch.create({
        data: {
          statementLineId: line.id,
          targetType: 'unidentified_receipt',
          targetPublicId: receipt.publicId,
          amount: line.amount,
          auto: false,
          matchedById: actor.userId,
        },
      });
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: { matchStatus: 'unidentified', matchedAt: new Date() },
      });
      await this.events.record(
        tx,
        {
          type: 'unidentified_receipt.recorded',
          aggregateType: 'unidentified_receipt',
          aggregateId: receipt.publicId,
          entityId: receipt.entityId,
          payload: {
            receiptId: receipt.publicId,
            reference: line.reference ?? line.description.slice(0, 40),
            receivedOn: dayOf(line.txnDate),
            receivedVia: 'statement',
            receivedIntoAccountCode: line.companyBankAccount.glAccount.code,
            amount: line.amount.toFixed(2),
          },
        },
        actor,
      );
    });
    return this.line(linePublicId);
  }

  /**
   * Finance identifies who paid: the receipt becomes a payment of the order group (provider `bank`), applied
   * to its schedule like any payment — its tax invoice then comes out of 1140 (P02).
   */
  async identify(actor: UserActor, receiptPublicId: string, groupPublicId: string) {
    const paymentPublicId = await this.prisma.withTx(async (tx) => {
      const receipt = await tx.unidentifiedReceipt.findUnique({
        where: { publicId: receiptPublicId },
        include: { statementLine: true },
      });
      if (!receipt) throw new DomainException('http.not_found');
      if (receipt.status !== 'open')
        throw new DomainException('banking.line_already_matched', { params: { status: receipt.status } });
      const payment = await tx.payment.create({
        data: {
          entityId: receipt.entityId,
          method: 'bank_transfer_slip',
          provider: 'bank',
          status: 'succeeded',
          referenceCode: `BNK${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`,
          amount: receipt.amount,
          cashAmount: receipt.amount,
          paidAt: receipt.statementLine.txnDate,
          verifiedAt: new Date(),
          verifiedById: actor.userId,
          providerPayload: { unidentifiedReceiptId: receipt.publicId },
        },
      });
      await tx.unidentifiedReceipt.update({
        where: { id: receipt.id },
        data: { status: 'matched', matchedPaymentId: payment.id },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'unidentified_receipt.identified',
        actor,
        resourceType: 'unidentified_receipt',
        resourcePublicId: receipt.publicId,
        entityId: receipt.entityId,
        data: { paymentId: payment.publicId, orderGroupId: groupPublicId },
      });
      // The bank line is this payment now: no slip clearing to match (P05) — it came through 1140.
      await tx.bankMatch.create({
        data: {
          statementLineId: receipt.statementLineId,
          targetType: 'payment',
          targetPublicId: payment.publicId,
          amount: receipt.amount,
          auto: false,
          matchedById: actor.userId,
        },
      });
      return payment.publicId;
    });
    await this.payments.allocate(actor, paymentPublicId, groupPublicId);
    return this.prisma.unidentifiedReceipt.findUniqueOrThrow({
      where: { publicId: receiptPublicId },
      include: { statementLine: true },
    });
  }

  // --- gateway settlements (P04) -------------------------------------------------------------------------

  async importSettlement(
    actor: UserActor,
    input: {
      provider: 'scb' | 'twoc2p';
      companyBankAccountId: string;
      settlementDate: string;
      vatOnFee: string;
      feeTaxInvoiceNo?: string | null;
      lines: { providerRef: string; grossAmount: string; feeAmount: string }[];
    },
  ) {
    if (!isDay(input.settlementDate) || input.lines.length === 0)
      throw new DomainException('banking.statement_invalid', {
        params: { reason: 'a settlement date and lines' },
      });
    const bank = await this.accounts.active(input.companyBankAccountId);
    const entityId = await this.entities.defaultEntityId();
    const body = Buffer.from(JSON.stringify({ ...input, companyBankAccountId: bank.publicId }));
    const sha = createHash('sha256').update(body).digest();
    const id = await this.prisma.withTx(async (tx) => {
      if (await tx.gatewaySettlement.findUnique({ where: { reportSha256: new Uint8Array(sha) } }))
        throw new DomainException('banking.duplicate_import');
      const gross = input.lines.reduce((a, l) => a.add(l.grossAmount), ZERO());
      const fee = input.lines.reduce((a, l) => a.add(l.feeAmount), ZERO());
      const vat = D(input.vatOnFee);
      const bankRow = await tx.companyBankAccount.findUniqueOrThrow({ where: { publicId: bank.publicId } });
      const settlement = await tx.gatewaySettlement.create({
        data: {
          entityId,
          provider: input.provider,
          settlementDate: dateOnly(input.settlementDate),
          companyBankAccountId: bankRow.id,
          reportSha256: new Uint8Array(sha),
          grossAmount: formatMoney(gross),
          feeAmount: formatMoney(fee),
          vatOnFee: formatMoney(vat),
          netAmount: formatMoney(gross.sub(fee).sub(vat)),
          feeTaxInvoiceNo: input.feeTaxInvoiceNo ?? null,
          createdById: actor.userId,
          lines: {
            create: await Promise.all(
              input.lines.map(async (l) => {
                const payment = await tx.payment.findFirst({
                  where: {
                    provider: input.provider,
                    OR: [{ providerRef: l.providerRef }, { referenceCode: l.providerRef }],
                  },
                });
                return {
                  paymentId: payment?.id ?? null,
                  providerRef: l.providerRef,
                  grossAmount: formatMoney(l.grossAmount),
                  feeAmount: formatMoney(l.feeAmount),
                  netAmount: formatMoney(D(l.grossAmount).sub(l.feeAmount)),
                };
              }),
            ),
          },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'gateway_settlement.imported',
        actor,
        resourceType: 'gateway_settlement',
        resourcePublicId: settlement.publicId,
        entityId,
        data: { provider: input.provider, gross: formatMoney(gross) },
      });
      return { publicId: settlement.publicId, bankId: bankRow.id };
    });
    await this.autoMatch(id.bankId);
    return this.prisma.gatewaySettlement.findUniqueOrThrow({
      where: { publicId: id.publicId },
      include: { lines: true },
    });
  }

  /** The settlement's money is in the bank: net to bank, fee (+ its VAT) to expense / input VAT (P04). */
  private async postSettlement(tx: Tx, settlementId: bigint, line: BankStatementLine) {
    const s = await tx.gatewaySettlement.update({
      where: { id: settlementId },
      data: { status: 'posted', statementLineId: line.id },
      include: { companyBankAccount: { include: { glAccount: true } } },
    });
    await this.match(tx, line, 'gateway_settlement', s.publicId, D(line.amount), true, null);
    await this.events.record(
      tx,
      {
        type: 'gateway_settlement.posted',
        aggregateType: 'gateway_settlement',
        aggregateId: s.publicId,
        entityId: s.entityId,
        payload: {
          settlementId: s.publicId,
          provider: s.provider,
          settlementDate: dayOf(s.settlementDate),
          grossAmount: s.grossAmount.toFixed(2),
          feeAmount: s.feeAmount.toFixed(2),
          vatOnFee: s.vatOnFee.toFixed(2),
          netAmount: s.netAmount.toFixed(2),
          feeVatClaimable: s.feeTaxInvoiceNo !== null,
          bankAccountCode: s.companyBankAccount.glAccount.code,
        },
      },
      ACTOR,
    );
  }

  // --- refunds paid (P22) --------------------------------------------------------------------------------

  /**
   * A refund left the company: from the customer's credit balance when a credit note put the money there
   * (the wallet goes down), from unapplied receipts (overpayments) or from unidentified receipts; through the
   * gateway's clearing account or the paying bank account (P22).
   */
  @OnDomainEvent('refund.succeeded', { consumer: 'banking.refunds' })
  async onRefund(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const refund = await tx.refund.findUnique({
      where: { publicId: event.aggregateId },
      include: { payment: { include: { orderGroup: true } }, order: true },
    });
    if (!refund) return;
    const amount = D(refund.amount);
    const group = refund.payment.orderGroup;
    let refundFrom: 'credit_balance' | 'unapplied' | 'unidentified' = 'unapplied';
    if (!group) refundFrom = 'unidentified';
    else if ((await this.storeCredit.balance(group.customerUserId, tx)).gte(amount)) {
      refundFrom = 'credit_balance';
      await this.storeCredit.debit(tx, {
        entityId: refund.entityId,
        customerUserId: group.customerUserId,
        amount,
        source: 'refunded',
        refundId: refund.id,
        orderId: refund.orderId,
        note: refund.payment.referenceCode,
      });
    }
    const paidVia = refund.channel === 'original_gateway' ? refund.payment.provider : 'bank';
    const bank = paidVia === 'bank' ? await this.accounts.defaultPayoutAccount(tx) : null;
    // No payout account yet (set-up): the first bank account of the chart takes it, for Finance to reclass.
    const bankAccountCode =
      bank?.glAccount.code ??
      (
        await tx.account.findFirst({
          where: { code: { startsWith: '112' }, isPostable: true },
          orderBy: { code: 'asc' },
        })
      )?.code ??
      '1121';
    const customer = group
      ? await tx.user.findUnique({ where: { id: group.customerUserId }, select: { publicId: true } })
      : null;
    await this.events.record(
      tx,
      {
        type: 'customer_refund.paid',
        aggregateType: 'refund',
        aggregateId: refund.publicId,
        entityId: refund.entityId,
        payload: {
          refundId: refund.publicId,
          reference: refund.providerRef ?? refund.payment.referenceCode,
          paidOn: bangkokDate(refund.completedAt ?? new Date(event.occurredAt)),
          refundFrom,
          paidVia,
          bankAccountCode,
          amount: amount.toFixed(2),
          customerId: customer?.publicId ?? null,
          orderGroupId: group?.publicId ?? null,
          orderId: refund.order?.publicId ?? null,
          channel: group?.channel ?? null,
        },
      },
      ACTOR,
    );
  }

  // --- reads ------------------------------------------------------------------------------------------------

  async line(publicId: string) {
    const row = await this.prisma.bankStatementLine.findUnique({
      where: { publicId },
      include: LINE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async lines(where: Prisma.BankStatementLineWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where,
        include: LINE_INCLUDE,
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.bankStatementLine.count({ where }),
    ]);
    return { rows, total };
  }

  async unidentified(status?: 'open' | 'matched' | 'refunded') {
    return this.prisma.unidentifiedReceipt.findMany({
      where: status ? { status } : {},
      include: { statementLine: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * The daily cash position (§6): per company bank account its GL balance and the last statement balance, the
   * clearing accounts (gateways, slips) and unidentified receipts, and the unmatched lines to explain.
   */
  async cashPosition(asOf: string) {
    const entityId = await this.entities.defaultEntityId();
    const end = dateOnly(asOf);
    const balance = async (code: string) => {
      const sum = await this.prisma.journalLine.aggregate({
        where: { account: { entityId, code }, journalEntry: { status: 'posted' }, entryDate: { lte: end } },
        _sum: { debit: true, credit: true },
      });
      return D(sum._sum.debit?.toString() ?? '0').sub(sum._sum.credit?.toString() ?? '0');
    };
    const banks = await this.prisma.companyBankAccount.findMany({
      where: { status: 'active' },
      include: { glAccount: true },
    });
    const rows = [];
    for (const b of banks) {
      const last = await this.prisma.bankStatementLine.findFirst({
        where: { companyBankAccountId: b.id, txnDate: { lte: end }, runningBalance: { not: null } },
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
      });
      const unmatched = await this.prisma.bankStatementLine.count({
        where: { companyBankAccountId: b.id, matchStatus: 'unmatched', txnDate: { lte: end } },
      });
      rows.push({
        account: b,
        glBalance: await balance(b.glAccount.code),
        statementBalance: last?.runningBalance ?? null,
        unmatched,
      });
    }
    const clearing = [];
    for (const code of ['1131', '1132', '1133', '1140'])
      clearing.push({ code, balance: await balance(code) });
    return { asOf, banks: rows, clearing };
  }
}
