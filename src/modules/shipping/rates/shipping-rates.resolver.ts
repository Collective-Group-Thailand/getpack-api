import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { type RateMissReason } from './customer-rates.dto';
import { CUSTOMER_RATE_CARD_KEY } from './customer-rates.service';
import { bandAmount, matchBand, type Parcel, type RateBand } from './rate-bands';
import { ZoneRefs } from './zone-refs';

export type RateResolution =
  | {
      priced: true;
      versionId: bigint;
      versionPublicId: string;
      versionNo: number;
      zoneId: bigint;
      zonePublicId: string;
      zoneCode: string;
      rateId: bigint;
      /** VAT-exclusive. */
      net: MoneyValue;
    }
  | { priced: false; reason: RateMissReason; versionId: bigint | null; versionPublicId: string | null };

export interface ResolvedVersion {
  id: bigint;
  publicId: string;
  versionNo: number;
  schemeId: bigint;
}

export interface CardAt {
  version: ResolvedVersion;
  bands: RateBand[];
}

/** Approved versions never change (trigger), so their bands are cached by card kind and version id. */
const CACHE_LIMIT = 128;
const VERSION_SELECT = { id: true, publicId: true, versionNo: true, schemeId: true } as const;

const dec = (value: { toString(): string } | null): MoneyValue | null =>
  value === null ? null : new MoneyDecimal(value.toString());

/**
 * Resolves the customer shipping price and a factory's payout for a parcel at an instant (D-013):
 * version in force (`approved`, greatest `effective_from ≤ at`) → zone of the postcode in the version's
 * scheme → matching band (postcode rows first) → amount + per-extra-kg. Used by quoting (B2.4/B2.5).
 */
@Injectable()
export class ShippingRatesResolver {
  private readonly cache = new Map<string, RateBand[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly zones: ZoneRefs,
  ) {}

  /** The customer card in force at `at` with its bands, or null before any approved version. */
  async customerCard(at: Date, db: Tx = this.prisma): Promise<CardAt | null> {
    const version = await db.customerShippingRateCardVersion.findFirst({
      where: { card: { key: CUSTOMER_RATE_CARD_KEY }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: VERSION_SELECT,
    });
    if (!version) return null;
    return {
      version,
      bands: await this.cached(`c:${version.id}`, () =>
        db.customerShippingRate.findMany({ where: { versionId: version.id } }).then((rows) =>
          rows.map((r) => ({
            ...r,
            amount: new MoneyDecimal(r.priceAmount.toString()),
            perExtraKg: dec(r.perExtraKg),
          })),
        ),
      ),
    };
  }

  /** A factory's payout card in force at `at` with its bands, or null before any accepted version. */
  async factoryCard(factoryId: bigint, at: Date, db: Tx = this.prisma): Promise<CardAt | null> {
    const version = await db.factoryShippingRateCardVersion.findFirst({
      where: { card: { factoryId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: VERSION_SELECT,
    });
    if (!version) return null;
    return {
      version,
      bands: await this.cached(`f:${version.id}`, () =>
        db.factoryShippingRate.findMany({ where: { versionId: version.id } }).then((rows) =>
          rows.map((r) => ({
            ...r,
            amount: new MoneyDecimal(r.payoutAmount.toString()),
            perExtraKg: dec(r.perExtraKg),
          })),
        ),
      ),
    };
  }

  async customerRate(
    postcode: string | null,
    parcel: Parcel,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<RateResolution> {
    return this.resolve(await this.customerCard(at, db), postcode, parcel, db);
  }

  async factoryPayout(
    factoryId: bigint,
    postcode: string | null,
    parcel: Parcel,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<RateResolution> {
    return this.resolve(await this.factoryCard(factoryId, at, db), postcode, parcel, db);
  }

  private async resolve(
    card: CardAt | null,
    postcode: string | null,
    parcel: Parcel,
    db: Tx,
  ): Promise<RateResolution> {
    const miss = (reason: RateMissReason): RateResolution => ({
      priced: false,
      reason,
      versionId: card?.version.id ?? null,
      versionPublicId: card?.version.publicId ?? null,
    });
    if (!postcode) return miss('no_postcode');
    if (!card) return miss('no_rate_card');
    const zone = await this.zones.zoneOf(card.version.schemeId, postcode, db);
    if (!zone) return miss('zone_unknown');
    const band = matchBand(card.bands, zone.id, postcode, parcel);
    if (!band) return miss('no_band');
    return {
      priced: true,
      versionId: card.version.id,
      versionPublicId: card.version.publicId,
      versionNo: card.version.versionNo,
      zoneId: zone.id,
      zonePublicId: zone.publicId,
      zoneCode: zone.code,
      rateId: band.id,
      net: bandAmount(band, parcel.weightG),
    };
  }

  private async cached(key: string, load: () => Promise<RateBand[]>): Promise<RateBand[]> {
    let bands = this.cache.get(key);
    if (!bands) {
      bands = await load();
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, bands);
    }
    return bands;
  }
}
