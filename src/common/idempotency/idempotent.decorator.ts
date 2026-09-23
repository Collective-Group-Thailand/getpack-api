import { applyDecorators, SetMetadata } from '@nestjs/common';

import { ApiIdempotent } from '../openapi/decorators';

export const IDEMPOTENT_METADATA = 'packio:idempotent';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Marks an irreversible POST (payments, refunds, checkout, payout runs…) as requiring an
 * `Idempotency-Key` (uuid) header. Replays within 24 h return the original response.
 * Documents the header and its problem codes (`@ApiIdempotent()`).
 */
export function Idempotent() {
  return applyDecorators(SetMetadata(IDEMPOTENT_METADATA, true), ApiIdempotent());
}
