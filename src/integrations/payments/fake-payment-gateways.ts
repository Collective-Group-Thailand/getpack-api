import { randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import {
  type CardPaymentRequest,
  type CardPaymentSession,
  type QrPayment,
  type QrPaymentRequest,
  type RefundResult,
  type ScbConfirmation,
  type ScbGateway,
  type SlipCheck,
  type SlipCheckRequest,
  type SlipVerifier,
  type TwoC2PGateway,
  type TwoC2PResult,
} from './payment-gateways.port';

/**
 * In-memory providers for `pnpm dev` and the tests. They behave like the real ones where it matters:
 * the SCB fake confirms a callback only for a transaction it "settled" (the real adapter asks the SCB
 * inquiry), the 2C2P fake signs and verifies notifications with an HS256 secret, and the slip fake reads
 * a text slip `FAKESLIP;transRef=…;amount=…;date=…;receiver=ok|bad` and remembers accepted references.
 */
export class FakeScbGateway implements ScbGateway {
  readonly qrs: (QrPaymentRequest & { qrId: string })[] = [];
  private readonly settled = new Map<string, ScbConfirmation>();

  createQr(request: QrPaymentRequest): Promise<QrPayment> {
    const qrId = `FAKEQR${this.qrs.length + 1}`;
    this.qrs.push({ ...request, qrId });
    return Promise.resolve({
      qrRawData: `00020101021230FAKE|${request.kind}|${request.reference}|${request.amount}`,
      qrImageBase64: null,
      providerQrId: request.kind === 'qr_cs' ? qrId : null,
    });
  }

  /** Test helper: the customer paid; returns the callback SCB would send (QR 30 shape). */
  settle(reference: string, amount: string): Record<string, string> {
    const transactionId = randomUUID().replace(/-/g, '');
    const paidAt = new Date();
    this.settled.set(transactionId, { kind: 'qr30', transactionId, reference, amount, paidAt, raw: {} });
    return {
      transactionId,
      amount,
      billPaymentRef1: reference,
      billPaymentRef2: 'GETPACK',
      billPaymentRef3: `FAKE${reference}`.slice(0, 20),
      transactionDateandTime: paidAt.toISOString(),
      payerAccountNumber: 'xxxxxx1234',
      currencyCode: '764',
      channelCode: 'PMH',
    };
  }

  confirm(body: unknown): Promise<{ transactionId: string | null; confirmation: ScbConfirmation | null }> {
    const cb = (body ?? {}) as Record<string, unknown>;
    const transactionId = typeof cb['transactionId'] === 'string' ? cb['transactionId'] : null;
    const settled = transactionId ? this.settled.get(transactionId) : undefined;
    const genuine =
      settled &&
      settled.reference === cb['billPaymentRef1'] &&
      Number(settled.amount) === Number(cb['amount']);
    return Promise.resolve({ transactionId, confirmation: genuine ? settled : null });
  }

  callbackReply(transactionId: string | null): Record<string, string> {
    return { resCode: '00', resDesc: 'success', transactionId: transactionId ?? '' };
  }
}

export const FAKE_TWOC2P_SECRET = 'fake-2c2p-secret-for-tests-only';

export class FakeTwoC2PGateway implements TwoC2PGateway {
  readonly sessions = new Map<string, CardPaymentRequest & { respCode: string }>();
  readonly refunds: { reference: string; amount: string }[] = [];

  paymentToken(request: CardPaymentRequest): Promise<CardPaymentSession> {
    this.sessions.set(request.reference, { ...request, respCode: '0001' });
    return Promise.resolve({
      webPaymentUrl: `https://pgw.fake.invalid/pay/${request.reference}`,
      paymentToken: `FAKETOKEN${request.reference}`,
    });
  }

  /** Test helper: the backend notification 2C2P would send after the customer paid (or failed). */
  async notification(reference: string, respCode = '0000', amount?: string): Promise<{ payload: string }> {
    const session = this.sessions.get(reference);
    if (session) session.respCode = respCode;
    const payload = await new SignJWT({
      merchantID: 'FAKE',
      invoiceNo: reference,
      amount: amount ?? session?.amount ?? '0.00',
      currencyCode: 'THB',
      tranRef: `TR${reference}`,
      channelCode: session?.channel === 'online_banking' ? 'IMBANK' : 'VI',
      accountNo: '411111XXXXXX1111',
      respCode,
      respDesc: respCode === '0000' ? 'Success' : 'Failed',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(new TextEncoder().encode(FAKE_TWOC2P_SECRET));
    return { payload };
  }

  async decodeNotification(body: unknown): Promise<TwoC2PResult> {
    const token = (body as { payload?: unknown } | null)?.payload;
    try {
      if (typeof token !== 'string') throw new Error('no payload');
      const { payload } = await jwtVerify(token, new TextEncoder().encode(FAKE_TWOC2P_SECRET));
      const p = payload as Record<string, unknown>;
      const respCode = String(p['respCode']);
      return {
        valid: true,
        reference: String(p['invoiceNo']),
        respCode,
        succeeded: respCode === '0000',
        pending: respCode === '0001',
        amount: Number(p['amount']).toFixed(2),
        tranRef: String(p['tranRef']),
        channelCode: String(p['channelCode']),
        raw: { invoiceNo: p['invoiceNo'], respCode },
      };
    } catch {
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
  }

  inquiry(reference: string): Promise<TwoC2PResult> {
    const s = this.sessions.get(reference);
    return Promise.resolve({
      valid: s !== undefined,
      reference,
      respCode: s?.respCode ?? '2002',
      succeeded: s?.respCode === '0000',
      pending: s?.respCode === '0001',
      amount: s ? Number(s.amount).toFixed(2) : null,
      tranRef: s ? `TR${reference}` : null,
      channelCode: null,
      raw: { invoiceNo: reference },
    });
  }

  refund(request: { reference: string; amount: string; idempotencyId: string }): Promise<RefundResult> {
    this.refunds.push({ reference: request.reference, amount: request.amount });
    return Promise.resolve({
      status: 'succeeded',
      providerRef: `RF${request.reference}`,
      message: '00 Success RF',
    });
  }
}

export class FakeSlipVerifier implements SlipVerifier {
  readonly name = 'fake';
  private readonly accepted = new Set<string>();
  private readonly results = new Map<string, SlipCheck>();

  verify(request: SlipCheckRequest): Promise<SlipCheck> {
    const text = request.file.toString('utf8');
    const fields = Object.fromEntries(
      text
        .trim()
        .split(';')
        .slice(1)
        .map((kv) => kv.split('=') as [string, string]),
    );
    const referenceId = randomUUID();
    const base = {
      transRef: fields['transRef'] ?? null,
      amount: fields['amount'] ? Number(fields['amount']).toFixed(2) : null,
      transferredAt: fields['date'] ? new Date(fields['date']) : null,
      referenceId,
      raw: { code: 'fake' },
    };
    let check: SlipCheck;
    if (!text.startsWith('FAKESLIP') || !base.transRef) {
      check = {
        ...base,
        result: 'unreadable',
        code: '400002',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
    } else if (this.accepted.has(base.transRef)) {
      check = {
        ...base,
        result: 'duplicate',
        code: '200501',
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
      };
    } else {
      const receiverMatched = request.receivers.length > 0 && fields['receiver'] === 'ok';
      const amountMatched = base.amount !== null && Number(base.amount) === Number(request.amount);
      const dateMatched = base.transferredAt !== null && base.transferredAt >= request.transferredAfter;
      const pass = (request.receivers.length === 0 || receiverMatched) && amountMatched && dateMatched;
      check = {
        ...base,
        result: pass ? 'pass' : 'mismatch',
        code: pass ? '200200' : !amountMatched ? '200402' : !dateMatched ? '200403' : '200401',
        receiverMatched,
        amountMatched,
        dateMatched,
      };
      if (pass) this.accepted.add(base.transRef);
    }
    this.results.set(referenceId, check);
    return Promise.resolve(check);
  }

  fetch(referenceId: string): Promise<SlipCheck> {
    const found = this.results.get(referenceId);
    if (!found) throw new Error('unknown reference');
    return Promise.resolve(found);
  }
}
