import { Global, Module } from '@nestjs/common';

import { JournalPostingService } from './journal-posting.service';
import { JournalsQueryService } from './journals-query.service';
import { LedgerJobs } from './ledger.jobs';
import { LedgerApprovalsSubscriber } from './ledger-approvals.subscriber';
import { LedgerConfigService } from './ledger-config.service';
import { ManualJournalsService } from './manual-journals.service';
import { PeriodsService } from './periods.service';
import { PostingEngine } from './posting/posting-engine.service';
import { RecurringJournalsService } from './recurring-journals.service';
import { SourceReversalSubscriber } from './source-reversal.subscriber';
import { TaxRatesReader } from './tax-rates.reader';

const SERVICES = [
  PeriodsService,
  JournalPostingService,
  PostingEngine,
  ManualJournalsService,
  RecurringJournalsService,
  LedgerConfigService,
  JournalsQueryService,
  TaxRatesReader,
];

/**
 * Packio Accounting ledger core (B5.1, D-031, ADR-0007): periods, chart of accounts, journals, the posting
 * engine and its rules, manual / recurring / reversing journals under maker-checker.
 */
@Global()
@Module({ providers: [...SERVICES, LedgerApprovalsSubscriber, SourceReversalSubscriber, LedgerJobs], exports: SERVICES })
export class LedgerModule {}
