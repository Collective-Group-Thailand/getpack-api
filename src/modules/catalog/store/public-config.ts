import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { PAYMENT_METHODS } from '@modules/payments/payments.dto';
import { PaymentsService } from '@modules/payments/payments.service';
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

/** D-447 (C1b): the entity that issues every customer tax invoice (D-010), from its own settings (D-092). */
export class IssuerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'บริษัท ตัวอย่าง จำกัด',
    description: '`entity.legal_name_th` of the default entity; null until set',
  })
  legalNameTh!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Example Co., Ltd.',
    description: '`entity.legal_name_en` of the default entity; null until set',
  })
  legalNameEn!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0000000000000',
    description:
      'D-458 `entity.tax_id` of the default entity (13 digits, shown in full — DECISIONS §3); null until set',
  })
  taxId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '00000',
    description: 'D-458 `entity.branch_code` (00000 = head office); null until set',
  })
  branchCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ที่อยู่ตัวอย่าง',
    description: 'D-458 `entity.address_th`, the registered address printed on documents; null until set',
  })
  addressTh!: string | null;
}

export class RoadmapItemDto {
  @ApiProperty({ example: 'brand_lock', description: 'The feature / module key the storefront has copy for' })
  key!: string;

  @ApiProperty({
    enum: ['live', 'soon', 'in_development'],
    enumName: 'RoadmapStatus',
    example: 'soon',
    description:
      '`live`; `soon` = "เร็ว ๆ นี้" (business features); `in_development` = "กำลังพัฒนา" (factory modules)',
  })
  status!: string;
}

/** D-458: what /business and /partner-with-us say is live — a config, never copy (pack hard rule 5). */
export class RoadmapDto {
  @ApiProperty({ type: [RoadmapItemDto], description: 'Company-account features, in display order' })
  business!: RoadmapItemDto[];

  @ApiProperty({ type: [RoadmapItemDto], description: 'getpack Factory modules, in display order' })
  erpModules!: RoadmapItemDto[];
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

  @ApiProperty({
    type: RoadmapDto,
    description:
      'D-458 `storefront.roadmap` (Admin): empty lists while unset — the pages then show no status chips',
  })
  roadmap!: RoadmapDto;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    isArray: true,
    example: ['bank_transfer_slip'],
    description:
      'D-458 the payment methods anyone can start a payment with now (feature flags, D-176) — instalments excluded ' +
      '(hidden until live, DECISIONS §3); the business page lists these and nothing else',
  })
  paymentMethods!: string[];

  @ApiProperty({
    type: IssuerDto,
    description:
      'D-447: the legal name of the entity that issues customer tax invoices (D-010, D-092 entity settings) — the ' +
      'storefront names the company from here, never from its own copy',
  })
  issuer!: IssuerDto;
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
  roadmap: {
    business: [
      { key: 'team', status: 'live' },
      { key: 'brand_lock', status: 'soon' },
    ],
    erpModules: [
      { key: 'getpack_jobs', status: 'live' },
      { key: 'stock', status: 'in_development' },
    ],
  },
  paymentMethods: ['bank_transfer_slip'],
  issuer: {
    legalNameTh: 'บริษัท ตัวอย่าง จำกัด',
    legalNameEn: 'Example Co., Ltd.',
    taxId: '0000000000000',
    branchCode: '00000',
    addressTh: 'ที่อยู่ตัวอย่าง',
  },
};

@Injectable()
export class PublicConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: StoreCatalogService,
    private readonly payments: PaymentsService,
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
    const [proofDays, hours, replyMinutes, channels, issuer, roadmap, methods] = await Promise.all([
      this.optional('artwork.first_proof_business_days'),
      this.optional('storefront.support_hours'),
      this.optional('support.reply_minutes'),
      this.catalog.supportChannels(),
      this.issuer(),
      this.optional('storefront.roadmap'),
      this.payments.offeredMethods(),
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
      roadmap: {
        business: (roadmap?.business ?? []).map((i) => ({ key: i.key, status: i.status })),
        erpModules: (roadmap?.erpModules ?? []).map((i) => ({ key: i.key, status: i.status })),
      },
      // Instalments stay hidden until live (DECISIONS-STAGE-A §3) whatever their flag says.
      paymentMethods: methods
        .filter((m) => m.available && m.method !== 'card_instalment_2c2p')
        .map((m) => m.method),
      issuer,
    };
  }

  /** D-447: the default entity's legal names (entity-scoped settings, D-092); null each until set. */
  private async issuer(): Promise<IssuerDto> {
    const entity = await this.prisma.entity.findFirst({
      where: { isDefault: true, status: 'active' },
      select: { id: true },
    });
    if (!entity)
      return { legalNameTh: null, legalNameEn: null, taxId: null, branchCode: null, addressTh: null };
    const read = async (
      key:
        | 'entity.legal_name_th'
        | 'entity.legal_name_en'
        | 'entity.tax_id'
        | 'entity.branch_code'
        | 'entity.address_th',
    ): Promise<string | null> => {
      try {
        const value: unknown = (
          await this.settings.at(key as never, { scope: { type: 'entity', id: entity.id } })
        ).value;
        return typeof value === 'string' && value.trim() !== '' ? value : null;
      } catch (error) {
        if (error instanceof SettingNotFoundError) return null;
        throw error;
      }
    };
    const [legalNameTh, legalNameEn, taxId, branchCode, addressTh] = await Promise.all([
      read('entity.legal_name_th'),
      read('entity.legal_name_en'),
      read('entity.tax_id'),
      read('entity.branch_code'),
      read('entity.address_th'),
    ]);
    return { legalNameTh, legalNameEn, taxId, branchCode, addressTh };
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
      'library size, the contacts (D-221), the invoicing entity’s legal name, tax id, branch and registered address ' +
      '(D-447, D-458), what the business and getpack Factory pages say is live (`storefront.roadmap`, D-458) and the ' +
      'payment methods offered now (D-458). Nothing about production partners — no count, coverage or ' +
      'threshold (D-435). Anonymous, cacheable 5 minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-309', 'D-051', 'D-082', 'D-221', 'D-307', 'D-435', 'D-447', 'D-458'],
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
