import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesDiscountApproval } from '@generated/prisma/client';
import { quotedBase } from '@modules/agents/agent-discount-rules';
import { type OfferInput } from '@modules/agents/agent-discount-rules';
import { AgentDiscountsService, DISCOUNT_REQUEST_INCLUDE } from '@modules/agents/agent-discounts.service';
import { recordAgentEvent } from '@modules/agents/agent-shared';
import { CreditService } from '@modules/companies/credit.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { SoloOwnerModeService, TYPED_REASON_MIN_LENGTH } from '@platform/approvals/solo-owner';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { holdersOfRole, type Recipient, RecipientDirectory } from '@platform/notifications/recipients';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import {
  type ApprovalLevel,
  approvalLevel,
  type ApprovalSnapshot,
  type CashLeg,
  creditCost,
  deciderLevel,
  levelAbove,
  levelRank,
  negotiationHeavy,
  serializeWaterfall,
  snapshotSha256,
  type TieredWaterfall,
  tierOf,
  type Waterfall,
  waterfall,
  type WaterfallTier,
} from './discount-approval-rules';
import { workingHoursDue } from './sales-desk-rules';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
export const APPROVAL_AGGREGATE = 'sales_discount_approval';
const LEVEL_ROLE: Record<ApprovalLevel, string> = {
  rep: 'sales_rep',
  sales_manager: 'sales_manager',
  c_level: 'c_level',
};

export const APPROVAL_INCLUDE = {
  request: { include: DISCOUNT_REQUEST_INCLUDE },
  agentQuote: {
    include: {
      agent: { select: { publicId: true, code: true, legalName: true, kind: true, staffUserId: true } },
      lead: { select: { publicId: true, contactName: true, organisationName: true } },
    },
  },
  quote: { select: { publicId: true, quoteCode: true, validUntil: true, status: true } },
  requestedBy: { select: { publicId: true, displayName: true } },
  decidedBy: { select: { publicId: true, displayName: true } },
  priceLocks: true,
} as const satisfies Prisma.SalesDiscountApprovalInclude;
export type ApprovalRow = Prisma.SalesDiscountApprovalGetPayload<{ include: typeof APPROVAL_INCLUDE }>;

/** What can change in a simulation (nothing is saved). */
export interface SimulationInput {
  discountPct: string;
  creditDays?: number | null;
  paymentTemplateKey?: string | null;
  depositPct?: string | null;
  ratePct?: string | null;
  paymentMethod?: string | null;
  freeServicesAmount?: string | null;
}

export interface DecisionInput {
  decision: 'approve' | 'reject' | 'counter';
  options?: OfferInput[];
  note?: string;
  counter?: Record<string, unknown>;
  selfApprovalReason?: string;
}

interface DealContext {
  quotePublicId: string;
  optionPublicId: string;
  quantity: number;
  listRevenue: string;
  factoryCost: string;
  shippingCharged: string | null;
  shippingPaid: string | null;
  vatPct: string;
  ratePct: string;
  minBase: string;
  floorPct: string;
  deliveryDay: number;
  factoryLegs: { advancePct: string; advanceDay: number | null; balanceDay: number };
  creditTermDays: number | null;
  badDebt: { pct: string | null; status: 'set' | 'not_set' | 'not_applicable' };
  depositPct: string | null;
  cashWithinDays: number | null;
  giveGetSha256: string;
  snapshot: ApprovalSnapshot;
  factoryId: bigint | null;
  priceListVersionId: bigint | null;
  quoteOptionId: bigint;
}

/**
 * D-470 (PLAN A-12, §7): the discount approval desk. Every agent / rep discount request round opens an approval (when
 * every quoted quantity has a buy price) with the deal's waterfall, the level from the matrix (negotiation-heavy one
 * up), an SLA in working hours with escalation, and a snapshot hash that voids it when anything changes. Deciding
 * approves with 1–3 options (P3 `offerOptions`, the full-rate option first), rejects or counters; big deals also lock
 * the factory buy price. Views are tiered by permission and logged.
 */
@Injectable()
export class DiscountApprovalsService implements OnModuleInit {
  private readonly logger = new Logger(DiscountApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly discounts: AgentDiscountsService,
    private readonly credit: CreditService,
    private readonly resolver: PermissionResolver,
    private readonly soloOwner: SoloOwnerModeService,
    private readonly audit: AuditService,
    private readonly directory: RecipientDirectory,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  onModuleInit(): void {
    this.directory.registerAssignees(APPROVAL_AGGREGATE, (event, _route, tx) => this.recipients(event, tx));
  }

  // --- the deal ---------------------------------------------------------------------------------------------------

  private async optionalSetting<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  /** Everything the waterfall needs for a request's quoted quantity; refuses an unknown cost. */
  async context(db: Tx, requestId: bigint, now = new Date()): Promise<DealContext> {
    const req = await db.salesAgentDiscountRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        agentQuote: { include: { lead: true } },
        quoteOption: true,
        quote: { include: { options: true, productType: { include: { category: true } } } },
      },
    });
    const unknown = req.quote.options.some(
      (o) => o.buyCostNet === null || !(o.internalBreakdown as { buyPrice?: string } | null)?.buyPrice,
    );
    if (unknown) throw new DomainException('discount_approval.cost_unknown');
    const option = req.quoteOption;
    const internal = option.internalBreakdown as {
      buyPrice: string;
      shipping?: { costAmount: string } | null;
    };
    const result = option.result as { shippingNetAmount?: string | null };
    const listRevenue = quotedBase({
      netAmount: option.netAmount.toFixed(2),
      shippingNetAmount: result.shippingNetAmount ?? null,
    });
    const vatPct = option.netAmount.gt(0)
      ? D(option.vatAmount).mul(100).div(option.netAmount).toDecimalPlaces(2).toFixed(2)
      : '0.00';
    const rate = await this.discounts.standardRate(db, req.agentQuote);
    const floors = await this.settings.value('margin.floor_pct', now);
    const floorPct = floors.byProductClass[req.quote.productType.category.code] ?? floors.default;
    // Factory payout terms (D-022): the factory's policy in force, else the platform defaults.
    const policy = option.selectedFactoryId
      ? await db.factoryPayoutPolicyVersion.findFirst({
          where: {
            status: 'approved',
            effectiveFrom: { lte: now },
            policy: { factoryId: option.selectedFactoryId },
          },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        })
      : null;
    const deliveryDay = option.leadTimeDays ?? 0;
    const claimWindow =
      policy?.claimWindowDays ?? Number(await this.settings.value('claims.window_days', now));
    const advancePct = policy
      ? policy.advancePct.toFixed(4)
      : String((await this.settings.at('payouts.advance_pct', { at: now })).value);
    const balanceTrigger =
      policy?.balanceTrigger ??
      String((await this.settings.at('payouts.balance_trigger', { at: now })).value);
    const terms = policy?.paymentTermsDays ?? 0;
    const balanceDay =
      (balanceTrigger === 'immediate' || balanceTrigger === 'job_accepted' || balanceTrigger === 'none'
        ? 0
        : balanceTrigger === 'after_pod'
          ? deliveryDay
          : deliveryDay + claimWindow) + terms;
    const advanceDay = policy && policy.advanceTrigger === 'none' ? null : 0;
    // The customer's credit (D-121, D-462): a company with approved credit pays its term after delivery.
    const companyId = req.agentQuote.lead.convertedCompanyId ?? req.quote.companyId;
    const limit = companyId ? await this.credit.currentLimit(db, companyId, now) : null;
    const grades = await this.optionalSetting(() =>
      this.settings.value('finance.bad_debt_provision_pct', now),
    );
    const badDebt: DealContext['badDebt'] = !limit
      ? { pct: null, status: 'not_applicable' }
      : grades?.byGrade['credit'] !== undefined
        ? { pct: grades.byGrade['credit'], status: 'set' }
        : { pct: null, status: 'not_set' };
    const shippingPaid = internal.shipping?.costAmount ?? null;
    const snapshot: ApprovalSnapshot = {
      quoteId: req.quote.publicId,
      lines: req.quote.options
        .map((o) => ({
          optionId: o.publicId,
          quantity: o.quantity,
          buyCost: o.buyCostNet?.toFixed(2) ?? null,
          shippingPaid:
            (o.internalBreakdown as { shipping?: { costAmount: string } | null } | null)?.shipping
              ?.costAmount ?? null,
          net: o.netAmount.toFixed(2),
        }))
        .sort((a, b) => a.quantity - b.quantity),
      terms: {
        requestedPct: req.requestedPct.toFixed(4),
        giveGetSha256: Buffer.from(req.giveGetSha256).toString('hex'),
        paymentTemplate: null,
        creditDays: limit?.termDays ?? null,
      },
    };
    return {
      quotePublicId: req.quote.publicId,
      optionPublicId: option.publicId,
      quantity: option.quantity,
      listRevenue,
      factoryCost: D(internal.buyPrice).toFixed(2),
      shippingCharged: result.shippingNetAmount ?? null,
      shippingPaid,
      vatPct,
      ratePct: rate.ratePct,
      minBase: rate.minBase,
      floorPct: D(floorPct).toFixed(2),
      deliveryDay,
      factoryLegs: { advancePct, advanceDay, balanceDay },
      creditTermDays: limit?.termDays ?? null,
      badDebt,
      depositPct: req.depositPct?.toFixed(4) ?? null,
      cashWithinDays: req.cashWithinDays,
      giveGetSha256: snapshot.terms.giveGetSha256,
      snapshot,
      factoryId: option.selectedFactoryId,
      priceListVersionId: option.priceListVersionId,
      quoteOptionId: option.id,
    };
  }

  /** The customer's receipts for the credit cost (net of VAT): deposit, schedule template or credit term. */
  private async receipts(
    ctx: DealContext,
    total: MoneyValue,
    sim: SimulationInput | null,
  ): Promise<CashLeg[]> {
    const delivery = ctx.deliveryDay;
    if (sim?.paymentTemplateKey) {
      const template = await this.prisma.paymentScheduleTemplate.findUnique({
        where: { key: sim.paymentTemplateKey },
        include: {
          versions: {
            where: { status: 'approved', effectiveFrom: { lte: new Date() } },
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            take: 1,
            include: { instalments: { orderBy: { seq: 'asc' } } },
          },
        },
      });
      const version = template?.versions[0];
      if (!version)
        throw new DomainException('validation.failed', {
          errors: [
            { path: 'paymentTemplateKey', code: 'invalid', message: 'a payment schedule template in force' },
          ],
        });
      return version.instalments.map((i) => ({
        amount: total.mul(i.pct).div(100).toFixed(2),
        day:
          i.dueTrigger === 'at_checkout' || i.dueTrigger === 'before_production'
            ? 0
            : i.dueTrigger === 'days_after_delivery'
              ? delivery + (i.dueOffsetDays ?? 0)
              : delivery,
      }));
    }
    const creditDays =
      sim?.creditDays !== undefined && sim.creditDays !== null ? sim.creditDays : ctx.creditTermDays;
    const deposit = D(sim?.depositPct ?? ctx.depositPct ?? 0);
    // No credit: the store's own rule — paid at checkout, before production (day 0).
    const balanceDay =
      ctx.cashWithinDays !== null && !sim?.creditDays
        ? ctx.cashWithinDays
        : creditDays === null
          ? 0
          : delivery + creditDays;
    const depositAmount = total.mul(deposit).div(100).toDecimalPlaces(2);
    return [
      { amount: depositAmount.toFixed(2), day: 0 },
      { amount: total.sub(depositAmount).toFixed(2), day: balanceDay },
    ];
  }

  /** The deal's waterfall at a discount (and simulated terms). */
  async compute(ctx: DealContext, sim: SimulationInput): Promise<Waterfall> {
    const net = D(ctx.listRevenue).mul(D(100).sub(sim.discountPct)).div(100).toDecimalPlaces(2);
    const total = net.add(ctx.shippingCharged ?? 0);
    const out = D(ctx.factoryCost).add(ctx.shippingPaid ?? 0);
    const advance =
      ctx.factoryLegs.advanceDay === null
        ? D(0)
        : out.mul(ctx.factoryLegs.advancePct).div(100).toDecimalPlaces(2);
    const cost = creditCost({
      cashOut: [
        { amount: advance.toFixed(2), day: ctx.factoryLegs.advanceDay ?? 0 },
        { amount: out.sub(advance).toFixed(2), day: ctx.factoryLegs.balanceDay },
      ],
      receipts: await this.receipts(ctx, total, sim),
      annualPct: String(await this.settings.value('finance.cost_of_capital_annual_pct', new Date())),
    });
    const fees = await this.optionalSetting(() => this.settings.value('payments.method_fees', new Date()));
    const method = sim.paymentMethod ?? 'bank_transfer';
    const fee = fees?.[method];
    return waterfall({
      listRevenue: ctx.listRevenue,
      discountPct: sim.discountPct,
      factoryCost: ctx.factoryCost,
      shippingCharged: ctx.shippingCharged,
      shippingPaid: ctx.shippingPaid,
      vatPct: ctx.vatPct,
      paymentFee: fee
        ? { method, pct: fee.pct ?? null, fixedAmount: fee.fixedAmount ?? null, status: 'set' }
        : { method, pct: null, fixedAmount: null, status: 'not_set' },
      freeServices: sim.freeServicesAmount ?? '0',
      commissionRatePct: sim.ratePct ?? ctx.ratePct,
      minBase: ctx.minBase,
      creditCost: cost.amount,
      badDebt: ctx.badDebt,
      floorPct: ctx.floorPct,
    });
  }

  /** Negotiation-heavy (setting `sales.negotiation_heavy`): rounds per quote of the same customer, newest first. */
  async heavy(db: Tx, leadId: bigint, now = new Date()): Promise<boolean> {
    const rule = await this.settings.value('sales.negotiation_heavy', now);
    return negotiationHeavy(await this.roundsOfCustomer(db, leadId, rule.lastQuotes), rule);
  }

  /** The customer key of a lead: the converted company, else the converted customer, else the lead itself. */
  async customerLeadIds(db: Tx, leadId: bigint): Promise<bigint[]> {
    const lead = await db.salesAgentLead.findUniqueOrThrow({ where: { id: leadId } });
    if (lead.convertedCompanyId || lead.convertedUserId) {
      const same = await db.salesAgentLead.findMany({
        where: lead.convertedCompanyId
          ? { convertedCompanyId: lead.convertedCompanyId }
          : { convertedUserId: lead.convertedUserId },
        select: { id: true },
      });
      return same.map((s) => s.id);
    }
    return [lead.id];
  }

  async roundsOfCustomer(db: Tx, leadId: bigint, lastQuotes: number): Promise<number[]> {
    const leads = await this.customerLeadIds(db, leadId);
    const quotes = await db.salesAgentQuote.findMany({
      where: { leadId: { in: leads } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: lastQuotes,
      select: { _count: { select: { discountRequests: true } } },
    });
    return quotes.map((q) => q._count.discountRequests);
  }

  // --- open ---------------------------------------------------------------------------------------------------------

  /** Every request round opens its approval; an unknown cost leaves it closed (no approval, logged). */
  @OnDomainEvent('sales_agent_discount.requested', { consumer: 'sales.discount_approval_open' })
  async onRequested(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const req = await tx.salesAgentDiscountRequest.findUnique({
      where: { publicId: String(event.payload['requestId']) },
    });
    if (!req || (await tx.salesDiscountApproval.findUnique({ where: { requestId: req.id } }))) return;
    try {
      await this.openInTx(tx, req.id, systemActor('sales.discount_approval_open'));
    } catch (error) {
      if (error instanceof DomainException && error.code === 'discount_approval.cost_unknown') {
        this.logger.warn(`discount approval not opened: cost unknown (request ${req.publicId})`);
        return;
      }
      throw error;
    }
  }

  /** A manager opens the approval of a request by hand (one made before P4, or after a cost became known). */
  async open(actor: UserActor, requestPublicId: string): Promise<ApprovalRow> {
    const id = await this.prisma.withTx(async (tx) => {
      const req = await tx.salesAgentDiscountRequest.findUnique({ where: { publicId: requestPublicId } });
      if (!req) throw new DomainException('http.not_found');
      if (req.status !== 'open') throw new DomainException('agents.discount_request_closed');
      if (await tx.salesDiscountApproval.findUnique({ where: { requestId: req.id } }))
        throw new DomainException('discount_approval.already_open');
      return (await this.openInTx(tx, req.id, actor)).publicId;
    });
    return this.row(id);
  }

  private async openInTx(tx: Tx, requestId: bigint, actor: Actor): Promise<SalesDiscountApproval> {
    const now = new Date();
    const req = await tx.salesAgentDiscountRequest.findUniqueOrThrow({ where: { id: requestId } });
    const aq = await tx.salesAgentQuote.findUniqueOrThrow({ where: { id: req.agentQuoteId } });
    const ctx = await this.context(tx, requestId, now);
    const w = await this.compute(ctx, { discountPct: req.requestedPct.toFixed(4) });
    const heavyCustomer = await this.heavy(tx, aq.leadId, now);
    const { baseLevel, level } = approvalLevel({
      discountPct: req.requestedPct.toFixed(4),
      discountAmount: w.discountAmount,
      grossMarginPct: w.grossMarginPct,
      floorPct: ctx.floorPct,
      authority: await this.settings.value('sales.discount_authority', now),
      negotiationHeavy: heavyCustomer,
    });
    const dueAt = workingHoursDue(
      now,
      Number(await this.settings.value('sales.discount_approval_hours', now)),
      await this.settings.value('calendar.business_hours', now),
    );
    const row = await tx.salesDiscountApproval.create({
      data: {
        requestId,
        agentQuoteId: aq.id,
        quoteId: req.quoteId,
        level,
        baseLevel,
        negotiationHeavy: heavyCustomer,
        requestedPct: req.requestedPct,
        grossMarginPct: w.grossMarginPct,
        floorPct: ctx.floorPct,
        belowFloor: w.floorCheck === 'fail',
        commissionBase: ctx.listRevenue,
        waterfall: w as unknown as Prisma.InputJsonValue,
        snapshot: ctx.snapshot as unknown as Prisma.InputJsonValue,
        snapshotSha256: Uint8Array.from(snapshotSha256(ctx.snapshot)),
        dueAt,
        requestedById: req.createdById,
        createdAt: now,
      },
    });
    // No cost or margin in the event (its readers include notification templates).
    await recordAgentEvent(this, tx, {
      type: 'sales_discount_approval.opened',
      aggregateType: APPROVAL_AGGREGATE,
      aggregateId: row.publicId,
      payload: {
        approvalId: row.publicId,
        requestId: req.publicId,
        level,
        requestedPct: req.requestedPct.toFixed(2),
        negotiationHeavy: heavyCustomer,
        dueAt: dueAt.toISOString(),
      },
      actor,
    });
    return row;
  }

  // --- reads --------------------------------------------------------------------------------------------------------

  async row(publicId: string, db: Tx = this.prisma): Promise<ApprovalRow> {
    const row = await db.salesDiscountApproval.findUnique({ where: { publicId }, include: APPROVAL_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** A rep sees approvals of their own employee agent and those their level may decide; managers all. */
  async visible(actor: UserActor, row: ApprovalRow): Promise<void> {
    const access = await this.resolver.forUser(actor.userId);
    if (
      access.permissions.has('discount_approvals.waterfall_full') ||
      access.permissions.has('discount_approvals.margin_pct')
    )
      return;
    const mine = row.agentQuote.agent.staffUserId === actor.userId;
    const level = deciderLevel(access.roles.map((r) => r.key));
    if (mine || (level !== null && levelRank(level) >= levelRank(row.level))) return;
    throw new DomainException('http.not_found');
  }

  async list(
    actor: UserActor,
    q: { status?: string; level?: string; awaitingMe?: boolean; page: number; perPage: number },
  ) {
    const access = await this.resolver.forUser(actor.userId);
    const wide =
      access.permissions.has('discount_approvals.waterfall_full') ||
      access.permissions.has('discount_approvals.margin_pct');
    const my = deciderLevel(access.roles.map((r) => r.key));
    const decidable: ApprovalLevel[] = my
      ? (['rep', 'sales_manager', 'c_level'] as const).filter((l) => levelRank(l) <= levelRank(my))
      : [];
    const where: Prisma.SalesDiscountApprovalWhereInput = {
      ...(q.status && { status: q.status as SalesDiscountApproval['status'] }),
      ...(q.level && { level: q.level as ApprovalLevel }),
      ...(q.awaitingMe && {
        status: 'pending',
        level: { in: decidable },
        requestedById: { not: actor.userId },
      }),
      ...(!wide && {
        OR: [{ agentQuote: { agent: { staffUserId: actor.userId } } }, { level: { in: decidable } }],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.salesDiscountApproval.findMany({
        where,
        include: APPROVAL_INCLUDE,
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.salesDiscountApproval.count({ where }),
    ]);
    return { rows, total };
  }

  /** The viewer's tier (server-side, from permissions). */
  async tier(actor: UserActor): Promise<WaterfallTier> {
    return tierOf((await this.resolver.forUser(actor.userId)).permissions);
  }

  /** D-470 / D-444: every waterfall shown is logged — who, when, which quote, which tier, why. */
  async logView(
    actor: UserActor,
    row: { id: bigint; quoteId: bigint },
    tier: WaterfallTier,
    purpose: 'view' | 'simulate' | 'export',
  ): Promise<void> {
    await this.prisma.salesWaterfallView.create({
      data: {
        viewerUserId: actor.userId,
        quoteId: row.quoteId,
        approvalId: row.id,
        tier,
        purpose,
        requestId: RequestContext.current()?.requestId ?? null,
      },
    });
  }

  /** The stored waterfall in the viewer's tier, plus one per offered option. */
  async views(row: ApprovalRow, tier: WaterfallTier) {
    const quoteView = serializeWaterfall(row.waterfall as unknown as Waterfall, row.level, tier);
    const options: { optionId: string; kind: string; discountPct: string; waterfall: TieredWaterfall }[] = [];
    if (row.request.options.length > 0) {
      const ctx = await this.prisma.withTx((tx) => this.context(tx, row.requestId));
      for (const o of row.request.options) {
        const w = await this.compute(ctx, {
          discountPct: o.discountPct.toFixed(4),
          ratePct: o.ratePct.toFixed(4),
        });
        options.push({
          optionId: o.publicId,
          kind: o.kind,
          discountPct: o.discountPct.toFixed(2),
          waterfall: serializeWaterfall(w, row.level, tier),
        });
      }
    }
    return { quoteView, options };
  }

  async simulate(actor: UserActor, publicId: string, sim: SimulationInput) {
    const row = await this.row(publicId);
    await this.visible(actor, row);
    const ctx = await this.prisma.withTx((tx) => this.context(tx, row.requestId));
    const w = await this.compute(ctx, sim);
    const { level } = approvalLevel({
      discountPct: sim.discountPct,
      discountAmount: w.discountAmount,
      grossMarginPct: w.grossMarginPct,
      floorPct: ctx.floorPct,
      authority: await this.settings.value('sales.discount_authority', new Date()),
      negotiationHeavy: row.negotiationHeavy,
    });
    const tier = await this.tier(actor);
    await this.logView(actor, row, tier, 'simulate');
    return { level, waterfall: serializeWaterfall(w, level, tier) };
  }

  // --- decide ---------------------------------------------------------------------------------------------------------

  async decide(actor: UserActor, publicId: string, input: DecisionInput): Promise<ApprovalRow> {
    const access = await this.resolver.forUser(actor.userId);
    const roles = access.roles.map((r) => r.key);
    const my = deciderLevel(roles);
    const pre = await this.row(publicId);
    if (pre.status !== 'pending') throw new DomainException('discount_approval.not_pending');
    // A changed deal voids the approval first (committed), then refuses.
    const ctxNow = await this.prisma.withTx((tx) => this.context(tx, pre.requestId));
    if (!snapshotSha256(ctxNow.snapshot).equals(Buffer.from(pre.snapshotSha256))) {
      await this.markStale(pre.id, 'snapshot_changed', actor);
      throw new DomainException('discount_approval.stale');
    }
    await this.prisma.withTx(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM sales_discount_approvals WHERE public_id = ${publicId}::uuid FOR UPDATE`;
      const row = await tx.salesDiscountApproval.findUniqueOrThrow({
        where: { id: locked!.id },
        include: { request: true },
      });
      if (row.status !== 'pending') throw new DomainException('discount_approval.not_pending');
      if (my === null || levelRank(my) < levelRank(row.level))
        throw new DomainException('discount_approval.not_authorised');
      let selfApproved = false;
      if (row.requestedById === actor.userId) {
        // D-449: only a Superadmin under solo-owner mode, with a typed reason, and nobody else could decide.
        const reason = input.selfApprovalReason?.trim() ?? '';
        const role = await tx.role.findUniqueOrThrow({ where: { key: LEVEL_ROLE[row.level] } });
        if (
          !roles.includes('superadmin') ||
          reason.length < TYPED_REASON_MIN_LENGTH ||
          !(await this.soloOwner.isOn(tx)) ||
          (await this.soloOwner.otherApproverExists(tx, actor.userId, {
            approverRoleId: role.id,
            approverScopeId: null,
          }))
        )
          throw new DomainException('discount_approval.self_approval');
        selfApproved = true;
      }
      const now = new Date();
      let status: SalesDiscountApproval['status'];
      let validUntil: Date | null = null;
      if (input.decision === 'approve') {
        const offers = input.options?.length
          ? input.options
          : [{ kind: 'standard' as const, discountPct: '0' }];
        // Every option must stay within the decider's level.
        for (const o of offers) {
          const w = await this.compute(ctxNow, { discountPct: o.discountPct, ratePct: o.ratePct ?? null });
          const { level } = approvalLevel({
            discountPct: o.discountPct,
            discountAmount: w.discountAmount,
            grossMarginPct: w.grossMarginPct,
            floorPct: ctxNow.floorPct,
            authority: await this.settings.value('sales.discount_authority', now),
            negotiationHeavy: row.negotiationHeavy,
          });
          if (levelRank(level) > levelRank(my)) throw new DomainException('discount_approval.not_authorised');
        }
        await this.discounts.offerOptionsInTx(tx, actor, row.request.publicId, offers, input.note);
        const days = Number(await this.settings.value('quotes.discounted_validity_days', now));
        validUntil = new Date(now.getTime() + days * 86_400_000);
        status = 'approved';
        await this.lockPrices(tx, row.id, ctxNow, validUntil, actor);
      } else {
        if (!input.note?.trim())
          throw new DomainException('validation.failed', {
            errors: [{ path: 'note', code: 'required', message: 'why (shown to the agent)' }],
          });
        await tx.salesAgentDiscountRequest.update({
          where: { id: row.requestId },
          data: {
            status: 'rejected',
            decidedAt: now,
            decidedById: actor.userId,
            decisionNote: input.note.trim(),
            rowVersion: { increment: 1 },
          },
        });
        status = input.decision === 'reject' ? 'rejected' : 'countered';
      }
      await tx.salesDiscountApproval.update({
        where: { id: row.id },
        data: {
          status,
          decidedById: actor.userId,
          decidedAt: now,
          decisionNote: input.note?.trim() || null,
          selfApproved,
          selfApprovalReason: selfApproved ? input.selfApprovalReason!.trim() : null,
          counter:
            input.decision === 'counter' ? ((input.counter ?? {}) as Prisma.InputJsonValue) : undefined,
          approvedOptions:
            input.decision === 'approve'
              ? ((input.options ?? []) as unknown as Prisma.InputJsonValue)
              : undefined,
          validUntil,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: selfApproved ? 'sales_discount_approval.self_approved' : 'sales_discount_approval.decided',
        actor,
        resourceType: APPROVAL_AGGREGATE,
        resourcePublicId: row.publicId,
        data: {
          decision: input.decision,
          level: row.level,
          options: (input.options ?? []).map((o) => ({
            kind: o.kind,
            discountPct: o.discountPct,
            ratePct: o.ratePct ?? null,
          })),
          ...(selfApproved && { reason: input.selfApprovalReason!.trim(), mode: 'solo_owner' }),
        },
      });
      const requester = await tx.user.findUniqueOrThrow({
        where: { id: row.requestedById },
        select: { publicId: true, kind: true },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_discount_approval.decided',
        aggregateType: APPROVAL_AGGREGATE,
        aggregateId: row.publicId,
        payload: {
          approvalId: row.publicId,
          decision: input.decision,
          level: row.level,
          selfApproved,
          // Staff requesters (reps) are told through the matrix; agents hear from P3's options_offered.
          requesterId: requester.kind === 'staff' ? requester.publicId : null,
        },
        actor,
      });
    });
    return this.row(publicId);
  }

  /** Big deals (commission base ≥ the deal threshold) lock the factory buy price for the approval's validity. */
  private async lockPrices(
    tx: Tx,
    approvalId: bigint,
    ctx: DealContext,
    validUntil: Date,
    actor: Actor,
  ): Promise<void> {
    const threshold = await this.settings.value('agent.deal_registration_threshold', new Date());
    if (D(ctx.listRevenue).lt(threshold)) return;
    const lock = await tx.salesFactoryPriceLock.create({
      data: {
        approvalId,
        quoteOptionId: ctx.quoteOptionId,
        factoryId: ctx.factoryId,
        priceListVersionId: ctx.priceListVersionId,
        buyPrice: ctx.factoryCost,
        validUntil,
      },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_factory_price_lock.requested',
      aggregateType: 'sales_factory_price_lock',
      aggregateId: lock.publicId,
      payload: { lockId: lock.publicId, validUntil: validUntil.toISOString() },
      actor,
    });
  }

  async markStale(approvalId: bigint, reason: string, actor: Actor): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const { count } = await tx.salesDiscountApproval.updateMany({
        where: { id: approvalId, status: { in: ['pending', 'approved'] } },
        data: { status: 'stale', staleAt: new Date(), staleReason: reason, rowVersion: { increment: 1 } },
      });
      if (count === 0) return;
      const row = await tx.salesDiscountApproval.findUniqueOrThrow({ where: { id: approvalId } });
      await tx.salesFactoryPriceLock.updateMany({
        where: { approvalId, status: { in: ['requested', 'confirmed'] } },
        data: { status: 'released' },
      });
      await recordAgentEvent(this, tx, {
        type: 'discount_approval.stale',
        aggregateType: APPROVAL_AGGREGATE,
        aggregateId: row.publicId,
        payload: { approvalId: row.publicId, reason },
        actor,
      });
    });
  }

  /** A request closed without a decision (quote withdrawn / expired): the pending approval is withdrawn. */
  @OnDomainEvent(['sales_agent_quote.withdrawn', 'quote.expired'], {
    consumer: 'sales.discount_approval_close',
  })
  async onQuoteClosed(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const where: Prisma.SalesDiscountApprovalWhereInput =
      event.type === 'quote.expired'
        ? { quote: { publicId: event.aggregateId }, status: 'pending' }
        : { agentQuote: { publicId: event.aggregateId }, status: 'pending' };
    await tx.salesDiscountApproval.updateMany({
      where,
      data: { status: 'withdrawn', rowVersion: { increment: 1 } },
    });
  }

  // --- SLA ------------------------------------------------------------------------------------------------------------

  /** Overdue pending approvals move up one level once; the next level is told. */
  async escalateDue(now = new Date()): Promise<number> {
    const due = await this.prisma.salesDiscountApproval.findMany({
      where: { status: 'pending', escalatedAt: null, dueAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    let n = 0;
    const hours = Number(await this.settings.value('sales.discount_approval_hours', now));
    const window = await this.settings.value('calendar.business_hours', now);
    for (const { id } of due)
      await this.prisma.withTx(async (tx) => {
        const row = await tx.salesDiscountApproval.findUniqueOrThrow({ where: { id } });
        if (row.status !== 'pending' || row.escalatedAt) return;
        const next = levelAbove(row.level);
        await tx.salesDiscountApproval.update({
          where: { id },
          data: {
            level: next,
            escalatedAt: now,
            dueAt: workingHoursDue(now, hours, window),
            rowVersion: { increment: 1 },
          },
        });
        await recordAgentEvent(this, tx, {
          type: 'sales_discount_approval.escalated',
          aggregateType: APPROVAL_AGGREGATE,
          aggregateId: row.publicId,
          payload: { approvalId: row.publicId, from: row.level, level: next },
          actor: systemActor('sales.discount_approval_sla'),
        });
        n += 1;
      });
    return n;
  }

  /** Assignee resolver: the deciders of the level (opened / escalated), the rep who asked (decided). */
  private async recipients(event: DomainEventEnvelope, tx: Tx): Promise<Recipient[]> {
    if (
      event.type === 'sales_discount_approval.opened' ||
      event.type === 'sales_discount_approval.escalated'
    ) {
      const level = String(event.payload['level']) as ApprovalLevel;
      const role = await tx.role.findUnique({ where: { key: LEVEL_ROLE[level] ?? 'c_level' } });
      return role ? holdersOfRole(tx, role.id, null) : [];
    }
    if (
      event.type === 'sales_discount_approval.decided' &&
      typeof event.payload['requesterId'] === 'string'
    ) {
      const user = await tx.user.findUnique({ where: { publicId: event.payload['requesterId'] } });
      return user && user.status === 'active'
        ? [{ userId: user.id, locale: user.locale, displayName: user.displayName }]
        : [];
    }
    return [];
  }
}
