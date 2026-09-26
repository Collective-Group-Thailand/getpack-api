import { createHash } from 'node:crypto';

import { CarrierRejectedError, CarrierUnsupportedError } from './carrier-adapter.port';
import { DELIVEREE_BASE_URL, DelivereeAdapter } from './deliveree.adapter';
import { FakeCarrierAdapter } from './fake-carrier.adapter';
import { FLASH_BASE_URL, FlashExpressAdapter, flashSign } from './flash-express.adapter';

/** Adapters against a recorded-shape fetch (no network); shapes from the providers' docs (B2.4). */
function fakeFetch(respond: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = respond(url, init);
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const FLASH = { credentials: { mchId: 'AA0001', secretKey: 'fake-secret' }, sandbox: true };

describe('Flash Express adapter', () => {
  it('signs sorted non-empty parameters with &key=<secret>, SHA-256 upper-case', () => {
    const expected = createHash('sha256')
      .update('a=1&mchId=AA0001&nonceStr=n1&key=fake-secret')
      .digest('hex')
      .toUpperCase();
    expect(flashSign({ nonceStr: 'n1', mchId: 'AA0001', a: '1', empty: '', sign: 'x' }, 'fake-secret')).toBe(
      expected,
    );
  });

  it('estimates each parcel on the training host and sums the satang', async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { code: 1, message: 'success', data: { estimatePrice: 4250 } },
    }));
    const quote = await new FlashExpressAdapter(impl).quote(FLASH, {
      from: { postcode: '10250' },
      to: { postcode: '50000', province: 'เชียงใหม่', district: 'เมือง' },
      parcels: [{ weightG: 3200 }, { weightG: 1000, lengthCm: 30, widthCm: 20, heightCm: 10 }],
    });
    expect(quote).toEqual({ amount: '85.00', transitDays: null });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`${FLASH_BASE_URL.sandbox}/open/v1/orders/estimate_rate`);
    const form = new URLSearchParams(calls[1]!.init.body as URLSearchParams);
    expect(form.get('weight')).toBe('1000');
    expect(form.get('length')).toBe('30');
    const params = Object.fromEntries(form.entries());
    expect(form.get('sign')).toBe(flashSign(params, 'fake-secret'));
  });

  it('surfaces Flash refusals and books one parcel per order', async () => {
    const refused = fakeFetch(() => ({ body: { code: 1002, message: 'sign error' } }));
    await expect(
      new FlashExpressAdapter(refused.impl).quote(FLASH, {
        from: { postcode: '1' },
        to: { postcode: '2' },
        parcels: [{ weightG: 1 }],
      }),
    ).rejects.toBeInstanceOf(CarrierRejectedError);
    const contact = { postcode: '10250', name: 'Fake', phone: '0800000000', addressLine: '1 Fake Rd' };
    await expect(
      new FlashExpressAdapter(refused.impl).book(FLASH, {
        reference: 'S1',
        from: contact,
        to: contact,
        parcels: [{ weightG: 1 }, { weightG: 2 }],
      }),
    ).rejects.toBeInstanceOf(CarrierUnsupportedError);
    const ok = fakeFetch(() => ({ body: { code: 1, data: { pno: 'TH0001' } } }));
    expect(
      await new FlashExpressAdapter(ok.impl).book(FLASH, {
        reference: 'S1',
        from: contact,
        to: contact,
        parcels: [{ weightG: 900 }],
      }),
    ).toMatchObject({ bookingRef: 'TH0001', trackingNo: 'TH0001' });
    expect(new URLSearchParams(ok.calls[0]!.init.body as URLSearchParams).get('outTradeNo')).toBe('S1');
  });

  it('maps route states and verifies callbacks over mchId and nonceStr', async () => {
    const { impl } = fakeFetch(() => ({
      body: {
        code: 1,
        data: {
          routes: [{ routedAt: 1727340000, state: 5, message: 'Signed', routeAction: 'DELIVERY_CONFIRM' }],
        },
      },
    }));
    const [event] = await new FlashExpressAdapter(impl).track(FLASH, 'TH0001');
    expect(event).toMatchObject({ status: 'delivered', message: 'Signed' });
    const adapter = new FlashExpressAdapter();
    const body = {
      mchId: 'AA0001',
      nonceStr: '1727340000',
      sign: flashSign({ mchId: 'AA0001', nonceStr: '1727340000' }, 'fake-secret'),
      data: { pno: 'TH0001', state: 2, updateAt: 1727340001 },
    };
    const ok = adapter.webhook(FLASH.credentials, {}, body);
    expect(ok).toMatchObject({
      valid: true,
      bookingRef: 'TH0001',
      status: 'in_transit',
      eventId: 'TH0001:2:1727340001',
    });
    expect(ok.reply.body).toEqual({ errorCode: '1', state: 'success' });
    expect(adapter.webhook(FLASH.credentials, {}, { ...body, sign: 'X' }).valid).toBe(false);
    expect(adapter.webhook({ ...FLASH.credentials, mchId: 'OTHER' }, {}, body).valid).toBe(false);
  });
});

describe('Deliveree adapter', () => {
  const call = {
    credentials: { apiKey: 'fake-key', webhookKey: 'fake-hook', vehicleTypeId: '7' },
    sandbox: true,
  };

  it('needs coordinates to quote and takes the cheapest vehicle', async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        data: [
          { vehicle_type_id: 7, total_fees: 900 },
          { vehicle_type_id: 8, total_fees: 650.5 },
        ],
      },
    }));
    const adapter = new DelivereeAdapter(impl);
    await expect(
      adapter.quote(call, {
        from: { postcode: '10250' },
        to: { postcode: '10110' },
        parcels: [{ weightG: 1 }],
      }),
    ).rejects.toBeInstanceOf(CarrierUnsupportedError);
    const quote = await adapter.quote(call, {
      from: { postcode: '10250', lat: 13.7, lng: 100.6 },
      to: { postcode: '10110', lat: 13.73, lng: 100.57 },
      parcels: [{ weightG: 120_000, lengthCm: 120, widthCm: 100, heightCm: 150 }],
    });
    expect(quote.amount).toBe('650.50');
    expect(calls[0]!.url).toBe(`${DELIVEREE_BASE_URL.sandbox}/deliveries/get_quote`);
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('fake-key');
  });

  it('checks the webhook key and prints no labels', async () => {
    const adapter = new DelivereeAdapter();
    expect(
      adapter.webhook(
        call.credentials,
        { authorization: 'fake-hook' },
        { id: 5, status: 'delivery_complete' },
      ),
    ).toMatchObject({
      valid: true,
      status: 'delivered',
      bookingRef: '5',
    });
    expect(adapter.webhook(call.credentials, { authorization: 'nope' }, { id: 5 }).valid).toBe(false);
    await expect(adapter.label()).rejects.toBeInstanceOf(CarrierUnsupportedError);
  });
});

describe('fake carrier', () => {
  it('prices obviously fake amounts and keeps the real constraints', async () => {
    const flash = new FakeCarrierAdapter('flash_express');
    expect(
      await flash.quote({}, { from: { postcode: '1' }, to: { postcode: '2' }, parcels: [{ weightG: 3200 }] }),
    ).toEqual({
      amount: '100.00',
      transitDays: 2,
    });
    await expect(
      new FakeCarrierAdapter('deliveree').quote(
        {},
        { from: { postcode: '1' }, to: { postcode: '2' }, parcels: [{ weightG: 1 }] },
      ),
    ).rejects.toBeInstanceOf(CarrierUnsupportedError);
  });
});
