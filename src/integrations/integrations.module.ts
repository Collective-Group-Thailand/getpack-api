import { AppConfig } from '@config/app-config';
import { Global, Module } from '@nestjs/common';

import { FakeFirebaseVerifier, FakeLineVerifier } from './identity/fake-identity-verifiers';
import { JoseFirebaseVerifier } from './identity/firebase-verifier';
import { FIREBASE_VERIFIER, LINE_VERIFIER } from './identity/identity-verifier.port';
import { LineLoginVerifier } from './identity/line-verifier';
import { FakeObjectStorage } from './s3/fake-object-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './s3/object-storage.port';
import { S3ObjectStorage } from './s3/s3-object-storage';
import { FakeSmsSender } from './sms/fake-sms-sender';
import { SMS_SENDER } from './sms/sms-sender.port';
import { ThaiBulkSmsSender } from './sms/thaibulksms-sender';

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
    {
      provide: SMS_SENDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeSmsSender()
          : new ThaiBulkSmsSender({
              apiKey: config.get('THAIBULKSMS_API_KEY'),
              apiSecret: config.get('THAIBULKSMS_API_SECRET'),
              sender: config.get('THAIBULKSMS_SENDER'),
            }),
    },
    {
      provide: FIREBASE_VERIFIER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeFirebaseVerifier()
          : new JoseFirebaseVerifier(config.get('FIREBASE_PROJECT_ID')),
    },
    {
      provide: LINE_VERIFIER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakeLineVerifier() : new LineLoginVerifier(config.get('LINE_LOGIN_CHANNEL_ID')),
    },
  ],
  exports: [OBJECT_STORAGE, SMS_SENDER, FIREBASE_VERIFIER, LINE_VERIFIER],
})
export class IntegrationsModule {}
