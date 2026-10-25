import { DomainException } from '@common/errors/domain.exception';
import { type CarrierContact } from '@integrations/carriers/carrier-adapter.port';
import { type EntityReturnAddress } from '@platform/settings/setting-keys';

/** The entity settings a carrier booking's sender is made of (D-442). */
export interface GetpackSenderSettings {
  /** `entity.display_name` */
  displayName: string | null;
  /** `entity.phone` */
  phone: string | null;
  /** `entity.return_address` */
  returnAddress: EntityReturnAddress | null;
}

/** The setting keys, in the order the refusal names the missing ones. */
export const SENDER_SETTING_KEYS = ['entity.display_name', 'entity.phone', 'entity.return_address'] as const;

/**
 * D-442: the sender of every carrier booking is getpack — the company display name, phone and return address from
 * the entity settings — never the factory that packed the shipment (its name, contact or address would show on the
 * waybill, the label and the carrier's public tracking page, GLOBAL-RULES §1). A missing setting refuses the
 * booking instead of falling back to anything else.
 */
export function getpackSenderContact(carrier: string, settings: GetpackSenderSettings): CarrierContact {
  const missing = [
    !settings.displayName?.trim() && SENDER_SETTING_KEYS[0],
    !settings.phone?.trim() && SENDER_SETTING_KEYS[1],
    !settings.returnAddress && SENDER_SETTING_KEYS[2],
  ].filter((key): key is (typeof SENDER_SETTING_KEYS)[number] => typeof key === 'string');
  if (missing.length > 0)
    throw new DomainException('shipments.carrier_unavailable', {
      params: { carrier, reason: `the getpack sender is not set (${missing.join(', ')})` },
    });
  const address = settings.returnAddress!;
  return {
    name: settings.displayName!.trim(),
    phone: settings.phone!.trim(),
    addressLine: [address.line1, address.line2, address.subdistrict].filter(Boolean).join(' '),
    postcode: address.postcode,
    province: address.province,
    district: address.district,
    lat: address.lat ?? null,
    lng: address.lng ?? null,
  };
}
