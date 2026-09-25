import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { Global, Module } from '@nestjs/common';

import { BankAccountsService } from './bank-accounts/bank-accounts.service';
import { FactoriesService } from './factories/factories.service';
import { FactoryAccess } from './factories/factory-access';
import { FactoryScopeResolver } from './factory-scope.resolver';

/**
 * Partners & price governance (schema-design §3.4, B2.2). Loaded by both processes: the HTTP app
 * serves the admin and partner surfaces; the worker runs the approval-outcome subscribers.
 */
@Global()
@Module({
  providers: [
    FactoryAccess,
    FactoriesService,
    BankAccountsService,
    FactoryScopeResolver,
    FieldEncryption,
    LookupHasher,
  ],
  exports: [FactoryAccess, FactoriesService, BankAccountsService, FieldEncryption, LookupHasher],
})
export class PartnersModule {}
