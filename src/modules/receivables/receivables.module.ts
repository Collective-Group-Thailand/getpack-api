import { Global, Module } from '@nestjs/common';

import { CreditNotesService } from './credit-notes.service';
import { CustomerDocumentsService } from './customer-documents.service';
import { DeliveryDocumentsService } from './delivery-documents.service';
import { DocumentCorrectionsService } from './document-corrections.service';
import { DocumentFilesService } from './document-files.service';
import { ETaxEmailService } from './etax-email.service';
import { ReceiptsService } from './receipts.service';
import { ReceivablesJobs } from './receivables.jobs';
import { ReceivablesService } from './receivables.service';
import { StoreCreditService } from './store-credit.service';
import { WhtCertificatesService } from './wht-certificates.service';

const SERVICES = [
  CustomerDocumentsService,
  StoreCreditService,
  CreditNotesService,
  ReceiptsService,
  DeliveryDocumentsService,
  ReceivablesService,
  WhtCertificatesService,
  DocumentFilesService,
  ETaxEmailService,
  DocumentCorrectionsService,
];

/**
 * Receivables & customer documents (B5.2, accounting-design §2, §4, §6): IV / TR / RC / CN / DN with gapless
 * numbers, PDFs and e-Tax XML, customer WHT certificates, AR, store credit, allowance and write-offs.
 */
@Global()
@Module({ providers: [...SERVICES, ReceivablesJobs], exports: SERVICES })
export class ReceivablesModule {}
