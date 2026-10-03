import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { IsOptional, Matches } from 'class-validator';

const TOP = 50;

export class NextStylesQuery {
  @ApiPropertyOptional({ example: '2026-10', description: 'Bangkok calendar month, default the current one' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class NextStylesKeywordDto {
  @ApiProperty({ enum: ['catalog', 'styles'], enumName: 'SearchSurface', example: 'styles' })
  surface!: string;

  @ApiProperty({ example: 'กล่องทรงหกเหลี่ยม', description: 'Lower-cased, trimmed' })
  keyword!: string;

  @ApiProperty({ type: 'integer', example: 14 })
  searches!: number;

  @ApiProperty({
    type: 'integer',
    example: 6,
    description: 'Distinct searchers (at least the minimum group size)',
  })
  searchers!: number;
}

export class NextStylesBaseDto {
  @ApiProperty({ example: 'PK-TE-04' })
  baseCode!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบล็อกก้น' })
  nameTh!: string;

  @ApiProperty({ example: 'Crash-lock tuck end' })
  nameEn!: string;

  @ApiProperty({
    type: 'integer',
    example: 9,
    description: 'Calculations refused: the variant is not publishable',
  })
  calculations!: number;
}

export class NextStylesTypeCountDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: 'integer', example: 4 })
  count!: number;
}

export class NextStylesAboveTargetDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 7,
    description:
      'Quotations ended above their target; null below `analytics.target_price_min_group_size` customers (D-190)',
  })
  quotations!: number | null;
}

export class NextStylesStructuralDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  requests!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Of them, published as a style' })
  published!: number;
}

export class NextStylesReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({
    type: 'integer',
    example: 3,
    description:
      'Distinct searchers a keyword needs to be shown (`analytics.prospectus_min_group_size`, D-160)',
  })
  minGroupSize!: number;

  @ApiProperty({ type: 'integer', example: 820, description: 'Style-library searches' })
  styleSearches!: number;

  @ApiProperty({ type: [NextStylesKeywordDto], description: `Zero-result keywords, top ${TOP}` })
  zeroResultSearches!: NextStylesKeywordDto[];

  @ApiProperty({
    type: 'integer',
    example: 37,
    description: 'Zero-result searches of keywords below the group size',
  })
  suppressedZeroResultSearches!: number;

  @ApiProperty({ type: [NextStylesBaseDto], description: `Styles asked for but not publishable, top ${TOP}` })
  unpublishableStyles!: NextStylesBaseDto[];

  @ApiProperty({
    type: [NextStylesTypeCountDto],
    description: 'RFQs naming no style, for product types that have a style library',
  })
  rfqsWithoutStyle!: NextStylesTypeCountDto[];

  @ApiProperty({
    type: [NextStylesAboveTargetDto],
    description: 'Quotations ended above their target (D-252)',
  })
  aboveTarget!: NextStylesAboveTargetDto[];

  @ApiProperty({ type: [NextStylesStructuralDto], description: 'Structural design requests (D-273)' })
  structuralRequests!: NextStylesStructuralDto[];
}

const EXAMPLE: NextStylesReportDto = {
  month: '2026-10',
  minGroupSize: 3,
  styleSearches: 820,
  zeroResultSearches: [{ surface: 'styles', keyword: 'กล่องทรงหกเหลี่ยม', searches: 14, searchers: 6 }],
  suppressedZeroResultSearches: 37,
  unpublishableStyles: [
    { baseCode: 'PK-TE-04', nameTh: 'กล่องฝาเสียบล็อกก้น', nameEn: 'Crash-lock tuck end', calculations: 9 },
  ],
  rfqsWithoutStyle: [{ productTypeCode: 'folding_carton', count: 4 }],
  aboveTarget: [{ productTypeCode: 'folding_carton', quotations: 7 }],
  structuralRequests: [{ productTypeCode: 'folding_carton', requests: 3, published: 1 }],
};

/**
 * D-274 "next styles": the month's demand the style library does not meet — zero-result searches, calculations
 * refused for an unpublishable variant, RFQs naming no style for a type with a library, quotations ended above their
 * target and structural design requests. Aggregates only: a keyword shows with ≥ `analytics.prospectus_min_group_size`
 * distinct searchers (D-160), target figures with ≥ `analytics.target_price_min_group_size` customers (D-190).
 */
@Injectable()
export class NextStylesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async report(month: string = bangkokDate(new Date()).slice(0, 7)): Promise<NextStylesReportDto> {
    const from = startOfBangkokDay(`${month}-01`);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const to = startOfBangkokDay(`${next}-01`);
    const [k, kTarget] = await Promise.all([
      this.settings.at('analytics.prospectus_min_group_size', { at: from }),
      this.settings.at('analytics.target_price_min_group_size', { at: from }),
    ]);

    // A searcher is the signed-in user, else the anonymous session; searches with neither count as one searcher.
    const keywords = await this.prisma.$queryRaw<
      { surface: string; keyword: string; searches: bigint; searchers: bigint }[]
    >`
      SELECT surface::text AS surface, lower(btrim(keyword)) AS keyword, count(*) AS searches,
             count(DISTINCT coalesce('u' || actor_user_id::text, 'a' || anonymous_id, 'none')) AS searchers
        FROM search_logs
       WHERE occurred_at >= ${from} AND occurred_at < ${to} AND results_count = 0 AND btrim(keyword) <> ''
       GROUP BY 1, 2`;
    const shown = keywords
      .filter((r) => Number(r.searchers) >= k.value)
      .sort((a, b) => Number(b.searches) - Number(a.searches) || a.keyword.localeCompare(b.keyword))
      .slice(0, TOP);
    const suppressed = keywords
      .filter((r) => Number(r.searchers) < k.value)
      .reduce((n, r) => n + Number(r.searches), 0);

    const [styleSearches, unpublishable, rfqs, above, structural] = await Promise.all([
      this.prisma.searchLog.count({ where: { surface: 'styles', occurredAt: { gte: from, lt: to } } }),
      this.prisma.unmetDemandRecord.groupBy({
        by: ['styleBaseId'],
        where: {
          source: 'style_not_publishable',
          styleBaseId: { not: null },
          occurredAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ code: string; n: bigint }[]>`
        SELECT pt.code, count(*) AS n
          FROM rfqs r JOIN product_types pt ON pt.id = r.product_type_id
         WHERE r.created_at >= ${from} AND r.created_at < ${to} AND r.style_variant_id IS NULL
           AND EXISTS (SELECT 1 FROM style_bases b WHERE b.product_type_id = r.product_type_id)
         GROUP BY pt.code ORDER BY n DESC, pt.code`,
      this.prisma.$queryRaw<{ code: string; n: bigint; customers: bigint }[]>`
        SELECT pt.code, count(*) AS n, count(DISTINCT u.customer_key) AS customers
          FROM unmet_demand_records u JOIN product_types pt ON pt.id = u.product_type_id
         WHERE u.source = 'price_above_target' AND u.occurred_at >= ${from} AND u.occurred_at < ${to}
         GROUP BY pt.code ORDER BY n DESC, pt.code`,
      this.prisma.$queryRaw<{ code: string; n: bigint; published: bigint }[]>`
        SELECT pt.code, count(*) AS n, count(*) FILTER (WHERE s.status = 'published') AS published
          FROM structural_design_requests s JOIN product_types pt ON pt.id = s.product_type_id
         WHERE s.created_at >= ${from} AND s.created_at < ${to}
         GROUP BY pt.code ORDER BY n DESC, pt.code`,
    ]);
    const bases = await this.prisma.styleBase.findMany({
      where: { id: { in: unpublishable.map((u) => u.styleBaseId!) } },
      select: { id: true, code: true, nameTh: true, nameEn: true },
    });
    const byId = new Map(bases.map((b) => [b.id, b]));

    return {
      month,
      minGroupSize: k.value,
      styleSearches,
      zeroResultSearches: shown.map((r) => ({
        surface: r.surface,
        keyword: r.keyword,
        searches: Number(r.searches),
        searchers: Number(r.searchers),
      })),
      suppressedZeroResultSearches: suppressed,
      unpublishableStyles: unpublishable
        .map((u) => ({ base: byId.get(u.styleBaseId!)!, n: u._count._all }))
        .filter((u) => u.base)
        .sort((a, b) => b.n - a.n || a.base.code.localeCompare(b.base.code))
        .slice(0, TOP)
        .map((u) => ({
          baseCode: u.base.code,
          nameTh: u.base.nameTh,
          nameEn: u.base.nameEn,
          calculations: u.n,
        })),
      rfqsWithoutStyle: rfqs.map((r) => ({ productTypeCode: r.code, count: Number(r.n) })),
      aboveTarget: above.map((r) => ({
        productTypeCode: r.code,
        quotations: Number(r.customers) >= kTarget.value ? Number(r.n) : null,
      })),
      structuralRequests: structural.map((r) => ({
        productTypeCode: r.code,
        requests: Number(r.n),
        published: Number(r.published),
      })),
    };
  }
}

@ApiSurface('admin', 'analytics')
@Controller('analytics')
export class AdminNextStylesController {
  constructor(private readonly nextStyles: NextStylesService) {}

  @Get('next-styles')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.nextStyles',
    summary: 'Next styles to add',
    description:
      'The month’s demand the style library does not meet (D-274): zero-result searches (keywords with at least ' +
      '`analytics.prospectus_min_group_size` distinct searchers, D-160), styles asked for but not publishable, RFQs ' +
      'naming no style for a type with a library, quotations ended above their target (counts only with ' +
      '`analytics.target_price_min_group_size` customers, D-190 / D-252) and structural design requests (D-273). ' +
      'Aggregates only, no customer identity.',
    implements: ['D-274', 'D-160', 'D-190', 'D-252', 'D-273'],
  })
  @ApiSuccess(200, { description: 'Report', type: NextStylesReportDto, example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  report(@Query() query: NextStylesQuery): Promise<NextStylesReportDto> {
    return this.nextStyles.report(query.month);
  }
}
