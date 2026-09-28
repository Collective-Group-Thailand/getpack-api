import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { DocumentFilesService } from './document-files.service';
import { ReceivablesService } from './receivables.service';

/** Receivables housekeeping in the worker (B5.2). */
@Injectable()
export class ReceivablesJobs {
  constructor(
    private readonly files: DocumentFilesService,
    private readonly receivables: ReceivablesService,
  ) {}

  /** PDFs (and e-Tax XML) of newly issued documents. */
  @ScheduledJob({ name: 'receivables.render_pdfs', every: 60_000 })
  render(): Promise<number> {
    return this.files.renderPending();
  }

  /** Reminders on the receivables of individual customers (company credit is reminded by B3.5, D-122). */
  @ScheduledJob({ name: 'receivables.dunning', cron: '0 8 * * *' })
  dunning(): Promise<number> {
    return this.receivables.dunning();
  }
}
