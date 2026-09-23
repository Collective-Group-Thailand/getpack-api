import { AppConfig } from '@config/app-config';
import { Global, Module } from '@nestjs/common';

import { FakeObjectStorage } from './s3/fake-object-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './s3/object-storage.port';
import { S3ObjectStorage } from './s3/s3-object-storage';

/**
 * Binds each provider port to its real adapter or its fake (`INTEGRATIONS_MODE`).
 * New providers (SES, SCB, 2C2P, LINE…) are added here by the deliverable that needs them.
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ObjectStorage =>
        config.useFakes
          ? new FakeObjectStorage()
          : new S3ObjectStorage({
              region: config.get('AWS_REGION'),
              bucket: config.get('S3_BUCKET'),
              endpoint: config.get('AWS_ENDPOINT_URL'),
              forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
            }),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class IntegrationsModule {}
