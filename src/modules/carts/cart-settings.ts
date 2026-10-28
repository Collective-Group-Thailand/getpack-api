import { type SettingValues } from '@platform/settings/setting-keys';
import { SettingNotFoundError, type SettingsService } from '@platform/settings/settings.service';

/**
 * D-452 (Stage C block C5): the cart's two effective-dated, audited settings — how many coupon codes a cart may
 * hold (`promotions.max_codes_per_cart`, Marketing) and how many pieces the quantity stepper moves by
 * (`storefront.cart_quantity_step`, Admin). Null when a setting has no version in force.
 */
export interface CartLimits {
  maxCodes: number | null;
  quantityStep: number | null;
}

async function optional<K extends 'promotions.max_codes_per_cart' | 'storefront.cart_quantity_step'>(
  settings: Pick<SettingsService, 'at'>,
  key: K,
  at: Date,
): Promise<SettingValues[K] | null> {
  try {
    return (await settings.at(key, { at })).value;
  } catch (error) {
    if (error instanceof SettingNotFoundError) return null;
    throw error;
  }
}

export async function cartLimits(
  settings: Pick<SettingsService, 'at'>,
  at = new Date(),
): Promise<CartLimits> {
  const [maxCodes, quantityStep] = await Promise.all([
    optional(settings, 'promotions.max_codes_per_cart', at),
    optional(settings, 'storefront.cart_quantity_step', at),
  ]);
  return { maxCodes, quantityStep };
}
