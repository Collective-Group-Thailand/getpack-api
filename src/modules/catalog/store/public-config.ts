import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { type SettingKey, type SettingValues } from '@platform/settings/setting-keys';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { StoreCatalogService } from './store-catalog.service';

export class MinOrderQtyDto {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 500,
    description:
      'Lowest minimum quantity among active made-to-order catalogue products (D-307); null without one',
  })
  custom!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Lowest minimum order quantity among active stock products; null without one',
  })
  readyStock!: number | null;
}

export class SupportHoursDto {
  @ApiProperty({ example: 'Asia/Bangkok', description: 'Time zone of `open` and `close`' })
  tz!: string;

  @ApiProperty({
    enum: ['daily', 'business_days', 'mon_fri', 'mon_sat'],
    enumName: 'SupportDays',
    example: 'mon_fri',
    description: '`business_days` = working days of the national calendar (D-161)',
  })
  days!: string;

  @ApiProperty({ example: '09:00', pattern: '^\\d{2}:\\d{2}$' })
  open!: string;

  @ApiProperty({ example: '18:00', pattern: '^\\d{2}:\\d{2}$' })
  close!: string;
}

export class ContactDto {
  @ApiProperty({ type: String, nullable: true, example: '0800000000' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '@getpack-test' })
  lineOaId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'support@example.invalid' })
  email!: string | null;
}

/** D-309: figures the storefront states, each from one source; null where none is agreed. */
export class PublicConfigDto {
  @ApiProperty({ type: MinOrderQtyDto })
  minOrderQty!: MinOrderQtyDto;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description: 'Days a quotation’s price stays locked — `quotes.validity_days` (D-051)',
  })
  priceLockDays!: number;

  @ApiProperty({
    type: 'integer',
    example: 7,
    description: 'Days after receipt a customer may open a claim — `claims.window_days` (D-082)',
  })
  claimWindowDays!: number;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description:
      'Business days from an accepted file to the first proof — `artwork.first_proof_business_days` (Prepress); ' +
      'null until set: omit the sentence',
  })
  proofSlaBusinessDays!: number | null;

  @ApiProperty({
    type: SupportHoursDto,
    nullable: true,
    description: 'CS answering hours — `storefront.support_hours` (CS Lead); null until set',
  })
  supportHours!: SupportHoursDto | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description:
      'Typical CS reply time within support hours — `support.reply_minutes` (CS Lead); null until set',
  })
  supportReplyMinutes!: number | null;

  @ApiProperty({
    type: 'integer',
    example: 42,
    description: 'Published styles in the template library (the count `store.styles.list` shows)',
  })
  templateCount!: number;

  @ApiProperty({ type: ContactDto, description: 'From `storefront.support_channels` (D-221)' })
  contact!: ContactDto;
}

export const PUBLIC_CONFIG_EXAMPLE: PublicConfigDto = {
  minOrderQty: { custom: 500, readyStock: 1 },
  priceLockDays: 15,
  claimWindowDays: 7,
  proofSlaBusinessDays: null,
  supportHours: { tz: 'Asia/Bangkok', days: 'mon_fri', open: '09:00', close: '18:00' },
  supportReplyMinutes: null,
  templateCount: 42,
  contact: { phone: '0800000000', lineOaId: '@getpack-test', email: 'support@example.invalid' },
};

@Injectable()
export class PublicConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: StoreCatalogService,
  ) {}

  async get(): Promise<PublicConfigDto> {
    const [custom, stock, templateCount, priceLock, claimWindow] = await Promise.all([
      this.prisma.catalogProduct.aggregate({
        where: { status: 'active', quantityMin: { not: null }, productType: { status: 'active' } },
        _min: { quantityMin: true },
      }),
      this.prisma.stockProduct.aggregate({ where: { status: 'active' }, _min: { minOrderQty: true } }),
      this.prisma.styleBase.count({
        where: {
          status: 'active',
          hidden: false,
          variants: { some: { publishable: true, status: 'active' } },
        },
      }),
      this.settings.at('quotes.validity_days').then((s) => s.value),
      this.settings.at('claims.window_days').then((s) => s.value),
    ]);
    const [proofDays, hours, replyMinutes, channels] = await Promise.all([
      this.optional('artwork.first_proof_business_days'),
      this.optional('storefront.support_hours'),
      this.optional('support.reply_minutes'),
      this.catalog.supportChannels(),
    ]);
    return {
      minOrderQty: { custom: custom._min.quantityMin ?? null, readyStock: stock._min.minOrderQty ?? null },
      priceLockDays: priceLock,
      claimWindowDays: claimWindow,
      proofSlaBusinessDays: proofDays ?? null,
      supportHours: hours
        ? { tz: 'Asia/Bangkok', days: hours.days, open: hours.open, close: hours.close }
        : null,
      supportReplyMinutes: replyMinutes ?? null,
      templateCount,
      contact: { phone: channels.phone, lineOaId: channels.lineOaId, email: channels.email },
    };
  }

  /** A setting defined without a value (no decision gives one) reads as null. */
  private async optional<K extends SettingKey>(key: K): Promise<SettingValues[K] | null> {
    try {
      return (await this.settings.at(key)).value ?? null;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }
}

/** `/v1/store/public-config`: the policy figures the storefront states (D-309). */
@ApiTags('store.catalog')
@Controller('public-config')
export class StorePublicConfigController {
  constructor(private readonly config: PublicConfigService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.publicConfig.get',
    summary: 'Get the figures the storefront states',
    description:
      'Every figure has one source and is null without one — the storefront then leaves the sentence out, never ' +
      'a number of its own (D-309): minimum quantities from the catalogue (D-307), the price lock ' +
      '(`quotes.validity_days`, D-051), the claim window (`claims.window_days`, D-082), the first-proof ' +
      'turnaround, support hours and reply time (settings kept by Prepress and the CS Lead), the template ' +
      'library size and the contacts (D-221). Nothing about production partners — no count, coverage or ' +
      'threshold (D-435). Anonymous, cacheable 5 minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-309', 'D-051', 'D-082', 'D-221', 'D-307', 'D-435'],
  })
  @ApiSuccess(200, {
    description: 'Storefront figures',
    type: PublicConfigDto,
    example: PUBLIC_CONFIG_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<PublicConfigDto> {
    return this.config.get();
  }
}
