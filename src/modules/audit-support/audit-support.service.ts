import { createHash, randomInt } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FiscalPeriod, type Prisma, type SampleMethod } from '@generated/prisma/client';
import { FinancialReportsService } from '@modules/financial-reports/financial-reports.service';
import { FixedAssetsService } from '@modules/fixed-assets/fixed-assets.service';
import { addMonths, dateOnly, dayOf } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';
import ExcelJS from 'exceljs';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal((v ?? 0).toString());
const DAY_MS = 86_400_000;

export const POPULATIONS = [
  'customer_documents',
  'vendor_invoices',
  'journal_entries',
  'payout_items',
  'wht_certificates',
] as const;
export type Population = (typeof POPULATIONS)[number];

export interface SampleItem {
  id: string;
  number: string;
  date: string;
  amount: string;
}

export interface ExceptionReport {
  key: string;
  description: string;
  count: number;
  items: {
    id: string | null;
    reference: string;
    date: string | null;
    amount: string | null;
    detail: string;
  }[];
}

/** Deterministic PRNG (mulberry32) so a sample can be reproduced from its seed. */
function prng(seed: bigint) {
  let a = Number(seed & 0xffffffffn) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], n: number, next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

/**
 * Audit support (accounting-design §8): the auditor's reproducible samples (random, or stratified by amount in
 * three value bands) of a period's documents, the prepared-by-client pack (one workbook: trial balance, GL
 * detail, registers, tax papers, fixed assets, close checklist and exceptions, hash kept), and the exception
 * reports — gaps in gapless series, journals posted outside business hours (setting `audit.business_hours`),
 * back-dated documents, manual journals by user, reversals, duplicate vendor bank accounts, duplicate slip
 * references, credit notes after the period end, payouts without a valid tax invoice.
 */
@Injectable()
export class AuditSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly periods: PeriodsService,
    private readonly settings: SettingsService,
    private readonly reports: FinancialReportsService,
    private readonly assets: FixedAssetsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async period(month: string): Promise<FiscalPeriod> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'period', code: 'pattern', message: 'YYYY-MM' }],
      });
    return this.periods.periodOf(await this.entities.defaultEntityId(), `${month}-01`);
  }

  private bounds(p: FiscalPeriod) {
    const start = new Date(Date.parse(`${dayOf(p.startDate)}T00:00:00+07:00`));
    const end = new Date(Date.parse(`${dayOf(p.endDate)}T00:00:00+07:00`) + DAY_MS);
    return { start, end };
  }

  // --- population & samples -----------------------------------------------------------------------------

  async population(p: FiscalPeriod, population: Population): Promise<SampleItem[]> {
    const inDates = { gte: p.startDate, lte: p.endDate };
    switch (population) {
      case 'customer_documents':
        return (
          await this.prisma.customerDocument.findMany({
            where: { entityId: p.entityId, documentDate: inDates },
            orderBy: { id: 'asc' },
          })
        ).map((d) => ({
          id: d.publicId,
          number: d.docNumber,
          date: dayOf(d.documentDate),
          amount: d.grossAmount.toFixed(2),
        }));
      case 'vendor_invoices':
        return (
          await this.prisma.vendorInvoice.findMany({
            where: { entityId: p.entityId, invoiceDate: inDates },
            orderBy: { id: 'asc' },
          })
        ).map((d) => ({
          id: d.publicId,
          number: d.vendorInvoiceNo,
          date: dayOf(d.invoiceDate),
          amount: d.grossAmount.toFixed(2),
        }));
      case 'journal_entries':
        return (
          await this.prisma.journalEntry.findMany({
            where: { entityId: p.entityId, fiscalPeriodId: p.id, status: 'posted' },
            orderBy: { id: 'asc' },
          })
        ).map((j) => ({
          id: j.publicId,
          number: j.jvNumber ?? j.entryNo ?? j.publicId,
          date: dayOf(j.documentDate),
          amount: j.totalDebit.toFixed(2),
        }));
      case 'payout_items':
        return (
          await this.prisma.payoutItem.findMany({
            where: { run: { entityId: p.entityId }, status: 'paid', paidOn: inDates },
            orderBy: { id: 'asc' },
          })
        ).map((i) => ({
          id: i.publicId,
          number: i.pvNumber ?? i.publicId,
          date: i.paidOn ? dayOf(i.paidOn) : '',
          amount: i.cashAmount.toFixed(2),
        }));
      case 'wht_certificates':
        return (
          await this.prisma.whtCertificate.findMany({
            where: { entityId: p.entityId, paidOn: inDates },
            orderBy: { id: 'asc' },
          })
        ).map((c) => ({
          id: c.publicId,
          number: c.wtNumber,
          date: dayOf(c.paidOn),
          amount: c.whtAmount.toFixed(2),
        }));
    }
  }

  async sample(
    actor: UserActor,
    input: { period: string; population: Population; method: SampleMethod; size: number; seed?: string },
  ) {
    const p = await this.period(input.period);
    const items = await this.population(p, input.population);
    const seed = input.seed ? BigInt(input.seed) : BigInt(randomInt(1, 2 ** 31));
    const next = prng(seed);
    const size = Math.min(input.size, items.length);
    let selected: SampleItem[];
    if (input.method === 'random' || items.length === 0) selected = pick(items, size, next);
    else {
      // Three bands of equal total value, sampled in proportion to their size (at least one each).
      const sorted = [...items].sort((a, b) => D(b.amount).cmp(D(a.amount)));
      const total = sorted.reduce((s, i) => s.add(D(i.amount).abs()), D(0));
      const bands: SampleItem[][] = [[], [], []];
      let running = D(0);
      for (const i of sorted) {
        const band = total.isZero() ? 2 : Math.min(2, Math.floor(running.div(total).mul(3).toNumber()));
        bands[band]!.push(i);
        running = running.add(D(i.amount).abs());
      }
      const nonEmpty = bands.filter((b) => b.length > 0);
      const quotas = nonEmpty.map((b) => Math.max(1, Math.round((b.length / items.length) * size)));
      while (quotas.reduce((a, q) => a + q, 0) > size) quotas[quotas.indexOf(Math.max(...quotas))]!--;
      selected = nonEmpty.flatMap((b, i) => pick(b, Math.min(quotas[i]!, b.length), next));
    }
    const row = await this.prisma.withTx(async (tx) => {
      const created = await tx.auditSample.create({
        data: {
          entityId: p.entityId,
          fiscalPeriodId: p.id,
          auditorUserId: actor.userId,
          population: input.population,
          method: input.method,
          size: Math.max(1, input.size),
          seed,
          populationSize: items.length,
          selected: selected as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'audit_sample.drawn',
        actor,
        resourceType: 'audit_sample',
        resourcePublicId: created.publicId,
        entityId: p.entityId,
        data: {
          period: input.period,
          population: input.population,
          method: input.method,
          size: selected.length,
          seed: seed.toString(),
        },
      });
      return created;
    });
    return { ...row, period: input.period };
  }

  async samples(auditorUserId?: bigint) {
    return this.prisma.auditSample.findMany({
      where: auditorUserId ? { auditorUserId } : {},
      include: { fiscalPeriod: { select: { startDate: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // --- exceptions (§8) --------------------------------------------------------------------------------------

  async exceptions(month: string): Promise<ExceptionReport[]> {
    const p = await this.period(month);
    const { start, end } = this.bounds(p);
    const inDates = { gte: p.startDate, lte: p.endDate };
    const out: ExceptionReport[] = [];

    // 1. Gaps in gapless series (customer documents, 50 ทวิ, PVs, JVs of the period).
    const numbers = [
      ...(
        await this.prisma.customerDocument.findMany({
          where: { entityId: p.entityId, documentDate: inDates },
          select: { docNumber: true },
        })
      ).map((d) => d.docNumber),
      ...(
        await this.prisma.whtCertificate.findMany({
          where: { entityId: p.entityId, paidOn: inDates },
          select: { wtNumber: true },
        })
      ).map((d) => d.wtNumber),
      ...(
        await this.prisma.payoutItem.findMany({
          where: { run: { entityId: p.entityId }, paidOn: inDates, pvNumber: { not: null } },
          select: { pvNumber: true },
        })
      ).map((d) => d.pvNumber!),
      ...(
        await this.prisma.journalEntry.findMany({
          where: { entityId: p.entityId, fiscalPeriodId: p.id, jvNumber: { not: null } },
          select: { jvNumber: true },
        })
      ).map((d) => d.jvNumber!),
    ];
    const series = new Map<string, number[]>();
    for (const n of numbers) {
      const m = /^(.*?)(\d+)$/.exec(n);
      if (!m) continue;
      series.set(m[1]!, [...(series.get(m[1]!) ?? []), Number(m[2])]);
    }
    const gaps: ExceptionReport['items'] = [];
    for (const [prefix, list] of series) {
      const sorted = [...new Set(list)].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++)
        for (let missing = sorted[i - 1]! + 1; missing < sorted[i]!; missing++)
          gaps.push({
            id: null,
            reference: `${prefix}${String(missing).padStart(5, '0')}`,
            date: null,
            amount: null,
            detail: `missing between ${sorted[i - 1]} and ${sorted[i]}`,
          });
    }
    out.push({
      key: 'series_gaps',
      description: 'Numbers missing inside a gapless series in the period',
      count: gaps.length,
      items: gaps.slice(0, 200),
    });

    // 2. Journals posted outside business hours.
    const hours = (await this.settings.at('audit.business_hours', { at: p.endDate })).value;
    const posted = await this.prisma.journalEntry.findMany({
      where: {
        entityId: p.entityId,
        fiscalPeriodId: p.id,
        status: 'posted',
        kind: { in: ['manual', 'reversal', 'recurring'] },
      },
      include: { postedBy: { select: { displayName: true } } },
    });
    const outside = posted.filter((j) => {
      const at = new Date((j.postedAt ?? j.createdAt).getTime() + 7 * 3_600_000);
      const hhmm = at.toISOString().slice(11, 16);
      const weekday = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
      return !hours.weekdays.includes(weekday) || hhmm < hours.start || hhmm >= hours.end;
    });
    out.push({
      key: 'outside_business_hours',
      description: `Manual journals posted outside ${hours.start}–${hours.end} on business weekdays`,
      count: outside.length,
      items: outside.slice(0, 200).map((j) => ({
        id: j.publicId,
        reference: j.jvNumber ?? j.entryNo ?? '',
        date: dayOf(j.documentDate),
        amount: j.totalDebit.toFixed(2),
        detail: `${(j.postedAt ?? j.createdAt).toISOString()} ${j.postedBy?.displayName ?? ''}`,
      })),
    });

    // 3. Back-dated documents: dated before the day they were created (manual journals, customer documents).
    const backJournals = await this.prisma.journalEntry.findMany({
      where: {
        entityId: p.entityId,
        fiscalPeriodId: p.id,
        kind: { in: ['manual', 'reversal'] },
        status: 'posted',
      },
    });
    const backDocs = await this.prisma.customerDocument.findMany({
      where: { entityId: p.entityId, documentDate: inDates },
    });
    const back = [
      ...backJournals
        .filter((j) => dayOf(j.documentDate) < bangkokDate(j.createdAt))
        .map((j) => ({
          id: j.publicId,
          reference: j.jvNumber ?? j.entryNo ?? '',
          date: dayOf(j.documentDate),
          amount: j.totalDebit.toFixed(2),
          detail: `created ${bangkokDate(j.createdAt)}`,
        })),
      ...backDocs
        .filter((d) => dayOf(d.documentDate) < bangkokDate(d.issuedAt))
        .map((d) => ({
          id: d.publicId,
          reference: d.docNumber,
          date: dayOf(d.documentDate),
          amount: d.grossAmount.toFixed(2),
          detail: `issued ${bangkokDate(d.issuedAt)}`,
        })),
    ];
    out.push({
      key: 'back_dated_documents',
      description: 'Documents and manual journals dated before the day they were made',
      count: back.length,
      items: back.slice(0, 200),
    });

    // 4. Manual journals by user.
    const manual = await this.prisma.journalEntry.groupBy({
      by: ['createdById'],
      where: { entityId: p.entityId, fiscalPeriodId: p.id, status: 'posted', kind: 'manual' },
      _count: true,
      _sum: { totalDebit: true },
    });
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: manual.map((m) => m.createdById).filter((x): x is bigint => x !== null) } },
        })
      ).map((u) => [u.id, u]),
    );
    out.push({
      key: 'manual_journals_by_user',
      description: 'Posted manual journals per maker',
      count: manual.reduce((a, m) => a + m._count, 0),
      items: manual.map((m) => ({
        id: m.createdById ? (users.get(m.createdById)?.publicId ?? null) : null,
        reference: m.createdById ? (users.get(m.createdById)?.displayName ?? '') : 'system',
        date: null,
        amount: formatMoney(D(m._sum.totalDebit)),
        detail: `${m._count} journal(s)`,
      })),
    });

    // 5. Reversals.
    const reversals = await this.prisma.journalEntry.findMany({
      where: { entityId: p.entityId, fiscalPeriodId: p.id, status: 'posted', kind: 'reversal' },
      include: { reverses: { select: { publicId: true, entryNo: true } } },
    });
    out.push({
      key: 'reversals',
      description: 'Reversing entries posted in the period',
      count: reversals.length,
      items: reversals.slice(0, 200).map((r) => ({
        id: r.publicId,
        reference: r.entryNo ?? '',
        date: dayOf(r.documentDate),
        amount: r.totalDebit.toFixed(2),
        detail: `reverses ${r.reverses?.entryNo ?? r.reverses?.publicId ?? '?'}`,
      })),
    });

    // 6. Duplicate vendor bank accounts (the same number for two vendors).
    const accounts = await this.prisma.vendorBankAccount.findMany({
      where: { status: { in: ['active', 'pending_approval'] } },
      include: { vendor: { select: { publicId: true, legalName: true } } },
    });
    const byHash = new Map<string, typeof accounts>();
    for (const a of accounts) {
      const key = Buffer.from(a.accountNoHash).toString('hex');
      byHash.set(key, [...(byHash.get(key) ?? []), a]);
    }
    const dupAccounts = [...byHash.values()]
      .filter((list) => new Set(list.map((a) => a.vendorId)).size > 1)
      .flat();
    out.push({
      key: 'duplicate_vendor_bank_accounts',
      description: 'Bank account numbers used by more than one vendor (only the last 4 digits shown)',
      count: dupAccounts.length,
      items: dupAccounts.slice(0, 200).map((a) => ({
        id: a.vendor.publicId,
        reference: `x${a.accountNoLast4}`,
        date: null,
        amount: null,
        detail: `${a.vendor.legalName} (${a.status})`,
      })),
    });

    // 7. Duplicate slip references.
    const slips = await this.prisma.slip.findMany({
      where: { bankTransRef: { not: null }, createdAt: { gte: start, lt: end } },
      include: { payment: { select: { publicId: true, referenceCode: true } } },
    });
    const byRef = new Map<string, typeof slips>();
    for (const s of slips) byRef.set(s.bankTransRef!, [...(byRef.get(s.bankTransRef!) ?? []), s]);
    const dupSlips = [...byRef.values()].filter((l) => l.length > 1).flat();
    out.push({
      key: 'duplicate_slip_references',
      description: 'Slips carrying a bank transaction reference seen more than once',
      count: dupSlips.length,
      items: dupSlips.slice(0, 200).map((s) => ({
        id: s.payment.publicId,
        reference: s.bankTransRef!,
        date: bangkokDate(s.createdAt),
        amount: s.declaredAmount.toFixed(2),
        detail: `${s.payment.referenceCode} ${s.verificationStatus}`,
      })),
    });

    // 8. Credit notes after the period end against the period's sales (cut-off).
    const nextEnd = dateOnly(addMonths(dayOf(p.startDate), 2));
    const cns = await this.prisma.customerDocument.findMany({
      where: {
        entityId: p.entityId,
        docType: 'cn',
        documentDate: { gt: p.endDate, lt: nextEnd },
        originalDocument: { documentDate: inDates },
      },
      include: { originalDocument: { select: { docNumber: true } } },
    });
    out.push({
      key: 'credit_notes_after_period_end',
      description: 'Credit notes dated in the following month against documents of the period',
      count: cns.length,
      items: cns.map((c) => ({
        id: c.publicId,
        reference: c.docNumber,
        date: dayOf(c.documentDate),
        amount: c.grossAmount.toFixed(2),
        detail: `on ${c.originalDocument?.docNumber ?? ''}`,
      })),
    });

    // 9. Payouts with VAT but no valid tax invoice (VAT parked as pending document).
    const payouts = await this.prisma.payoutItem.findMany({
      where: {
        run: { entityId: p.entityId },
        status: 'paid',
        paidOn: inDates,
        vatAmount: { gt: 0 },
        vatClaimable: false,
      },
      include: { vendor: { select: { legalName: true } } },
    });
    out.push({
      key: 'payouts_without_valid_tax_invoice',
      description: 'Payouts with VAT paid before a valid tax invoice (input VAT pending document)',
      count: payouts.length,
      items: payouts.map((i) => ({
        id: i.publicId,
        reference: i.pvNumber ?? '',
        date: i.paidOn ? dayOf(i.paidOn) : null,
        amount: i.vatAmount.toFixed(2),
        detail: i.vendor.legalName,
      })),
    });
    return out;
  }

  // --- PBC pack ------------------------------------------------------------------------------------------

  async pbcExport(actor: UserActor, month: string) {
    const p = await this.period(month);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Packio';
    wb.created = new Date();
    const sheet = (name: string, rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(name);
      const columns = rows.length ? Object.keys(rows[0]!) : ['(empty)'];
      ws.columns = columns.map((c) => ({
        header: c,
        key: c,
        width: Math.min(40, Math.max(12, c.length + 2)),
      }));
      for (const r of rows)
        ws.addRow(
          Object.fromEntries(
            columns.map((c) => [c, typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]]),
          ),
        );
      ws.getRow(1).font = { bold: true };
    };
    sheet('README', [
      {
        entity: p.entityId.toString(),
        period: month,
        generatedAt: new Date().toISOString(),
        generatedBy: actor.publicId,
        note: 'Prepared by client — Packio ledger export',
      },
    ]);
    const tb = await this.reports.trialBalance(month, month, false);
    sheet('TrialBalance', tb.accounts);
    const lines = await this.prisma.journalLine.findMany({
      where: { fiscalPeriodId: p.id, journalEntry: { status: 'posted' } },
      include: {
        account: { select: { code: true } },
        journalEntry: {
          select: {
            publicId: true,
            entryNo: true,
            jvNumber: true,
            kind: true,
            documentDate: true,
            sourceDocumentType: true,
            sourceDocumentNo: true,
            domainEventId: true,
          },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    });
    sheet(
      'GLDetail',
      lines.map((l) => ({
        entryNo: l.journalEntry.entryNo,
        jvNumber: l.journalEntry.jvNumber,
        kind: l.journalEntry.kind,
        entryDate: dayOf(l.entryDate),
        documentDate: dayOf(l.journalEntry.documentDate),
        account: l.account.code,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        taxCode: l.taxCode,
        source: l.journalEntry.sourceDocumentType,
        sourceNo: l.journalEntry.sourceDocumentNo,
        journalEntryId: l.journalEntry.publicId,
        domainEventId: l.journalEntry.domainEventId,
      })),
    );
    for (const population of POPULATIONS)
      sheet(population, (await this.population(p, population)) as unknown as Record<string, unknown>[]);
    sheet(
      'TaxReports',
      (await this.prisma.taxReport.findMany({ where: { fiscalPeriodId: p.id } })).map((r) => ({
        kind: r.kind,
        status: r.status,
        reportAmount: r.reportAmount.toFixed(2),
        glAmount: r.glAmount.toFixed(2),
        glDifference: r.glDifference.toFixed(2),
        filingRef: r.filingRef,
      })),
    );
    const fa = await this.assets.rollForward(month, month);
    sheet('FixedAssets', fa.categories);
    const checklist = await this.prisma.closeChecklist.findUnique({
      where: { fiscalPeriodId: p.id },
      include: { tasks: { orderBy: { stepNo: 'asc' } } },
    });
    sheet(
      'CloseChecklist',
      (checklist?.tasks ?? []).map((t) => ({
        step: t.stepNo,
        key: t.key,
        status: t.status,
        note: t.note,
        waivedReason: t.waivedReason,
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    );
    const exceptions = await this.exceptions(month);
    sheet(
      'Exceptions',
      exceptions.map((e) => ({ key: e.key, count: e.count, description: e.description })),
    );
    const body = Buffer.from(await wb.xlsx.writeBuffer());
    const sha = createHash('sha256').update(body).digest();
    const file = await this.files.storeSystem({
      body,
      fileName: `pbc-${month}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      retentionClass: 'financial_record',
      ownerUserId: actor.userId,
    });
    return this.prisma.withTx(async (tx) => {
      const row = await tx.pbcExport.create({
        data: {
          entityId: p.entityId,
          fiscalPeriodId: p.id,
          fileObjectId: file.id,
          sha256: new Uint8Array(sha),
          generatedById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'export',
        action: 'pbc_export.generated',
        actor,
        resourceType: 'pbc_export',
        resourcePublicId: row.publicId,
        entityId: p.entityId,
        data: { period: month, sha256: sha.toString('hex'), sheets: wb.worksheets.length },
      });
      return { ...row, period: month, sha256Hex: sha.toString('hex') };
    });
  }

  async pbcExports() {
    return this.prisma.pbcExport.findMany({
      include: { fiscalPeriod: { select: { startDate: true } }, file: { select: { id: true } } },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
  }

  async pbcFile(publicId: string): Promise<bigint> {
    const row = await this.prisma.pbcExport.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    return row.fileObjectId;
  }
}
