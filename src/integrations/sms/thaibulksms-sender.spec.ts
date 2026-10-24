import { providerReason, ThaiBulkSmsSender, toLocalThai } from './thaibulksms-sender';

describe('thaibulksms sender', () => {
  it('surfaces the provider error code and description', () => {
    expect(
      providerReason({
        error: { code: 400, name: 'ERROR_SENDER_NAME', description: 'Sender name not found' },
      }),
    ).toBe('(400 ERROR_SENDER_NAME Sender name not found)');
  });

  it('masks phone numbers in the description', () => {
    expect(providerReason({ error: { description: 'Invalid msisdn 0812345678' } })).toBe(
      '(Invalid msisdn ***)',
    );
  });

  it('returns nothing for an unknown body', () => {
    expect(providerReason(null)).toBeUndefined();
    expect(providerReason('Bad Request')).toBeUndefined();
    expect(providerReason({ error: {} })).toBeUndefined();
  });

  it('converts E.164 Thai numbers to local form', () => {
    expect(toLocalThai('+66812345678')).toBe('0812345678');
  });
});

describe('ThaiBulkSmsSender.send', () => {
  const config = { apiKey: 'key', apiSecret: 'secret', sender: 'Example' };
  const message = { to: '+66812345678', text: 'OTP 000000' };

  function fakeFetch() {
    return jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ phone_number_list: [{ message_id: 'msg-1' }] }), { status: 201 }),
      ),
    );
  }

  function sentForm(fetchImpl: ReturnType<typeof fakeFetch>): URLSearchParams {
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    return init.body as URLSearchParams;
  }

  it('sends the configured credit type as force', async () => {
    const fetchImpl = fakeFetch();
    const result = await new ThaiBulkSmsSender({ ...config, creditType: 'corporate' }, fetchImpl).send(
      message,
    );
    expect(result).toEqual({ providerMessageId: 'msg-1' });
    const form = sentForm(fetchImpl);
    expect(form.get('force')).toBe('corporate');
    expect(form.get('sender')).toBe('Example');
    expect(form.get('msisdn')).toBe('0812345678');
  });

  it('omits force when no credit type is configured', async () => {
    const fetchImpl = fakeFetch();
    await new ThaiBulkSmsSender(config, fetchImpl).send(message);
    expect(sentForm(fetchImpl).has('force')).toBe(false);
  });
});
