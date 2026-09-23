import { CircuitBreaker, ProviderUnavailableError, ResilientHttp } from './resilient-http';

const response = (status: number, body: unknown) =>
  ({ status, text: () => Promise.resolve(JSON.stringify(body)) }) as unknown as Response;

describe('ResilientHttp', () => {
  it('returns 2xx/4xx bodies and retries 5xx when allowed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const http = new ResilientHttp('p', fetchImpl);
    await expect(http.call('https://example.invalid', { retries: 1 })).resolves.toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry unless asked and reports the provider as unavailable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const http = new ResilientHttp('sms', fetchImpl);
    await expect(http.call('https://example.invalid', { method: 'POST' })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(500, {}));
    const http = new ResilientHttp('p', fetchImpl);
    for (let i = 0; i < 5; i++) await expect(http.call('https://example.invalid')).rejects.toThrow();
    await expect(http.call('https://example.invalid')).rejects.toThrow('circuit open');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('half-opens after the cool-down', () => {
    const breaker = new CircuitBreaker(1, 0);
    breaker.failure();
    expect(breaker.isOpen).toBe(false);
  });
});
