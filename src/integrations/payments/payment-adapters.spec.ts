import { generateKeyPairSync } from 'node:crypto';

import {
  compactDecrypt,
  CompactEncrypt,
  CompactSign,
  compactVerify,
  decodeJwt,
  importPKCS8,
  importSPKI,
  SignJWT,
} from 'jose';

import { FakeSlipVerifier } from './fake-payment-gateways';
import { ScbAdapter } from './scb.adapter';
import { checkOf, Slip2GoAdapter } from './slip2go.adapter';
import { TwoC2PAdapter } from './twoc2p.adapter';

/** Adapters against doc-shaped responses (no network; docs/integrations/payment-providers.md). */
function fakeFetch(
  respond: (
    url: string,
    init: RequestInit,
  ) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown },
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = await respond(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const SCB = {
  baseUrl: 'https://api-sandbox.partners.scb/partners/sandbox',
  apiKey: 'fake-key',
  apiSecret: 'fake-secret',
  billerId: '123456789012345',
  ref3Prefix: 'PKO',
  merchantId: '684349039613126',
  terminalId: '379479514042628',
};
const TOKEN = {
  status: { code: 1000, description: 'Success' },
  data: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 1800 },
};

describe('SCB adapter', () => {
  it('creates a QR 30 with ref1 = the payment reference and ref3 = prefix + reference', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/oauth/token')
        ? { body: TOKEN }
        : {
            body: {
              status: { code: 1000, description: 'Success' },
              data: { qrRawData: '000201…6304CE18', qrImage: 'iVBOR' },
            },
          },
    );
    const qr = await new ScbAdapter(SCB, impl).createQr({
      kind: 'qr30',
      reference: 'PKO2610000001',
      amount: '1070.00',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(qr).toEqual({ qrRawData: '000201…6304CE18', qrImageBase64: 'iVBOR', providerQrId: null });
    const create = calls[1]!;
    expect(create.url).toBe(`${SCB.baseUrl}/v1/payment/qrcode/create`);
    expect(JSON.parse(create.init.body as string)).toMatchObject({
      qrType: 'PP',
      ppType: 'BILLERID',
      ppId: SCB.billerId,
      amount: '1070.00',
      ref1: 'PKO2610000001',
      ref3: 'PKOPKO2610000001',
    });
    expect((create.init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    expect((create.init.headers as Record<string, string>)['resourceOwnerId']).toBe('fake-key');
  });

  it('confirms a QR 30 callback only when the inquiry finds the transaction (callbacks are not signed)', async () => {
    const callback = {
      transactionId: '46a0e0c00f114482991414ef26654ace',
      amount: '1070.00',
      billPaymentRef1: 'PKO2610000001',
      transactionDateandTime: '2026-10-01T05:16:48.000+07:00',
      payerAccountNumber: '0662658053',
    };
    const inquiry = (found: unknown[]) =>
      fakeFetch((url) =>
        url.includes('/oauth/token') ? { body: TOKEN } : { body: { status: { code: 1000 }, data: found } },
      );
    const genuine = inquiry([{ ...callback, reverseFlag: 'N' }]);
    const result = await new ScbAdapter(SCB, genuine.impl).confirm(callback);
    expect(result.confirmation).toMatchObject({
      kind: 'qr30',
      reference: 'PKO2610000001',
      amount: '1070.00',
    });
    expect(genuine.calls[1]!.url).toContain('eventCode=00300100');
    expect(genuine.calls[1]!.url).toContain('transactionDate=2026-10-01');
    expect(JSON.stringify(result.confirmation!.raw)).not.toContain('0662658053');

    expect((await new ScbAdapter(SCB, inquiry([]).impl).confirm(callback)).confirmation).toBeNull();
    expect(
      (await new ScbAdapter(SCB, inquiry([{ ...callback, reverseFlag: 'R' }]).impl).confirm(callback))
        .confirmation,
    ).toBeNull();
  });

  it('refuses when not configured', async () => {
    await expect(
      new ScbAdapter({}).createQr({ kind: 'qr30', reference: 'X', amount: '1', expiresAt: new Date() }),
    ).rejects.toThrow(/not configured/);
  });
});

const SECRET = 'fake-merchant-secret-key-for-tests';
const twoc2p = (impl: typeof fetch, extra: object = {}) =>
  new TwoC2PAdapter(
    {
      baseUrl: 'https://sandbox-pgw.2c2p.com',
      apiVersion: '4.5',
      merchantId: 'JT01',
      secretKey: SECRET,
      ...extra,
    },
    impl,
  );
const sign = (payload: object, secret = SECRET) =>
  new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(new TextEncoder().encode(secret));

describe('2C2P adapter', () => {
  it('requests a payment token with an HS256 JWT and verifies the answer', async () => {
    const { impl, calls } = fakeFetch(async () => ({
      body: {
        payload: await sign({
          webPaymentUrl: 'https://sandbox-pgw-ui.2c2p.com/x',
          paymentToken: 'kSA',
          respCode: '0000',
        }),
      },
    }));
    const session = await twoc2p(impl).paymentToken({
      reference: 'PKO2610000002',
      amount: '1070.00',
      description: 'getpack order',
      channel: 'card',
      expiresAt: new Date('2026-10-01T03:00:00Z'),
      frontendReturnUrl: 'https://shop.example.invalid/return',
      backendReturnUrl: 'https://api.example.invalid/webhooks/2c2p/payment',
      idempotencyId: 'idem-1',
    });
    expect(session).toEqual({ webPaymentUrl: 'https://sandbox-pgw-ui.2c2p.com/x', paymentToken: 'kSA' });
    expect(calls[0]!.url).toBe('https://sandbox-pgw.2c2p.com/payment/4.5/paymentToken');
    const sent = decodeJwt(JSON.parse(calls[0]!.init.body as string).payload as string);
    expect(sent).toMatchObject({
      merchantID: 'JT01',
      invoiceNo: 'PKO2610000002',
      amount: 1070,
      currencyCode: 'THB',
      paymentChannel: ['CC'],
      paymentExpiry: '2026-10-01 10:00:00',
    });
  });

  it('accepts only notifications signed with the merchant secret; 0000 is success', async () => {
    const adapter = twoc2p(fakeFetch(() => ({ body: {} })).impl);
    const ok = await adapter.decodeNotification({
      payload: await sign({
        invoiceNo: 'PKO2610000002',
        amount: '1070.00',
        respCode: '0000',
        tranRef: '2868821',
        accountNo: '411111XXXXXX1111',
      }),
    });
    expect(ok).toMatchObject({
      valid: true,
      succeeded: true,
      reference: 'PKO2610000002',
      amount: '1070.00',
      tranRef: '2868821',
    });
    const forged = await adapter.decodeNotification({
      payload: await sign({ invoiceNo: 'X', respCode: '0000' }, 'wrong-secret-wrong-secret-wrong'),
    });
    expect(forged.valid).toBe(false);
  });

  it('sends refunds as JWE (RSA-OAEP) inside JWS (PS256) and reads the RF status', async () => {
    const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const provider = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = (k: typeof merchant.publicKey, type: 'spki' | 'pkcs8') =>
      k.export({ type, format: 'pem' }).toString();
    const { impl } = fakeFetch(async (_url, init) => {
      // 2C2P side: verify the merchant signature, decrypt, answer encrypted to the merchant and signed.
      const verified = await compactVerify(
        init.body as string,
        await importSPKI(pem(merchant.publicKey, 'spki'), 'PS256'),
      );
      const { plaintext } = await compactDecrypt(
        new TextDecoder().decode(verified.payload),
        await importPKCS8(pem(provider.privateKey, 'pkcs8'), 'RSA-OAEP'),
      );
      expect(new TextDecoder().decode(plaintext)).toContain('<processType>R</processType>');
      const xml =
        '<PaymentProcessResponse><respCode>00</respCode><respDesc>Success</respDesc><status>RF</status><refundReferenceNo>RF1</refundReferenceNo></PaymentProcessResponse>';
      const jwe = await new CompactEncrypt(new TextEncoder().encode(xml))
        .setProtectedHeader({ alg: 'RSA-OAEP', enc: 'A256GCM' })
        .encrypt(await importSPKI(pem(merchant.publicKey, 'spki'), 'RSA-OAEP'));
      const jws = await new CompactSign(new TextEncoder().encode(jwe))
        .setProtectedHeader({ alg: 'PS256' })
        .sign(await importPKCS8(pem(provider.privateKey, 'pkcs8'), 'PS256'));
      return { body: jws };
    });
    const result = await twoc2p(impl, {
      paymentActionUrl: 'https://demo2.2c2p.com/PaymentAction/2.0/action',
      merchantPrivateKeyPem: pem(merchant.privateKey, 'pkcs8'),
      twoc2pPublicKeyPem: pem(provider.publicKey, 'spki'),
    }).refund({ reference: 'PKO2610000002', amount: '100.00', idempotencyId: 'r-1' });
    expect(result).toEqual({ status: 'succeeded', providerRef: 'RF1', message: '00 Success RF' });
  });
});

describe('Slip2Go adapter', () => {
  it('maps result codes to slip checks', () => {
    expect(
      checkOf(
        { code: '200200', data: { transRef: 'T1', amount: 1000, dateTime: '2026-10-01T03:00:00.000Z' } },
        true,
      ),
    ).toMatchObject({
      result: 'pass',
      transRef: 'T1',
      amount: '1000.00',
      receiverMatched: true,
    });
    expect(checkOf({ code: '200200' }, false).receiverMatched).toBe(false);
    expect(checkOf({ code: '200402' }, true)).toMatchObject({ result: 'mismatch', amountMatched: false });
    expect(checkOf({ code: '200501' }, true).result).toBe('duplicate');
    expect(checkOf({ code: '200404' }, true).result).toBe('unreadable');
    expect(checkOf({ code: '200502' }, true).result).toBe('provider_error');
  });

  it('posts the image with duplicate, receiver, amount and date conditions', async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { code: '200200', data: { transRef: 'T9', amount: 1000 } },
    }));
    const check = await new Slip2GoAdapter(
      { apiUrl: 'https://slip.example.invalid', secretKey: 'k' },
      impl,
    ).verify({
      file: Buffer.from('png'),
      mime: 'image/png',
      fileName: 'slip.png',
      amount: '1000.00',
      transferredAfter: new Date('2026-10-01T00:00:00Z'),
      receivers: [{ accountType: '01014', accountNumber: '1234567890' }],
    });
    expect(check.result).toBe('pass');
    expect(calls[0]!.url).toBe('https://slip.example.invalid/api/verify-slip/qr-image/info');
    const form = calls[0]!.init.body as FormData;
    expect(JSON.parse(form.get('payload') as string)).toEqual({
      checkDuplicate: true,
      checkReceiver: [{ accountType: '01014', accountNumber: '1234567890' }],
      checkAmount: { type: 'eq', amount: '1000.00' },
      checkDate: { type: 'gte', date: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('the fake refuses a reference already accepted', async () => {
    const fake = new FakeSlipVerifier();
    const slip = Buffer.from('FAKESLIP;transRef=T1;amount=10.00;date=2026-10-01T03:00:00Z;receiver=ok');
    const req = {
      file: slip,
      mime: 'text/plain',
      fileName: 's',
      amount: '10.00',
      transferredAfter: new Date('2026-10-01T00:00:00Z'),
      receivers: [{ accountType: '01014', accountNumber: '1' }],
    };
    expect((await fake.verify(req)).result).toBe('pass');
    expect((await fake.verify(req)).result).toBe('duplicate');
  });
});
