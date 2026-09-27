import { type Type } from '@nestjs/common';

import { AdminDesignServicesController, StoreDesignServicesController } from './design-services.controller';

export const DESIGN_SERVICES_STORE_CONTROLLERS: Type<unknown>[] = [StoreDesignServicesController];
export const DESIGN_SERVICES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminDesignServicesController];
