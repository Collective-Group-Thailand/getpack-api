import { providerReason, toLocalThai } from './thaibulksms-sender';

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
