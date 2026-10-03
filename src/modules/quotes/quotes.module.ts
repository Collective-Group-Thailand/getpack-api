import { QUOTE_REPRICER } from '@modules/partners/pricing/quote-repricer.port';
import { Global, Module } from '@nestjs/common';

import { ConfigurationDraftsService } from './configuration-drafts.service';
import { QuoteClosingService } from './levers/quote-closing.service';
import { QuoteLeversService } from './levers/quote-levers.service';
import { QuoteOutcomesService } from './levers/quote-outcomes.service';
import { QuoteConversionService } from './quote-conversion.service';
import { QuotePdfService } from './quote-pdf.service';
import { QuotesJobs } from './quotes.jobs';
import { SavedQuotesRepricer } from './saved-quotes.repricer';
import { SavedQuotesService } from './saved-quotes.service';

const SERVICES = [
  SavedQuotesService,
  QuotePdfService,
  QuoteConversionService,
  ConfigurationDraftsService,
  QuoteOutcomesService,
  QuoteLeversService,
  QuoteClosingService,
];

/**
 * Saved quotations and RFQs (schema-design §3.5, B2.5). Loaded by both processes: the HTTP app serves
 * the store / admin / partner surfaces; the worker renders PDFs, expires quotes and runs impact
 * simulations through the saved-quote repricer.
 */
@Global()
@Module({
  providers: [...SERVICES, QuotesJobs, { provide: QUOTE_REPRICER, useClass: SavedQuotesRepricer }],
  exports: [...SERVICES, QUOTE_REPRICER],
})
export class QuotesModule {}
