import { type Type } from '@nestjs/common';

import { AdminArtworkController, StoreArtworkController } from './artwork.controller';
import { AdminProofsController, StoreProofsController } from './proofs.controller';

/** `/v1/store/*` controllers of artwork. */
export const ARTWORK_STORE_CONTROLLERS: Type<unknown>[] = [StoreArtworkController, StoreProofsController];

/** `/v1/admin/*` controllers of artwork. */
export const ARTWORK_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminArtworkController, AdminProofsController];
