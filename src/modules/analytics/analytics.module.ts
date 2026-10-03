import { Global, Module } from '@nestjs/common';

import { AnalyticsJobs } from './analytics.jobs';
import { AnalyticsDashboardsService } from './dashboards.service';
import { AnalyticsIngestionService } from './ingestion.service';
import { NetworkStatsService } from './network-stats';
import { AnalyticsOutboxSubscriber } from './outbox-events.subscriber';
import { ProspectusService } from './prospectus.service';
import { AnalyticsRollupService } from './rollups.service';

/**
 * Demand & growth analytics (B6.1, D-102): BFF and outbox event ingestion, nightly rollups into the `analytics`
 * star model, admin dashboards and the anonymised partner prospectus. Loaded by both processes: the HTTP app
 * serves the surfaces; the worker runs the subscriber, rollups and prospectus rendering.
 */
@Global()
@Module({
  providers: [
    AnalyticsIngestionService,
    AnalyticsRollupService,
    AnalyticsDashboardsService,
    ProspectusService,
    AnalyticsOutboxSubscriber,
    AnalyticsJobs,
    NetworkStatsService,
  ],
  exports: [
    AnalyticsIngestionService,
    AnalyticsRollupService,
    AnalyticsDashboardsService,
    ProspectusService,
    NetworkStatsService,
  ],
})
export class AnalyticsModule {}
