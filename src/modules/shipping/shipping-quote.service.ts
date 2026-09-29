import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CarrierParcel } from '@integrations/carriers/carrier-adapter.port';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { CarriersService } from './carriers/carriers.service';
import { type CartonSpec } from './packing/folding-packing';
import { packPart, type ShipmentPart } from './packing/packer';
import { type PalletSpec, shipment, type ShipmentPack } from './packing/shipment';
import { type RateMissReason } from './rates/customer-rates.dto';
import { type RateResolution, ShippingRatesResolver } from './rates/shipping-rates.resolver';

/**
 * Delivery on a quote (D-013): the shipment is packed once per quantity (packing helper), priced for
 * the customer on the customer rate card (VAT-exclusive, its own line), then costed per candidate
 * factory — the factory's own fleet at its payout card where it serves the zone, otherwise the
 * cheapest enabled fallback carrier (D-114). A factory with neither has no delivery path for the
 * postcode (fail closed). Used by the quote engine (B2.4) and saved quotes (B2.5).
 */
export type { ShipmentPart } from './packing/packer';

export interface PreparedShipment {
  postcode: string | null;
  pack: ShipmentPack;
  parcels: CarrierParcel[];
  customer: RateResolution;
  /** Setting versions used (snapshot, schema-design §2.2); absent keys were not set. */
  settingVersionIds: Record<string, string>;
}

export type Delivery =
  | {
      available: true;
      method: 'factory_fleet' | 'flash_express' | 'deliveree';
      /** Packio's cost of the delivery (payout or carrier quote), THB. */
      cost: MoneyValue;
      factoryPayoutVersionId: bigint | null;
      factoryPayoutVersionPublicId: string | null;
      /** Working days after shipping (zone extra lead days or carrier transit), when known. */
      extraDays: number | null;
    }
  | { available: false; reason: 'payout_missing' | 'no_carrier' };

@Injectable()
export class ShippingQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rates: ShippingRatesResolver,
    private readonly carriers: CarriersService,
  ) {}

  async prepare(
    parts: readonly ShipmentPart[],
    qty: number,
    postcode: string | null,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<PreparedShipment> {
    const settingVersionIds: Record<string, string> = {};
    const carton = await this.optional<CartonSpec>('shipping.carton_spec', at, settingVersionIds);
    const pallet = await this.optional<PalletSpec>('shipping.pallet_spec', at, settingVersionIds);
    const packed = parts.map((p) => packPart(p, qty, carton));
    const pack = shipment(packed, pallet);
    const parcels: CarrierParcel[] = packed.flatMap((p) =>
      p.carton
        ? Array.from({ length: p.carton.count }, () => ({
            weightG: p.carton!.weightKg * 1000,
            lengthCm: p.carton!.lCm,
            widthCm: p.carton!.wCm,
            heightCm: p.carton!.hCm,
          }))
        : [{ weightG: p.weightAllKg * 1000 }],
    );
    const customer = await this.rates.customerRate(
      postcode,
      { weightG: pack.weightG, volumeCm3: pack.volumeCm3 },
      at,
      db,
    );
    return { postcode, pack, parcels, customer, settingVersionIds };
  }

  /** How `factoryId` delivers the prepared shipment and what it costs Packio. */
  async delivery(
    factoryId: bigint,
    prepared: PreparedShipment,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<Delivery> {
    if (!prepared.customer.priced || !prepared.postcode) return { available: false, reason: 'no_carrier' };
    const served = await db.factoryDeliveryZone.findUnique({
      where: { factoryId_zoneId: { factoryId, zoneId: prepared.customer.zoneId } },
    });
    if (served?.serves) {
      const payout = await this.rates.factoryPayout(
        factoryId,
        prepared.postcode,
        { weightG: prepared.pack.weightG, volumeCm3: prepared.pack.volumeCm3 },
        at,
        db,
      );
      if (!payout.priced) return { available: false, reason: 'payout_missing' };
      return {
        available: true,
        method: 'factory_fleet',
        cost: payout.net,
        factoryPayoutVersionId: payout.versionId,
        factoryPayoutVersionPublicId: payout.versionPublicId,
        extraDays: served.extraLeadDays,
      };
    }
    const from = await this.origin(factoryId, db);
    const estimate = from
      ? await this.carriers.estimate({ from, to: prepared.postcode, parcels: prepared.parcels })
      : null;
    if (!estimate) return { available: false, reason: 'no_carrier' };
    return {
      available: true,
      method: estimate.carrier,
      cost: estimate.amount,
      factoryPayoutVersionId: null,
      factoryPayoutVersionPublicId: null,
      extraDays: estimate.transitDays,
    };
  }

  /** VAT on the shipping line, rounded half-up to the satang (line-level, accounting-design §1.5). */
  static vat(net: MoneyValue, ratePct: MoneyValue): MoneyValue {
    return net.mul(ratePct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
  }

  static missReason(customer: RateResolution): RateMissReason | null {
    return customer.priced ? null : customer.reason;
  }

  /** Pickup address first, then the plant, then the registered address (the carrier's collection point). */
  private async origin(factoryId: bigint, db: Tx): Promise<string | null> {
    const addresses = await db.factoryAddress.findMany({ where: { factoryId, postcode: { not: null } } });
    for (const kind of ['pickup', 'plant', 'registered'] as const) {
      const hit = addresses.find((a) => a.kind === kind);
      if (hit?.postcode) return hit.postcode;
    }
    return null;
  }

  private async optional<T>(
    key: 'shipping.carton_spec' | 'shipping.pallet_spec',
    at: Date,
    ids: Record<string, string>,
  ) {
    try {
      const resolved = await this.settings.at(key, { at });
      ids[key] = String(resolved.versionId);
      return resolved.value as T;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }
}
