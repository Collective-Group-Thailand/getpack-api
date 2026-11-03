import { Can } from '@common/auth/can.decorator';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { P3_IDS } from '@modules/agents/agents-pipeline.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { IsOptional, IsUUID, Matches } from 'class-validator';

import { negotiationHeavy } from './discount-approval-rules';

/**
 * D-470 item 7: negotiation history per customer (rounds per quote, average approved discount, win / loss, lost
 * reasons, the last competitor named, the "เจรจาราคาสูง" flag) and lost-to-price by product class and quantity band
 * for the pricing team. Percentages only — no cost or margin.
 */

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECISIONS = ['D-470', 'D-468'];

/** Decade bands of the quoted quantity — a reporting convention, not a business value. */
export function quantityBand(quantity: number): string {
  if (quantity < 1000) return 'lt_1k';
  if (quantity < 10_000) return '1k_10k';
  if (quantity < 100_000) return '10k_100k';
  return 'gte_100k';
}
export const QUANTITY_BANDS = ['lt_1k', '1k_10k', '10k_100k', 'gte_100k'] as const;

export class NegotiationHistoryQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'A company (its converted leads)' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'A customer (their converted leads)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'A lead (a prospect not converted yet)' })
  @IsOptional()
  @IsUUID()
  leadId?: string;
}

export class NegotiationQuoteDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.agentQuote }) agentQuoteId!: string;
  @ApiProperty({ type: String, nullable: true, example: 'QT-2611-00042' }) quoteCode!: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-11-01T10:00:00+07:00' }) sentAt!: string;
  @ApiProperty({ type: 'integer', example: 2 }) rounds!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.00',
    description: 'Discount of the option accepted',
  })
  acceptedDiscountPct!: string | null;
  @ApiProperty({
    enum: ['won', 'lost', 'open'],
    enumName: 'SalesNegotiationOutcome',
    example: 'won',
    description: 'From the lead: won (first payment), lost, else open',
  })
  outcome!: string;
}

export class LostReasonCountDto {
  @ApiProperty({
    enum: ['price', 'lead_time', 'no_need', 'competitor', 'no_response', 'other'],
    enumName: 'AgentLeadLostReason',
    example: 'price',
  })
  reason!: string;
  @ApiProperty({ example: 2 }) count!: number;
}

export class LastCompetitorDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' }) namedAt!: string;
  @ApiProperty({ type: String, nullable: true, example: 'ร้านกล่องเจ้าเดิม ราคา 9.80/ใบ' }) notes!:
    string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '9.80',
    description: 'Their price as the agent typed it',
  })
  price!: string | null;
}

export class NegotiationHistoryDto {
  @ApiProperty({ example: true, description: '"เจรจาราคาสูง" — raises the approval level by one' })
  negotiationHeavy!: boolean;
  @ApiProperty({ type: 'integer', example: 2, description: 'sales.negotiation_heavy.minRounds' })
  minRounds!: number;
  @ApiProperty({ type: 'integer', example: 2 }) minQuotes!: number;
  @ApiProperty({ type: 'integer', example: 5 }) lastQuotes!: number;
  @ApiProperty({ type: [NegotiationQuoteDto], description: 'Newest first' }) quotes!: NegotiationQuoteDto[];
  @ApiProperty({ type: String, nullable: true, example: '3.50' }) averageApprovedDiscountPct!: string | null;
  @ApiProperty({ example: 3 }) won!: number;
  @ApiProperty({ example: 1 }) lost!: number;
  @ApiProperty({ type: [LostReasonCountDto] }) lostReasons!: LostReasonCountDto[];
  @ApiProperty({ type: LastCompetitorDto, nullable: true }) lastCompetitor!: LastCompetitorDto | null;
}

export class LostToPriceQuery {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'First Bangkok day (default: 180 days ago)' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-03', description: 'Last Bangkok day, inclusive (default: today)' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export class LostToPriceRowDto {
  @ApiProperty({ example: 'folding_carton', description: 'Product class (product category code)' })
  productClass!: string;
  @ApiProperty({ enum: QUANTITY_BANDS, enumName: 'SalesQuantityBand', example: '1k_10k' })
  quantityBand!: string;
  @ApiProperty({ example: 12, description: 'Leads with a quotation in the cell, closed in the range' })
  closed!: number;
  @ApiProperty({ example: 4, description: 'Lost with reason `price`' }) lostToPrice!: number;
  @ApiProperty({ type: String, nullable: true, example: '33.3' }) lostToPricePct!: string | null;
}

export class LostToPriceDto {
  @ApiProperty({ format: 'date', example: '2026-05-08' }) from!: string;
  @ApiProperty({ format: 'date', example: '2026-11-03' }) to!: string;
  @ApiProperty({ type: [LostToPriceRowDto] }) rows!: LostToPriceRowDto[];
}

@Injectable()
export class SalesNegotiationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async history(q: NegotiationHistoryQuery): Promise<NegotiationHistoryDto> {
    const where: Prisma.SalesAgentLeadWhereInput | null = q.companyId
      ? { convertedCompany: { publicId: q.companyId } }
      : q.customerId
        ? { convertedUser: { publicId: q.customerId } }
        : q.leadId
          ? { publicId: q.leadId }
          : null;
    if (!where)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'companyId', code: 'required', message: 'a company, customer or lead' }],
      });
    const leads = await this.prisma.salesAgentLead.findMany({
      where,
      select: { id: true, stage: true, lostReason: true },
    });
    if (leads.length === 0) throw new DomainException('http.not_found');
    const quotes = await this.prisma.salesAgentQuote.findMany({
      where: { leadId: { in: leads.map((l) => l.id) } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      include: {
        quote: { select: { quoteCode: true } },
        lead: { select: { stage: true } },
        discountRequests: {
          include: { options: { where: { status: 'accepted' } } },
          orderBy: { round: 'asc' },
        },
      },
    });
    const rule = await this.settings.value('sales.negotiation_heavy', new Date());
    const accepted = quotes.flatMap((x) =>
      x.discountRequests.flatMap((r) => r.options.map((o) => D(o.discountPct))),
    );
    const competitor = quotes
      .flatMap((x) => x.discountRequests)
      .filter((r) => r.reason === 'competitor_price' && r.competitorSpec)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const spec = (competitor?.competitorSpec ?? {}) as Record<string, unknown>;
    const reasons = new Map<string, number>();
    for (const l of leads)
      if (l.stage === 'lost' && l.lostReason) reasons.set(l.lostReason, (reasons.get(l.lostReason) ?? 0) + 1);
    return {
      negotiationHeavy: negotiationHeavy(
        quotes.map((x) => x.discountRequests.length),
        rule,
      ),
      ...rule,
      quotes: quotes.map((x) => {
        const option = x.discountRequests.flatMap((r) => r.options)[0];
        return {
          agentQuoteId: x.publicId,
          quoteCode: x.quote.quoteCode,
          sentAt: toBangkokIso(x.sentAt),
          rounds: x.discountRequests.length,
          acceptedDiscountPct: option ? option.discountPct.toFixed(2) : null,
          outcome: x.lead.stage === 'won' ? 'won' : x.lead.stage === 'lost' ? 'lost' : 'open',
        };
      }),
      averageApprovedDiscountPct: accepted.length
        ? accepted
            .reduce((a, v) => a.add(v), D(0))
            .div(accepted.length)
            .toDecimalPlaces(2)
            .toFixed(2)
        : null,
      won: leads.filter((l) => l.stage === 'won').length,
      lost: leads.filter((l) => l.stage === 'lost').length,
      lostReasons: [...reasons].map(([reason, count]) => ({ reason, count })),
      lastCompetitor: competitor
        ? {
            namedAt: toBangkokIso(competitor.createdAt),
            notes: typeof spec['notes'] === 'string' ? spec['notes'] : null,
            price:
              typeof spec['price'] === 'string' || typeof spec['price'] === 'number'
                ? String(spec['price'])
                : null,
          }
        : null,
    };
  }

  async lostToPrice(q: LostToPriceQuery, now = new Date()): Promise<LostToPriceDto> {
    const to = q.to ?? bangkokDate(now);
    const from = q.from ?? addCalendarDays(to, -179);
    const leads = await this.prisma.salesAgentLead.findMany({
      where: {
        stage: { in: ['won', 'lost'] },
        stageChangedAt: { gte: startOfBangkokDay(from), lt: startOfBangkokDay(addCalendarDays(to, 1)) },
      },
      select: {
        stage: true,
        lostReason: true,
        agentQuotes: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            quote: {
              select: {
                productType: { select: { category: { select: { code: true } } } },
                options: { select: { quantity: true }, orderBy: { quantity: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    });
    const cells = new Map<
      string,
      { productClass: string; quantityBand: string; closed: number; lost: number }
    >();
    for (const l of leads) {
      const q0 = l.agentQuotes[0]?.quote;
      if (!q0) continue;
      const productClass = q0.productType.category.code;
      const band = quantityBand(q0.options[0]?.quantity ?? 0);
      const key = `${productClass}|${band}`;
      const cell = cells.get(key) ?? { productClass, quantityBand: band, closed: 0, lost: 0 };
      cell.closed += 1;
      if (l.stage === 'lost' && l.lostReason === 'price') cell.lost += 1;
      cells.set(key, cell);
    }
    return {
      from,
      to,
      rows: [...cells.values()]
        .sort(
          (a, b) =>
            a.productClass.localeCompare(b.productClass) ||
            QUANTITY_BANDS.indexOf(a.quantityBand as 'lt_1k') -
              QUANTITY_BANDS.indexOf(b.quantityBand as 'lt_1k'),
        )
        .map((c) => ({
          productClass: c.productClass,
          quantityBand: c.quantityBand,
          closed: c.closed,
          lostToPrice: c.lost,
          lostToPricePct: c.closed ? ((c.lost * 100) / c.closed).toFixed(1) : null,
        })),
    };
  }
}

const HISTORY_EXAMPLE: NegotiationHistoryDto = {
  negotiationHeavy: true,
  minRounds: 2,
  minQuotes: 2,
  lastQuotes: 5,
  quotes: [
    {
      agentQuoteId: P3_IDS.agentQuote,
      quoteCode: 'QT-2611-00042',
      sentAt: '2026-11-01T10:00:00+07:00',
      rounds: 2,
      acceptedDiscountPct: '3.00',
      outcome: 'open',
    },
  ],
  averageApprovedDiscountPct: '3.50',
  won: 3,
  lost: 1,
  lostReasons: [{ reason: 'price', count: 1 }],
  lastCompetitor: { namedAt: '2026-10-20T10:00:00+07:00', notes: 'ร้านกล่องเจ้าเดิม', price: '9.80' },
};

/** D-470 item 7: negotiation history and lost-to-price for managers and the pricing team. */
@ApiSurface('admin', 'salesNegotiations')
@Controller('sales/negotiations')
export class AdminSalesNegotiationsController {
  constructor(private readonly negotiations: SalesNegotiationsService) {}

  @Get('history')
  @Can('sales_reports.read')
  @ApiEndpoint({
    id: 'admin.salesNegotiations.history',
    summary: 'Read a customer’s negotiation history',
    description:
      'For a company, a customer or a lead: rounds per quote (newest first), the discount of each accepted option ' +
      'and their average, won / lost and lost reasons, the last competitor named, and `negotiationHeavy` — ' +
      '≥ `minRounds` rounds on ≥ `minQuotes` of the last `lastQuotes` quotes (`sales.negotiation_heavy`), which ' +
      'raises the approval level (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'History', type: NegotiationHistoryDto, example: HISTORY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  history(@Query() q: NegotiationHistoryQuery): Promise<NegotiationHistoryDto> {
    return this.negotiations.history(q);
  }

  @Get('lost-to-price')
  @Can('sales_reports.read')
  @ApiEndpoint({
    id: 'admin.salesNegotiations.lostToPrice',
    summary: 'Read lost-to-price by product class and quantity band',
    description:
      'Leads closed (won or lost) in the range, by the product class (category) and the quantity band (< 1k, ' +
      '1k–10k, 10k–100k, ≥ 100k) of their latest quotation: how many were lost with reason `price` — input for ' +
      'the pricing tables (D-470, PLAN §7).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Lost to price',
    type: LostToPriceDto,
    example: {
      from: '2026-05-08',
      to: '2026-11-03',
      rows: [
        {
          productClass: 'folding_carton',
          quantityBand: '1k_10k',
          closed: 12,
          lostToPrice: 4,
          lostToPricePct: '33.3',
        },
      ],
    },
  })
  @ApiStandardErrors('validation.failed')
  lostToPrice(@Query() q: LostToPriceQuery): Promise<LostToPriceDto> {
    return this.negotiations.lostToPrice(q);
  }
}
