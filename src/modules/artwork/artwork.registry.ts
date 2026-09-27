import { type Type } from '@nestjs/common';

import { AdminArtworkController, StoreArtworkController } from './artwork.controller';

/** `/v1/store/*` controllers of artwork. */
export const ARTWORK_STORE_CONTROLLERS: Type<unknown>[] = [StoreArtworkController];

/** `/v1/admin/*` controllers of artwork. */
export const ARTWORK_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminArtworkController];
