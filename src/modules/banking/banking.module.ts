import { Global, Module } from '@nestjs/common';

import { BankingService } from './banking.service';
import { CompanyBankAccountsService } from './company-bank-accounts.service';

const SERVICES = [CompanyBankAccountsService, BankingService];

/** Cash & bank (B5.3, accounting-design §6, D-061, D-093): company bank accounts, statements, matching, settlements, cash position. */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class BankingModule {}
