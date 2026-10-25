import { THAIBULKSMS_CREDIT_TYPES, type ThaiBulkSmsCreditType } from '@collective/integrations/sms';
import { parseCidrList } from '@common/http/cidr';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** `real` talks to AWS and third-party providers; `fake` uses the in-memory fakes (tests, `pnpm dev`, contract build). */
export enum IntegrationsMode {
  Real = 'real',
  Fake = 'fake',
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no', ''].includes(value.toLowerCase())) return false;
  return value;
};

@ValidatorConstraint({ name: 'isCidrList' })
class IsCidrList implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      parseCidrList(value);
      return true;
    } catch {
      return false;
    }
  }
}

const toNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;

/**
 * Every environment variable the processes read. Documented in `.env.example`.
 * Business values never live here — they are effective-dated settings (ADR-0005).
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @Transform(toBoolean)
  @IsBoolean()
  LOG_PRETTY = false;

  @IsEnum(IntegrationsMode)
  INTEGRATIONS_MODE: IntegrationsMode = IntegrationsMode.Fake;

  /** Per-provider override for object storage; defaults to `INTEGRATIONS_MODE` when unset. */
  @IsOptional()
  @IsEnum(IntegrationsMode)
  OBJECT_STORAGE_MODE?: IntegrationsMode;

  /** Fake object storage only: a directory that keeps every object on disk across processes and restarts. */
  @IsOptional()
  @IsString()
  FAKE_OBJECT_STORAGE_DIR?: string;

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must be a postgres:// URL' })
  DATABASE_URL!: string;

  @IsString()
  @Matches(/^rediss?:\/\//, { message: 'REDIS_URL must be a redis:// or rediss:// URL' })
  REDIS_URL!: string;

  @IsString()
  AWS_REGION = 'ap-southeast-1';

  /**
   * Region for Amazon SES when it differs from AWS_REGION — SES is not offered in every region
   * (e.g. ap-southeast-7, Thailand), so mail goes out of ap-southeast-1. Unset: AWS_REGION.
   */
  @IsOptional()
  @IsString()
  SES_REGION?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  AWS_ENDPOINT_URL?: string;

  @IsString()
  S3_BUCKET!: string;

  // --- Malware scanning (D-005 media). Real mode without CLAMAV_HOST keeps every upload `pending`.

  /** clamd host (the platform's `clamav` container). */
  @IsOptional()
  @IsString()
  CLAMAV_HOST?: string;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  CLAMAV_PORT = 3310;

  /** Bytes of each object sent to clamd; must stay below clamd's StreamMaxLength (platform clamd.conf). */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  CLAMAV_MAX_BYTES = 512 * 1024 * 1024;

  @Transform(toNumber)
  @IsInt()
  @Min(1000)
  CLAMAV_TIMEOUT_MS = 120_000;

  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE = false;

  /**
   * Prepended to every object key, for a bucket shared with another system (e.g. `getpack/`). Empty: keys
   * at the bucket root. Keep the endpoint empty for real AWS rather than putting a path in it.
   */
  @IsOptional()
  @IsString()
  @Matches(/^([A-Za-z0-9._-]+\/)*$/, { message: 'S3_KEY_PREFIX: path segments ending in /, e.g. getpack/' })
  S3_KEY_PREFIX?: string;

  @IsOptional()
  @IsString()
  AWS_SECRETS_ID?: string;

  @Transform(toBoolean)
  @IsBoolean()
  DOCS_ENABLED = false;

  /**
   * Who may open /docs* outside development/test (contract §5): comma-separated IPs/CIDRs.
   * Empty = nobody on IP alone; staff tokens with `settings.read` are always accepted (B1.3).
   */
  @IsOptional()
  @IsString()
  @Validate(IsCidrList)
  DOCS_ALLOWED_CIDRS?: string;

  /** Number of trusted reverse-proxy hops in front of the API (Express `trust proxy`); 0 = none. */
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY = 0;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS = 60;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 300;

  /** Sign-in attempts per IP per minute on password/OTP/client-credential endpoints (brute-force guard). */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  AUTH_LOGIN_THROTTLE_LIMIT = 10;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  SENTRY_DSN?: string;

  @Transform(toNumber)
  @IsNumber()
  @Min(0)
  @Max(1)
  SENTRY_TRACES_SAMPLE_RATE = 0;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsString()
  OTEL_SERVICE_NAME = 'getpack-api';

  // --- Auth (ADR-0004). Secrets: from Secrets Manager in real environments, never committed.

  /**
   * JSON array of Ed25519 private JWKs, each with a `kid`; the first signs, the others still verify
   * (rotation). Required in production; development and tests generate an ephemeral key.
   */
  @IsOptional()
  @IsString()
  JWT_SIGNING_KEYS?: string;

  /** HMAC key for OTP codes (≥ 32 chars). Required in production. */
  @IsOptional()
  @IsString()
  @MinLength(32)
  OTP_HMAC_SECRET?: string;

  /** Firebase project whose Google/Apple ID tokens customers exchange. */
  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  /** LINE Login channel id (also the LIFF app's channel); ID tokens must carry it as `aud`. */
  @IsOptional()
  @IsString()
  LINE_LOGIN_CHANNEL_ID?: string;

  @IsOptional()
  @IsString()
  THAIBULKSMS_API_KEY?: string;

  @IsOptional()
  @IsString()
  THAIBULKSMS_API_SECRET?: string;

  // --- Payments (B3.2, D-176; docs/integrations/payment-providers.md). Optional: an adapter without its
  // configuration refuses with `provider.unavailable`, and each method stays behind its feature flag.

  /** SCB Open API host, e.g. `https://api-sandbox.partners.scb/partners/sandbox`. */
  @IsOptional()
  @IsString()
  SCB_API_BASE_URL?: string;

  @IsOptional()
  @IsString()
  SCB_API_KEY?: string;

  @IsOptional()
  @IsString()
  SCB_API_SECRET?: string;

  /** QR 30 Biller ID (15 digits) and the Ref3 prefix of the SCB merchant profile. */
  @IsOptional()
  @IsString()
  SCB_BILLER_ID?: string;

  @IsOptional()
  @IsString()
  SCB_REF3_PREFIX?: string;

  /** QR CS merchant and terminal. */
  @IsOptional()
  @IsString()
  SCB_MERCHANT_ID?: string;

  @IsOptional()
  @IsString()
  SCB_TERMINAL_ID?: string;

  /** 2C2P PGW host (`https://sandbox-pgw.2c2p.com` or `https://pgw.2c2p.com`) and API version. */
  @IsOptional()
  @IsString()
  TWOC2P_BASE_URL?: string;

  @IsOptional()
  @IsString()
  TWOC2P_API_VERSION?: string;

  @IsOptional()
  @IsString()
  TWOC2P_MERCHANT_ID?: string;

  /** HS256 merchant secret key (payment token, inquiry, backend notifications). */
  @IsOptional()
  @IsString()
  TWOC2P_SECRET_KEY?: string;

  /** Refunds (Payment Process API): endpoint, merchant private key (PKCS#8 PEM), 2C2P public key (PEM). */
  @IsOptional()
  @IsString()
  TWOC2P_PAYMENT_ACTION_URL?: string;

  @IsOptional()
  @IsString()
  TWOC2P_MERCHANT_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  TWOC2P_PUBLIC_KEY?: string;

  /** Slip2Go API host and secret key (slip verification, D-061). */
  @IsOptional()
  @IsString()
  SLIP2GO_API_URL?: string;

  @IsOptional()
  @IsString()
  SLIP2GO_SECRET_KEY?: string;

  /** Public URL of this API (webhook callbacks) and of the storefront (2C2P browser return). */
  @IsOptional()
  @IsString()
  STOREFRONT_BASE_URL?: string;

  /** D-308: where the web app revalidates cached cards (POST `{ tags }`); unset → tags are only recorded. */
  @IsOptional()
  @IsString()
  STOREFRONT_REVALIDATE_URL?: string;

  /** D-308: HMAC-SHA256 key of the revalidation POST (`X-Getpack-Signature`). */
  @IsOptional()
  @IsString()
  STOREFRONT_REVALIDATE_SECRET?: string;

  // --- Notifications (D-143)

  /** Verified SES sender, e.g. `getpack <no-reply@getpack.example>`. */
  @IsOptional()
  @IsString()
  SES_FROM_ADDRESS?: string;

  /** LINE Messaging API channel access token (customer and staff pushes). */
  @IsOptional()
  @IsString()
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string;

  /** LINE Messaging API channel secret: verifies `x-line-signature` on the OA webhook (B4.6). */
  @IsOptional()
  @IsString()
  LINE_MESSAGING_CHANNEL_SECRET?: string;

  /** LINE Messaging API channel id (the OA the webhook belongs to). */
  @IsOptional()
  @IsString()
  LINE_MESSAGING_CHANNEL_ID?: string;

  /** Web push VAPID key pair (base64url) and contact (`mailto:` or URL). */
  @IsOptional()
  @IsString()
  VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_SUBJECT?: string;

  /**
   * AES-256-GCM key (base64, 32 bytes) for secrets stored in the database (web-push auth secrets).
   * Required in production; development and tests derive a per-process key.
   */
  @IsOptional()
  @IsString()
  FIELD_ENCRYPTION_KEY?: string;

  /** Chromium used by the PDF renderer (installed in the Docker image with Thai fonts). */
  @IsOptional()
  @IsString()
  PDF_CHROMIUM_PATH?: string;

  /** Registered sender name shown on SMS. */
  @IsOptional()
  @IsString()
  THAIBULKSMS_SENDER?: string;

  /** Credit type the sender is approved for (`force`); unset lets the provider choose. */
  @IsOptional()
  @IsIn(THAIBULKSMS_CREDIT_TYPES)
  THAIBULKSMS_FORCE?: ThaiBulkSmsCreditType;

  /**
   * HMAC key (≥ 32 characters) for lookup hashes of sensitive numbers, e.g. vendor bank accounts for
   * duplicate detection (accounting-design.md §8). Required in production; development and tests
   * derive a fixed key.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  LOOKUP_HMAC_SECRET?: string;

  // --- Catalogue (B2.1)

  /** Public base URL of this API, for absolute links in feeds (e.g. catalogue images in the Merchant feed). */
  @Matches(/^https?:\/\/[^/]+$/, {
    message: 'PUBLIC_API_BASE_URL must be an origin without a trailing slash',
  })
  PUBLIC_API_BASE_URL = 'https://api.getpack.invalid';

  /**
   * Storefront URL of a stock product for the Google Merchant feed; `{sku}` is replaced. The route
   * belongs to getpack-web, so it is configuration, not code.
   */
  @Matches(/^https?:\/\/.+\{sku\}/, { message: 'MERCHANT_FEED_LINK_TEMPLATE must be a URL containing {sku}' })
  MERCHANT_FEED_LINK_TEMPLATE = 'https://www.getpack.invalid/th/products/{sku}';
}
