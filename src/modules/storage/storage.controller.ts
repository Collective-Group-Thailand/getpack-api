import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';

import {
  STORAGE_ACCOUNT_EXAMPLE,
  STORAGE_CHARGE_EXAMPLE,
  STORAGE_USAGE_EXAMPLE,
  StorageAccountDto,
  StorageAccountListQuery,
  StorageChargeDto,
  StorageUsageDto,
} from './storage.dto';
import { StorageMeteringService, type StorageStatus } from './storage-metering.service';
import { DEFAULT_RECORD_BYTES } from './storage-settings';

const DECISIONS = ['D-436'];

/** Used ÷ allowance in percent with one decimal, from basis points. */
const pct = (basisPoints: number): string => (basisPoints / 100).toFixed(1);

const usedPctOf = (used: bigint, allowance: bigint | null): string | null =>
  allowance === null || allowance === 0n ? null : pct(Number((used * 10000n) / allowance));

export function storageUsageDto(status: StorageStatus, now: Date): StorageUsageDto {
  const policy = status.policy.policy;
  const bytesEach = (type: string): number =>
    policy
      ? Number(policy.recordBytes[type] ?? policy.defaultRecordBytes)
      : ((DEFAULT_RECORD_BYTES as Record<string, number>)[type] ?? DEFAULT_RECORD_BYTES._default);
  const records = Object.entries(status.usage.records)
    .map(([type, count]) => ({ type, count, bytesEach: bytesEach(type) }))
    .sort((a, b) => b.count * b.bytesEach - a.count * a.bytesEach);
  const recordBytes = records.reduce((sum, r) => sum + r.count * r.bytesEach, 0);
  const fileBytes = Number(status.usage.fileBytes);
  return {
    accountType: status.accountType,
    asOf: toBangkokIso(now),
    usedBytes: status.state ? Number(status.state.usedBytes) : fileBytes + recordBytes,
    fileBytes,
    recordBytes,
    records,
    allowanceBytes: status.state ? Number(status.state.allowanceBytes) : null,
    usedPct: status.state ? pct(status.state.usedBasisPoints) : null,
    level: status.state?.level ?? null,
    freeGb: status.policy.freeGb,
    pricePerGbMonth: status.policy.pricePerGbMonth,
    noticeAtPercent: policy?.noticeAtPercent ?? [80, 100],
    packs: (policy?.packs ?? []).map((p) => ({
      key: p.key,
      gb: (Number(p.bytes / 1024n / 1024n) / 1024).toString(),
      monthlyPrice: (Number(p.monthlyPriceSatang) / 100).toFixed(2),
    })),
  };
}

/** A factory's own storage (D-436): usage against the free allowance; nothing is ever deleted or locked. */
@ApiSurface('partner', 'storage')
@Controller('factories/:factoryId/storage')
export class PartnerStorageController {
  constructor(
    private readonly metering: StorageMeteringService,
    private readonly access: FactoryAccess,
  ) {}

  @Get()
  @Can('factory_profile.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.storage.get',
    summary: 'My storage',
    description:
      'What my factory stores in getpack — files it owns at their size and the records of its ERP at a counted size ' +
      'per type — against the free allowance (5 GB per account type, set by the platform admin), with the price ' +
      'per GB-month above it and the packs on offer. Over the allowance nothing is deleted or locked: documents ' +
      'the law requires are always produced and job files always accepted; only optional uploads (images, logos, ' +
      'design assets) wait while overage is not sold (D-436).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Usage', type: StorageUsageDto, example: STORAGE_USAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<StorageUsageDto> {
    const factory = await this.access.factory(actor, factoryId);
    const now = new Date();
    return storageUsageDto(await this.metering.status(factory.id, now), now);
  }
}

/** Every account's storage for the platform admin (D-436), to judge the allowance and the price. */
@ApiSurface('admin', 'storage')
@Controller('storage/accounts')
export class AdminStorageController {
  constructor(
    private readonly metering: StorageMeteringService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Can('settings.read')
  @ApiEndpoint({
    id: 'admin.storage.listAccounts',
    summary: 'Storage of every account',
    description:
      'The latest daily snapshot of each factory account (job at 03:10 Bangkok), largest first: files, records, ' +
      'counted total and the allowance in force that day. The allowance, price per GB-month, packs, counted ' +
      'record sizes and notice thresholds are the `storage.*` settings (D-436).',
    implements: DECISIONS,
  })
  @ApiPaginated(StorageAccountDto, { example: STORAGE_ACCOUNT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: StorageAccountListQuery): Promise<Page<StorageAccountDto>> {
    const { skip, take } = toSkipTake(q);
    const { rows, total } = await this.metering.latest(take, skip);
    return paginated(
      rows.map((r) => ({
        factoryId: r.factoryPublicId,
        factoryCode: r.factoryCode,
        factoryName: r.factoryName,
        day: r.day,
        usedBytes: Number(r.countedBytes),
        fileBytes: Number(r.fileBytes),
        allowanceBytes: r.allowanceBytes === null ? null : Number(r.allowanceBytes),
        usedPct: usedPctOf(r.countedBytes, r.allowanceBytes),
        records: Object.values(r.recordCounts).reduce((sum, n) => sum + Number(n), 0),
      })),
      total,
      q,
    );
  }

  @Get(':factoryId')
  @Can('settings.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.storage.getAccount',
    summary: 'One account’s storage now',
    description: 'A factory’s storage measured now, as its own console shows it (D-436).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Usage', type: StorageUsageDto, example: STORAGE_USAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('factoryId', ParseUUIDPipe) factoryId: string): Promise<StorageUsageDto> {
    const factory = await this.prisma.factory.findUnique({
      where: { publicId: factoryId },
      select: { id: true },
    });
    if (!factory) throw new DomainException('http.not_found');
    const now = new Date();
    return storageUsageDto(await this.metering.status(factory.id, now), now);
  }

  @Get(':factoryId/charges/:month')
  @Can('settings.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'month', example: '2026-10' })
  @ApiEndpoint({
    id: 'admin.storage.monthlyCharge',
    summary: 'A month’s storage charge',
    description:
      'The storage line of an account’s monthly platform invoice (D-436): the daily snapshots above the allowance, ' +
      'averaged over the month and priced per GB-month with the settings in force on its last day (a day without ' +
      'a snapshot counts as the day before, days before the first as nothing stored). 404 when no allowance is set or the month has no snapshot.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The charge', type: StorageChargeDto, example: STORAGE_CHARGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async charge(
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('month') month: string,
  ): Promise<StorageChargeDto> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainException('http.not_found');
    const factory = await this.prisma.factory.findUnique({
      where: { publicId: factoryId },
      select: { id: true },
    });
    if (!factory) throw new DomainException('http.not_found');
    const charge = await this.metering.monthlyCharge(factory.id, month);
    if (!charge) throw new DomainException('http.not_found');
    return {
      month: charge.month,
      days: charge.days,
      overageGbMonths: charge.overageGbMonths,
      overageAmount: charge.overageAmount,
      packsAmount: charge.packsAmount,
      total: charge.total,
    };
  }
}
