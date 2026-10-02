import { Global, Module } from '@nestjs/common';

import { AdvisoryService } from './advisory.service';
import { BoardSheetsService } from './board-sheets.service';

const SERVICES = [BoardSheetsService, AdvisoryService];

/**
 * Structure Advisor (U2.2, D-188, D-189, D-235–D-240): partners' signed board strength sheets, the rule-based
 * advisor (simplified McKee with effective-dated factors) priced through the real quote engine, and its replayable
 * log. HTTP process only.
 */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class AdvisoryModule {}
