import { systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { dayOf } from '@common/ledger-core/dates';
import { type PostingTemplate, renderJournal, ruleApplies, TemplateError } from '@common/ledger-core/template';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type ErpGlJournalEntry,
  type ErpGlPostingRule,
  type ErpGlPostingRuleVersion,
  type ErpGlSettings,
  type Factory,
  Prisma,
} from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope, envelopeFromRow } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { dec } from './erp.math';
import { type ErpGlCatchUpDto } from './erp-e6.dto';
import { moForCost, orderCost } from './erp-insight.service';
import { ErpLedgerService, money } from './erp-ledger.service';
import { POSTING_EVENT_TYPES, REVERSING_EVENTS, SYNC_EVENT_TYPES } from './erp-ledger.template';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/**
 * E6 posting engine (D-388): one idempotent subscriber over the ERP's domain events. Events carry ids only
 * (D-345), so the engine loads the document and builds the rule payload — amounts excl. VAT, the document's
 * stock movements with the inventory account of each item's kind, the factory's method accounts — then renders
 * every approved rule in force into a balanced automatic journal. A cancelled / voided document reverses its
 * entries. Documents dated before the ledger start are left to the opening balances. `catchUp` replays the
 * stored events of a factory that started its ledger later than its ERP.
 */

interface Movement {
  itemId: string;
  warehouseId: string;
  kind: string;
  value: string;
  inventoryAccount: string;
  expenseAccount: string;
}

type Payload = Record<string, unknown>;
type Builder = (tx: Tx, ctx: Ctx, event: DomainEventEnvelope) => Promise<Payload | null>;
interface Ctx {
  factory: Factory;
  settings: ErpGlSettings;
  accounts: Record<string, string>;
}

const sum = (rows: { value: string }[]) => rows.reduce((a, r) => a.plus(dec(r.value)), new MoneyDecimal(0));

@Injectable()
export class ErpLedgerPostingService {
  private readonly log = new Logger(ErpLedgerPostingService.name);

  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly ledger: ErpLedgerService,
  ) {}

  @OnDomainEvent(POSTING_EVENT_TYPES, { consumer: 'factory_erp.ledger_posting' })
  async onEvent(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (SYNC_EVENT_TYPES.has(event.type)) return;
    await this.postEvent(tx, event);
  }

  /**
   * Posts a ledger-own event (depreciation run, asset disposal, bank fee / interest) inside the caller's
   * transaction: the entry exists when the request returns, and the worker never posts it again.
   */
  async postSync(tx: Tx, factoryPublicId: string, type: string, aggregateId: string, payload: Record<string, unknown> = {}): Promise<ErpGlJournalEntry[]> {
    if (!SYNC_EVENT_TYPES.has(type)) throw new Error(`${type} is not a ledger-own event`);
    return this.postEvent(tx, {
      id: '',
      type,
      aggregateType: type.split('.')[0]!,
      aggregateId,
      entityId: null,
      actor: { type: 'system' },
      occurredAt: new Date().toISOString(),
      correlationId: aggregateId,
      causationId: null,
      payloadSchemaVersion: 1,
      payload: { factoryId: factoryPublicId, ...payload },
    });
  }

  /** Posts (or reverses) for one event; returns the entries written. */
  async postEvent(tx: Tx, event: DomainEventEnvelope): Promise<ErpGlJournalEntry[]> {
    const factory = await this.factoryOf(tx, event);
    if (!factory) return [];
    const settings = await tx.erpGlSettings.findUnique({ where: { factoryId: factory.id } });
    if (!settings) return []; // the ledger has not been started (catch-up posts these later)
    const day = bangkokDate(new Date(event.occurredAt));
    if (day < dayOf(settings.ledgerStartOn)) return [];
    const ctx: Ctx = { factory, settings, accounts: this.ledger.methodAccounts(settings) };
    const actor = systemActor('factory-erp.ledger');

    const reversingType = REVERSING_EVENTS[event.type];
    if (reversingType) {
      const posted = await tx.erpGlJournalEntry.findMany({
        where: { factoryId: factory.id, kind: 'auto', status: 'posted', sourceDocumentType: reversingType, sourceDocumentPublicId: event.aggregateId, reversedBy: null },
      });
      const out: ErpGlJournalEntry[] = [];
      for (const e of posted) out.push(await this.ledger.reverse(tx, settings, e, day, `เอกสารถูกยกเลิก (${event.type})`, actor, null));
      return out;
    }

    const rules = await this.rulesFor(tx, factory.id, event.type, new Date(event.occurredAt));
    if (rules.length === 0) return [];
    const builder = this.builders[event.type];
    if (!builder) return [];
    const payload = await builder(tx, ctx, event);
    if (!payload) return [];
    const out: ErpGlJournalEntry[] = [];
    for (const { rule, version } of rules) {
      if (!ruleApplies(version.conditions, payload)) continue;
      // idempotent: an event already posted by this rule (catch-up and the worker may both see it)
      if (event.id && (await tx.erpGlJournalEntry.findFirst({ where: { domainEventId: event.id, postingRuleId: rule.id }, select: { id: true } }))) continue;
      // one posting per rule and document (an invoice approved after a variance posts once, F02 / F02A)
      const documentId = payload['documentId'] as string | undefined;
      const twin = documentId
        ? await tx.erpGlJournalEntry.findFirst({
            where: { factoryId: factory.id, kind: 'auto', status: 'posted', sourceDocumentPublicId: documentId, reversedBy: null, postingRule: { key: { in: this.twins(rule.key) } } },
          })
        : null;
      if (twin) continue;
      let journal;
      try {
        journal = renderJournal(version.template as unknown as PostingTemplate, payload);
      } catch (error) {
        if (error instanceof TemplateError) throw new DomainException('erp.ledger_rule_invalid', { params: { reason: `${rule.key}: ${error.message}` } });
        throw error;
      }
      if (journal.lines.length === 0) continue;
      if (!journal.totalDebit.eq(journal.totalCredit))
        throw new DomainException('erp.ledger_unbalanced', { params: { debit: money(journal.totalDebit), credit: money(journal.totalCredit) } });
      out.push(
        await this.ledger.post(
          tx,
          factory.id,
          settings,
          {
            kind: 'auto',
            documentDate: journal.documentDate ?? day,
            description: journal.description,
            source: journal.source,
            domainEventId: event.id || null,
            postingRuleId: rule.id,
            postingRuleVersionId: version.id,
            lines: journal.lines.map((l) => ({
              accountCode: l.accountCode,
              side: l.side,
              amount: l.amount,
              description: l.description,
              dimensions: l.dimensions,
              taxCode: l.taxCode,
              taxBase: l.taxBase,
            })),
          },
          actor,
        ),
      );
    }
    return out;
  }

  /**
   * The factory an event belongs to: ERP events name it (`payload.factoryId`, D-317); a getpack payout names the
   * factory it paid; a getpack billing statement is looked up (its event carries the statement only).
   */
  private async factoryOf(tx: Tx, event: DomainEventEnvelope): Promise<Factory | null> {
    const id = (event.payload as { factoryId?: string | null }).factoryId;
    if (id) return tx.factory.findUnique({ where: { publicId: id } });
    if (event.type === 'billing_statement.confirmed') {
      const statement = await tx.billingStatement.findUnique({ where: { publicId: event.aggregateId }, include: { factory: true } });
      return statement?.factory ?? null;
    }
    return null;
  }

  /**
   * The payload the rules of `eventType` would see for the factory's latest such event (rule editor preview, D-398);
   * `null` when the factory has none yet.
   */
  async samplePayload(factory: Factory, settings: ErpGlSettings, eventType: string): Promise<{ payload: Payload; occurredAt: string } | null> {
    const builder = this.builders[eventType];
    if (!builder) return null;
    const db = this.workspace.db;
    const rows = await db.domainEvent.findMany({
      where: {
        type: eventType,
        OR: [
          { payload: { path: ['factoryId'], equals: factory.publicId } },
          ...(eventType === 'billing_statement.confirmed'
            ? [{ aggregateId: { in: (await db.billingStatement.findMany({ where: { factoryId: factory.id }, select: { publicId: true } })).map((b) => b.publicId) } }]
            : []),
        ],
      },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    });
    const ctx: Ctx = { factory, settings, accounts: this.ledger.methodAccounts(settings) };
    for (const row of rows) {
      const envelope = envelopeFromRow(row);
      const payload = await this.workspace.tx((tx) => builder(tx, ctx, envelope));
      if (payload) return { payload, occurredAt: envelope.occurredAt };
    }
    return null;
  }

  /** Rules that post the same document (never both): F02 and F02A. */
  private twins(key: string): string[] {
    return key === 'F02' || key === 'F02A' ? ['F02', 'F02A'] : [key];
  }

  async rulesFor(tx: Tx, factoryId: bigint, eventType: string, at: Date): Promise<{ rule: ErpGlPostingRule; version: ErpGlPostingRuleVersion }[]> {
    const rules = await tx.erpGlPostingRule.findMany({
      where: { factoryId, eventType },
      include: { versions: { where: { status: 'approved', effectiveFrom: { lte: at } }, orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }], take: 1 } },
      orderBy: { key: 'asc' },
    });
    return rules.filter((r) => r.versions[0]).map(({ versions, ...rule }) => ({ rule, version: versions[0]! }));
  }

  /**
   * Replays the factory's stored ERP events since the ledger start that have no entry yet (a ledger started after
   * the ERP, or a rule added later). Every event is its own transaction; failures are reported, not retried.
   */
  async catchUp(scope: ErpScope): Promise<ErpGlCatchUpDto> {
    const settings = await this.workspace.tx((tx) => this.ledger.book(tx, scope.factory.id, scope.actor.userId));
    const rows = await this.workspace.db.domainEvent.findMany({
      where: {
        type: { in: [...POSTING_EVENT_TYPES] },
        occurredAt: { gte: new Date(`${dayOf(settings.ledgerStartOn)}T00:00:00+07:00`) },
        OR: [
          { payload: { path: ['factoryId'], equals: scope.factory.publicId } },
          // getpack statements of this factory (their events name the statement only)
          {
            type: 'billing_statement.confirmed',
            aggregateId: { in: (await this.workspace.db.billingStatement.findMany({ where: { factoryId: scope.factory.id }, select: { publicId: true } })).map((b) => b.publicId) },
          },
        ],
      },
      orderBy: { occurredAt: 'asc' },
      take: 5000,
    });
    const done = new Set(
      (await this.workspace.db.erpGlJournalEntry.findMany({ where: { factoryId: scope.factory.id, domainEventId: { not: null } }, select: { domainEventId: true } })).map((e) => e.domainEventId!),
    );
    const result: ErpGlCatchUpDto = { posted: 0, skipped: 0, failed: [] };
    for (const row of rows) {
      if (done.has(row.id)) {
        result.skipped++;
        continue;
      }
      try {
        const entries = await this.workspace.tx((tx) => this.postEvent(tx, envelopeFromRow(row)));
        if (entries.length > 0) result.posted++;
        else result.skipped++;
      } catch (error) {
        result.failed.push(`${row.type} ${row.aggregateId}: ${error instanceof Error ? error.message : String(error)}`);
        this.log.warn(`catch-up ${row.type} ${row.aggregateId} failed: ${String(error)}`);
      }
    }
    await this.workspace.tx((tx) => this.workspace.record(tx, scope, 'erp_ledger.caught_up', 'factory', scope.factory.publicId, { posted: result.posted, failed: result.failed.length }));
    return result;
  }

  // ======================================================================================= payloads

  private async movements(tx: Tx, ctx: Ctx, where: Prisma.ErpStockMovementWhereInput): Promise<Movement[]> {
    const rows = await tx.erpStockMovement.findMany({ where: { factoryId: ctx.factory.id, ...where }, include: { item: true, warehouse: true }, orderBy: { id: 'asc' } });
    return rows.map((m) => ({
      itemId: m.item.publicId,
      warehouseId: m.warehouse.publicId,
      kind: m.kind,
      value: money(dec(m.value)),
      inventoryAccount: this.ledger.itemKindAccount(ctx.settings, m.item.kind),
      expenseAccount: m.item.kind === 'spare_part' ? ctx.accounts['maintenance']! : ctx.accounts['factorySupplies']!,
    }));
  }

  private movementIds(event: DomainEventEnvelope): string[] | null {
    const ids = (event.payload as { movementIds?: unknown }).movementIds;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : null;
  }

  /** The bank / cash account a payment method posts to: cash, else the default bank account's sub-account, else cash. */
  private async cashAccount(tx: Tx, ctx: Ctx, method: string): Promise<{ cashAccount: string; bankAccountId: string | null }> {
    if (method === 'cash') return { cashAccount: ctx.accounts['cash']!, bankAccountId: null };
    const bank = await tx.erpGlBankAccount.findFirst({ where: { factoryId: ctx.factory.id, status: 'active' }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }], include: { glAccount: true } });
    return bank ? { cashAccount: bank.glAccount.code, bankAccountId: bank.publicId } : { cashAccount: ctx.accounts['cash']!, bankAccountId: null };
  }

  private base(ctx: Ctx, doc: { publicId: string }, no: string, date: Date): Payload {
    return { factoryId: ctx.factory.publicId, documentId: doc.publicId, documentNo: no, documentDate: dayOf(date), accounts: ctx.accounts };
  }

  private readonly builders: Record<string, Builder> = {
    'erp_goods_receipt.posted': async (tx, ctx, event) => {
      const gr = await tx.erpGoodsReceipt.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { supplier: true, warehouse: true, lines: true } });
      if (!gr) return null;
      const movements = await this.movements(tx, ctx, { sourcePublicId: gr.publicId, kind: 'receipt' });
      const movementsValue = sum(movements);
      const chargesValue = gr.lines.reduce((a, l) => a.plus(dec(l.landedAmount)), new MoneyDecimal(0));
      return {
        ...this.base(ctx, gr, gr.grNo, gr.receivedOn),
        partnerId: gr.supplier.publicId,
        partnerName: gr.supplier.name,
        warehouseId: gr.warehouse.publicId,
        movements,
        movementsValue: money(movementsValue),
        goodsValue: money(movementsValue.minus(chargesValue)),
        chargesValue: money(chargesValue),
      };
    },
    'erp_goods_receipt.charge_added': async (tx, ctx, event) => {
      const gr = await tx.erpGoodsReceipt.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { supplier: true } });
      if (!gr) return null;
      const ids = this.movementIds(event);
      const p = event.payload as { chargeId?: string; kind?: string };
      const charge = p.chargeId ? await tx.erpLandedCharge.findFirst({ where: { publicId: p.chargeId } }) : null;
      const movements = ids && ids.length > 0 ? await this.movements(tx, ctx, { publicId: { in: ids } }) : [];
      const movementsValue = sum(movements);
      return {
        ...this.base(ctx, gr, gr.grNo, charge?.createdAt ?? new Date(event.occurredAt)),
        partnerId: gr.supplier.publicId,
        partnerName: gr.supplier.name,
        chargeDescription: charge?.description ?? p.kind ?? '',
        movements,
        movementsValue: money(movementsValue),
        chargesValue: money(movementsValue),
      };
    },
    'erp_supplier_invoice.recorded': (tx, ctx, event) => this.supplierInvoice(tx, ctx, event, 'recorded'),
    'erp_supplier_invoice.approved': (tx, ctx, event) => this.supplierInvoice(tx, ctx, event, 'approved'),
    'erp_supplier_payment.recorded': (tx, ctx, event) => this.supplierPayment(tx, ctx, event),
    'erp_supplier_payment.reversed': (tx, ctx, event) => this.supplierPayment(tx, ctx, event),
    'erp_stock.adjusted': (tx, ctx, event) => this.stockDocument(tx, ctx, event),
    'erp_stock.issued': (tx, ctx, event) => this.stockDocument(tx, ctx, event),
    'erp_maintenance.parts_issued': async (tx, ctx, event) => {
      const mt = await tx.erpMaintenanceOrder.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { machine: true } });
      if (!mt) return null;
      const ids = this.movementIds(event);
      const movements = ids ? await this.movements(tx, ctx, { publicId: { in: ids } }) : await this.movements(tx, ctx, { sourcePublicId: mt.publicId, kind: 'maintenance_issue' });
      return { ...this.base(ctx, mt, mt.mtNo, new Date(event.occurredAt)), machineId: mt.machine?.publicId ?? null, movements, movementsValue: money(sum(movements)) };
    },
    'erp_ncr.disposed': async (tx, ctx, event) => {
      const ncr = await tx.erpNcr.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId } });
      if (!ncr) return null;
      const movements = await this.movements(tx, ctx, { sourcePublicId: ncr.publicId });
      if (movements.length === 0) return null;
      return { ...this.base(ctx, ncr, ncr.ncrNo, ncr.dispositionAt ?? new Date(event.occurredAt)), movements, movementsValue: money(sum(movements)) };
    },
    'erp_production_order.materials_issued': (tx, ctx, event) => this.productionMovements(tx, ctx, event, 'production_issue'),
    'erp_production_order.materials_returned': (tx, ctx, event) => this.productionMovements(tx, ctx, event, 'production_return'),
    'erp_production_order.completed': async (tx, ctx, event) => {
      const mo = await tx.erpProductionOrder.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { item: true, warehouse: true } });
      if (!mo) return null;
      const ids = this.movementIds(event);
      const received = ids && ids.length > 0 ? await this.movements(tx, ctx, { publicId: { in: ids } }) : await this.movements(tx, ctx, { sourcePublicId: mo.publicId, kind: 'production_receipt' });
      const consumed = await this.movements(tx, ctx, { sourcePublicId: mo.publicId, kind: { in: ['production_issue', 'production_return'] } });
      const materialsValue = sum(consumed).negated();
      const erpSettings = await this.workspace.settings(tx, ctx.factory.id);
      const { cost } = await orderCost(tx, await moForCost(tx, mo.id), erpSettings);
      const labourValue = dec(cost.labour);
      const overheadValue = dec(cost.machine).plus(dec(cost.overhead));
      const receivedValue = received.length > 0 ? sum(received) : materialsValue.plus(labourValue).plus(overheadValue);
      // a getpack job's product leaves with the job: its cost goes straight to cost of goods sold (§5 F08)
      const accounts = received.length > 0 ? ctx.accounts : { ...ctx.accounts, finishedGoods: ctx.accounts['cogs']! };
      return {
        ...this.base(ctx, mo, mo.moNo, mo.completedAt ?? new Date(event.occurredAt)),
        accounts,
        itemId: mo.item?.publicId ?? null,
        warehouseId: mo.warehouse.publicId,
        receivedValue: money(receivedValue),
        materialsValue: money(materialsValue),
        labourValue: money(labourValue),
        overheadValue: money(overheadValue),
      };
    },
    'erp_sales_invoice.issued': async (tx, ctx, event) => {
      const iv = await tx.erpSalesInvoice.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { customer: true } });
      if (!iv || !iv.invoiceNo) return null;
      return {
        ...this.base(ctx, iv, iv.invoiceNo, iv.issueDate),
        partnerId: iv.customer.publicId,
        partnerName: iv.customer.name,
        subtotal: money(dec(iv.subtotal)),
        vatAmount: money(dec(iv.vatAmount)),
        total: money(dec(iv.total)),
        taxInvoice: iv.isTaxInvoice,
      };
    },
    'erp_delivery_note.issued': async (tx, ctx, event) => {
      const dn = await tx.erpDeliveryNote.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { customer: true, warehouse: true } });
      if (!dn) return null;
      const movements = await this.movements(tx, ctx, { sourcePublicId: dn.publicId, kind: 'sales_issue' });
      if (movements.length === 0) return null;
      return { ...this.base(ctx, dn, dn.doNo, dn.deliverOn), partnerId: dn.customer.publicId, partnerName: dn.customer.name, warehouseId: dn.warehouse.publicId, movements, movementsValue: money(sum(movements)) };
    },
    'erp_receipt.issued': (tx, ctx, event) => this.customerReceipt(tx, ctx, event),
    'erp_refund.issued': (tx, ctx, event) => this.customerReceipt(tx, ctx, event),
    'erp_credit_note.issued': (tx, ctx, event) => this.salesNote(tx, ctx, event),
    'erp_debit_note.issued': (tx, ctx, event) => this.salesNote(tx, ctx, event),
    'erp_fixed_asset.depreciated': async (tx, ctx, event) => {
      const run = await tx.erpGlDepreciationRun.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { period: true, lines: { include: { asset: { include: { category: { include: { expenseAccount: true, accumulatedAccount: true } }, machine: true } } } } } });
      if (!run) return null;
      const byCategory = new Map<string, { expenseAccount: string; accumulatedAccount: string; machineId: string | null; amount: MoneyValue }>();
      for (const l of run.lines) {
        const key = `${l.asset.categoryId}:${l.asset.machine?.publicId ?? ''}`;
        const cur = byCategory.get(key) ?? { expenseAccount: l.asset.category.expenseAccount.code, accumulatedAccount: l.asset.category.accumulatedAccount.code, machineId: l.asset.machine?.publicId ?? null, amount: new MoneyDecimal(0) };
        cur.amount = cur.amount.plus(dec(l.amount));
        byCategory.set(key, cur);
      }
      return {
        ...this.base(ctx, run, `DEP-${dayOf(run.period.startDate).slice(0, 7)}`, run.period.endDate),
        month: dayOf(run.period.startDate).slice(0, 7),
        lines: [...byCategory.values()].map((l) => ({ ...l, amount: money(l.amount) })),
      };
    },
    'erp_fixed_asset.disposed': async (tx, ctx, event) => {
      const a = await tx.erpGlFixedAsset.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { category: { include: { assetAccount: true, accumulatedAccount: true, gainLossAccount: true } }, machine: true } });
      if (!a || !a.disposedOn) return null;
      const p = event.payload as { bankAccountId?: string | null };
      const bank = p.bankAccountId ? await tx.erpGlBankAccount.findFirst({ where: { factoryId: ctx.factory.id, publicId: p.bankAccountId }, include: { glAccount: true } }) : null;
      const cash = bank ? { cashAccount: bank.glAccount.code, bankAccountId: bank.publicId } : await this.cashAccount(tx, ctx, dec(a.proceeds ?? 0).gt(0) ? 'transfer' : 'cash');
      return {
        ...this.base(ctx, a, a.assetNo, a.disposedOn),
        assetName: a.name,
        machineId: a.machine?.publicId ?? null,
        assetAccount: a.category.assetAccount.code,
        accumulatedAccount: a.category.accumulatedAccount.code,
        gainLossAccount: a.category.gainLossAccount.code,
        cost: money(dec(a.cost)),
        accumulated: money(dec(a.accumulated).plus(dec(a.openingAccumulated))),
        proceeds: money(dec(a.proceeds ?? 0)),
        ...cash,
      };
    },
    'billing_statement.confirmed': async (tx, ctx, event) => {
      const bs = await tx.billingStatement.findUnique({ where: { publicId: event.aggregateId } });
      if (!bs || bs.factoryId !== ctx.factory.id) return null;
      return {
        ...this.base(ctx, bs, bs.bsNumber, new Date(`${bangkokDate(bs.confirmedAt ?? new Date(event.occurredAt))}T00:00:00Z`)),
        net: money(dec(bs.netAmount)),
        vat: money(dec(bs.vatAmount)),
        gross: money(dec(bs.grossAmount)),
      };
    },
    'payout_item.paid': async (tx, ctx, event) => {
      const item = await tx.payoutItem.findUnique({ where: { publicId: event.aggregateId } });
      if (!item) return null;
      const p = event.payload as { pvNumber?: string | null; paidOn?: string | null };
      const cash = await this.cashAccount(tx, ctx, 'transfer');
      return {
        ...this.base(ctx, item, item.pvNumber ?? p.pvNumber ?? item.publicId.slice(0, 8), item.paidOn ?? new Date(`${p.paidOn ?? bangkokDate(new Date(event.occurredAt))}T00:00:00Z`)),
        kind: item.kind,
        cash: money(dec(item.cashAmount)),
        wht: money(dec(item.whtAmount)),
        whtBase: money(dec(item.whtBase)),
        retention: money(dec(item.retentionAmount)),
        ...cash,
      };
    },
    'erp_bank_line.matched': async (tx, ctx, event) => {
      const line = await tx.erpGlBankStatementLine.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { bankAccount: { include: { glAccount: true } } } });
      if (!line) return null;
      const p = event.payload as { targetType?: string };
      if (p.targetType !== 'bank_fee' && p.targetType !== 'interest') return null;
      return {
        ...this.base(ctx, line, line.reference ?? dayOf(line.txnDate), line.txnDate),
        reference: line.reference ?? '',
        txnDate: dayOf(line.txnDate),
        bankName: line.bankAccount.name,
        bankAccountId: line.bankAccount.publicId,
        bankGlAccount: line.bankAccount.glAccount.code,
        contraAccount: p.targetType === 'bank_fee' ? ctx.accounts['bankCharges']! : ctx.accounts['interestIncome']!,
        targetLabel: p.targetType === 'bank_fee' ? 'ค่าธรรมเนียมธนาคาร' : 'ดอกเบี้ยรับ',
        amount: money(dec(line.amount)),
      };
    },
  };

  private async supplierInvoice(tx: Tx, ctx: Ctx, event: DomainEventEnvelope, on: 'recorded' | 'approved'): Promise<Payload | null> {
    const inv = await tx.erpSupplierInvoice.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { supplier: true, lines: true } });
    if (!inv || inv.status === 'cancelled') return null;
    if (on === 'recorded' && inv.status === 'variance') return null; // posts when approved (F02A)
    let grir = new MoneyDecimal(0);
    let variance = new MoneyDecimal(0);
    let expense = new MoneyDecimal(0);
    for (const l of inv.lines) {
      if (l.purchaseOrderLineId && l.orderedPrice !== null) {
        const expected = dec(l.quantity).times(dec(l.orderedPrice)).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
        grir = grir.plus(expected);
        variance = variance.plus(dec(l.amount).minus(expected));
      } else expense = expense.plus(dec(l.amount));
    }
    // the document's subtotal is the truth; rounding differences go to the variance
    const rounding = dec(inv.subtotal).minus(grir).minus(variance).minus(expense);
    variance = variance.plus(rounding);
    return {
      ...this.base(ctx, inv, inv.docNo, inv.invoiceDate),
      partnerId: inv.supplier.publicId,
      partnerName: inv.supplier.name,
      invoiceNo: inv.invoiceNo,
      taxInvoice: !!inv.taxInvoiceNo,
      subtotal: money(dec(inv.subtotal)),
      vatAmount: money(dec(inv.vatAmount)),
      total: money(dec(inv.total)),
      grirValue: money(grir),
      varianceValue: money(variance),
      expenseValue: money(expense),
    };
  }

  private async supplierPayment(tx: Tx, ctx: Ctx, event: DomainEventEnvelope): Promise<Payload | null> {
    const p = await tx.erpSupplierPayment.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { supplier: true } });
    if (!p) return null;
    // WHT arises at payment (D-367): the certificates issued on this payment; a reversal mirrors the original's
    const certPaymentId = p.reversesId ?? p.id;
    const certs = await tx.erpWhtCertificate.findMany({ where: { paymentId: certPaymentId, status: { in: ['issued', 'voided'] } } });
    const sign = p.reversesId ? -1 : 1;
    const byForm = (form: 'pnd3' | 'pnd53') => certs.filter((c) => c.form === form && (p.reversesId ? true : c.status === 'issued'));
    const wht = (form: 'pnd3' | 'pnd53') => byForm(form).reduce((a, c) => a.plus(dec(c.whtAmount)), new MoneyDecimal(0)).times(sign);
    const base = (form: 'pnd3' | 'pnd53') => byForm(form).reduce((a, c) => a.plus(dec(c.baseAmount)), new MoneyDecimal(0)).abs();
    const cash = await this.cashAccount(tx, ctx, p.method);
    return {
      ...this.base(ctx, p, p.paymentNo, p.paidOn),
      partnerId: p.supplier.publicId,
      partnerName: p.supplier.name,
      amount: money(dec(p.amount)),
      wht3: money(wht('pnd3')),
      wht53: money(wht('pnd53')),
      whtBase3: money(base('pnd3')),
      whtBase53: money(base('pnd53')),
      ...cash,
    };
  }

  private async stockDocument(tx: Tx, ctx: Ctx, event: DomainEventEnvelope): Promise<Payload | null> {
    const movements = await this.movements(tx, ctx, { sourcePublicId: event.aggregateId });
    if (movements.length === 0) return null;
    const first = await tx.erpStockMovement.findFirst({ where: { sourcePublicId: event.aggregateId }, orderBy: { id: 'asc' } });
    const opening = movements.every((m) => m.kind === 'opening');
    return {
      ...this.base(ctx, { publicId: event.aggregateId }, first!.documentNo, first!.occurredAt),
      movements,
      movementsValue: money(sum(movements)),
      offsetAccount: opening ? ctx.accounts['retainedEarnings']! : ctx.accounts['stockVariance']!,
    };
  }

  private async productionMovements(tx: Tx, ctx: Ctx, event: DomainEventEnvelope, kind: 'production_issue' | 'production_return'): Promise<Payload | null> {
    const mo = await tx.erpProductionOrder.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { warehouse: true } });
    if (!mo) return null;
    const ids = this.movementIds(event);
    const movements = ids ? await this.movements(tx, ctx, { publicId: { in: ids } }) : await this.movements(tx, ctx, { sourcePublicId: mo.publicId, kind, occurredAt: { lte: new Date(event.occurredAt) } });
    if (movements.length === 0) return null;
    return { ...this.base(ctx, mo, mo.moNo, new Date(event.occurredAt)), warehouseId: mo.warehouse.publicId, movements, movementsValue: money(sum(movements)) };
  }

  private async customerReceipt(tx: Tx, ctx: Ctx, event: DomainEventEnvelope): Promise<Payload | null> {
    const r = await tx.erpCustomerReceipt.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { customer: true } });
    if (!r || r.status !== 'issued') return null;
    const sign = r.kind === 'refund' ? -1 : 1;
    const cash = await this.cashAccount(tx, ctx, r.method);
    return {
      ...this.base(ctx, r, r.receiptNo, r.receivedOn),
      partnerId: r.customer.publicId,
      partnerName: r.customer.name,
      amount: money(dec(r.amount).times(sign)),
      whtAmount: money(dec(r.whtAmount).times(sign)),
      whtBase: money(dec(r.amount).plus(dec(r.whtAmount))),
      ...cash,
    };
  }

  private async salesNote(tx: Tx, ctx: Ctx, event: DomainEventEnvelope): Promise<Payload | null> {
    const n = await tx.erpSalesNote.findFirst({ where: { factoryId: ctx.factory.id, publicId: event.aggregateId }, include: { customer: true } });
    if (!n || !n.noteNo || n.status !== 'issued') return null;
    const sign = n.kind === 'credit' ? 1 : -1;
    const movements = await this.movements(tx, ctx, { sourcePublicId: n.publicId });
    return {
      ...this.base(ctx, n, n.noteNo, n.issueDate),
      partnerId: n.customer.publicId,
      partnerName: n.customer.name,
      noteKindLabel: n.kind === 'credit' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้',
      difference: money(dec(n.difference).abs().times(sign)),
      vatAmount: money(dec(n.vatAmount).abs().times(sign)),
      total: money(dec(n.total).abs().times(sign)),
      movements,
      movementsValue: money(sum(movements)),
    };
  }
}
