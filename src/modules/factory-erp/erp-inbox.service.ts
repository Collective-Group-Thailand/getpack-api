import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { dec } from './erp.math';
import { type ErpInboxDto, type ErpInboxItemDto } from './erp-inbox.dto';
import { day, iso, today } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * D-399: one "waiting for you" list across the ERP — what the signed-in person can and should act on now, gated by
 * their permissions: approvals (never their own proposals), what is overdue, what is due today and what is coming.
 * Read-only and cheap (counts and the first few documents of each kind); every item names the document or the list
 * it opens, so the Today screen is the start of every journey.
 */

const FIRST = 6;
type Section = ErpInboxItemDto['section'];
type Tone = ErpInboxItemDto['tone'];

const money = (v: Prisma.Decimal | number | string | null | undefined) => dec(v ?? 0).toFixed(2);

@Injectable()
export class ErpInboxService {
  constructor(private readonly workspace: ErpWorkspace) {}

  async inbox(scope: ErpScope, perms: ReadonlySet<string>): Promise<ErpInboxDto> {
    const f = scope.factory.id;
    const me = scope.actor.userId;
    const db = this.workspace.db;
    const t = today();
    const tomorrow = addCalendarDays(t, 1);
    const in3 = addCalendarDays(t, 3);
    const in7 = addCalendarDays(t, 7);
    const can = (p: string) => perms.has(p);
    const items: ErpInboxItemDto[] = [];
    const add = (section: Section, kind: string, tone: Tone, count: number, extra: Partial<ErpInboxItemDto> = {}) => {
      if (count > 0) items.push({ key: `${kind}:${extra.document?.id ?? 'all'}`, section, kind, tone, count, document: null, party: null, amount: null, date: null, ...extra });
    };
    const docs = <T>(section: Section, kind: string, tone: Tone, rows: T[], total: number, map: (row: T) => Partial<ErpInboxItemDto>) => {
      for (const r of rows.slice(0, FIRST)) add(section, kind, tone, 1, map(r));
      if (total > FIRST) add(section, `${kind}_more`, tone, total - FIRST);
    };
    const tasks: Promise<void>[] = [];

    // ------------------------------------------------------------------------------------------- approvals
    if (can('factory_procurement.approve'))
      tasks.push(
        (async () => {
          const where = { factoryId: f, status: 'submitted' as const, NOT: { createdById: me } };
          const [rows, n] = await Promise.all([
            db.erpPurchaseRequest.findMany({ where, include: { createdBy: true }, orderBy: { createdAt: 'asc' }, take: FIRST }),
            db.erpPurchaseRequest.count({ where }),
          ]);
          docs('approve', 'purchase_request', 'warning', rows, n, (r) => ({
            document: { type: 'erp_purchase_request', id: r.publicId, number: r.prNo },
            party: r.createdBy.displayName,
            date: iso(r.createdAt),
          }));
        })(),
      );
    if (can('factory_ap.approve'))
      tasks.push(
        (async () => {
          const where = { factoryId: f, status: 'variance' as const };
          const [rows, n] = await Promise.all([
            db.erpSupplierInvoice.findMany({ where, include: { supplier: true }, orderBy: { dueDate: 'asc' }, take: FIRST }),
            db.erpSupplierInvoice.count({ where }),
          ]);
          docs('approve', 'invoice_variance', 'warning', rows, n, (r) => ({
            document: { type: 'erp_supplier_invoice', id: r.publicId, number: r.docNo },
            party: r.supplier.name,
            amount: money(r.total),
            date: iso(r.dueDate),
          }));
        })(),
      );
    if (can('factory_ledger.approve'))
      tasks.push(
        (async () => {
          const jw = { factoryId: f, status: 'pending_approval' as const, NOT: { createdById: me } };
          const [journals, jn, changes, rules] = await Promise.all([
            db.erpGlJournalEntry.findMany({ where: jw, include: { createdBy: true }, orderBy: { documentDate: 'asc' }, take: FIRST }),
            db.erpGlJournalEntry.count({ where: jw }),
            db.erpGlAccountChange.findMany({ where: { factoryId: f, status: 'proposed', NOT: { createdById: me } }, include: { account: true, createdBy: true }, take: 20 }),
            db.erpGlPostingRuleVersion.findMany({ where: { status: 'proposed', rule: { factoryId: f }, NOT: { createdById: me } }, include: { rule: true, createdBy: true }, take: 20 }),
          ]);
          docs('approve', 'journal', 'warning', journals, jn, (r) => ({
            document: { type: 'erp_gl_journal_entry', id: r.publicId, number: r.description.slice(0, 80) },
            party: r.createdBy?.displayName ?? null,
            date: iso(r.documentDate),
          }));
          for (const c of changes)
            add('approve', 'account_change', 'warning', 1, {
              document: { type: 'erp_gl_account_change', id: c.publicId, number: c.account?.code ?? (c.proposed as { code?: string }).code ?? null },
              party: c.createdBy.displayName,
              date: iso(c.createdAt),
            });
          for (const v of rules)
            add('approve', 'rule_version', 'warning', 1, {
              document: { type: 'erp_gl_posting_rule', id: v.rule.publicId, number: `${v.rule.key} · ${v.rule.name}` },
              party: v.createdBy?.displayName ?? null,
              date: iso(v.createdAt),
            });
        })(),
      );

    // ------------------------------------------------------------------------------------ buying and stock
    if (can('factory_procurement.manage') || can('factory_inventory.manage'))
      tasks.push(
        (async () => {
          const open = { factoryId: f, status: { in: ['issued' as const, 'partially_received' as const] } };
          const [late, lateN, due, drafts] = await Promise.all([
            db.erpPurchaseOrder.findMany({ where: { ...open, expectedOn: { lt: day(t) } }, include: { supplier: true }, orderBy: { expectedOn: 'asc' }, take: FIRST }),
            db.erpPurchaseOrder.count({ where: { ...open, expectedOn: { lt: day(t) } } }),
            db.erpPurchaseOrder.findMany({ where: { ...open, expectedOn: day(t) }, include: { supplier: true }, take: 20 }),
            can('factory_procurement.manage') ? db.erpPurchaseOrder.count({ where: { factoryId: f, status: 'draft' } }) : 0,
          ]);
          docs('overdue', 'receipt_late', 'danger', late, lateN, (r) => ({
            document: { type: 'erp_purchase_order', id: r.publicId, number: r.poNo },
            party: r.supplier.name,
            date: iso(r.expectedOn),
          }));
          for (const r of due)
            add('today', 'receipt_today', 'info', 1, { document: { type: 'erp_purchase_order', id: r.publicId, number: r.poNo }, party: r.supplier.name, date: t });
          add('soon', 'po_draft', 'info', drafts);
        })(),
      );
    if (can('factory_inventory.manage') || can('factory_procurement.manage'))
      tasks.push(
        (async () => {
          const low = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
            SELECT count(*) AS n FROM (
              SELECT it.id FROM erp_items it LEFT JOIN erp_stock_balances b ON b.item_id = it.id
               WHERE it.factory_id = ${f} AND it.status = 'active' AND it.reorder_point IS NOT NULL
               GROUP BY it.id, it.reorder_point
              HAVING coalesce(sum(b.on_hand - b.reserved), 0) < it.reorder_point) x`);
          add('soon', 'stock_low', 'warning', Number(low[0]?.n ?? 0));
        })(),
      );
    if (can('factory_ap.manage'))
      tasks.push(
        (async () => {
          const rows = await db.$queryRaw<{ overdue: bigint; overdue_amt: Prisma.Decimal; week: bigint; week_amt: Prisma.Decimal }[]>(Prisma.sql`
            SELECT count(*) FILTER (WHERE due_date < ${day(t)}) AS overdue,
                   coalesce(sum(payable_amount - paid_amount) FILTER (WHERE due_date < ${day(t)}), 0) AS overdue_amt,
                   count(*) FILTER (WHERE due_date >= ${day(t)} AND due_date <= ${day(in7)}) AS week,
                   coalesce(sum(payable_amount - paid_amount) FILTER (WHERE due_date >= ${day(t)} AND due_date <= ${day(in7)}), 0) AS week_amt
              FROM erp_supplier_invoices
             WHERE factory_id = ${f} AND status IN ('matched', 'approved', 'partially_paid')`);
          const r = rows[0]!;
          add('overdue', 'payable_overdue', 'danger', Number(r.overdue), { amount: money(r.overdue_amt) });
          add('today', 'payable_week', 'info', Number(r.week), { amount: money(r.week_amt) });
        })(),
      );

    // ---------------------------------------------------------------------------------- planning and floor
    if (can('factory_planning.read'))
      tasks.push(
        (async () => {
          const active = { factoryId: f, status: { in: ['planned' as const, 'released' as const, 'in_progress' as const] } };
          const [late, lateN, toRelease] = await Promise.all([
            db.erpProductionOrder.findMany({ where: { ...active, dueOn: { lt: day(t) } }, orderBy: { dueOn: 'asc' }, take: FIRST }),
            db.erpProductionOrder.count({ where: { ...active, dueOn: { lt: day(t) } } }),
            can('factory_planning.manage') ? db.erpProductionOrder.count({ where: { factoryId: f, status: 'planned', dueOn: { gte: day(t), lte: day(in7) } } }) : 0,
          ]);
          docs('overdue', 'mo_late', 'danger', late, lateN, (r) => ({ document: { type: 'erp_production_order', id: r.publicId, number: r.moNo }, party: r.title, date: iso(r.dueOn) }));
          add('soon', 'mo_to_release', 'info', toRelease);
        })(),
      );
    if (can('factory_maintenance.read'))
      tasks.push(
        (async () => {
          const rows = await db.erpMaintenanceOrder.findMany({
            where: { factoryId: f, kind: 'breakdown', status: { in: ['open', 'scheduled', 'in_progress'] } },
            include: { machine: true },
            orderBy: { reportedAt: 'asc' },
            take: 20,
          });
          for (const r of rows)
            add('today', 'machine_down', 'danger', 1, { document: { type: 'erp_maintenance_order', id: r.publicId, number: r.mtNo }, party: r.machine.name, date: iso(r.reportedAt) });
        })(),
      );
    if (can('factory_quality.manage'))
      tasks.push(
        (async () => {
          const where = { factoryId: f, status: { in: ['open' as const, 'in_progress' as const] }, actionDueOn: { lte: day(t) } };
          const [rows, n] = await Promise.all([db.erpNcr.findMany({ where, orderBy: { actionDueOn: 'asc' }, take: FIRST }), db.erpNcr.count({ where })]);
          docs('overdue', 'ncr_due', 'danger', rows, n, (r) => ({ document: { type: 'erp_ncr', id: r.publicId, number: r.ncrNo }, party: r.title, date: iso(r.actionDueOn) }));
        })(),
      );

    // --------------------------------------------------------------------------------------------- sales
    if (can('factory_sales.read'))
      tasks.push(
        (async () => {
          const [expiring, soDrafts, followToday, followLate] = await Promise.all([
            db.erpQuotation.findMany({ where: { factoryId: f, status: 'sent', validUntil: { gte: day(t), lte: day(in3) } }, include: { customer: true }, orderBy: { validUntil: 'asc' }, take: FIRST }),
            can('factory_sales.manage') ? db.erpSalesOrder.count({ where: { factoryId: f, status: 'draft' } }) : 0,
            db.erpActivity.count({ where: { factoryId: f, assigneeId: me, doneAt: null, dueAt: { gte: startOfBangkokDay(t), lt: startOfBangkokDay(tomorrow) } } }),
            db.erpActivity.count({ where: { factoryId: f, assigneeId: me, doneAt: null, dueAt: { lt: startOfBangkokDay(t) } } }),
          ]);
          for (const q of expiring)
            add('soon', 'quotation_expiring', 'warning', 1, { document: { type: 'erp_quotation', id: q.publicId, number: q.quoteNo }, party: q.customer.name, amount: money(q.total), date: iso(q.validUntil) });
          add('soon', 'so_draft', 'info', soDrafts);
          add('today', 'followup_today', 'info', followToday);
          add('overdue', 'followup_late', 'warning', followLate);
        })(),
      );
    if (can('factory_delivery.manage') || can('factory_sales.manage'))
      tasks.push(
        (async () => {
          const [late, lateN, todays] = await Promise.all([
            db.erpDeliveryNote.findMany({ where: { factoryId: f, status: 'issued', deliverOn: { lt: day(t) } }, include: { customer: true }, orderBy: { deliverOn: 'asc' }, take: FIRST }),
            db.erpDeliveryNote.count({ where: { factoryId: f, status: 'issued', deliverOn: { lt: day(t) } } }),
            db.erpDeliveryNote.findMany({ where: { factoryId: f, status: { in: ['draft', 'issued'] }, deliverOn: day(t) }, include: { customer: true }, take: 20 }),
          ]);
          docs('overdue', 'delivery_late', 'danger', late, lateN, (r) => ({ document: { type: 'erp_delivery_note', id: r.publicId, number: r.doNo }, party: r.customer.name, date: iso(r.deliverOn) }));
          for (const r of todays)
            add('today', 'delivery_today', 'info', 1, { document: { type: 'erp_delivery_note', id: r.publicId, number: r.doNo }, party: r.customer.name, date: t });
        })(),
      );
    if (can('factory_receivables.manage'))
      tasks.push(
        (async () => {
          const rows = await db.$queryRaw<{ n: bigint; amt: Prisma.Decimal }[]>(Prisma.sql`
            SELECT count(*) AS n, coalesce(sum(o), 0) AS amt FROM (
              SELECT total + debited_amount - credited_amount - received_amount AS o
                FROM erp_sales_invoices
               WHERE factory_id = ${f} AND status IN ('issued', 'partially_paid') AND due_date < ${day(t)}) x
             WHERE o > 0`);
          add('overdue', 'receivable_overdue', 'danger', Number(rows[0]?.n ?? 0), { amount: money(rows[0]?.amt) });
        })(),
      );

    // ----------------------------------------------------------------------------------------- the books
    if (can('factory_ledger.read'))
      tasks.push(
        (async () => {
          const settings = await db.erpGlSettings.findUnique({ where: { factoryId: f } });
          if (!settings) return;
          const monthStart = day(`${t.slice(0, 7)}-01`);
          const [open, lines] = await Promise.all([
            can('factory_ledger.close')
              ? db.erpGlPeriod.findMany({ where: { factoryId: f, status: { in: ['open', 'soft_closed'] }, endDate: { lt: monthStart, gte: settings.ledgerStartOn } }, orderBy: { startDate: 'asc' }, take: 1 })
              : [],
            can('factory_ledger.post') ? db.erpGlBankStatementLine.count({ where: { factoryId: f, status: 'open' } }) : 0,
          ]);
          // a month still open after the 10th of the next is overdue; before that it is today's work
          for (const p of open)
            add(Number(t.slice(8)) > 10 || p.endDate < day(addCalendarDays(`${t.slice(0, 7)}-01`, -31)) ? 'overdue' : 'today', 'period_to_close', 'warning', 1, {
              document: { type: 'erp_gl_period', id: p.publicId, number: iso(p.startDate)!.slice(0, 7) },
              date: iso(p.endDate),
            });
          add('today', 'bank_lines', 'info', lines);
          if (can('factory_tax.file')) {
            const previous = addCalendarDays(`${t.slice(0, 7)}-01`, -1).slice(0, 7);
            if (previous >= iso(settings.ledgerStartOn)!.slice(0, 7)) {
              const filed = await db.erpGlTaxFiling.findMany({ where: { factoryId: f, month: day(`${previous}-01`) } });
              const due = `${t.slice(0, 7)}-15`;
              if (scope.factory.isVatRegistered && !filed.some((x) => x.form === 'pp30'))
                add(t > due ? 'overdue' : 'soon', 'tax_due', t > due ? 'danger' : 'warning', 1, { document: { type: 'erp_gl_tax_filing', id: `pp30-${previous}`, number: previous }, date: due });
            }
          }
        })(),
      );
    if (can('factory_profile.read'))
      tasks.push(
        (async () => {
          add('today', 'alerts', 'warning', await db.erpAlert.count({ where: { factoryId: f, status: 'open' } }));
        })(),
      );

    await Promise.all(tasks);
    const order: Section[] = ['approve', 'overdue', 'today', 'soon'];
    items.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
    const total = (s: Section) => items.filter((i) => i.section === s).reduce((n, i) => n + i.count, 0);
    return { asOf: t, items, counts: { approve: total('approve'), overdue: total('overdue'), today: total('today'), soon: total('soon') } };
  }
}
