/**
 * Outbound HTTP for provider adapters (00-master-plan §4: timeout, retry/backoff, circuit breaker).
 * Retries only idempotent calls; never logs request or response bodies (they may hold PII/secrets).
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderUnavailableError';
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly coolDownMs = 30_000,
  ) {}

  get isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.openedAt >= this.coolDownMs) return false; // half-open: let one call through
    return true;
  }

  success(): void {
    this.failures = 0;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
}

export interface HttpCallOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeoutMs?: number;
  /** Extra attempts for network errors and 5xx; only for idempotent calls. */
  retries?: number;
  /** `buffer`: the body is returned as raw bytes (documents such as label PDFs). */
  responseType?: 'json' | 'buffer';
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export class ResilientHttp {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly provider: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(url: string, options: HttpCallOptions = {}): Promise<HttpResult> {
    if (this.breaker.isOpen) throw new ProviderUnavailableError(this.provider, 'circuit open');
    const attempts = 1 + (options.retries ?? 0);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        });
        let body: unknown;
        if (options.responseType === 'buffer' && response.status < 300) {
          body = Buffer.from(await response.arrayBuffer());
        } else {
          const text = await response.text();
          body = text ? safeJson(text) : null;
        }
        if (response.status >= 500) {
          lastError = new ProviderUnavailableError(this.provider, `HTTP ${response.status}`, response.status);
        } else {
          this.breaker.success();
          return { status: response.status, body };
        }
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
    }
    this.breaker.failure();
    if (lastError instanceof ProviderUnavailableError) throw lastError;
    throw new ProviderUnavailableError(
      this.provider,
      lastError instanceof Error ? lastError.name : 'request failed',
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
