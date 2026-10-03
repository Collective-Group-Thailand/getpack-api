import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';

import { AdminApiModule } from './admin-api.module';
import { AuthApiModule } from './auth-api.module';
import { B2bApiModule } from './b2b-api.module';
import { PartnerApiModule } from './partner-api.module';
import { StoreApiModule } from './store-api.module';
import { SURFACES } from './surfaces';
import { WebhooksModule } from './webhooks.module';

const SURFACE_MODULES = [
  AuthApiModule,
  StoreApiModule,
  AdminApiModule,
  PartnerApiModule,
  B2bApiModule,
  WebhooksModule,
];

/**
 * Mounts each surface under its prefix. URI versioning adds `/v1` in front (webhook controllers
 * declare `version: VERSION_NEUTRAL`).
 */
@Module({
  imports: [
    ...SURFACE_MODULES,
    RouterModule.register([
      { path: SURFACES.auth, module: AuthApiModule },
      { path: SURFACES.store, module: StoreApiModule },
      { path: SURFACES.admin, module: AdminApiModule },
      { path: SURFACES.partner, module: PartnerApiModule },
      { path: SURFACES.b2b, module: B2bApiModule },
      { path: SURFACES.webhooks, module: WebhooksModule },
    ]),
  ],
})
export class SurfacesModule {}
