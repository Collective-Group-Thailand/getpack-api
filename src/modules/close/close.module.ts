import { PERIOD_CLOSE_GATE } from '@modules/ledger/periods.service';
import { Global, Module } from '@nestjs/common';

import { CloseService } from './close.service';
import { CloseSubscribers } from './close.subscribers';

/** Period close (B5.6, §7): checklists with blocking checks; gates the ledger's close and lock. */
@Global()
@Module({
  providers: [CloseService, CloseSubscribers, { provide: PERIOD_CLOSE_GATE, useExisting: CloseService }],
  exports: [CloseService, PERIOD_CLOSE_GATE],
})
export class CloseModule {}
