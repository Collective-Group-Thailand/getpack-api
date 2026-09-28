import { type Type } from '@nestjs/common';

import {
  AdminJournalsController,
  AdminLedgerAccountsController,
  AdminLedgerPeriodsController,
  AdminPostingRulesController,
  AdminRecurringJournalsController,
  AdminTaxRatesController,
} from './ledger.controller';

export const LEDGER_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminLedgerAccountsController,
  AdminLedgerPeriodsController,
  AdminJournalsController,
  AdminRecurringJournalsController,
  AdminPostingRulesController,
  AdminTaxRatesController,
];
