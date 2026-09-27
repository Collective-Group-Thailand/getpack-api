/**
 * Payment provider ports (B3.2, D-061, D-176; docs/integrations/payment-providers.md). Each port has a
 * real adapter built from the provider's public documentation and an in-memory fake (`INTEGRATIONS_MODE`).
 * Adapters never log request or response bodies; the `raw` data they return is already redacted (PDPA).
 */

// --- SCB (QR 30 PromptPay bill payment, QR CS) -------------------------------------------------------

export const SCB_GATEWAY = Symbol('SCB_GATEWAY');

export interface QrPaymentRequest {
  kind: 'qr30' | 'qr_cs';
  /** Packio's payment reference: SCB `ref1` (QR 30) or `invoice` (QR CS); `[A-Z0-9]`, ≤ 20. */
  reference: string;
  amount: string;
  expiresAt: Date;
}

export interface QrPayment {
  qrRawData: string;
  qrImageBase64: string | null;
  /** QR CS: the id used by the inquiry. */
  providerQrId: string | null;
}

export interface ScbConfirmation {
  kind: 'qr30' | 'qr_cs';
  transactionId: string;
  reference: string;
  amount: string;
  paidAt: Date;
  raw: Record<string, unknown>;
}

export interface ScbGateway {
  createQr(request: QrPaymentRequest): Promise<QrPayment>;
  /**
   * Reads a payment-confirmation callback and **confirms it by inquiry** (SCB callbacks carry no
   * signature). Returns null when the callback cannot be confirmed; the transaction id otherwise.
   */
  confirm(body: unknown): Promise<{ transactionId: string | null; confirmation: ScbConfirmation | null }>;
  /** The JSON body SCB expects in answer to a callback. */
  callbackReply(transactionId: string | null): Record<string, string>;
}

// --- 2C2P PGW (card, online banking) -----------------------------------------------------------------

export const TWOC2P_GATEWAY = Symbol('TWOC2P_GATEWAY');

export interface CardPaymentRequest {
  reference: string;
  amount: string;
  description: string;
  channel: 'card' | 'online_banking';
  expiresAt: Date;
  frontendReturnUrl: string;
  backendReturnUrl: string;
  idempotencyId: string;
}

export interface CardPaymentSession {
  webPaymentUrl: string;
  paymentToken: string;
}

export interface TwoC2PResult {
  /** The JWT signature verified (notifications) or the inquiry answered. */
  valid: boolean;
  reference: string | null;
  respCode: string | null;
  succeeded: boolean;
  pending: boolean;
  amount: string | null;
  tranRef: string | null;
  channelCode: string | null;
  raw: Record<string, unknown>;
}

export interface RefundResult {
  status: 'succeeded' | 'pending' | 'failed';
  providerRef: string | null;
  message: string;
}

export interface TwoC2PGateway {
  paymentToken(request: CardPaymentRequest): Promise<CardPaymentSession>;
  /** Verifies and decodes a backend notification (`{"payload":"<JWT HS256>"}`). */
  decodeNotification(body: unknown): Promise<TwoC2PResult>;
  inquiry(reference: string): Promise<TwoC2PResult>;
  refund(request: { reference: string; amount: string; idempotencyId: string }): Promise<RefundResult>;
}

// --- Slip verification (Slip2Go first, D-176) ---------------------------------------------------------

export const SLIP_VERIFIER = Symbol('SLIP_VERIFIER');

export interface SlipReceiver {
  accountType: string;
  accountNumber: string;
  accountNameTH?: string;
}

export interface SlipCheckRequest {
  file: Buffer;
  mime: string;
  fileName: string;
  amount: string;
  transferredAfter: Date;
  /** Packio's collection accounts; empty = the receiver cannot be checked (never auto-accepted). */
  receivers: SlipReceiver[];
}

export interface SlipCheck {
  result: 'pass' | 'mismatch' | 'duplicate' | 'unreadable' | 'provider_error';
  code: string;
  transRef: string | null;
  amount: string | null;
  transferredAt: Date | null;
  receiverMatched: boolean;
  amountMatched: boolean;
  dateMatched: boolean;
  referenceId: string | null;
  raw: Record<string, unknown>;
}

export interface SlipVerifier {
  readonly name: string;
  verify(request: SlipCheckRequest): Promise<SlipCheck>;
  /** Re-reads a past result (asynchronous providers call back without a signature). */
  fetch(referenceId: string): Promise<SlipCheck>;
}

/** Masks account-like digits in provider payloads before they are stored (PDPA). */
export function redact(value: unknown): Record<string, unknown> {
  const text = JSON.stringify(value ?? {}, (key, v: unknown) =>
    typeof v === 'string' && /account|pan|accountNo|payerAccount|payeeAccount|consumer/i.test(key)
      ? v.replace(/\d(?=\d{4})/g, 'x')
      : v,
  );
  return JSON.parse(text) as Record<string, unknown>;
}

/** A provider scalar as text ('' for anything that is not a string or a number). */
export function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
