import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { type Waterfall, type WaterfallTier } from './discount-approval-rules';
import { DiscountApprovalsService } from './discount-approvals.service';
import { P4_IDS } from './sales-pipeline.dto';
import { staffActor } from './sales-scope';

/**
 * D-470 item 10: post-deal review — per won deal that went through the approval desk, the approved figures (the
 * accepted option's waterfall) against the actual ones after delivery: invoiced quantity incl. tolerance (D-021),
 * the factory paid for at most the ordered quantity (D-165), shipping charged, refunds (net of VAT) and the
 * commission actually accrued. By approver, agent and customer; percentages only for sales managers.
 */

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const money = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
const pctOf = (v: MoneyValue, net: MoneyValue) =>
  net.gt(0) ? v.mul(100).div(net).toDecimalPlaces(2).toFixed(2) : '0.00';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = ['approver', 'agent', 'customer'] as const;

export interface DealFigures {
  netRevenue: string;
  grossMargin: string;
  grossMarginPct: string;
  contribution: string;
  contributionPct: string;
}

/** The actual figures of a deal's orders (pure). */
export function actualFigures(input: {
  orders: {
    quantityOrdered: number;
    quantityDelivered: number | null;
    productNet: string;
    shippingCharged: string;
    buyCost: string | null;
    refundsGross: string;
    vatPct: string;
    commission: string;
  }[];
  approvedShippingPaid: string;
  creditCost: string;
  badDebt: string;
}): DealFigures {
  let net = D(0);
  let gross = D(0);
  let commission = D(0);
  for (const o of input.orders) {
    const invoiced = o.quantityDelivered ?? o.quantityOrdered;
    const ratio = o.quantityOrdered > 0 ? D(invoiced).div(o.quantityOrdered) : D(1);
    const paidRatio =
      o.quantityOrdered > 0 ? D(Math.min(invoiced, o.quantityOrdered)).div(o.quantityOrdered) : D(1);
    const revenue = D(o.productNet).mul(ratio);
    const refundsNet = D(o.refundsGross).mul(100).div(D(100).add(o.vatPct));
    const cost = D(o.buyCost ?? 0).mul(paidRatio);
    net = net.add(revenue).sub(refundsNet);
    gross = gross.add(revenue).sub(refundsNet).sub(cost).add(o.shippingCharged);
    commission = commission.add(o.commission);
  }
  gross = gross.sub(input.approvedShippingPaid);
  const contribution = gross.sub(commission).sub(input.creditCost).sub(input.badDebt);
  return {
    netRevenue: money(net),
    grossMargin: money(gross),
    grossMarginPct: pctOf(gross, net),
    contribution: money(contribution),
    contributionPct: pctOf(contribution, net),
  };
}

export class PostDealQuery {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Deals decided from this Bangkok day (default 180 days ago)',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-03' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ enum: GROUPS, enumName: 'SalesPostDealGroupBy', default: 'approver' })
  @IsOptional()
  @IsIn(GROUPS)
  groupBy?: (typeof GROUPS)[number];
}

export class PostDealPctFiguresDto {
  @ApiProperty({ enum: ['margin_pct'], enumName: 'SalesWaterfallMarginPctVisibility', example: 'margin_pct' })
  visibility!: string;
  @ApiProperty({ example: '12.40' }) grossMarginPct!: string;
  @ApiProperty({ example: '6.10' }) contributionPct!: string;
}

export class PostDealFullFiguresDto {
  @ApiProperty({ enum: ['full'], enumName: 'SalesWaterfallFullVisibility', example: 'full' })
  visibility!: string;
  @ApiProperty({ example: '1026000.00' }) netRevenue!: string;
  @ApiProperty({ example: '93000.00' }) grossMargin!: string;
  @ApiProperty({ example: '9.06' }) grossMarginPct!: string;
  @ApiProperty({ example: '50821.00', description: 'กำไรหลังหักค่าคอม' }) contribution!: string;
  @ApiProperty({ example: '4.95' }) contributionPct!: string;
}

const FIGURES = {
  oneOf: [{ $ref: getSchemaPath(PostDealPctFiguresDto) }, { $ref: getSchemaPath(PostDealFullFiguresDto) }],
  discriminator: {
    propertyName: 'visibility',
    mapping: {
      margin_pct: getSchemaPath(PostDealPctFiguresDto),
      full: getSchemaPath(PostDealFullFiguresDto),
    },
  },
};

@ApiExtraModels(PostDealPctFiguresDto, PostDealFullFiguresDto)
export class PostDealRowDto {
  @ApiProperty({ format: 'uuid', example: P4_IDS.approval }) approvalId!: string;
  @ApiProperty({ type: String, nullable: true, example: 'QT-2611-00042' }) quoteCode!: string | null;
  @ApiProperty({ example: 'K7QX2MAP', description: 'Agent code' }) agentCode!: string;
  @ApiProperty({ example: 'สมชาย ขายเก่ง' }) agentName!: string;
  @ApiProperty({ type: String, nullable: true, example: 'C-Level ทดสอบ' }) approverName!: string | null;
  @ApiProperty({ example: 'ร้านกาแฟบ้านสวน' }) customerName!: string;
  @ApiProperty({ example: '5.00' }) approvedDiscountPct!: string;
  @ApiProperty({ type: 'integer', example: 1 }) orders!: number;
  @ApiProperty({ ...FIGURES, description: 'At approval (the accepted option)' }) approved!: object;
  @ApiProperty({ ...FIGURES, description: 'After delivery' }) actual!: object;
}

@ApiExtraModels(PostDealPctFiguresDto, PostDealFullFiguresDto)
export class PostDealGroupDto {
  @ApiProperty({ example: 'สมชาย ขายเก่ง' }) key!: string;
  @ApiProperty({ type: 'integer', example: 3 }) deals!: number;
  @ApiProperty({ ...FIGURES }) approved!: object;
  @ApiProperty({ ...FIGURES }) actual!: object;
}

export class PostDealReviewDto {
  @ApiProperty({ format: 'date', example: '2026-05-08' }) from!: string;
  @ApiProperty({ format: 'date', example: '2026-11-03' }) to!: string;
  @ApiProperty({ enum: GROUPS, enumName: 'SalesPostDealGroupBy', example: 'approver' }) groupBy!: string;
  @ApiProperty({ type: [PostDealRowDto] }) deals!: PostDealRowDto[];
  @ApiProperty({ type: [PostDealGroupDto] }) groups!: PostDealGroupDto[];
}

function tiered(f: DealFigures, tier: WaterfallTier) {
  return tier === 'full'
    ? { visibility: 'full', ...f }
    : { visibility: 'margin_pct', grossMarginPct: f.grossMarginPct, contributionPct: f.contributionPct };
}

function sumFigures(list: DealFigures[]): DealFigures {
  const net = list.reduce((a, f) => a.add(f.netRevenue), D(0));
  const gross = list.reduce((a, f) => a.add(f.grossMargin), D(0));
  const contribution = list.reduce((a, f) => a.add(f.contribution), D(0));
  return {
    netRevenue: money(net),
    grossMargin: money(gross),
    grossMarginPct: pctOf(gross, net),
    contribution: money(contribution),
    contributionPct: pctOf(contribution, net),
  };
}

@Injectable()
export class SalesPostDealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: DiscountApprovalsService,
  ) {}

  async review(q: PostDealQuery, tier: WaterfallTier, now = new Date()): Promise<PostDealReviewDto> {
    const to = q.to ?? bangkokDate(now);
    const from = q.from ?? addCalendarDays(to, -179);
    const groupBy = q.groupBy ?? 'approver';
    const rows = await this.prisma.salesDiscountApproval.findMany({
      where: {
        status: 'approved',
        decidedAt: { gte: startOfBangkokDay(from), lt: startOfBangkokDay(addCalendarDays(to, 1)) },
        agentQuote: { lead: { stage: 'won' } },
      },
      include: {
        decidedBy: { select: { displayName: true } },
        quote: { select: { quoteCode: true } },
        agentQuote: {
          include: {
            agent: { select: { id: true, code: true, legalName: true } },
            lead: { select: { contactName: true, organisationName: true } },
          },
        },
        discounted: { select: { quoteId: true, discountPct: true, option: { select: { ratePct: true } } } },
      },
    });
    const deals: (PostDealRowDto & { approvedRaw: DealFigures; actualRaw: DealFigures; groupKey: string })[] =
      [];
    for (const r of rows) {
      const quoteIds = [r.quoteId, ...r.discounted.map((d) => d.quoteId)];
      const orders = await this.prisma.order.findMany({
        where: { quoteId: { in: quoteIds }, status: { not: 'cancelled' } },
        select: {
          id: true,
          quantityOrdered: true,
          quantityDelivered: true,
          netAmount: true,
          discountAmount: true,
          shippingNetAmount: true,
          vatAmount: true,
          buyCostNet: true,
        },
      });
      if (orders.length === 0) continue;
      const accepted = r.discounted[0];
      const ctx = await this.prisma.withTx((tx) => this.approvals.context(tx, r.requestId));
      const approvedW: Waterfall = accepted
        ? await this.approvals.compute(ctx, {
            discountPct: accepted.discountPct.toFixed(4),
            ratePct: accepted.option.ratePct.toFixed(4),
          })
        : (r.waterfall as unknown as Waterfall);
      const approvedFig: DealFigures = {
        netRevenue: approvedW.netRevenue,
        grossMargin: approvedW.grossMargin,
        grossMarginPct: approvedW.grossMarginPct,
        contribution: approvedW.contributionAfterCommission,
        contributionPct: approvedW.contributionPct,
      };
      const refunds = await this.prisma.refund.groupBy({
        by: ['orderId'],
        where: { orderId: { in: orders.map((o) => o.id) }, status: 'succeeded' },
        _sum: { amount: true },
      });
      const commissions = await this.prisma.salesAgentCommission.groupBy({
        by: ['orderId'],
        where: { orderId: { in: orders.map((o) => o.id) }, status: { not: 'cancelled' } },
        _sum: { amount: true },
      });
      const actual = actualFigures({
        orders: orders.map((o) => {
          const net = D(o.netAmount).sub(o.discountAmount);
          return {
            quantityOrdered: o.quantityOrdered,
            quantityDelivered: o.quantityDelivered,
            productNet: net.sub(o.shippingNetAmount).toFixed(2),
            shippingCharged: o.shippingNetAmount.toFixed(2),
            buyCost: o.buyCostNet?.toFixed(2) ?? null,
            refundsGross: (refunds.find((x) => x.orderId === o.id)?._sum.amount ?? D(0)).toString(),
            vatPct: net.gt(0) ? D(o.vatAmount).mul(100).div(net).toDecimalPlaces(2).toFixed(2) : '0',
            commission: (commissions.find((x) => x.orderId === o.id)?._sum.amount ?? D(0)).toString(),
          };
        }),
        approvedShippingPaid: ctx.shippingPaid ?? '0',
        creditCost: approvedW.creditCost,
        badDebt: approvedW.badDebtProvision.amount,
      });
      const customerName = r.agentQuote.lead.organisationName ?? r.agentQuote.lead.contactName;
      const groupKey =
        groupBy === 'approver'
          ? (r.decidedBy?.displayName ?? '—')
          : groupBy === 'agent'
            ? r.agentQuote.agent.legalName
            : customerName;
      deals.push({
        approvalId: r.publicId,
        quoteCode: r.quote.quoteCode,
        agentCode: r.agentQuote.agent.code,
        agentName: r.agentQuote.agent.legalName,
        approverName: r.decidedBy?.displayName ?? null,
        customerName,
        approvedDiscountPct: (accepted?.discountPct ?? r.requestedPct).toFixed(2),
        orders: orders.length,
        approved: tiered(approvedFig, tier),
        actual: tiered(actual, tier),
        approvedRaw: approvedFig,
        actualRaw: actual,
        groupKey,
      });
    }
    const groups = new Map<string, typeof deals>();
    for (const d of deals) groups.set(d.groupKey, [...(groups.get(d.groupKey) ?? []), d]);
    return {
      from,
      to,
      groupBy,
      deals: deals.map(({ approvedRaw: _a, actualRaw: _b, groupKey: _c, ...d }) => d),
      groups: [...groups].map(([key, list]) => ({
        key,
        deals: list.length,
        approved: tiered(sumFigures(list.map((d) => d.approvedRaw)), tier),
        actual: tiered(sumFigures(list.map((d) => d.actualRaw)), tier),
      })),
    };
  }
}

const FULL_FIG = {
  visibility: 'full',
  netRevenue: '1026000.00',
  grossMargin: '93000.00',
  grossMarginPct: '9.06',
  contribution: '50821.00',
  contributionPct: '4.95',
};

@ApiSurface('admin', 'salesPostDeal')
@ApiExtraModels(PostDealPctFiguresDto, PostDealFullFiguresDto)
@Controller('sales/post-deal-review')
export class AdminSalesPostDealController {
  constructor(
    private readonly review: SalesPostDealService,
    private readonly approvals: DiscountApprovalsService,
  ) {}

  @Get()
  @Can('sales_reports.read')
  @ApiEndpoint({
    id: 'admin.salesPostDeal.review',
    summary: 'Review won deals: approved vs actual margin',
    description:
      'Every won deal approved at the desk in the range: the approved gross margin and contribution after commission ' +
      '(the accepted option) against the actual after delivery — invoiced quantity incl. tolerance, the factory ' +
      'paid for at most the ordered quantity, shipping charged, refunds, commission accrued — grouped by approver, ' +
      'agent or customer. Sales managers get percentages only; full amounts with `discount_approvals.waterfall_full` ' +
      '(D-470).',
    implements: ['D-470', 'D-141', 'D-165'],
  })
  @ApiSuccess(200, {
    description: 'Review',
    type: PostDealReviewDto,
    example: {
      from: '2026-05-08',
      to: '2026-11-03',
      groupBy: 'approver',
      deals: [
        {
          approvalId: P4_IDS.approval,
          quoteCode: 'QT-2611-00042',
          agentCode: 'K7QX2MAP',
          agentName: 'สมชาย ขายเก่ง',
          approverName: 'C-Level ทดสอบ',
          customerName: 'ร้านกาแฟบ้านสวน',
          approvedDiscountPct: '5.00',
          orders: 1,
          approved: FULL_FIG,
          actual: { ...FULL_FIG, grossMargin: '90000.00', grossMarginPct: '8.77' },
        },
      ],
      groups: [{ key: 'C-Level ทดสอบ', deals: 1, approved: FULL_FIG, actual: FULL_FIG }],
    },
  })
  @ApiStandardErrors('validation.failed')
  async get(@CurrentActor() actor: Actor, @Query() q: PostDealQuery): Promise<PostDealReviewDto> {
    const tier = await this.approvals.tier(staffActor(actor));
    return this.review.review(q, tier === 'full' ? 'full' : 'margin_pct');
  }
}
