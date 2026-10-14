import { AppConfig } from '@config/app-config';
import { Global, Module } from '@nestjs/common';

import { CARRIER_ADAPTERS, type CarrierAdapter } from './carriers/carrier-adapter.port';
import { DelivereeAdapter } from './carriers/deliveree.adapter';
import { FakeCarrierAdapter } from './carriers/fake-carrier.adapter';
import { FlashExpressAdapter } from './carriers/flash-express.adapter';
import { DIELINE_ENGINE } from './dieline/dieline-engine.port';
import { FakeDielineEngine } from './dieline/fake-dieline.engine';
import { PackioDielineEngine } from './dieline/packio-dieline.engine';
import { EMAIL_SENDER } from './email/email-sender.port';
import { FakeEmailSender } from './email/fake-email-sender';
import { SesEmailSender } from './email/ses-email-sender';
import { FakeFirebaseVerifier, FakeLineVerifier } from './identity/fake-identity-verifiers';
import { JoseFirebaseVerifier } from './identity/firebase-verifier';
import { FIREBASE_VERIFIER, LINE_VERIFIER } from './identity/identity-verifier.port';
import { LineLoginVerifier } from './identity/line-verifier';
import { FakeLineMessaging } from './line-messaging/fake-line-messaging';
import { LINE_MESSAGING } from './line-messaging/line-messaging.port';
import { LineMessagingClient } from './line-messaging/line-messaging-client';
import { FakeIndexSource } from './material-price-index/fake-index-source';
import { ManualIndexSource } from './material-price-index/manual-index-source';
import { MATERIAL_PRICE_INDEX } from './material-price-index/material-price-index.port';
import { FakeScbGateway, FakeSlipVerifier, FakeTwoC2PGateway } from './payments/fake-payment-gateways';
import { SCB_GATEWAY, SLIP_VERIFIER, TWOC2P_GATEWAY } from './payments/payment-gateways.port';
import { ScbAdapter } from './payments/scb.adapter';
import { Slip2GoAdapter } from './payments/slip2go.adapter';
import { TwoC2PAdapter } from './payments/twoc2p.adapter';
import { FakePdfRenderer } from './pdf/fake-pdf-renderer';
import { PDF_RENDERER } from './pdf/pdf-renderer.port';
import { PuppeteerPdfRenderer } from './pdf/puppeteer-pdf-renderer';
import { FakeObjectStorage } from './s3/fake-object-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './s3/object-storage.port';
import { S3ObjectStorage } from './s3/s3-object-storage';
import { AwsSecretsProvider } from './secrets/aws-secrets.provider';
import { FakeSecretsProvider } from './secrets/fake-secrets.provider';
import { SECRETS_PROVIDER } from './secrets/secrets.port';
import { FakeSmsSender } from './sms/fake-sms-sender';
import { SMS_SENDER } from './sms/sms-sender.port';
import { ThaiBulkSmsSender } from './sms/thaibulksms-sender';
import { FakeTeamsWebhook } from './teams/fake-teams';
import { TEAMS_WEBHOOK } from './teams/teams.port';
import { TeamsWebhookClient } from './teams/teams-webhook';
import { ExternalScanPending } from './virus-scan/external-scan-pending';
import { FakeVirusScanner } from './virus-scan/fake-virus-scanner';
import { VIRUS_SCANNER } from './virus-scan/virus-scanner.port';
import { FakeWebPush } from './web-push/fake-web-push';
import { VapidWebPush } from './web-push/vapid-web-push';
import { WEB_PUSH } from './web-push/web-push.port';
import { FakeWebhookSender } from './webhooks-out/fake-webhook-sender';
import { HttpWebhookSender } from './webhooks-out/http-webhook-sender';
import { WEBHOOK_SENDER } from './webhooks-out/webhook-sender.port';

/**
 * Binds each provider port to its real adapter or its fake (`INTEGRATIONS_MODE`).
 * New providers (SES, SCB, 2C2P, LINE…) are added here by the deliverable that needs them.
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
          ? new FakeObjectStorage()
          : new S3ObjectStorage({
              region: config.get('AWS_REGION'),
              bucket: config.get('S3_BUCKET'),
              endpoint: config.get('AWS_ENDPOINT_URL'),
              forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
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
              region: config.get('AWS_REGION'),
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
      // @packio/dieline (B4.1): unavailable until packio-web publishes it; the `drawing.engine` flag gates use.
      provide: DIELINE_ENGINE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakeDielineEngine() : new PackioDielineEngine(),
    },
    {
      provide: VIRUS_SCANNER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.useFakes ? new FakeVirusScanner() : new ExternalScanPending(),
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
export class IntegrationsModule {}
