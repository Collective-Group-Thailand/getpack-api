import { type Type } from '@nestjs/common';

import { AdminAnalyticsController, StoreAnalyticsController } from './analytics.controller';
import { AdminJourneysController } from './journeys.controller';
import { AdminNextStylesController } from './next-styles';
import { AdminStudioFunnelController } from './studio-funnel';

export const ANALYTICS_STORE_CONTROLLERS: Type<unknown>[] = [StoreAnalyticsController];
export const ANALYTICS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminAnalyticsController,
  AdminNextStylesController,
  AdminStudioFunnelController,
  AdminJourneysController,
];
