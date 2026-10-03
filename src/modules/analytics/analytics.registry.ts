import { type Type } from '@nestjs/common';

import { AdminAnalyticsController, StoreAnalyticsController } from './analytics.controller';
import { StoreNetworkController } from './network-stats';

export const ANALYTICS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreAnalyticsController,
  StoreNetworkController,
];
export const ANALYTICS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminAnalyticsController];
