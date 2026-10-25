import { setIntegrationsLogger } from '@collective/integrations';
import { EMAIL_SENDER, FakeEmailSender, SesEmailSender } from '@collective/integrations/email';
import {
  FakeFirebaseVerifier,
  FakeLineVerifier,
  FIREBASE_VERIFIER,
  JoseFirebaseVerifier,
  LINE_VERIFIER,
  LineLoginVerifier,
} from '@collective/integrations/identity';
import {
  FakeScbGateway,
  FakeSlipVerifier,
  FakeTwoC2PGateway,
  SCB_GATEWAY,
  ScbAdapter,
  SLIP_VERIFIER,
  Slip2GoAdapter,
  TWOC2P_GATEWAY,
  TwoC2PAdapter,
} from '@collective/integrations/payments/gateways';
import { FakePdfRenderer, PDF_RENDERER, PuppeteerPdfRenderer } from '@collective/integrations/pdf';
import { AwsSecretsProvider, FakeSecretsProvider, SECRETS_PROVIDER } from '@collective/integrations/secrets';
import { FakeSmsSender, SMS_SENDER, ThaiBulkSmsSender } from '@collective/integrations/sms';
import { OBJECT_STORAGE, type ObjectStorage, S3ObjectStorage } from '@collective/integrations/storage';
import { FakeTeamsWebhook, TEAMS_WEBHOOK, TeamsWebhookClient } from '@collective/integrations/teams';
import {
  ClamdScanner,
  ExternalScanPending,
  FakeVirusScanner,
  VIRUS_SCANNER,
} from '@collective/integrations/virus-scan';
import { FakeWebPush, VapidWebPush, WEB_PUSH } from '@collective/integrations/web-push';
import { FakeWebhookSender, HttpWebhookSender, WEBHOOK_SENDER } from '@collective/integrations/webhooks';
import { AppConfig } from '@config/app-config';
import { FakeObjectStorage } from '@integrations/storage/fake-object-storage';
import { Global, Logger, Module } from '@nestjs/common';

import { CARRIER_ADAPTERS, type CarrierAdapter } from './carriers/carrier-adapter.port';
import { DelivereeAdapter } from './carriers/deliveree.adapter';
import { FakeCarrierAdapter } from './carriers/fake-carrier.adapter';
import { FlashExpressAdapter } from './carriers/flash-express.adapter';
import { DIELINE_ENGINE } from './dieline/dieline-engine.port';
import { FakeDielineEngine } from './dieline/fake-dieline.engine';
import { GetpackDielineEngine } from './dieline/getpack-dieline.engine';
import { FakeLineMessaging } from './line-messaging/fake-line-messaging';
import { LINE_MESSAGING } from './line-messaging/line-messaging.port';
import { LineMessagingClient } from './line-messaging/line-messaging-client';
import { FakeIndexSource } from './material-price-index/fake-index-source';
import { ManualIndexSource } from './material-price-index/manual-index-source';
import { MATERIAL_PRICE_INDEX } from './material-price-index/material-price-index.port';

/**
 * Binds each provider port to its real adapter or its fake (`INTEGRATIONS_MODE`).
 * New providers (SES, SCB, 2C2P, LINE…) are added here by the deliverable that needs them.
 *
 * Ports, adapters and fakes come from `@collective/integrations` (D-435) except getpack's own:
 * carriers, dieline, material price index, bank files, and — until collective-shared 0.2 — the
 * LINE messaging client (rich menus) and the on-disk fake object storage.
 */
@Global()
@Module({
  providers: [
    {
      provide: MATERIAL_PRICE_INDEX,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => (config.useFakes ? new FakeIndexSource() : new ManualIndexSource()),
    },
    {
      provide: OBJECT_STORAGE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ObjectStorage =>
        config.useFakeObjectStorage
          ? new FakeObjectStorage(config.get('FAKE_OBJECT_STORAGE_DIR'))
          : new S3ObjectStorage({
              region: config.get('AWS_REGION'),
              bucket: config.get('S3_BUCKET'),
              endpoint: config.get('AWS_ENDPOINT_URL'),
              forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
              keyPrefix: config.get('S3_KEY_PREFIX') ?? '',
            }),
    },
    {
      provide: SCB_GATEWAY,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeScbGateway()
          : new ScbAdapter({
              baseUrl: config.get('SCB_API_BASE_URL'),
              apiKey: config.get('SCB_API_KEY'),
              apiSecret: config.get('SCB_API_SECRET'),
              billerId: config.get('SCB_BILLER_ID'),
              ref3Prefix: config.get('SCB_REF3_PREFIX'),
              merchantId: config.get('SCB_MERCHANT_ID'),
              terminalId: config.get('SCB_TERMINAL_ID'),
            }),
    },
    {
      provide: TWOC2P_GATEWAY,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeTwoC2PGateway()
          : new TwoC2PAdapter({
              baseUrl: config.get('TWOC2P_BASE_URL'),
              apiVersion: config.get('TWOC2P_API_VERSION'),
              merchantId: config.get('TWOC2P_MERCHANT_ID'),
              secretKey: config.get('TWOC2P_SECRET_KEY'),
              paymentActionUrl: config.get('TWOC2P_PAYMENT_ACTION_URL'),
              merchantPrivateKeyPem: config.get('TWOC2P_MERCHANT_PRIVATE_KEY'),
              twoc2pPublicKeyPem: config.get('TWOC2P_PUBLIC_KEY'),
            }),
    },
    {
      provide: SLIP_VERIFIER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeSlipVerifier()
          : new Slip2GoAdapter({
              apiUrl: config.get('SLIP2GO_API_URL'),
              secretKey: config.get('SLIP2GO_SECRET_KEY'),
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
              creditType: config.get('THAIBULKSMS_FORCE'),
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
    {
      provide: EMAIL_SENDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeEmailSender()
          : new SesEmailSender({
              region: config.get('SES_REGION') ?? config.get('AWS_REGION'),
              endpoint: config.get('AWS_ENDPOINT_URL'),
              from: config.get('SES_FROM_ADDRESS'),
            }),
    },
    {
      provide: LINE_MESSAGING,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeLineMessaging()
          : new LineMessagingClient(config.get('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN')),
    },
    {
      provide: WEB_PUSH,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeWebPush()
          : new VapidWebPush({
              publicKey: config.get('VAPID_PUBLIC_KEY'),
              privateKey: config.get('VAPID_PRIVATE_KEY'),
              subject: config.get('VAPID_SUBJECT'),
            }),
    },
    {
      provide: WEBHOOK_SENDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakeWebhookSender() : new HttpWebhookSender(),
    },
    {
      provide: TEAMS_WEBHOOK,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeTeamsWebhook()
          : new TeamsWebhookClient(
              new AwsSecretsProvider({
                region: config.get('AWS_REGION'),
                endpoint: config.get('AWS_ENDPOINT_URL'),
              }),
            ),
    },
    {
      provide: PDF_RENDERER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakePdfRenderer() : new PuppeteerPdfRenderer(config.get('PDF_CHROMIUM_PATH')),
    },
    {
      provide: SECRETS_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes
          ? new FakeSecretsProvider({}, { fake: 'true' })
          : new AwsSecretsProvider({
              region: config.get('AWS_REGION'),
              endpoint: config.get('AWS_ENDPOINT_URL'),
            }),
    },
    {
      // Fallback carriers (D-013, D-114): one adapter per carrier, fakes in tests and `pnpm dev`.
      provide: CARRIER_ADAPTERS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new Map<string, CarrierAdapter>(
          (config.useFakes
            ? [new FakeCarrierAdapter('flash_express'), new FakeCarrierAdapter('deliveree')]
            : [new FlashExpressAdapter(), new DelivereeAdapter()]
          ).map((a) => [a.code, a]),
        ),
    },
    {
      // @getpack/dieline (B4.1): unavailable until getpack-web publishes it; the `drawing.engine` flag gates use.
      provide: DIELINE_ENGINE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakeDielineEngine() : new GetpackDielineEngine(),
    },
    {
      // Real mode: ClamAV (clamd) when CLAMAV_HOST is set; otherwise files stay `pending` (never served unscanned).
      provide: VIRUS_SCANNER,
      inject: [AppConfig, OBJECT_STORAGE],
      useFactory: (config: AppConfig, storage: ObjectStorage) => {
        if (config.useFakes) return new FakeVirusScanner();
        const host = config.get('CLAMAV_HOST');
        if (!host) return new ExternalScanPending();
        return new ClamdScanner(
          {
            host,
            port: config.get('CLAMAV_PORT'),
            maxBytes: config.get('CLAMAV_MAX_BYTES'),
            timeoutMs: config.get('CLAMAV_TIMEOUT_MS'),
          },
          storage,
        );
      },
    },
  ],
  exports: [
    SCB_GATEWAY,
    TWOC2P_GATEWAY,
    SLIP_VERIFIER,
    VIRUS_SCANNER,
    OBJECT_STORAGE,
    SMS_SENDER,
    FIREBASE_VERIFIER,
    LINE_VERIFIER,
    EMAIL_SENDER,
    LINE_MESSAGING,
    WEB_PUSH,
    TEAMS_WEBHOOK,
    WEBHOOK_SENDER,
    MATERIAL_PRICE_INDEX,
    SECRETS_PROVIDER,
    CARRIER_ADAPTERS,
    PDF_RENDERER,
    DIELINE_ENGINE,
  ],
})
export class IntegrationsModule {
  constructor() {
    // The shared adapters (@collective/integrations, D-435) log through Nest's logger.
    setIntegrationsLogger(new Logger('Integrations'));
  }
}
