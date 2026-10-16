import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import {
  type CarrierAdapter,
  type CarrierBooking,
  type CarrierBookingRequest,
  type CarrierCall,
  type CarrierCredentials,
  type CarrierQuote,
  type CarrierQuoteRequest,
  CarrierRejectedError,
  type CarrierStatus,
  type CarrierTrackingEvent,
  CarrierUnsupportedError,
  type CarrierWebhook,
} from './carrier-adapter.port';

/**
 * Flash Express Open API (https://open-docs.flashexpress.com, read 2026-09-26 for B2.4): HTTPS POST,
 * `application/x-www-form-urlencoded`, JSON answers `{ code, message, data }` with `code = 1` on
 * success; every request carries `mchId`, `nonceStr` and `sign`. Credentials: `mchId`, `secretKey`,
 * optional `articleCategory` (default 99 = other). Disabled until getpack's own account exists (D-005).
 */
export const FLASH_BASE_URL = {
  sandbox: 'https://open-api-tra.flashexpress.com',
  production: 'https://open-api.flashexpress.com',
};

const TRACKING_URL = 'https://www.flashexpress.co.th/fle/tracking?se=';

/**
 * Flash's signature: non-empty parameters except `sign` sorted by ASCII name, `k=v` joined with `&`,
 * then `&key=<secret>`; SHA-256, upper-case hex.
 */
export function flashSign(params: Record<string, string>, secretKey: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha256').update(`${base}&key=${secretKey}`, 'utf8').digest('hex').toUpperCase();
}

/** Flash parcel states (`/open/v1/orders/{pno}/routes`, webhook `state`). */
const STATES: Record<number, CarrierStatus> = {
  1: 'picked_up',
  2: 'in_transit',
  3: 'out_for_delivery',
  4: 'in_transit', // detained at a branch
  5: 'delivered',
  6: 'failed', // problem processing
  7: 'returned',
  8: 'failed', // closed as an exception
  9: 'cancelled',
};

interface FlashAnswer {
  code?: number;
  message?: string;
  data?: unknown;
}

export class FlashExpressAdapter implements CarrierAdapter {
  readonly code = 'flash_express' as const;
  private readonly http: ResilientHttp;

  constructor(fetchImpl?: typeof fetch) {
    this.http = new ResilientHttp('flash_express', fetchImpl);
  }

  async quote(call: CarrierCall, request: CarrierQuoteRequest): Promise<CarrierQuote> {
    if (request.parcels.length === 0) throw new CarrierUnsupportedError(this.code, 'no parcel');
    // Flash prices one parcel per order: the shipment costs the sum of its cartons.
    let satang = 0;
    for (const parcel of request.parcels) {
      const data = (await this.post(call, '/open/v1/orders/estimate_rate', {
        srcPostalCode: request.from.postcode,
        srcProvinceName: request.from.province ?? '',
        srcCityName: request.from.district ?? '',
        dstPostalCode: request.to.postcode,
        dstProvinceName: request.to.province ?? '',
        dstCityName: request.to.district ?? '',
        weight: String(Math.max(1, Math.round(parcel.weightG))),
        width: parcel.widthCm ? String(Math.ceil(parcel.widthCm)) : '',
        length: parcel.lengthCm ? String(Math.ceil(parcel.lengthCm)) : '',
        height: parcel.heightCm ? String(Math.ceil(parcel.heightCm)) : '',
      })) as { estimatePrice?: number };
      if (typeof data?.estimatePrice !== 'number') {
        throw new ProviderUnavailableError(this.code, 'estimate_rate answered without estimatePrice');
      }
      satang += data.estimatePrice;
    }
    return { amount: (satang / 100).toFixed(2), transitDays: null };
  }

  async book(call: CarrierCall, request: CarrierBookingRequest): Promise<CarrierBooking> {
    if (request.parcels.length !== 1) {
      throw new CarrierUnsupportedError(this.code, 'one parcel per order: book each carton');
    }
    const parcel = request.parcels[0]!;
    const data = (await this.post(call, '/open/v3/orders', {
      outTradeNo: request.reference,
      expressCategory: '1',
      srcName: request.from.name,
      srcPhone: request.from.phone,
      srcProvinceName: request.from.province ?? '',
      srcCityName: request.from.district ?? '',
      srcPostalCode: request.from.postcode,
      srcDetailAddress: request.from.addressLine,
      dstName: request.to.name,
      dstPhone: request.to.phone,
      dstProvinceName: request.to.province ?? '',
      dstCityName: request.to.district ?? '',
      dstPostalCode: request.to.postcode,
      dstDetailAddress: request.to.addressLine,
      articleCategory: call.credentials['articleCategory'] ?? '99',
      weight: String(Math.max(1, Math.round(parcel.weightG))),
      width: parcel.widthCm ? String(Math.ceil(parcel.widthCm)) : '',
      length: parcel.lengthCm ? String(Math.ceil(parcel.lengthCm)) : '',
      height: parcel.heightCm ? String(Math.ceil(parcel.heightCm)) : '',
      insured: '0',
      codEnabled: '0',
    })) as { pno?: string };
    if (!data?.pno) throw new ProviderUnavailableError(this.code, 'order created without pno');
    return { bookingRef: data.pno, trackingNo: data.pno, trackingUrl: `${TRACKING_URL}${data.pno}` };
  }

  async label(call: CarrierCall, bookingRef: string): Promise<Buffer> {
    const { status, body } = await this.http.call(
      `${this.base(call)}/open/v1/orders/${encodeURIComponent(bookingRef)}/pre_print`,
      { method: 'POST', ...this.form(call, {}), responseType: 'buffer', timeoutMs: 10_000 },
    );
    if (status >= 300 || !Buffer.isBuffer(body)) {
      throw new CarrierRejectedError(this.code, String(status), 'label not available');
    }
    return body;
  }

  async track(call: CarrierCall, bookingRef: string): Promise<CarrierTrackingEvent[]> {
    const data = (await this.post(
      call,
      `/open/v1/orders/${encodeURIComponent(bookingRef)}/routes`,
      {},
      2,
    )) as {
      routes?: { routedAt?: number | string; state?: number; message?: string; routeAction?: string }[];
    };
    return (data?.routes ?? []).map((r) => ({
      occurredAt: typeof r.routedAt === 'number' ? new Date(r.routedAt * 1000) : new Date(String(r.routedAt)),
      status: STATES[r.state ?? 0] ?? 'in_transit',
      providerStatus: `${r.state ?? ''}${r.routeAction ? `:${r.routeAction}` : ''}`,
      message: r.message ?? null,
    }));
  }

  async cancel(call: CarrierCall, bookingRef: string): Promise<void> {
    await this.post(call, `/open/v1/orders/${encodeURIComponent(bookingRef)}/cancel`, {});
  }

  /** Status callbacks are signed over `mchId` and `nonceStr` only; Flash retries unless `errorCode` is 1. */
  webhook(credentials: CarrierCredentials, _headers: Record<string, string>, body: unknown): CarrierWebhook {
    const payload = (body ?? {}) as {
      mchId?: string;
      nonceStr?: string;
      sign?: string;
      data?: {
        pno?: string;
        state?: number;
        stateText?: string;
        updateAt?: number | string;
        stateDate?: number | string;
      };
    };
    const secret = credentials['secretKey'] ?? '';
    const expected =
      payload.mchId && payload.nonceStr && secret
        ? flashSign({ mchId: payload.mchId, nonceStr: payload.nonceStr }, secret)
        : '';
    const given = String(payload.sign ?? '').toUpperCase();
    const valid =
      expected !== '' &&
      payload.mchId === credentials['mchId'] &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    const data = payload.data ?? {};
    const status = data.state !== undefined ? (STATES[data.state] ?? null) : null;
    return {
      valid,
      eventId: data.pno
        ? `${data.pno}:${data.state ?? ''}:${data.updateAt ?? data.stateDate ?? payload.nonceStr ?? ''}`
        : null,
      bookingRef: data.pno ?? null,
      status,
      providerStatus:
        data.state !== undefined ? `${data.state}${data.stateText ? `:${data.stateText}` : ''}` : null,
      reply: valid
        ? { status: 200, body: { errorCode: '1', state: 'success' } }
        : { status: 401, body: { errorCode: '0' } },
    };
  }

  // --- helpers -------------------------------------------------------------------------------------

  private base(call: CarrierCall): string {
    return call.sandbox ? FLASH_BASE_URL.sandbox : FLASH_BASE_URL.production;
  }

  private form(call: CarrierCall, params: Record<string, string>) {
    const mchId = call.credentials['mchId'];
    const secretKey = call.credentials['secretKey'];
    if (!mchId || !secretKey) throw new ProviderUnavailableError(this.code, 'account credentials incomplete');
    const signed: Record<string, string> = { ...params, mchId, nonceStr: randomNonce() };
    for (const key of Object.keys(signed)) if (signed[key] === '') delete signed[key];
    signed['sign'] = flashSign(signed, secretKey);
    return {
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(signed),
    };
  }

  private async post(
    call: CarrierCall,
    path: string,
    params: Record<string, string>,
    retries = 0,
  ): Promise<unknown> {
    const { status, body } = await this.http.call(`${this.base(call)}${path}`, {
      method: 'POST',
      ...this.form(call, params),
      retries,
      timeoutMs: 5_000,
    });
    const answer = (body ?? {}) as FlashAnswer;
    if (status >= 400 || answer.code !== 1) {
      throw new CarrierRejectedError(this.code, String(answer.code ?? status), answer.message ?? 'refused');
    }
    return answer.data;
  }
}

function randomNonce(): string {
  return randomBytes(12).toString('hex');
}
