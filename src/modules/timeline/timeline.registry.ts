import { type Type } from '@nestjs/common';

import {
  AdminTimelineController,
  PublicTrackingController,
  StoreTimelineController,
} from './timeline.controller';

export const TIMELINE_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminTimelineController];
export const TIMELINE_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreTimelineController,
  PublicTrackingController,
];
