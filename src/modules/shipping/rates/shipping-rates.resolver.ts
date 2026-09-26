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

interface ResolvedVersion {
  id: bigint;
  publicId: string;
  versionNo: number;
  schemeId: bigint;
}

/** Approved versions never change (trigger), so their bands are cached by version id. */
const CACHE_LIMIT = 64;

/**
 * Resolves the customer shipping price and a factory's payout for a parcel at an instant (D-013):
 * version in force (`approved`, greatest `effective_from ≤ at`) → zone of the postcode in the version's
 * scheme → matching band (postcode rows first) → amount + per-extra-kg. Used by quoting (B2.4/B2.5).
 */
@Injectable()
export class ShippingRatesResolver {
  private readonly bands = new Map<bigint, RateBand[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly zones: ZoneRefs,
  ) {}

  async customerRate(
    postcode: string | null,
    parcel: Parcel,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<RateResolution> {
    const version = await db.customerShippingRateCardVersion.findFirst({
      where: { card: { key: CUSTOMER_RATE_CARD_KEY }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, publicId: true, versionNo: true, schemeId: true },
    });
    return this.resolve(version, postcode, parcel, db, (id) =>
      db.customerShippingRate.findMany({ where: { versionId: id } }).then((rows) =>
        rows.map((r) => ({
          ...r,
          amount: new MoneyDecimal(r.priceAmount.toString()),
          perExtraKg: dec(r.perExtraKg),
        })),
      ),
    );
  }

  async factoryPayout(
    factoryId: bigint,
    postcode: string | null,
    parcel: Parcel,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<RateResolution> {
    const version = await db.factoryShippingRateCardVersion.findFirst({
      where: { card: { factoryId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, publicId: true, versionNo: true, schemeId: true },
    });
    return this.resolve(version, postcode, parcel, db, (id) =>
      db.factoryShippingRate.findMany({ where: { versionId: id } }).then((rows) =>
        rows.map((r) => ({
          ...r,
          amount: new MoneyDecimal(r.payoutAmount.toString()),
          perExtraKg: dec(r.perExtraKg),
        })),
      ),
    );
  }

  private async resolve(
    version: ResolvedVersion | null,
    postcode: string | null,
    parcel: Parcel,
    db: Tx,
    load: (versionId: bigint) => Promise<RateBand[]>,
  ): Promise<RateResolution> {
    if (!postcode)
      return {
        priced: false,
        reason: 'no_postcode',
        versionId: version?.id ?? null,
        versionPublicId: version?.publicId ?? null,
      };
    if (!version) return { priced: false, reason: 'no_rate_card', versionId: null, versionPublicId: null };
    const zone = await this.zones.zoneOf(version.schemeId, postcode, db);
    if (!zone)
      return {
        priced: false,
        reason: 'zone_unknown',
        versionId: version.id,
        versionPublicId: version.publicId,
      };
    let bands = this.bands.get(version.id);
    if (!bands) {
      bands = await load(version.id);
      if (this.bands.size >= CACHE_LIMIT) this.bands.delete(this.bands.keys().next().value!);
      this.bands.set(version.id, bands);
    }
    const band = matchBand(bands, zone.id, postcode, parcel);
    if (!band)
      return { priced: false, reason: 'no_band', versionId: version.id, versionPublicId: version.publicId };
    return {
      priced: true,
      versionId: version.id,
      versionPublicId: version.publicId,
      versionNo: version.versionNo,
      zoneId: zone.id,
      zonePublicId: zone.publicId,
      zoneCode: zone.code,
      rateId: band.id,
      net: bandAmount(band, parcel.weightG),
    };
  }
}

const dec = (value: { toString(): string } | null): MoneyValue | null =>
  value === null ? null : new MoneyDecimal(value.toString());
