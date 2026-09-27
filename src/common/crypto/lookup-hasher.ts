import { AppConfig } from '@config/app-config';
import { Injectable } from '@nestjs/common';

import { hmacSha256 } from './hashing';

/** Fixed development key: lookup hashes must be stable across restarts to find duplicates. */
const DEVELOPMENT_KEY = 'packio-development-lookup-key-not-for-production';

/**
 * Keyed lookup hash (HMAC-SHA256) of a sensitive number, e.g. a bank account number, so duplicates
 * can be found without storing or indexing the number itself (accounting-design.md §8, schema-design
 * §1.3). The key is `LOOKUP_HMAC_SECRET` (required in production).
 */
@Injectable()
export class LookupHasher {
  private readonly key: string;

  constructor(config: AppConfig) {
    this.key = config.get('LOOKUP_HMAC_SECRET') ?? DEVELOPMENT_KEY;
  }

  /** Digits only, so `123-4-56789-0` and `1234567890` hash the same. */
  hash(value: string, purpose: string): Uint8Array<ArrayBuffer> {
    return hmacSha256(this.key, `${purpose}:${value.replace(/[^0-9A-Za-z]/g, '')}`);
  }

  /** Free text (e.g. a Thai address): NFC, lower case, punctuation and whitespace removed. */
  hashText(value: string, purpose: string): Uint8Array<ArrayBuffer> {
    const normalised = value.normalize('NFC').toLowerCase().replace(/[\s.,\-/#()]+/g, '');
    return hmacSha256(this.key, `${purpose}:${normalised}`);
  }
}
