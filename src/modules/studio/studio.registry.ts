import { type Type } from '@nestjs/common';

import { StoreStudioController } from './studio.controller';

/** `/v1/store/*` controllers of the studio (U4). */
export const STUDIO_STORE_CONTROLLERS: Type<unknown>[] = [StoreStudioController];
