import { Global, Module } from '@nestjs/common';

import { CallOffsJobs } from './call-offs.jobs';
import { CallOffsService } from './call-offs.service';
import { CallOffsCheckout } from './call-offs-checkout.extension';

/** Call-off agreements: a locked unit price released in parts (U2.7, D-290). */
@Global()
@Module({ providers: [CallOffsService, CallOffsCheckout, CallOffsJobs], exports: [CallOffsService] })
export class CallOffsModule {}
