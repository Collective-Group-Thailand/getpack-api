import { type Carton } from './folding-packing';

/**
 * A quote's shipment: every part of a configuration travels together to one address, so the customer
 * rate is looked up once on the summed weight and volume (Packio's rate card is per shipment, D-013;
 * legacy priced each part's cartons with a carrier, `Calculator.php:335-359`).
 */
export interface PalletSpec {
  lengthCm: number;
  widthCm: number;
  maxHeightCm: number;
  maxWeightKg: number;
}

export interface PackedPart {
  weightAllKg: number;
  carton: Carton | null;
}

export interface ShipmentPack {
  /** Σ legacy `weightAllBox` (whole kg per part), in grams — the weight the rate cards are read at. */
  weightG: number;
  /** Null when any part could not be put in cartons (no carton spec). */
  cartons: number | null;
  volumeCm3: number | null;
  /** Null without a pallet spec or when a carton does not fit on the pallet. */
  pallets: number | null;
}

/**
 * Cartons per pallet — no legacy rule exists (legacy has no pallet logic): the better of the two
 * footprint orientations × layers under the height limit, capped by the pallet weight limit.
 */
export function cartonsPerPallet(carton: Carton, pallet: PalletSpec): number {
  const perLayer = Math.max(
    Math.floor(pallet.lengthCm / carton.lCm) * Math.floor(pallet.widthCm / carton.wCm),
    Math.floor(pallet.lengthCm / carton.wCm) * Math.floor(pallet.widthCm / carton.lCm),
  );
  const layers = Math.floor(pallet.maxHeightCm / carton.hCm);
  const byWeight = carton.weightKg > 0 ? Math.floor(pallet.maxWeightKg / carton.weightKg) : Infinity;
  return Math.max(0, Math.min(perLayer * layers, byWeight));
}

export function shipment(parts: readonly PackedPart[], pallet: PalletSpec | null): ShipmentPack {
  const weightG = parts.reduce((sum, p) => sum + p.weightAllKg * 1000, 0);
  const cartons = parts.map((p) => p.carton);
  if (cartons.some((c) => c === null)) return { weightG, cartons: null, volumeCm3: null, pallets: null };
  const packed = cartons as Carton[];
  const perPallet = pallet ? packed.map((c) => cartonsPerPallet(c, pallet)) : [];
  return {
    weightG,
    cartons: packed.reduce((sum, c) => sum + c.count, 0),
    volumeCm3: packed.reduce((sum, c) => sum + c.count * c.wCm * c.lCm * c.hCm, 0),
    // Parts are palletised separately (an upper bound when cartons of several sizes could share one).
    pallets:
      pallet && perPallet.every((n) => n > 0)
        ? packed.reduce((sum, c, i) => sum + Math.ceil(c.count / perPallet[i]!), 0)
        : null,
  };
}
