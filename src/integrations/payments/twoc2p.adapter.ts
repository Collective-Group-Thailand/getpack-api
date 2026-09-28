import {
  compactDecrypt,
  CompactEncrypt,
  CompactSign,
  compactVerify,
  importPKCS8,
  importSPKI,
  importX509,
  jwtVerify,
  SignJWT,
} from 'jose';

import { ProviderUnavailableError, ResilientHttp } from '../http/resilient-http';
import {
  type CardPaymentRequest,
  type CardPaymentSession,
  redact,
  type RefundResult,
  str,
  type TwoC2PGateway,
  type TwoC2PResult,
} from './payment-gateways.port';

export interface TwoC2PConfig {
  /** `https://sandbox-pgw.2c2p.com` or `https://pgw.2c2p.com`. */
  baseUrl?: string;
  /** PGW API version path segment (the docs show 4.3 and 4.5; to confirm with 2C2P). */
  apiVersion?: string;
  merchantId?: string;
  /** HS256 secret of the merchant (payment token, inquiry, notifications). */
  secretKey?: string;
  /** Payment Process API (refunds): `https://demo2.2c2p.com/PaymentAction/2.0/action` in sandbox. */
  paymentActionUrl?: string;
  /** PEM: merchant private key (PKCS#8) signing refunds, 2C2P public key (SPKI or X.509) encrypting them. */
  merchantPrivateKeyPem?: string;
  twoc2pPublicKeyPem?: string;
  /** Channel codes of the contract per Packio method (to confirm with 2C2P). */
  cardChannels?: string[];
  onlineBankingChannels?: string[];
}

/**
 * 2C2P PGW v4.x (developer.2c2p.com, read 2026-09-27). Payment token, inquiry and backend notifications
 * are JWT HS256 with the merchant secret (`{"payload":"<JWT>"}` both ways, responses verified). Refunds
 * use the Payment Process API: an XML request encrypted as JWE (RSA-OAEP + A256GCM, 2C2P public key) and
 * signed as JWS (PS256, merchant private key); the answer is verified then decrypted.
 */
export class TwoC2PAdapter implements TwoC2PGateway {
  private readonly http: ResilientHttp;

  constructor(
    private readonly config: TwoC2PConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.http = new ResilientHttp('twoc2p', fetchImpl);
  }

  async paymentToken(request: CardPaymentRequest): Promise<CardPaymentSession> {
    const c = this.required();
    const expiry = new Date(request.expiresAt.getTime() + 7 * 3_600_000).toISOString();
    const payload = {
      merchantID: c.merchantId,
      invoiceNo: request.reference,
      idempotencyID: request.idempotencyId,
      description: request.description.slice(0, 250),
      amount: Number(request.amount),
      currencyCode: 'THB',
      paymentChannel:
        request.channel === 'card'
          ? (this.config.cardChannels ?? ['CC'])
          : (this.config.onlineBankingChannels ?? []),
      paymentExpiry: `${expiry.slice(0, 10)} ${expiry.slice(11, 19)}`,
      frontendReturnUrl: request.frontendReturnUrl,
      backendReturnUrl: request.backendReturnUrl,
    };
    const answer = await this.call('paymentToken', payload);
    if (answer['respCode'] !== '0000' || typeof answer['webPaymentUrl'] !== 'string')
      throw new ProviderUnavailableError('twoc2p', `paymentToken respCode ${str(answer['respCode'])}`);
    return { webPaymentUrl: answer['webPaymentUrl'], paymentToken: str(answer['paymentToken']) };
  }

  async decodeNotification(body: unknown): Promise<TwoC2PResult> {
    const token = (body as { payload?: unknown } | null)?.payload;
    if (typeof token !== 'string') return invalidResult();
    try {
      const { payload } = await jwtVerify(token, this.secret(), { algorithms: ['HS256'] });
      return resultOf(payload, true);
    } catch {
      return invalidResult();
    }
  }

  async inquiry(reference: string): Promise<TwoC2PResult> {
    const answer = await this.call('paymentInquiry', {
      merchantID: this.required().merchantId,
      invoiceNo: reference,
    });
    return resultOf(answer, true);
  }

  async refund(request: { reference: string; amount: string; idempotencyId: string }): Promise<RefundResult> {
    const c = this.required();
    const { paymentActionUrl, merchantPrivateKeyPem, twoc2pPublicKeyPem } = this.config;
    if (!paymentActionUrl || !merchantPrivateKeyPem || !twoc2pPublicKeyPem)
      throw new ProviderUnavailableError('twoc2p', 'refund keys not configured');
    const stamp = new Date(Date.now() + 7 * 3_600_000).toISOString().replace(/[-:T]/g, '').slice(2, 14);
    const xml =
      '<PaymentProcessRequest>' +
      '<version>4.6</version>' +
      `<timeStamp>${stamp}</timeStamp>` +
      `<merchantID>${escapeXml(c.merchantId)}</merchantID>` +
      '<processType>R</processType>' +
      `<invoiceNo>${escapeXml(request.reference)}</invoiceNo>` +
      `<actionAmount>${escapeXml(request.amount)}</actionAmount>` +
      `<idempotencyID>${escapeXml(request.idempotencyId)}</idempotencyID>` +
      '</PaymentProcessRequest>';
    const theirKey = twoc2pPublicKeyPem.includes('CERTIFICATE')
      ? await importX509(twoc2pPublicKeyPem, 'RSA-OAEP')
      : await importSPKI(twoc2pPublicKeyPem, 'RSA-OAEP');
    const signKey = await importPKCS8(merchantPrivateKeyPem, 'PS256');
    const jwe = await new CompactEncrypt(new TextEncoder().encode(xml))
      .setProtectedHeader({ alg: 'RSA-OAEP', enc: 'A256GCM' })
      .encrypt(theirKey);
    const jws = await new CompactSign(new TextEncoder().encode(jwe))
      .setProtectedHeader({ alg: 'PS256' })
      .sign(signKey);
    const { status, body } = await this.http.call(paymentActionUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: jws,
      timeoutMs: 20_000,
    });
    if (status >= 300 || typeof body !== 'string')
      throw new ProviderUnavailableError('twoc2p', `refund HTTP ${status}`, status);
    const verifyKey = twoc2pPublicKeyPem.includes('CERTIFICATE')
      ? await importX509(twoc2pPublicKeyPem, 'PS256')
      : await importSPKI(twoc2pPublicKeyPem, 'PS256');
    const verified = await compactVerify(body, verifyKey);
    const decryptKey = await importPKCS8(merchantPrivateKeyPem, 'RSA-OAEP');
    const { plaintext } = await compactDecrypt(new TextDecoder().decode(verified.payload), decryptKey);
    const answer = new TextDecoder().decode(plaintext);
    const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(answer)?.[1] ?? null;
    const respCode = tag('respCode');
    const state = tag('status');
    const result: RefundResult['status'] =
      respCode === '00' && state === 'RF'
        ? 'succeeded'
        : respCode === '00' && state === 'RP'
          ? 'pending'
          : 'failed';
    return {
      status: result,
      providerRef: tag('refundReferenceNo') ?? tag('referenceNo'),
      message: `${respCode ?? '-'} ${tag('respDesc') ?? ''} ${state ?? ''}`.trim(),
    };
  }

  // --- helpers --------------------------------------------------------------------------------------

  private required() {
    const { baseUrl, merchantId, secretKey } = this.config;
    if (!baseUrl || !merchantId || !secretKey) throw new ProviderUnavailableError('twoc2p', 'not configured');
    return { baseUrl, merchantId, secretKey, version: this.config.apiVersion ?? '4.3' };
  }

  private secret(): Uint8Array {
    return new TextEncoder().encode(this.required().secretKey);
  }

  private async call(action: 'paymentToken' | 'paymentInquiry', payload: Record<string, unknown>) {
    const c = this.required();
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(this.secret());
    const { status, body } = await this.http.call(`${c.baseUrl}/payment/${c.version}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: jwt }),
      timeoutMs: 15_000,
      retries: action === 'paymentInquiry' ? 2 : 0,
    });
    const token = (body as { payload?: unknown } | null)?.payload;
    if (status >= 300) throw new ProviderUnavailableError('twoc2p', `${action} HTTP ${status}`, status);
    if (typeof token !== 'string') {
      // Errors come back unsigned: `{"respCode":"…","respDesc":"…"}`.
      const plain = (body ?? {}) as Record<string, unknown>;
      throw new ProviderUnavailableError('twoc2p', `${action} respCode ${str(plain['respCode']) || '-'}`);
    }
    const { payload: answer } = await jwtVerify(token, this.secret(), { algorithms: ['HS256'] });
    return answer as Record<string, unknown>;
  }
}

function resultOf(p: Record<string, unknown>, valid: boolean): TwoC2PResult {
  const respCode = typeof p['respCode'] === 'string' ? p['respCode'] : null;
  const amount = p['amount'] !== undefined && p['amount'] !== null ? Number(p['amount']).toFixed(2) : null;
  return {
    valid,
    reference: typeof p['invoiceNo'] === 'string' ? p['invoiceNo'] : null,
    respCode,
    succeeded: respCode === '0000',
    pending: respCode === '0001' || respCode === '2001',
    amount,
    tranRef: str(p['tranRef']) || str(p['referenceNo']) || null,
    channelCode: typeof p['channelCode'] === 'string' ? p['channelCode'] : null,
    raw: redact(p),
  };
}

function invalidResult(): TwoC2PResult {
  return {
    valid: false,
    reference: null,
    respCode: null,
    succeeded: false,
    pending: false,
    amount: null,
    tranRef: null,
    channelCode: null,
    raw: {},
  };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
