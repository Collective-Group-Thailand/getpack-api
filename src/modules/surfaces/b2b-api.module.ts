import { B2B_API_CONTROLLERS } from '@modules/b2b/b2b.registry';
import { Module } from '@nestjs/common';

/** `/v1/b2b/*` — company API clients (client credentials, `aud=b2b`, D-291). */
@Module({ controllers: [...B2B_API_CONTROLLERS] })
export class B2bApiModule {}
