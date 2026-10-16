import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id (ADR-0004) with the OWASP 2024 baseline: 19 MiB memory, 2 iterations, 1 lane.
 * Used for passwords, device PINs and client secrets.
 */
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified when the account does not exist, so response time does not reveal it. */
  private dummy?: Promise<string>;

  hash(secret: string): Promise<string> {
    return hash(secret, OPTIONS);
  }

  async verify(storedHash: string | null | undefined, secret: string): Promise<boolean> {
    if (!storedHash) {
      this.dummy ??= hash('getpack-dummy-secret', OPTIONS);
      await verify(await this.dummy, secret).catch(() => false);
      return false;
    }
    return verify(storedHash, secret).catch(() => false);
  }
}
