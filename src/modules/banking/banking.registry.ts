import { type Type } from '@nestjs/common';

import { AdminBankingController } from './banking.controller';

export const BANKING_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminBankingController];
