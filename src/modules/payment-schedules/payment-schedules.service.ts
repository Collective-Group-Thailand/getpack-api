import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type DueTrigger,
  type Instalment,
  type InstalmentStatus,
  type Prisma,
  type RequiredBefore,
} from '@generated/prisma/client';
import {
  type CheckoutDraft,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { OrderLifecycleHooks, OrdersService } from '@modules/orders/orders.service';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import {
  addSets,
  allocateByGross,
  type AmountSet,
  applyFifo,
  type SelectionRule,
  selectTemplate,
  splitByPct,
  subSets,
  ZERO,
} from './schedule-math';

const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
const OPEN: InstalmentStatus[] = ['pending', 'due', 'partially_paid', 'overdue'];
const DAY_MS = 86_400_000;

export const SCHEDULE_INCLUDE = {
  templateVersion: { include: { template: true } },
  instalments: { orderBy: { seq: 'asc' }, include: { allocations: { include: { order: true } } } },
} as const satisfies Prisma.PaymentScheduleInclude;
export type ScheduleRow = Prisma.PaymentScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

export const scheduleEtag = (s: ScheduleRow) =>
  etagOf(s.publicId, ...s.instalments.map((i) => `${i.seq}:${i.rowVersion}`));

interface TemplateInForce {
  key: string;
  priority: number;
  rule: SelectionRule;
  versionId: bigint;
  requiresPermissionToSelect: boolean;
  instalments: {
    seq: number;
    labelTh: string;
    labelEn: string;
    pct: string;
    dueTrigger: DueTrigger;
    dueOffsetDays: number | null;
    requiredBefore: RequiredBefore;
  }[];
}

export interface ProposedSchedule {
  templateKey: string;
  versionId: bigint;
  isOverride: boolean;
  overrideReason: string | null;
  instalments: (TemplateInForce['instalments'][number] & { amounts: AmountSet })[];
}

/** Schedule choice CS may pass at checkout (`extensions.paymentSchedule`). */
export interface ScheduleOverrideInput {
  templateKey: string;
  reason: string;
}

function setOf(row: {
  netAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  whtAmount: Prisma.Decimal;
}): AmountSet {
  const gross = D(row.grossAmount);
  return {
    net: formatMoney(D(row.netAmount).sub(row.discountAmount)),
    vat: formatMoney(D(row.vatAmount)),
    gross: formatMoney(gross),
    wht: formatMoney(D(row.whtAmount)),
    cash: formatMoney(gross.sub(row.whtAmount)),
  };
}

/**
 * Payment schedules of order groups (D-020, ADR-0008): chosen at checkout from the templates in force
 * (credit terms first, then by order value against `payments.schedule_split_threshold`), overridable by
 * CS with `payment_schedules.override` and a reason; instalments split to orders; due dates resolved from
 * order facts; payments applied FIFO; the production gate (D-073) and the shipping gate opened when the
 * instalments required before them are paid.
 */
@Injectable()
export class PaymentSchedulesService implements OnModuleInit {
  private readonly logger = new Logger(PaymentSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly extensions: CheckoutExtensions,
    private readonly hooks: OrderLifecycleHooks,
    private readonly permissions: PermissionResolver,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  onModuleInit(): void {
    this.extensions.register({
      key: 'payment_schedule',
      order: 900,
      adjust: async (draft, db) => {
        draft.state['paymentSchedule'] = await this.propose(draft, db);
      },
      placed: (tx, draft, placed) => this.create(tx, draft, placed),
    });
    this.hooks.register({
      key: 'payment_schedule',
      paidAmount: async (tx, groupId) => {
        const rows = await tx.instalment.findMany({ where: { schedule: { orderGroupId: groupId } } });
        return formatMoney(rows.reduce((a, i) => a.add(i.paidAmount.toString()), new MoneyDecimal(0)));
      },
    });
  }

  // --- choice ---------------------------------------------------------------------------------------

  /** Templates whose approved version is in force at `at` (ADR-0005 resolution). */
  async templatesInForce(at: Date, db: Tx = this.prisma): Promise<TemplateInForce[]> {
    const templates = await db.paymentScheduleTemplate.findMany({
      include: {
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
          include: { instalments: { orderBy: { seq: 'asc' } } },
        },
      },
    });
    return templates
      .filter((t) => t.versions.length > 0)
      .map((t) => {
        const v = t.versions[0]!;
        return {
          key: t.key,
          priority: v.priority,
          rule: v.selectionRule as SelectionRule,
          versionId: v.id,
          requiresPermissionToSelect: v.requiresPermissionToSelect,
          instalments: v.instalments.map((i) => ({
            seq: i.seq,
            labelTh: i.labelTh,
            labelEn: i.labelEn,
            pct: i.pct.toFixed(4),
            dueTrigger: i.dueTrigger,
            dueOffsetDays: i.dueOffsetDays,
            requiredBefore: i.requiredBefore,
          })),
        };
      });
  }

  /** The schedule a checkout draft gets (preview and placement). */
  async propose(draft: CheckoutDraft, db: Tx = this.prisma): Promise<ProposedSchedule> {
    const templates = await this.templatesInForce(draft.at, db);
    const override = (draft.input.extensions?.['paymentSchedule'] ?? null) as ScheduleOverrideInput | null;
    let chosen: TemplateInForce | null;
    if (override) {
      chosen = templates.find((t) => t.key === override.templateKey) ?? null;
      if (!chosen)
        throw new DomainException('validation.failed', {
          errors: [
            { path: 'paymentSchedule.templateKey', code: 'exists', message: 'unknown schedule template' },
          ],
        });
    } else {
      const threshold = await this.settings.at('payments.schedule_split_threshold', { at: draft.at });
      draft.settingVersionIds['payments.schedule_split_threshold'] = String(threshold.versionId);
      const profile = await db.customerProfile.findUnique({ where: { userId: draft.customerUserId } });
      chosen = selectTemplate(
        templates.filter((t) => !t.requiresPermissionToSelect),
        {
          grossAmount: draft.totals.grossAmount,
          customerType: profile?.customerType ?? 'individual',
          productTypeCodes: draft.orders.map((o) => o.productTypeCode),
          creditApproved: draft.state['creditApproved'] === true,
          settings: { 'payments.schedule_split_threshold': String(threshold.value) },
        },
      );
    }
    if (!chosen) throw new DomainException('payments.no_schedule_template');
    const total: AmountSet = {
      net: formatMoney(D(draft.totals.netAmount).sub(draft.totals.discountAmount)),
      vat: draft.totals.vatAmount,
      gross: draft.totals.grossAmount,
      wht: draft.totals.whtAmount,
      cash: draft.totals.cashAmount,
    };
    const amounts = splitByPct(
      total,
      chosen.instalments.map((i) => i.pct),
    );
    const creditTermDays = draft.state['creditTermDays'];
    return {
      templateKey: chosen.key,
      versionId: chosen.versionId,
      isOverride: override !== null,
      overrideReason: override?.reason ?? null,
      instalments: chosen.instalments.map((i, index) => ({
        ...i,
        dueOffsetDays:
          i.dueTrigger === 'days_after_delivery' && typeof creditTermDays === 'number'
            ? creditTermDays
            : i.dueOffsetDays,
        amounts: amounts[index]!,
      })),
    };
  }

  // --- creation ---------------------------------------------------------------------------------------

  private async create(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const proposed = draft.state['paymentSchedule'] as ProposedSchedule;
    if (proposed.isOverride) {
      const actor = draft.actor;
      const granted =
        actor.type === 'user' && actor.audience === 'staff'
          ? (await this.permissions.forUser(actor.userId)).permissions.has('payment_schedules.override')
          : false;
      if (!granted) throw new DomainException('auth.forbidden');
      if (!proposed.overrideReason?.trim())
        throw new DomainException('validation.failed', {
          errors: [{ path: 'paymentSchedule.reason', code: 'required', message: 'a reason is required' }],
        });
    }
    const schedule = await tx.paymentSchedule.create({
      data: {
        orderGroupId: placed.groupId,
        templateVersionId: proposed.versionId,
        isOverride: proposed.isOverride,
        overrideReason: proposed.overrideReason,
        overrideById: proposed.isOverride && draft.actor.type === 'user' ? draft.actor.userId : null,
      },
    });
    const orders = placed.orders.map((o) => ({ key: o.id, gross: o.draft.totals.grossAmount }));
    for (const i of proposed.instalments) {
      await this.writeInstalment(tx, schedule.id, i.seq, i, i.amounts, orders, draft.at);
    }
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: placed.groupId } });
    await this.record(
      tx,
      group.publicId,
      'payment_schedule.created',
      {
        templateKey: proposed.templateKey,
        isOverride: proposed.isOverride,
        instalments: proposed.instalments.map((i) => ({
          seq: i.seq,
          pct: i.pct,
          dueTrigger: i.dueTrigger,
          requiredBefore: i.requiredBefore,
          cashAmount: i.amounts.cash,
        })),
      },
      draft.actor,
    );
    for (const i of proposed.instalments.filter((x) => x.dueTrigger === 'at_checkout')) {
      await this.record(
        tx,
        group.publicId,
        'instalment.due',
        { seq: i.seq, cashAmount: i.amounts.cash },
        draft.actor,
      );
    }
    // No instalment required before production (e.g. credit term): production may start once the artwork is approved.
    await this.evaluateGates(tx, placed.groupId, draft.actor);
  }

  private async writeInstalment(
    tx: Tx,
    scheduleId: bigint,
    seq: number,
    t: TemplateInForce['instalments'][number],
    amounts: AmountSet,
    orders: { key: bigint; gross: string }[],
    at: Date,
  ): Promise<Instalment> {
    const due = t.dueTrigger === 'at_checkout';
    const instalment = await tx.instalment.create({
      data: {
        paymentScheduleId: scheduleId,
        seq,
        labelTh: t.labelTh,
        labelEn: t.labelEn,
        pct: t.pct,
        dueTrigger: t.dueTrigger,
        dueOffsetDays: t.dueOffsetDays,
        requiredBefore: t.requiredBefore,
        dueAt: due ? at : null,
        status: due ? 'due' : 'pending',
        netAmount: amounts.net,
        vatAmount: amounts.vat,
        grossAmount: amounts.gross,
        whtAmount: amounts.wht,
        cashAmount: amounts.cash,
      },
    });
    await this.allocate(tx, instalment.id, amounts, orders);
    return instalment;
  }

  private async allocate(
    tx: Tx,
    instalmentId: bigint,
    amounts: AmountSet,
    orders: { key: bigint; gross: string }[],
  ) {
    await tx.instalmentAllocation.deleteMany({ where: { instalmentId } });
    for (const [orderId, a] of allocateByGross(amounts, orders)) {
      await tx.instalmentAllocation.create({
        data: {
          instalmentId,
          orderId,
          netAmount: a.net,
          vatAmount: a.vat,
          grossAmount: a.gross,
          whtAmount: a.wht,
          cashAmount: a.cash,
        },
      });
    }
  }

  /**
   * An add-on charge after placement (extra design round D-071, mockup D-072; ADR-0008 item 6): a
   * fixed-amount instalment due now, required before nothing, allocated to its order and naming its line.
   * The caller has already added the line to the order and the group totals.
   */
  async addFixedInstalment(
    tx: Tx,
    input: {
      groupId: bigint;
      orderId: bigint;
      orderLineId: bigint;
      labelTh: string;
      labelEn: string;
      amounts: AmountSet;
    },
    actor: Actor,
    at = new Date(),
  ): Promise<Instalment> {
    const schedule = await this.forGroup(input.groupId, tx);
    const seq = Math.max(0, ...schedule.instalments.map((i) => i.seq)) + 1;
    const instalment = await tx.instalment.create({
      data: {
        paymentScheduleId: schedule.id,
        seq,
        labelTh: input.labelTh,
        labelEn: input.labelEn,
        pct: '0',
        dueTrigger: 'at_checkout',
        requiredBefore: 'none',
        fixedAmount: true,
        orderLineId: input.orderLineId,
        dueAt: at,
        status: 'due',
        netAmount: input.amounts.net,
        vatAmount: input.amounts.vat,
        grossAmount: input.amounts.gross,
        whtAmount: input.amounts.wht,
        cashAmount: input.amounts.cash,
      },
    });
    await this.allocate(tx, instalment.id, input.amounts, [
      { key: input.orderId, gross: input.amounts.gross },
    ]);
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: input.groupId } });
    await this.record(
      tx,
      group.publicId,
      'instalment.due',
      {
        instalmentId: instalment.publicId,
        seq,
        cashAmount: input.amounts.cash,
        addOn: true,
      },
      actor,
    );
    return instalment;
  }

  // --- reads & override -------------------------------------------------------------------------------

  async forGroup(groupId: bigint, db: Tx = this.prisma): Promise<ScheduleRow> {
    const row = await db.paymentSchedule.findUnique({
      where: { orderGroupId: groupId },
      include: SCHEDULE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /**
   * CS replaces the schedule of a group before anything is paid (`payment_schedules.override`, reason):
   * the open instalments are cancelled and the template's instalments written for the group's totals.
   */
  async override(
    actor: UserActor,
    groupPublicId: string,
    ifMatch: string | undefined,
    input: ScheduleOverrideInput,
  ) {
    return this.prisma.withTx(async (tx) => {
      const group = await tx.orderGroup.findUnique({
        where: { publicId: groupPublicId },
        include: { orders: true },
      });
      if (!group) throw new DomainException('http.not_found');
      const schedule = await this.forGroup(group.id, tx);
      assertIfMatch(ifMatch, scheduleEtag(schedule));
      if (schedule.instalments.some((i) => D(i.paidAmount).gt(0)))
        throw new DomainException('payments.schedule_has_payments');
      if (!['waiting_payment', 'pending_company_approval'].includes(group.status))
        throw new DomainException('payments.schedule_has_payments');
      const template = (await this.templatesInForce(new Date(), tx)).find((t) => t.key === input.templateKey);
      if (!template)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'templateKey', code: 'exists', message: 'unknown schedule template' }],
        });
      await tx.instalment.updateMany({
        where: { paymentScheduleId: schedule.id, status: { in: OPEN } },
        data: { status: 'cancelled', rowVersion: { increment: 1 } },
      });
      await tx.paymentSchedule.update({
        where: { id: schedule.id },
        data: {
          templateVersionId: template.versionId,
          isOverride: true,
          overrideReason: input.reason,
          overrideById: actor.userId,
        },
      });
      const active = group.orders.filter((o) => o.status !== 'cancelled');
      const total = active.map(setOf).reduce(addSets, ZERO);
      const amounts = splitByPct(
        total,
        template.instalments.map((i) => i.pct),
      );
      const nextSeq = Math.max(...schedule.instalments.map((i) => i.seq)) + 1;
      const orders = active.map((o) => ({ key: o.id, gross: o.grossAmount.toFixed(2) }));
      const now = new Date();
      for (const [index, i] of template.instalments.entries()) {
        await this.writeInstalment(tx, schedule.id, nextSeq + index, i, amounts[index]!, orders, now);
      }
      await this.record(
        tx,
        group.publicId,
        'payment_schedule.overridden',
        {
          templateKey: template.key,
          reason: input.reason,
        },
        actor,
      );
      await this.evaluateGates(tx, group.id, actor);
      return this.forGroup(group.id, tx);
    });
  }

  // --- templates (D-063: Superadmin changes them as new versions) --------------------------------------

  async templates(at = new Date()) {
    return this.prisma.paymentScheduleTemplate.findMany({
      orderBy: { key: 'asc' },
      include: {
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
          include: { instalments: { orderBy: { seq: 'asc' } } },
        },
      },
    });
  }

  /** A new approved version of a template, effective from now or later (never back-dated, ADR-0005). */
  async createVersion(
    actor: UserActor,
    key: string,
    body: {
      effectiveFrom: string;
      selectionRule: Record<string, unknown>;
      priority: number;
      requiresPermissionToSelect?: boolean;
      instalments: {
        labelTh: string;
        labelEn: string;
        pct: string;
        dueTrigger: DueTrigger;
        dueOffsetDays?: number | null;
        requiredBefore: RequiredBefore;
      }[];
      reason: string;
    },
  ) {
    const invalid = (path: string, message: string): never => {
      throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    };
    const effectiveFrom = new Date(body.effectiveFrom);
    if (effectiveFrom.getTime() < Date.now() - 60_000) invalid('effectiveFrom', 'must not be in the past');
    const total = body.instalments.reduce((a, i) => a.add(i.pct), new MoneyDecimal(0));
    if (!total.eq(100)) invalid('instalments', `percentages add up to ${total.toString()}, not 100`);
    body.instalments.forEach((i, index) => {
      if (i.dueTrigger === 'days_after_delivery' && (i.dueOffsetDays ?? null) === null)
        invalid(`instalments[${index}].dueOffsetDays`, 'required for days_after_delivery');
    });
    const rule = body.selectionRule as SelectionRule;
    const allowed = ['orderValue', 'customerTypes', 'productTypeCodes', 'creditApproved'];
    for (const k of Object.keys(rule))
      if (!allowed.includes(k)) invalid(`selectionRule.${k}`, 'unknown rule');
    return this.prisma.withTx(async (tx) => {
      const template = await tx.paymentScheduleTemplate.findUnique({ where: { key } });
      if (!template) throw new DomainException('http.not_found');
      const last = await tx.paymentScheduleTemplateVersion.findFirst({
        where: { templateId: template.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.paymentScheduleTemplateVersion.create({
        data: {
          templateId: template.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom,
          selectionRule: body.selectionRule as Prisma.InputJsonValue,
          priority: body.priority,
          requiresPermissionToSelect: body.requiresPermissionToSelect ?? false,
          reason: body.reason,
          createdById: actor.userId,
          instalments: {
            create: body.instalments.map((i, index) => ({
              seq: index + 1,
              labelTh: i.labelTh,
              labelEn: i.labelEn,
              pct: i.pct,
              dueTrigger: i.dueTrigger,
              dueOffsetDays: i.dueOffsetDays ?? null,
              requiredBefore: i.requiredBefore,
            })),
          },
        },
      });
      await tx.paymentScheduleTemplateVersion.update({
        where: { id: version.id },
        data: { status: 'approved', decidedAt: new Date(), decidedById: actor.userId },
      });
      const event = await this.events.record(
        tx,
        {
          type: 'payment_schedule_template.version_approved',
          aggregateType: 'payment_schedule_template',
          aggregateId: template.publicId,
          payload: { key, versionNo: version.versionNo, effectiveFrom: effectiveFrom.toISOString() },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'payment_schedule_template',
        aggregatePublicId: template.publicId,
        action: 'payment_schedule_template.version_approved',
        messageKey: 'activity.payment_schedule_template.version_approved',
        visibility: ['internal'],
        domainEventId: event.id,
        actor,
      });
      return template;
    });
  }

  // --- payments & gates -------------------------------------------------------------------------------

  /**
   * Applies received cash to the group's open instalments (FIFO, ADR-0008) in the payment's transaction,
   * records the allocations and opens the gates. Returns the cash that found no instalment (overpayment).
   */
  async applyPayment(
    tx: Tx,
    groupId: bigint,
    paymentId: bigint,
    cash: string,
    actor: Actor,
    at = new Date(),
  ) {
    const schedule = await this.forGroup(groupId, tx);
    // What is due takes the cash first (oldest seq first), then what is not due yet (ADR-0008 item 3).
    const dueFirst = (i: { status: InstalmentStatus }) => (i.status === 'pending' ? 1 : 0);
    const open = schedule.instalments
      .filter((i) => OPEN.includes(i.status))
      .sort((a, b) => dueFirst(a) - dueFirst(b) || a.seq - b.seq);
    const { applications, leftover } = applyFifo(
      open.map((i) => ({
        key: i.id,
        cash: i.cashAmount.toFixed(2),
        gross: i.grossAmount.toFixed(2),
        paid: i.paidAmount.toFixed(2),
      })),
      cash,
    );
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: groupId } });
    for (const a of applications) {
      const instalment = open.find((i) => i.id === a.key)!;
      await tx.paymentAllocation.create({
        data: { paymentId, instalmentId: a.key, cashAmount: a.cash, grossAmount: a.gross },
      });
      const paid = D(instalment.paidAmount).add(a.cash);
      await tx.instalment.update({
        where: { id: a.key },
        data: {
          paidAmount: formatMoney(paid),
          status: a.fullyPaid ? 'paid' : 'partially_paid',
          paidAt: a.fullyPaid ? at : null,
          rowVersion: { increment: 1 },
        },
      });
      if (a.fullyPaid)
        await this.record(
          tx,
          group.publicId,
          'instalment.paid',
          {
            instalmentId: instalment.publicId,
            seq: instalment.seq,
            cashAmount: a.cash,
            fixedAmount: instalment.fixedAmount,
          },
          actor,
        );
    }
    await this.evaluateGates(tx, groupId, actor);
    return { applications, leftover };
  }

  /** Opens the production gate (fact `paid_for_production`) and announces the shipping gate. */
  async evaluateGates(tx: Tx, groupId: bigint, actor: Actor): Promise<void> {
    const schedule = await tx.paymentSchedule.findUnique({
      where: { orderGroupId: groupId },
      include: { instalments: true },
    });
    if (!schedule) return;
    const live = schedule.instalments.filter((i) => i.status !== 'cancelled');
    const paidFor = (gate: RequiredBefore) =>
      live
        .filter((i) => i.requiredBefore === gate)
        .every((i) => i.status === 'paid' || i.status === 'refunded');
    if (paidFor('production')) {
      const orders = await tx.order.findMany({
        where: { orderGroupId: groupId, cancelledAt: null, paidForProductionAt: null },
      });
      for (const o of orders) await this.orders.applyFact(tx, o.id, { kind: 'paid_for_production' }, actor);
    }
  }

  /** B4.2: the instalments required before production are paid (D-073). */
  async canStartProduction(orderId: bigint, db: Tx = this.prisma): Promise<boolean> {
    return this.gateOpen(orderId, ['production'], db);
  }

  /** B4.3: shipping is blocked while instalments required before shipping (or production) are unpaid. */
  async canShip(orderId: bigint, db: Tx = this.prisma): Promise<boolean> {
    return this.gateOpen(orderId, ['production', 'shipping'], db);
  }

  private async gateOpen(orderId: bigint, gates: RequiredBefore[], db: Tx): Promise<boolean> {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const schedule = await db.paymentSchedule.findUnique({
      where: { orderGroupId: order.orderGroupId },
      include: { instalments: true },
    });
    if (!schedule) return false;
    return schedule.instalments
      .filter((i) => i.status !== 'cancelled' && gates.includes(i.requiredBefore))
      .every((i) => i.status === 'paid' || i.status === 'refunded');
  }

  // --- due dates from facts ---------------------------------------------------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'payment_schedules.due' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const { orderId, fact, at } = event.payload as { orderId: string; fact: string; at: string };
    const trigger: Partial<Record<string, DueTrigger[]>> = {
      artwork_approved: ['before_production'],
      production_started: ['before_shipping'],
      delivered: ['on_delivery', 'days_after_delivery'],
    };
    const triggers = trigger[fact];
    if (!triggers) return;
    const order = await tx.order.findUnique({ where: { publicId: orderId }, include: { orderGroup: true } });
    if (!order) return;
    const schedule = await tx.paymentSchedule.findUnique({
      where: { orderGroupId: order.orderGroupId },
      include: { instalments: true },
    });
    if (!schedule) return;
    const when = new Date(at);
    const actor = systemActor('payment_schedules.due');
    for (const i of schedule.instalments.filter(
      (x) => x.status === 'pending' && triggers.includes(x.dueTrigger),
    )) {
      const dueAt =
        i.dueTrigger === 'days_after_delivery'
          ? new Date(when.getTime() + (i.dueOffsetDays ?? 0) * DAY_MS)
          : when;
      const dueNow = dueAt <= new Date();
      await tx.instalment.update({
        where: { id: i.id },
        data: { dueAt, ...(dueNow && { status: 'due' }), rowVersion: { increment: 1 } },
      });
      if (dueNow)
        await this.record(
          tx,
          order.orderGroup.publicId,
          'instalment.due',
          {
            seq: i.seq,
            cashAmount: i.cashAmount.toFixed(2),
            dueAt: dueAt.toISOString(),
          },
          actor,
        );
    }
  }

  /** Scheduled: instalments reaching their due date become due; delivery-based ones past it overdue. */
  async refreshStatuses(now = new Date()): Promise<number> {
    let changed = 0;
    const actor = systemActor('instalments.refresh');
    const due = await this.prisma.instalment.findMany({
      where: { status: 'pending', dueAt: { lte: now } },
      include: { schedule: { include: { orderGroup: true } } },
      take: 500,
    });
    for (const i of due) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.instalment.updateMany({
          where: { id: i.id, status: 'pending' },
          data: { status: 'due', rowVersion: { increment: 1 } },
        });
        if (count === 1) {
          changed += 1;
          await this.record(
            tx,
            i.schedule.orderGroup.publicId,
            'instalment.due',
            {
              seq: i.seq,
              cashAmount: i.cashAmount.toFixed(2),
              dueAt: i.dueAt!.toISOString(),
            },
            actor,
          );
        }
      });
    }
    // Only delivery-based instalments have a deadline; the ones before production / shipping are gates.
    const overdue = await this.prisma.instalment.findMany({
      where: {
        status: { in: ['due', 'partially_paid'] },
        dueTrigger: { in: ['on_delivery', 'days_after_delivery'] },
        dueAt: { lt: now },
        overdueNotifiedAt: null,
      },
      include: { schedule: { include: { orderGroup: true } } },
      take: 500,
    });
    for (const i of overdue) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.instalment.updateMany({
          where: { id: i.id, overdueNotifiedAt: null },
          data: { status: 'overdue', overdueNotifiedAt: now, rowVersion: { increment: 1 } },
        });
        if (count === 1) {
          changed += 1;
          await this.record(
            tx,
            i.schedule.orderGroup.publicId,
            'instalment.overdue',
            {
              seq: i.seq,
              openCashAmount: formatMoney(D(i.cashAmount).sub(i.paidAmount)),
              dueAt: i.dueAt!.toISOString(),
            },
            actor,
          );
        }
      });
    }
    return changed;
  }

  // --- rebalance (ADR-0008 §4) --------------------------------------------------------------------------

  /** Cancelled orders and CS re-prices move only the unpaid part of the schedule. */
  @OnDomainEvent(['order.repriced', 'order.cancelled'], { consumer: 'payment_schedules.rebalance' })
  async onOrderChanged(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({ where: { publicId: event.aggregateId } });
    if (!order) return;
    await this.rebalance(tx, order.orderGroupId, systemActor('payment_schedules.rebalance'));
  }

  async rebalance(tx: Tx, groupId: bigint, actor: Actor): Promise<void> {
    const schedule = await tx.paymentSchedule.findUnique({
      where: { orderGroupId: groupId },
      include: { instalments: { orderBy: { seq: 'asc' } } },
    });
    if (!schedule) return;
    const group = await tx.orderGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: { orders: true },
    });
    const active = group.orders.filter((o) => o.status !== 'cancelled');
    const live = schedule.instalments.filter((i) => i.status !== 'cancelled');
    // Paid instalments and add-on charges (ADR-0008 item 6) keep their amounts; the rest is re-split.
    const fixed = live.filter((i) => i.status === 'paid' || i.status === 'refunded' || i.fixedAmount);
    const adjustable = live.filter((i) => OPEN.includes(i.status) && !i.fixedAmount);
    const target = active.map(setOf).reduce(addSets, ZERO);
    const remainder = subSets(target, fixed.map(setOf).reduce(addSets, ZERO));
    const paidOnAdjustable = adjustable.reduce((a, i) => a.add(i.paidAmount.toString()), new MoneyDecimal(0));

    if (active.length === 0 || D(remainder.cash).lt(paidOnAdjustable)) {
      for (const i of adjustable.filter((x) => D(x.paidAmount).eq(0))) {
        await tx.instalment.update({
          where: { id: i.id },
          data: { status: 'cancelled', rowVersion: { increment: 1 } },
        });
      }
      const paid = live.reduce((a, i) => a.add(i.paidAmount.toString()), new MoneyDecimal(0));
      const over = paid.sub(target.cash);
      if (over.gt(0))
        await this.record(
          tx,
          group.publicId,
          'payment_schedule.overpaid',
          { amount: formatMoney(over) },
          actor,
        );
      return;
    }
    if (adjustable.length > 0) {
      const parts = splitByPct(
        remainder,
        adjustable.map((i) => i.pct.toFixed(4)),
        true,
      );
      // Each order's share excludes its add-on charges, which have their own instalments.
      const charges = await tx.instalmentAllocation.groupBy({
        by: ['orderId'],
        where: {
          instalment: { paymentScheduleId: schedule.id, fixedAmount: true, status: { not: 'cancelled' } },
        },
        _sum: { grossAmount: true },
      });
      const chargeOf = (orderId: bigint) =>
        D(charges.find((c) => c.orderId === orderId)?._sum.grossAmount ?? 0);
      const orders = active.map((o) => ({
        key: o.id,
        gross: formatMoney(D(o.grossAmount).sub(chargeOf(o.id))),
      }));
      for (const [index, i] of adjustable.entries()) {
        const a = parts[index]!;
        const paid = D(i.paidAmount);
        await tx.instalment.update({
          where: { id: i.id },
          data: {
            netAmount: a.net,
            discountAmount: '0.00',
            vatAmount: a.vat,
            grossAmount: a.gross,
            whtAmount: a.wht,
            cashAmount: a.cash,
            ...(paid.gte(a.cash) && paid.gt(0) ? { status: 'paid', paidAt: new Date() } : {}),
            rowVersion: { increment: 1 },
          },
        });
        await this.allocate(tx, i.id, a, orders);
      }
    }
    await this.record(
      tx,
      group.publicId,
      'payment_schedule.rebalanced',
      { grossAmount: target.gross },
      actor,
    );
    await this.evaluateGates(tx, groupId, actor);
  }

  private async record(
    tx: Tx,
    groupPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'order_group',
        aggregateId: groupPublicId,
        payload: { groupId: groupPublicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order_group',
      aggregatePublicId: groupPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
