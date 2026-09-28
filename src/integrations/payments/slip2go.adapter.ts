import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import { redact, type SlipCheck, type SlipCheckRequest, type SlipVerifier } from './payment-gateways.port';

export interface Slip2GoConfig {
  /** The API host given in the Slip2Go dashboard. */
  apiUrl?: string;
  secretKey?: string;
}

interface Slip2GoResponse {
  code?: string;
  message?: string;
  data?: {
    referenceId?: string;
    transRef?: string;
    dateTime?: string;
    amount?: number | string;
  };
}

/**
 * Slip2Go (slip2go.com, read 2026-09-27): `POST /api/verify-slip/qr-image/info` (multipart `file` +
 * `payload` conditions) with `checkDuplicate`, `checkReceiver`, `checkAmount` and `checkDate`; the result
 * code tells which condition failed. `GET /api/verify-slip/{referenceId}` re-reads a past result.
 */
export class Slip2GoAdapter implements SlipVerifier {
  readonly name = 'slip2go';
  private readonly http: ResilientHttp;

  constructor(
    private readonly config: Slip2GoConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.http = new ResilientHttp('slip2go', fetchImpl);
  }

  async verify(request: SlipCheckRequest): Promise<SlipCheck> {
    const { apiUrl, secretKey } = this.required();
    const conditions = {
      checkDuplicate: true,
      ...(request.receivers.length > 0 && { checkReceiver: request.receivers }),
      checkAmount: { type: 'eq', amount: request.amount },
      checkDate: { type: 'gte', date: request.transferredAfter.toISOString() },
    };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(request.file)], { type: request.mime }), request.fileName);
    form.append('payload', JSON.stringify(conditions));
    const { status, body } = await this.http.call(`${apiUrl}/api/verify-slip/qr-image/info`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secretKey}` },
      body: form,
      timeoutMs: 20_000,
    });
    if (status >= 500 && !(body as Slip2GoResponse | null)?.code)
      throw new ProviderUnavailableError('slip2go', `HTTP ${status}`, status);
    return checkOf(body ?? {}, request.receivers.length > 0);
  }

  async fetch(referenceId: string): Promise<SlipCheck> {
    const { apiUrl, secretKey } = this.required();
    const { status, body } = await this.http.call(
      `${apiUrl}/api/verify-slip/${encodeURIComponent(referenceId)}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${secretKey}` },
        timeoutMs: 10_000,
        retries: 2,
      },
    );
    if (status >= 500) throw new ProviderUnavailableError('slip2go', `HTTP ${status}`, status);
    return checkOf(body ?? {}, true);
  }

  private required() {
    const { apiUrl, secretKey } = this.config;
    if (!apiUrl || !secretKey) throw new ProviderUnavailableError('slip2go', 'not configured');
    return { apiUrl, secretKey };
  }
}

/** Maps a Slip2Go answer to a slip check (result code table of the provider). */
export function checkOf(response: Slip2GoResponse, receiverChecked: boolean): SlipCheck {
  const code = response.code ?? 'none';
  const data = response.data ?? {};
  const base = {
    code,
    transRef: data.transRef ?? null,
    amount: data.amount !== undefined ? Number(data.amount).toFixed(2) : null,
    transferredAt: data.dateTime ? new Date(data.dateTime) : null,
    referenceId: data.referenceId ?? null,
    raw: redact(response),
  };
  switch (code) {
    case '200200':
    case '200001':
      return {
        ...base,
        result: 'pass',
        receiverMatched: receiverChecked,
        amountMatched: true,
        dateMatched: true,
      };
    case '200401':
      return { ...base, result: 'mismatch', receiverMatched: false, amountMatched: true, dateMatched: true };
    case '200402':
      return {
        ...base,
        result: 'mismatch',
        receiverMatched: receiverChecked,
        amountMatched: false,
        dateMatched: true,
      };
    case '200403':
      return {
        ...base,
        result: 'mismatch',
        receiverMatched: receiverChecked,
        amountMatched: true,
        dateMatched: false,
      };
    case '200500':
      return {
        ...base,
        result: 'mismatch',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
    case '200501':
      return {
        ...base,
        result: 'duplicate',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
    case '200404':
    case '400001':
    case '400002':
    case '400005':
      return {
        ...base,
        result: 'unreadable',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
    default:
      return {
        ...base,
        result: 'provider_error',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
  }
}
