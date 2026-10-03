import { Can } from '@common/auth/can.decorator';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { Matches } from 'class-validator';

export const STUDIO_STEPS = [
  'studio_started',
  'studio_box_confirmed',
  'studio_first_artwork',
  'studio_checks_clean',
  'studio_add_to_cart',
  'studio_ordered',
] as const;

export class StudioFunnelQuery {
  @ApiProperty({ example: '2026-10-01', description: 'First Bangkok day' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Last Bangkok day' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class StudioFunnelStepDto {
  @ApiProperty({ enum: STUDIO_STEPS, enumName: 'StudioFunnelStep', example: 'studio_started' })
  step!: string;

  @ApiProperty({ type: 'integer', example: 420, description: 'Consented sessions that reached it' })
  sessions!: number;

  @ApiProperty({ type: String, nullable: true, example: '42.86', description: '% of the previous step' })
  fromPreviousPct!: string | null;
}

export class StudioMetricDto {
  @ApiProperty({ type: String, nullable: true, example: '8.5', description: 'null without data' })
  value!: string | null;

  @ApiProperty({ example: '10', description: 'Target (setting `studio.funnel_targets`)' })
  target!: string;

  @ApiProperty({ type: Boolean, nullable: true, example: true, description: 'null without data' })
  met!: boolean | null;

  @ApiProperty({ type: 'integer', example: 51, description: 'How many it was measured over' })
  basis!: number;
}

export class StudioFunnelReportDto {
  @ApiProperty({ example: '2026-10-01' })
  from!: string;

  @ApiProperty({ example: '2026-10-31' })
  to!: string;

  @ApiProperty({ type: [StudioFunnelStepDto] })
  steps!: StudioFunnelStepDto[];

  @ApiProperty({
    type: StudioMetricDto,
    description: 'Median minutes from studio start to first add-to-cart',
  })
  medianMinutesToCart!: StudioMetricDto;

  @ApiProperty({ type: StudioMetricDto, description: '% of sessions adding artwork that add to cart' })
  artworkToCartPct!: StudioMetricDto;

  @ApiProperty({ type: StudioMetricDto, description: '% of studio print files passing preflight (no block)' })
  preflightPassPct!: StudioMetricDto;

  @ApiProperty({
    type: StudioMetricDto,
    description: '% of studio orders whose product total equals the studio price',
  })
  priceParityPct!: StudioMetricDto;
}

const EXAMPLE: StudioFunnelReportDto = {
  from: '2026-10-01',
  to: '2026-10-31',
  steps: STUDIO_STEPS.map((step, i) => ({
    step,
    sessions: [420, 300, 204, 150, 51, 40][i]!,
    fromPreviousPct: i === 0 ? null : '71.43',
  })),
  medianMinutesToCart: { value: '8.5', target: '10', met: true, basis: 51 },
  artworkToCartPct: { value: '25.00', target: '25', met: true, basis: 204 },
  preflightPassPct: { value: '92.50', target: '90', met: true, basis: 40 },
  priceParityPct: { value: '100.00', target: '100', met: true, basis: 40 },
};

const pct = (n: number, d: number) => (d === 0 ? null : ((n / d) * 100).toFixed(2));

/**
 * D-286 the studio funnel against the spec §1 targets (`studio.funnel_targets`): consented sessions per step from the
 * product-analytics events (B6 consent rules), the median minutes from start to first add-to-cart, artwork → cart
 * conversion, and — from the studio's own records — the share of print files passing preflight and of studio orders
 * whose product total equals their studio quotation. Aggregates only.
 */
@Injectable()
export class StudioFunnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async report(from: string, to: string): Promise<StudioFunnelReportDto> {
    if (from > to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'range', message: 'to before from' }],
      });
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const targets = (await this.settings.at('studio.funnel_targets', { at: start })).value;
    const steps = await this.prisma.$queryRaw<{ event_name: string; sessions: bigint }[]>`
      SELECT event_name, count(DISTINCT session_id) AS sessions
        FROM analytics.raw_events
       WHERE occurred_at >= ${start} AND occurred_at < ${end} AND session_id IS NOT NULL
         AND event_name = ANY(${[...STUDIO_STEPS]}::text[])
       GROUP BY event_name`;
    const counts = STUDIO_STEPS.map((s) => Number(steps.find((r) => r.event_name === s)?.sessions ?? 0));
    const [median] = await this.prisma.$queryRaw<{ minutes: number | null; n: bigint }[]>`
      WITH s AS (
        SELECT session_id,
               min(occurred_at) FILTER (WHERE event_name = 'studio_started') AS started,
               min(occurred_at) FILTER (WHERE event_name = 'studio_add_to_cart') AS carted
          FROM analytics.raw_events
         WHERE occurred_at >= ${start} AND occurred_at < ${end} AND session_id IS NOT NULL
           AND event_name IN ('studio_started', 'studio_add_to_cart')
         GROUP BY session_id)
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM carted - started) / 60) AS minutes,
             count(*) AS n
        FROM s WHERE started IS NOT NULL AND carted IS NOT NULL AND carted >= started`;
    const [artwork] = await this.prisma.$queryRaw<{ artwork: bigint; carted: bigint }[]>`
      WITH s AS (
        SELECT session_id,
               bool_or(event_name = 'studio_first_artwork') AS artwork,
               bool_or(event_name = 'studio_add_to_cart') AS carted
          FROM analytics.raw_events
         WHERE occurred_at >= ${start} AND occurred_at < ${end} AND session_id IS NOT NULL
           AND event_name IN ('studio_first_artwork', 'studio_add_to_cart')
         GROUP BY session_id)
      SELECT count(*) FILTER (WHERE artwork) AS artwork, count(*) FILTER (WHERE artwork AND carted) AS carted FROM s`;
    const [preflight] = await this.prisma.$queryRaw<{ done: bigint; passed: bigint }[]>`
      SELECT count(*) FILTER (WHERE s.preflight_status IN ('passed', 'passed_with_warnings', 'blocked')) AS done,
             count(*) FILTER (WHERE s.preflight_status IN ('passed', 'passed_with_warnings')) AS passed
        FROM studio_print_jobs j JOIN artwork_submissions s ON s.id = j.submission_id
       WHERE j.created_at >= ${start} AND j.created_at < ${end}`;
    const [parity] = await this.prisma.$queryRaw<{ orders: bigint; equal: bigint }[]>`
      WITH o AS (
        SELECT o.id,
               (SELECT coalesce(sum(l.gross_amount), 0) FROM order_lines l
                 WHERE l.order_id = o.id AND l.line_type <> 'shipping') AS product,
               qo.gross_amount - coalesce(qo.shipping_amount, 0) AS studio
          FROM orders o
          JOIN quotes q ON q.id = o.quote_id AND q.spec_hash IS NOT NULL
          JOIN quote_options qo ON qo.id = o.quote_option_id
         WHERE o.created_at >= ${start} AND o.created_at < ${end})
      SELECT count(*) AS orders, count(*) FILTER (WHERE product = studio) AS equal FROM o`;

    const metric = (value: string | null, target: string, basis: number, higherIsBetter = true) => ({
      value,
      target,
      basis,
      met:
        value === null
          ? null
          : higherIsBetter
            ? Number(value) >= Number(target)
            : Number(value) <= Number(target),
    });
    const minutes = median?.minutes ?? null;
    return {
      from,
      to,
      steps: STUDIO_STEPS.map((step, i) => ({
        step,
        sessions: counts[i]!,
        fromPreviousPct: i === 0 ? null : pct(counts[i]!, counts[i - 1]!),
      })),
      medianMinutesToCart: metric(
        minutes === null ? null : Number(minutes).toFixed(1),
        String(targets.medianMinutesToCart),
        Number(median?.n ?? 0),
        false,
      ),
      artworkToCartPct: metric(
        pct(Number(artwork?.carted ?? 0), Number(artwork?.artwork ?? 0)),
        targets.artworkToCartPct,
        Number(artwork?.artwork ?? 0),
      ),
      preflightPassPct: metric(
        pct(Number(preflight?.passed ?? 0), Number(preflight?.done ?? 0)),
        targets.preflightPassPct,
        Number(preflight?.done ?? 0),
      ),
      priceParityPct: metric(
        pct(Number(parity?.equal ?? 0), Number(parity?.orders ?? 0)),
        targets.priceParityPct,
        Number(parity?.orders ?? 0),
      ),
    };
  }
}

@ApiSurface('admin', 'analytics')
@Controller('analytics')
export class AdminStudioFunnelController {
  constructor(private readonly funnel: StudioFunnelService) {}

  @Get('studio-funnel')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.studioFunnel',
    summary: 'Studio funnel against its targets',
    description:
      'Consented sessions per studio step (started, box confirmed, first artwork, checks clean, added to cart, ' +
      'ordered), the median minutes to first add-to-cart, artwork → cart conversion, the share of studio print files ' +
      'passing preflight and of studio orders charged exactly the studio price — each against the spec §1 target ' +
      '(`studio.funnel_targets`). Aggregates only (D-286).',
    implements: ['D-286'],
  })
  @ApiSuccess(200, { description: 'Report', type: StudioFunnelReportDto, example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  report(@Query() q: StudioFunnelQuery): Promise<StudioFunnelReportDto> {
    return this.funnel.report(q.from, q.to);
  }
}
