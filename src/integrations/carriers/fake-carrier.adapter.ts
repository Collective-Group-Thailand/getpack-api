import {
  type CarrierAdapter,
  type CarrierBooking,
  type CarrierBookingRequest,
  type CarrierQuote,
  type CarrierQuoteRequest,
  type CarrierTrackingEvent,
  CarrierUnsupportedError,
  type CarrierWebhook,
  type FallbackCarrierCode,
} from './carrier-adapter.port';

/** Header a test sends to make a fake callback valid. */
export const FAKE_CARRIER_SIGNATURE_HEADER = 'x-fake-carrier-signature';
export const FAKE_CARRIER_SIGNATURE = 'valid';

/**
 * In-memory carrier for tests and `pnpm dev` (obviously fake prices: 40 THB + 15 THB per started kg
 * per parcel). Keeps each real carrier's constraints: Flash books one parcel per order; Deliveree
 * needs coordinates and prints no labels.
 */
export class FakeCarrierAdapter implements CarrierAdapter {
  readonly booked = new Map<string, CarrierBookingRequest>();
  readonly cancelled = new Set<string>();
  private sequence = 0;

  constructor(readonly code: FallbackCarrierCode) {}

  quote(_call: unknown, request: CarrierQuoteRequest): Promise<CarrierQuote> {
    if (this.code === 'deliveree' && [request.from, request.to].some((p) => p.lat == null || p.lng == null)) {
      return Promise.reject(
        new CarrierUnsupportedError(this.code, 'coordinates are required for every stop'),
      );
    }
    const amount = request.parcels.reduce((sum, p) => sum + 40 + 15 * Math.ceil(p.weightG / 1000), 0);
    return Promise.resolve({ amount: amount.toFixed(2), transitDays: this.code === 'flash_express' ? 2 : 0 });
  }

  book(_call: unknown, request: CarrierBookingRequest): Promise<CarrierBooking> {
    if (this.code === 'flash_express' && request.parcels.length !== 1) {
      return Promise.reject(new CarrierUnsupportedError(this.code, 'one parcel per order: book each carton'));
    }
    this.sequence += 1;
    const ref = `FAKE-${this.code.toUpperCase()}-${this.sequence}`;
    this.booked.set(ref, request);
    return Promise.resolve({
      bookingRef: ref,
      trackingNo: this.code === 'flash_express' ? ref : null,
      trackingUrl: null,
    });
  }

  label(_call: unknown, bookingRef: string): Promise<Buffer> {
    if (this.code === 'deliveree')
      return Promise.reject(new CarrierUnsupportedError(this.code, 'no shipping labels'));
    return Promise.resolve(Buffer.from(`%PDF-1.4\n% fake label ${bookingRef}\n%%EOF\n`));
  }

  track(_call: unknown, bookingRef: string): Promise<CarrierTrackingEvent[]> {
    const status = this.cancelled.has(bookingRef) ? 'cancelled' : 'booked';
    return Promise.resolve([{ occurredAt: new Date(), status, providerStatus: status, message: null }]);
  }

  cancel(_call: unknown, bookingRef: string): Promise<void> {
    this.cancelled.add(bookingRef);
    return Promise.resolve();
  }

  webhook(_credentials: unknown, headers: Record<string, string>, body: unknown): CarrierWebhook {
    const valid = headers[FAKE_CARRIER_SIGNATURE_HEADER] === FAKE_CARRIER_SIGNATURE;
    const payload = (body ?? {}) as { ref?: string; status?: string; at?: string };
    return {
      valid,
      eventId: payload.ref ? `${payload.ref}:${payload.status ?? ''}:${payload.at ?? ''}` : null,
      bookingRef: payload.ref ?? null,
      status: payload.status === 'delivered' ? 'delivered' : payload.status ? 'in_transit' : null,
      providerStatus: payload.status ?? null,
      reply: valid ? { status: 200, body: { ok: true } } : { status: 401, body: { ok: false } },
    };
  }
}
