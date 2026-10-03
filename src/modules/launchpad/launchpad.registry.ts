import { type Type } from '@nestjs/common';

import { StoreLaunchpadController } from './launchpad.controller';

/** `/v1/store/*` controllers of the launchpad (U5.B1). */
export const LAUNCHPAD_STORE_CONTROLLERS: Type<unknown>[] = [StoreLaunchpadController];
