import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toSkipTake } from '@common/pagination/pagination';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type IndexPoint, Prisma } from '@generated/prisma/client';
import {
  MATERIAL_PRICE_INDEX,
  type MaterialPriceIndexSource,
} from '@integrations/material-price-index/material-price-index.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import {
  type CreateIndexSeriesDto,
  type IndexPointDto,
  type IndexPointsQuery,
  type IndexSeriesDto,
  type IndexSeriesListQuery,
  type SetIndexPointDto,
} from './index-series.dto';

const INCLUDE = {
  materialFamily: { select: { publicId: true } },
  points: { orderBy: { period: 'desc' }, take: 1 },
} satisfies Prisma.IndexSeriesInclude;
type SeriesRow = Prisma.IndexSeriesGetPayload<{ include: typeof INCLUDE }>;

/** `YYYY-MM` ↔ the first day of that month (the `index_points.period` date). */
export const periodDate = (period: string): Date => new Date(`${period}-01T00:00:00.000Z`);
export const periodOf = (date: Date): string => date.toISOString().slice(0, 7);
/** Month of an instant in Asia/Bangkok. */
export const monthOf = (at: Date): string => bangkokDate(at).slice(0, 7);

export const pointDto = (p: IndexPoint): IndexPointDto => ({
  period: periodOf(p.period),
  value: p.value.toFixed(6),
  sourceRef: p.sourceRef,
  updatedAt: toBangkokIso(p.updatedAt),
});

const seriesDto = (s: SeriesRow): IndexSeriesDto => ({
  id: s.publicId,
  code: s.code,
  kind: s.kind,
  materialFamilyId: s.materialFamily?.publicId ?? null,
  nameTh: s.nameTh,
  nameEn: s.nameEn,
  unit: s.unit,
  source: s.source,
  adapterKey: s.adapterKey,
  latestPoint: s.points[0] ? pointDto(s.points[0]) : null,
  createdAt: toBangkokIso(s.createdAt),
});

/**
 * Index series (D-040 groups 1–2): a material price index per material family and cost-driver
 * series (minimum wage, electricity Ft, PPI), one value per month. Maintained by the Partner team;
 * `feed` series are pulled from a material-price-index adapter.
 */
@Injectable()
export class IndexSeriesService {
  private readonly logger = new Logger(IndexSeriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(MATERIAL_PRICE_INDEX) private readonly source: MaterialPriceIndexSource,
  ) {}

  async list(query: IndexSeriesListQuery): Promise<{ rows: IndexSeriesDto[]; total: number }> {
    const where: Prisma.IndexSeriesWhereInput = {
      ...(query.kind && { kind: query.kind }),
      ...(query.q && {
        OR: [
          { code: { contains: query.q, mode: 'insensitive' } },
          { nameTh: { contains: query.q, mode: 'insensitive' } },
          { nameEn: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.indexSeries.findMany({
        where,
        include: INCLUDE,
        orderBy: { code: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.indexSeries.count({ where }),
    ]);
    return { rows: rows.map(seriesDto), total };
  }

  async get(publicId: string): Promise<IndexSeriesDto> {
    const series = await this.prisma.indexSeries.findUnique({ where: { publicId }, include: INCLUDE });
    if (!series) throw new DomainException('http.not_found');
    return seriesDto(series);
  }

  async create(actor: UserActor, input: CreateIndexSeriesDto): Promise<IndexSeriesDto> {
    const source = input.source ?? 'manual';
    const errors: { path: string; code: string; message: string }[] = [];
    if (input.kind === 'material' && !input.materialFamilyId) {
      errors.push({
        path: 'materialFamilyId',
        code: 'required',
        message: 'a material index names its family',
      });
    }
    if (source === 'feed' && !this.source.adapterKeys().includes(input.adapterKey ?? '')) {
      errors.push({ path: 'adapterKey', code: 'unsupported', message: 'no feed adapter with this key' });
    }
    if (source === 'manual' && input.adapterKey) {
      errors.push({ path: 'adapterKey', code: 'forbidden', message: 'manual series have no adapter' });
    }
    const family = input.materialFamilyId
      ? await this.prisma.materialFamily.findUnique({ where: { publicId: input.materialFamilyId } })
      : null;
    if (input.materialFamilyId && !family) {
      errors.push({ path: 'materialFamilyId', code: 'exists', message: 'materialFamilyId does not exist' });
    }
    if (errors.length > 0) throw new DomainException('validation.failed', { errors });
    return this.prisma.withTx(async (tx) => {
      let series;
      try {
        series = await tx.indexSeries.create({
          data: {
            code: input.code,
            kind: input.kind,
            materialFamilyId: family?.id ?? null,
            nameTh: input.nameTh,
            nameEn: input.nameEn,
            unit: input.unit,
            source,
            adapterKey: input.adapterKey ?? null,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include: INCLUDE,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('catalog.code_taken');
        }
        throw error;
      }
      await this.record(tx, series, 'index_series.created', { code: series.code, kind: series.kind, source });
      return seriesDto(series);
    });
  }

  async points(publicId: string, query: IndexPointsQuery): Promise<IndexPointDto[]> {
    const series = await this.prisma.indexSeries.findUnique({ where: { publicId }, select: { id: true } });
    if (!series) throw new DomainException('http.not_found');
    const points = await this.prisma.indexPoint.findMany({
      where: {
        seriesId: series.id,
        period: {
          ...(query.from && { gte: periodDate(query.from) }),
          ...(query.to && { lte: periodDate(query.to) }),
        },
      },
      orderBy: { period: 'asc' },
    });
    return points.map(pointDto);
  }

  /** Records (or corrects) the value of one month; the previous value stays in the audit trail. */
  async setPoint(actor: UserActor, publicId: string, period: string, input: SetIndexPointDto) {
    const series = await this.prisma.indexSeries.findUnique({ where: { publicId }, include: INCLUDE });
    if (!series) throw new DomainException('http.not_found');
    if (Number(input.value) <= 0) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'value', code: 'min', message: 'an index value is greater than 0' }],
      });
    }
    if (period > monthOf(new Date())) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'period', code: 'future', message: 'a month that has not started has no value yet' },
        ],
      });
    }
    return this.prisma.withTx((tx) =>
      this.writePoint(tx, series, period, input.value, input.sourceRef ?? null, actor.userId),
    );
  }

  /** Pulls this and last month for `feed` series whose adapter is available (daily, Asia/Bangkok). */
  @ScheduledJob({ name: 'partners.index-series.pull', cron: '30 6 * * *' })
  async pullFeeds(now: Date = new Date()): Promise<number> {
    const keys = this.source.adapterKeys();
    if (keys.length === 0) return 0;
    const series = await this.prisma.indexSeries.findMany({
      where: { source: 'feed', adapterKey: { in: keys } },
      include: INCLUDE,
    });
    const current = monthOf(now);
    const previous = periodOf(
      new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 2, 1)),
    );
    let written = 0;
    for (const s of series) {
      for (const period of [previous, current]) {
        const exists = await this.prisma.indexPoint.count({
          where: { seriesId: s.id, period: periodDate(period) },
        });
        if (exists > 0) continue;
        try {
          const observation = await this.source.fetch(s.adapterKey!, s.code, `${period}-01`);
          if (!observation) continue;
          await this.prisma.withTx((tx) =>
            this.writePoint(tx, s, period, observation.value, observation.sourceRef, null),
          );
          written++;
        } catch (error) {
          this.logger.warn(
            `index feed ${s.code} ${period}: ${error instanceof Error ? error.message : 'error'}`,
          );
        }
      }
    }
    return written;
  }

  /** Latest value of a series at or before `month` (`YYYY-MM`). */
  async pointAt(seriesId: bigint, month: string, db: Tx = this.prisma): Promise<IndexPoint | null> {
    return db.indexPoint.findFirst({
      where: { seriesId, period: { lte: periodDate(month) } },
      orderBy: { period: 'desc' },
    });
  }

  private async writePoint(
    tx: Tx,
    series: SeriesRow,
    period: string,
    value: string,
    sourceRef: string | null,
    userId: bigint | null,
  ): Promise<IndexPointDto> {
    const previous = await tx.indexPoint.findUnique({
      where: { seriesId_period: { seriesId: series.id, period: periodDate(period) } },
    });
    const point = await tx.indexPoint.upsert({
      where: { seriesId_period: { seriesId: series.id, period: periodDate(period) } },
      create: {
        seriesId: series.id,
        period: periodDate(period),
        value: new Prisma.Decimal(value),
        sourceRef,
        enteredById: userId,
      },
      update: { value: new Prisma.Decimal(value), sourceRef, enteredById: userId },
    });
    await this.record(
      tx,
      series,
      'index_series.point_recorded',
      {
        code: series.code,
        period,
        value: point.value.toFixed(6),
        previous: previous?.value.toFixed(6) ?? null,
      },
      userId === null ? systemActor('index-feed') : undefined,
    );
    return pointDto(point);
  }

  private async record(
    tx: Tx,
    series: { publicId: string },
    type: string,
    data: Record<string, unknown>,
    actor?: ReturnType<typeof systemActor>,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'index_series',
      resourcePublicId: series.publicId,
      data,
      ...(actor && { actor }),
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'index_series',
      aggregateId: series.publicId,
      payload: { seriesId: series.publicId, ...data },
    });
  }
}
