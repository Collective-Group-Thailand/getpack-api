import { type Type } from '@nestjs/common';

import { AdminTaxController } from './tax.controller';

export const TAX_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminTaxController];
