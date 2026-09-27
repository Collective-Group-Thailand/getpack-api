import { randomUUID } from 'node:crypto';

import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import {
  type QrPayment,
  type QrPaymentRequest,
  redact,
  type ScbConfirmation,
  type ScbGateway,
  str,
} from './payment-gateways.port';

export interface ScbConfig {
  /** e.g. `https://api-sandbox.partners.scb/partners/sandbox`; production host from SCB at go-live. */
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  /** QR 30: Biller ID (15 digits) and the Ref3 prefix of the merchant profile. */
  billerId?: string;
  ref3Prefix?: string;
  /** QR CS merchant. */
  merchantId?: string;
  terminalId?: string;
}

interface Envelope<T> {
  status?: { code?: number; description?: string };
  data?: T;
}

const SUCCESS = 1000;

/**
 * SCB Open API (developer.scb, read 2026-09-27): OAuth token, QR create (`qrType` PP = QR 30, CS = QR CS),
 * payment-confirmation callbacks confirmed by inquiry (the callback carries no signature), billpayment
 * inquiry for QR 30 and the QR CS inquiry. Refunds are not offered by a public API (Finance transfers).
 */
export class ScbAdapter implements ScbGateway {
  private readonly http: ResilientHttp;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: ScbConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.http = new ResilientHttp('scb', fetchImpl);
  }

  async createQr(request: QrPaymentRequest): Promise<QrPayment> {
    const c = this.required();
    const minutes = Math.max(1, Math.round((request.expiresAt.getTime() - Date.now()) / 60_000));
    const body =
      request.kind === 'qr30'
        ? {
            qrType: 'PP',
            ppType: 'BILLERID',
            ppId: c.billerId,
            amount: request.amount,
            ref1: request.reference,
            ref2: 'PACKIO',
            ref3: `${c.ref3Prefix}${request.reference}`.slice(0, 20),
          }
        : {
            qrType: 'CS',
            merchantId: c.merchantId,
            terminalId: c.terminalId,
            invoice: request.reference,
            amount: request.amount,
            csExtExpiryTime: String(minutes),
          };
    const data = await this.post<{ qrRawData?: string; qrImage?: string; qrCodeId?: string | number }>(
      '/v1/payment/qrcode/create',
      body,
    );
    if (!data.qrRawData) throw new ProviderUnavailableError('scb', 'no QR returned');
    return {
      qrRawData: data.qrRawData,
      qrImageBase64: data.qrImage ?? null,
      providerQrId: data.qrCodeId !== undefined ? String(data.qrCodeId) : null,
    };
  }

  async confirm(body: unknown): Promise<{ transactionId: string | null; confirmation: ScbConfirmation | null }> {
    const cb = (body ?? {}) as Record<string, unknown>;
    const transactionId = typeof cb['transactionId'] === 'string' ? cb['transactionId'] : null;
    if (!transactionId) return { transactionId: null, confirmation: null };
    if (typeof cb['billPaymentRef1'] === 'string') {
      const when = new Date(str(cb['transactionDateandTime']));
      const day = Number.isNaN(when.getTime())
        ? new Date().toISOString().slice(0, 10)
        : new Date(when.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
      const params = new URLSearchParams({
        eventCode: '00300100',
        transactionDate: day,
        billerId: this.required().billerId,
        reference1: cb['billPaymentRef1'],
      });
      const found = await this.get<Record<string, unknown>[]>(`/v1/payment/billpayment/inquiry?${params.toString()}`);
      const match = (found ?? []).find((t) => t['transactionId'] === transactionId && t['reverseFlag'] !== 'R');
      if (!match) return { transactionId, confirmation: null };
      return {
        transactionId,
        confirmation: {
          kind: 'qr30',
          transactionId,
          reference: str(match['billPaymentRef1']),
          amount: Number(match['amount']).toFixed(2),
          paidAt: new Date(str(match['transactionDateandTime'])),
          raw: redact(match),
        },
      };
    }
    const qrId = cb['qrId'];
    if (typeof qrId !== 'string' && typeof qrId !== 'number') return { transactionId, confirmation: null };
    const paid = await this.get<Record<string, unknown>>(`/v1/payment/qrcode/creditcard/${String(qrId)}`);
    if (!paid || paid['transactionId'] !== transactionId) return { transactionId, confirmation: null };
    const stamp = str(paid['transactionDateandTime']);
    const m = /^(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
    return {
      transactionId,
      confirmation: {
        kind: 'qr_cs',
        transactionId,
        reference: str(paid['invoice']),
        amount: Number(paid['amount']).toFixed(2),
        // The QR CS inquiry answers in GMT (`yyyyMMdd HH:mm:ss`).
        paidAt: m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : new Date(),
        raw: redact(paid),
      },
    };
  }

  callbackReply(transactionId: string | null): Record<string, string> {
    return { resCode: '00', resDesc: 'success', transactionId: transactionId ?? '' };
  }

  // --- HTTP -----------------------------------------------------------------------------------------

  private required() {
    const { baseUrl, apiKey, apiSecret, billerId, ref3Prefix, merchantId, terminalId } = this.config;
    if (!baseUrl || !apiKey || !apiSecret) throw new ProviderUnavailableError('scb', 'not configured');
    return {
      baseUrl,
      apiKey,
      apiSecret,
      billerId: billerId ?? '',
      ref3Prefix: ref3Prefix ?? '',
      merchantId: merchantId ?? '',
      terminalId: terminalId ?? '',
    };
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      'content-type': 'application/json',
      resourceOwnerId: this.required().apiKey,
      requestUId: randomUUID().replace(/-/g, ''),
      'accept-language': 'EN',
      ...extra,
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const c = this.required();
    const { status, body } = await this.http.call(`${c.baseUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ applicationKey: c.apiKey, applicationSecret: c.apiSecret }),
      timeoutMs: 10_000,
      retries: 1,
    });
    const env = body as Envelope<{ accessToken?: string; expiresIn?: number }> | null;
    if (status >= 300 || env?.status?.code !== SUCCESS || !env.data?.accessToken)
      throw new ProviderUnavailableError('scb', `token HTTP ${status} code ${env?.status?.code ?? '-'}`, status);
    this.token = { value: env.data.accessToken, expiresAt: Date.now() + (env.data.expiresIn ?? 1800) * 1000 };
    return this.token.value;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const { status, body } = await this.http.call(`${this.required().baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ authorization: `Bearer ${await this.accessToken()}` }),
      body: JSON.stringify(payload),
      timeoutMs: 10_000,
    });
    const env = body as Envelope<T> | null;
    if (status >= 300 || env?.status?.code !== SUCCESS || env.data === undefined)
      throw new ProviderUnavailableError('scb', `${path} HTTP ${status} code ${env?.status?.code ?? '-'}`, status);
    return env.data;
  }

  private async get<T>(path: string): Promise<T | null> {
    const { status, body } = await this.http.call(`${this.required().baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers({ authorization: `Bearer ${await this.accessToken()}` }),
      timeoutMs: 10_000,
      retries: 2,
    });
    const env = body as Envelope<T> | null;
    if (status === 404 || env?.status?.code === 1104) return null;
    if (status >= 300 || env?.status?.code !== SUCCESS)
      throw new ProviderUnavailableError('scb', `${path} HTTP ${status} code ${env?.status?.code ?? '-'}`, status);
    return env.data ?? null;
  }
}
