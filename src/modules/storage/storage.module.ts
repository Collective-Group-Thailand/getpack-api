import { Global, Module } from '@nestjs/common';

import { StorageJobs } from './storage.jobs';
import { StorageMeteringService } from './storage-metering.service';

/** Storage-based pricing of factory and partner accounts (D-436, on @collective/documents). */
@Global()
@Module({
  providers: [StorageMeteringService, StorageJobs],
  exports: [StorageMeteringService],
})
export class StorageModule {}
