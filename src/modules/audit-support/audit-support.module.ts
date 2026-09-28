import { Global, Module } from '@nestjs/common';

import { AuditSupportService } from './audit-support.service';

/** Audit support (B5.6, §8): samples, PBC packs, exception reports. */
@Global()
@Module({ providers: [AuditSupportService], exports: [AuditSupportService] })
export class AuditSupportModule {}
