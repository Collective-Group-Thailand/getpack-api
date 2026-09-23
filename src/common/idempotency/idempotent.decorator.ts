import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_METADATA = 'packio:idempotent';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Marks an irreversible POST (payments, refunds, checkout, payout runs…) as requiring an
 * `Idempotency-Key` (uuid) header. Replays within 24 h return the original response.
 */
export function Idempotent() {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_METADATA, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'uuid; replays within 24 h return the original response',
      schema: { type: 'string', format: 'uuid' },
    }),
  );
}
