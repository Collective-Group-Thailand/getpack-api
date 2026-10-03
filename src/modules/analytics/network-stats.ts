import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

const DAY_MS = 86_400_000;

/** An audit criterion has the shape of a checklist item (key + Thai / English label). */
export { ArtworkChecklistItemDto as AuditCriterionDto } from '@modules/artwork/artwork.dto';
import { ArtworkChecklistItemDto as AuditCriterionDto } from '@modules/artwork/artwork.dto';

export class CoverageDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องกระดาษพับ' })
  nameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  nameEn!: string;

  @ApiProperty({ example: true, description: 'At least one active partner can make it' })
  available!: boolean;
}

export class NetworkFiguresDto {
  @ApiProperty({
    example: false,
    description:
      'Figures are published only with ≥ `trust.network_min_factories` active factories and ≥ `trust.network_min_jobs` ' +
      'completed jobs in the window (D-201, D-264); otherwise every figure is null',
  })
  published!: boolean;

  @ApiProperty({ example: 3 })
  minFactories!: number;

  @ApiProperty({ example: 30 })
  minJobs!: number;

  @ApiProperty({ example: 90, description: 'Rolling window (days)' })
  windowDays!: number;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Active partner factories' })
  partnerCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Jobs picked up by their promised ship date, whole %',
  })
  onTimePct!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Jobs whose first QC check passed, whole %',
  })
  firstPassPct!: number | null;
}

export class NetworkStatsDto {
  @ApiProperty({
    type: [AuditCriterionDto],
    description: 'How partners are audited (`trust.audit_criteria`)',
  })
  auditCriteria!: AuditCriterionDto[];

  @ApiProperty({ type: [CoverageDto], description: 'Capability coverage by product type (yes / no)' })
  coverage!: CoverageDto[];

  @ApiProperty({ type: NetworkFiguresDto })
  network!: NetworkFiguresDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  generatedAt!: string;
}

const EXAMPLE: NetworkStatsDto = {
  auditCriteria: [
    {
      key: 'site_visit',
      labelTh: 'ผ่านการตรวจเยี่ยมโรงงานโดยทีมพาร์ทเนอร์',
      labelEn: 'Passed a site visit by the Partner team',
    },
  ],
  coverage: [
    {
      productTypeCode: 'folding_carton',
      nameTh: 'กล่องกระดาษพับ',
      nameEn: 'Folding carton',
      available: true,
    },
  ],
  network: {
    published: false,
    minFactories: 3,
    minJobs: 30,
    windowDays: 90,
    partnerCount: null,
    onTimePct: null,
    firstPassPct: null,
  },
  generatedAt: '2026-10-03T10:00:00+07:00',
};

/**
 * Public network statistics (U2.5, D-201, D-264): the audit criteria, capability coverage by product type, and — only
 * above the published minimums — the partner count and on-time / first-pass rates over the rolling window. Aggregates
 * only: never a partner's identity or the factory of an order (D-044, D-050).
 */
@Injectable()
export class NetworkStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async stats(now = new Date()): Promise<NetworkStatsDto> {
    const [minFactories, minJobs, windowDays] = await Promise.all([
      this.settings.at('trust.network_min_factories', { at: now }).then((s) => s.value),
      this.settings.at('trust.network_min_jobs', { at: now }).then((s) => s.value),
      this.settings.at('trust.network_window_days', { at: now }).then((s) => s.value),
    ]);
    let auditCriteria: AuditCriterionDto[] = [];
    try {
      auditCriteria = (await this.settings.at('trust.audit_criteria', { at: now })).value ?? [];
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    const active = { status: 'active' as const, factory: { status: 'active' as const } };
    const types = await this.prisma.productType.findMany({
      where: { status: 'active' },
      select: {
        code: true,
        nameTh: true,
        nameEn: true,
        factoryCapabilities: { where: active, select: { id: true }, take: 1 },
      },
      orderBy: { code: 'asc' },
    });
    const partnerCount = await this.prisma.factory.count({
      where: { status: 'active', capabilities: { some: { status: 'active' } } },
    });
    const from = new Date(now.getTime() - windowDays * DAY_MS);
    const jobs = await this.prisma.productionJob.findMany({
      where: { jobKind: 'production', status: 'completed', actualFinishAt: { gte: from, lte: now } },
      select: { id: true, promisedShipDate: true },
    });
    const published = partnerCount >= minFactories && jobs.length >= minJobs;
    let onTimePct: number | null = null;
    let firstPassPct: number | null = null;
    if (published) {
      const ids = jobs.map((j) => j.id);
      const pickups = await this.prisma.$queryRaw<{ job_id: bigint; first_pickup: Date }[]>`
        SELECT i.production_job_id AS job_id, min(s.picked_up_at) AS first_pickup
          FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id
         WHERE i.production_job_id = ANY(${ids}::bigint[]) AND s.picked_up_at IS NOT NULL
         GROUP BY i.production_job_id`;
      const promised = new Map(jobs.map((j) => [j.id, j.promisedShipDate]));
      const bangkok = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
      const onTime = pickups.filter((p) => {
        const due = promised.get(p.job_id);
        return due ? bangkok(p.first_pickup) <= due.toISOString().slice(0, 10) : false;
      }).length;
      onTimePct = pickups.length ? Math.round((onTime * 100) / pickups.length) : null;
      const firstQcs = await this.prisma.$queryRaw<{ result: string }[]>`
        SELECT DISTINCT ON (q.job_id) q.result::text AS result FROM qc_checks q
         WHERE q.job_id = ANY(${ids}::bigint[]) ORDER BY q.job_id, q.performed_at`;
      firstPassPct = firstQcs.length
        ? Math.round((firstQcs.filter((q) => q.result === 'pass').length * 100) / firstQcs.length)
        : null;
    }
    return {
      auditCriteria,
      coverage: types.map((t) => ({
        productTypeCode: t.code,
        nameTh: t.nameTh,
        nameEn: t.nameEn,
        available: t.factoryCapabilities.length > 0,
      })),
      network: {
        published,
        minFactories,
        minJobs,
        windowDays,
        partnerCount: published ? partnerCount : null,
        onTimePct,
        firstPassPct,
      },
      generatedAt: toBangkokIso(now),
    };
  }
}

@ApiSurface('store', 'network')
@Controller('network')
export class StoreNetworkController {
  constructor(private readonly network: NetworkStatsService) {}

  @Get('stats')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEndpoint({
    id: 'store.network.getStats',
    summary: 'Packio’s partner network in numbers',
    description:
      'How partners are audited, which product types the network can make, and — only with at least ' +
      '`trust.network_min_factories` (3) active factories and `trust.network_min_jobs` (30) jobs completed in the last ' +
      '`trust.network_window_days` (90) days — the partner count and the on-time and first-pass rates rounded to whole ' +
      '%. Aggregates only: never a partner or the factory of an order (D-201, D-264, D-044).',
    implements: ['D-201', 'D-264', 'D-044'],
  })
  @ApiSuccess(200, { description: 'Statistics', type: NetworkStatsDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found')
  stats(): Promise<NetworkStatsDto> {
    return this.network.stats();
  }
}
