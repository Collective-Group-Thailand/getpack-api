import { timingSafeEqual } from 'node:crypto';

import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import {
  type CarrierAdapter,
  type CarrierBooking,
  type CarrierBookingRequest,
  type CarrierCall,
  type CarrierCredentials,
  type CarrierPlace,
  type CarrierQuote,
  type CarrierQuoteRequest,
  CarrierRejectedError,
  type CarrierStatus,
  type CarrierTrackingEvent,
  CarrierUnsupportedError,
  type CarrierWebhook,
} from './carrier-adapter.port';

/**
 * Deliveree public API v10 (https://developers.deliveree.com, read 2026-09-26 for B2.4): on-demand
 * trucks for bulky cartons and pallets (D-114). JSON over HTTPS with the API key in `Authorization`.
 * Pricing needs coordinates for every stop, so it cannot quote from postcodes alone (quotes at
 * configure time skip it; bookings in B4.3 carry the geocoded addresses). Credentials: `apiKey`,
 * `webhookKey` (the key getpack gives Deliveree for callbacks), optional `vehicleTypeId`.
 */
export const DELIVEREE_BASE_URL = {
  sandbox: 'https://api.sandbox.deliveree.com/public_api/v10',
  production: 'https://api.deliveree.com/public_api/v10',
};

const STATUSES: Record<string, CarrierStatus> = {
  locating_driver: 'booked',
  driver_accept_booking: 'booked',
  delivery_in_progress: 'in_transit',
  delivery_complete: 'delivered',
  canceled: 'cancelled',
  locating_driver_timeout: 'failed',
};

interface QuoteRow {
  vehicle_type_id?: number;
  total_fees?: number | string;
}

export class DelivereeAdapter implements CarrierAdapter {
  readonly code = 'deliveree' as const;
  private readonly http: ResilientHttp;

  constructor(fetchImpl?: typeof fetch) {
    this.http = new ResilientHttp('deliveree', fetchImpl);
  }

  async quote(call: CarrierCall, request: CarrierQuoteRequest): Promise<CarrierQuote> {
    const body = await this.request(call, 'POST', '/deliveries/get_quote', {
      time_type: 'now',
      ...(call.credentials['vehicleTypeId']
        ? { vehicle_type_id: Number(call.credentials['vehicleTypeId']) }
        : {}),
      locations: [this.stop(request.from), this.stop(request.to)],
      packs: request.parcels.map((p) => ({
        dimensions: [p.lengthCm ?? 0, p.widthCm ?? 0, p.heightCm ?? 0],
        weight: Math.max(0.001, p.weightG / 1000),
        quantity: 1,
      })),
    });
    // The quote is one object, or a list of vehicle types (with or without a `data` envelope).
    const rows: QuoteRow[] = Array.isArray(body)
      ? (body as QuoteRow[])
      : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: QuoteRow[] }).data
        : [body as QuoteRow];
    const fees = rows.map((r) => Number(r?.total_fees)).filter((n) => Number.isFinite(n) && n > 0);
    if (fees.length === 0)
      throw new ProviderUnavailableError(this.code, 'get_quote answered without total_fees');
    return { amount: Math.min(...fees).toFixed(2), transitDays: 0 };
  }

  async book(call: CarrierCall, request: CarrierBookingRequest): Promise<CarrierBooking> {
    const vehicleTypeId = call.credentials['vehicleTypeId'];
    if (!vehicleTypeId) throw new CarrierUnsupportedError(this.code, 'account has no vehicleTypeId');
    const body = (await this.request(call, 'POST', '/deliveries', {
      vehicle_type_id: Number(vehicleTypeId),
      time_type: request.pickupAt ? 'schedule' : 'now',
      ...(request.pickupAt ? { pickup_time: request.pickupAt.toISOString() } : {}),
      job_order_number: request.reference,
      booking_payment_type: 'credit',
      require_signatures: true,
      locations: [
        {
          ...this.stop(request.from),
          recipient_name: request.from.name,
          recipient_phone: request.from.phone,
          is_payer: true,
        },
        { ...this.stop(request.to), recipient_name: request.to.name, recipient_phone: request.to.phone },
      ],
    })) as { booking_id?: number | string; id?: number | string };
    const id = body?.booking_id ?? body?.id;
    if (id === undefined)
      throw new ProviderUnavailableError(this.code, 'delivery created without booking_id');
    return { bookingRef: String(id), trackingNo: null, trackingUrl: null };
  }

  label(): Promise<Buffer> {
    return Promise.reject(new CarrierUnsupportedError(this.code, 'no shipping labels (the driver collects)'));
  }

  async track(call: CarrierCall, bookingRef: string): Promise<CarrierTrackingEvent[]> {
    const body = (await this.request(
      call,
      'GET',
      `/deliveries/${encodeURIComponent(bookingRef)}`,
      undefined,
      2,
    )) as {
      status?: string;
      completed_at?: string | null;
      updated_at?: string | null;
    };
    if (!body?.status) return [];
    return [
      {
        occurredAt: new Date(body.completed_at ?? body.updated_at ?? Date.now()),
        status: STATUSES[body.status] ?? 'in_transit',
        providerStatus: body.status,
        message: null,
      },
    ];
  }

  async cancel(call: CarrierCall, bookingRef: string): Promise<void> {
    await this.request(call, 'POST', `/deliveries/${encodeURIComponent(bookingRef)}/cancel`, {});
  }

  /** Callbacks carry getpack's webhook key in `Authorization`; Deliveree expects 200, or 401 when refused. */
  webhook(credentials: CarrierCredentials, headers: Record<string, string>, body: unknown): CarrierWebhook {
    const key = credentials['webhookKey'] ?? '';
    const given = headers['authorization'] ?? '';
    const valid =
      key !== '' && given.length === key.length && timingSafeEqual(Buffer.from(given), Buffer.from(key));
    const payload = (body ?? {}) as {
      id?: number | string;
      booking_id?: number | string;
      status?: string;
      updated_at?: string;
    };
    const id = payload.booking_id ?? payload.id;
    return {
      valid,
      eventId: id !== undefined ? `${id}:${payload.status ?? ''}:${payload.updated_at ?? ''}` : null,
      bookingRef: id !== undefined ? String(id) : null,
      status: payload.status ? (STATUSES[payload.status] ?? null) : null,
      providerStatus: payload.status ?? null,
      reply: valid ? { status: 200, body: { received: true } } : { status: 401, body: { received: false } },
    };
  }

  // --- helpers -------------------------------------------------------------------------------------

  private stop(place: CarrierPlace) {
    if (place.lat === null || place.lat === undefined || place.lng === null || place.lng === undefined) {
      throw new CarrierUnsupportedError(this.code, 'coordinates are required for every stop');
    }
    return {
      address: [place.district, place.province, place.postcode].filter(Boolean).join(' '),
      latitude: place.lat,
      longitude: place.lng,
    };
  }

  private async request(
    call: CarrierCall,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
    retries = 0,
  ) {
    const apiKey = call.credentials['apiKey'];
    if (!apiKey) throw new ProviderUnavailableError(this.code, 'account credentials incomplete');
    const base = call.sandbox ? DELIVEREE_BASE_URL.sandbox : DELIVEREE_BASE_URL.production;
    const { status, body } = await this.http.call(`${base}${path}`, {
      method,
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-language': 'en',
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      retries,
      timeoutMs: 8_000,
    });
    if (status >= 400) {
      const message = (body as { message?: string; error?: string } | null)?.message ?? 'refused';
      throw new CarrierRejectedError(this.code, String(status), message);
    }
    return body;
  }
}
