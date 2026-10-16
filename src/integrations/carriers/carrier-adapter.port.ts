/**
 * getpack-booked carriers, used only as fallback where a factory's own fleet cannot serve a zone
 * (D-013, D-114). One adapter per carrier behind one interface, so carriers are added without changes
 * elsewhere. Credentials come from getpack's carrier account (Secrets Manager reference, D-005); each
 * call receives them, adapters hold no state.
 */
export const CARRIER_ADAPTERS = Symbol('CARRIER_ADAPTERS');

export type FallbackCarrierCode = 'flash_express' | 'deliveree';

export type CarrierCredentials = Record<string, string>;

export interface CarrierCall {
  credentials: CarrierCredentials;
  /** getpack's sandbox account (provider test environment) or production. */
  sandbox: boolean;
}

export interface CarrierPlace {
  postcode: string;
  province?: string | null;
  district?: string | null;
  /** Coordinates, needed by on-demand trucks (Deliveree); unknown at quote time. */
  lat?: number | null;
  lng?: number | null;
}

export interface CarrierContact extends CarrierPlace {
  name: string;
  phone: string;
  addressLine: string;
}

export interface CarrierParcel {
  weightG: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface CarrierQuoteRequest {
  from: CarrierPlace;
  to: CarrierPlace;
  parcels: readonly CarrierParcel[];
}

export interface CarrierQuote {
  /** THB, 2 decimals, as the carrier quotes it (getpack's cost of the fallback delivery). */
  amount: string;
  transitDays: number | null;
}

export interface CarrierBookingRequest {
  /** getpack's reference (shipment number), sent as the carrier's merchant order number. */
  reference: string;
  from: CarrierContact;
  to: CarrierContact;
  parcels: readonly CarrierParcel[];
  pickupAt?: Date | null;
}

export interface CarrierBooking {
  bookingRef: string;
  trackingNo: string | null;
  trackingUrl: string | null;
}

/** Normalised carrier status (mapped to `shipment_status` by logistics, B4.3). */
export type CarrierStatus =
  | 'booked'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'cancelled';

export interface CarrierTrackingEvent {
  occurredAt: Date;
  status: CarrierStatus;
  providerStatus: string;
  message: string | null;
}

export interface CarrierWebhook {
  valid: boolean;
  /** Stable id for idempotent inbox storage (`webhook_inbox.provider_event_id`). */
  eventId: string | null;
  bookingRef: string | null;
  status: CarrierStatus | null;
  providerStatus: string | null;
  /** What the carrier expects back. */
  reply: { status: number; body: unknown };
}

/** The adapter cannot do this (capability or input missing): the caller moves on. */
export class CarrierUnsupportedError extends Error {
  constructor(
    readonly carrier: string,
    message: string,
  ) {
    super(`${carrier}: ${message}`);
    this.name = 'CarrierUnsupportedError';
  }
}

/** The carrier answered but refused the request (validation, not found, already picked up…). */
export class CarrierRejectedError extends Error {
  constructor(
    readonly carrier: string,
    readonly providerCode: string,
    message: string,
  ) {
    super(`${carrier}: ${providerCode} ${message}`);
    this.name = 'CarrierRejectedError';
  }
}

export interface CarrierAdapter {
  readonly code: FallbackCarrierCode;
  quote(call: CarrierCall, request: CarrierQuoteRequest): Promise<CarrierQuote>;
  book(call: CarrierCall, request: CarrierBookingRequest): Promise<CarrierBooking>;
  /** Shipping label PDF. */
  label(call: CarrierCall, bookingRef: string): Promise<Buffer>;
  track(call: CarrierCall, bookingRef: string): Promise<CarrierTrackingEvent[]>;
  cancel(call: CarrierCall, bookingRef: string): Promise<void>;
  /** Verifies and reads an inbound callback (headers lower-cased, body parsed JSON). */
  webhook(credentials: CarrierCredentials, headers: Record<string, string>, body: unknown): CarrierWebhook;
}

export type CarrierAdapters = ReadonlyMap<FallbackCarrierCode, CarrierAdapter>;
