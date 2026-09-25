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

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must be a postgres:// URL' })
  DATABASE_URL!: string;

  @IsString()
  @Matches(/^rediss?:\/\//, { message: 'REDIS_URL must be a redis:// or rediss:// URL' })
  REDIS_URL!: string;

  @IsString()
  AWS_REGION = 'ap-southeast-1';

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  AWS_ENDPOINT_URL?: string;

  @IsString()
  S3_BUCKET!: string;

  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE = false;

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
  OTEL_SERVICE_NAME = 'packio-api';

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

  // --- Notifications (D-143)

  /** Verified SES sender, e.g. `Packio <no-reply@packio.example>`. */
  @IsOptional()
  @IsString()
  SES_FROM_ADDRESS?: string;

  /** LINE Messaging API channel access token (customer and staff pushes). */
  @IsOptional()
  @IsString()
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string;

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

  /** Registered sender name shown on SMS. */
  @IsOptional()
  @IsString()
  THAIBULKSMS_SENDER?: string;

  // --- Catalogue (B2.1)

  /** Public base URL of this API, for absolute links in feeds (e.g. catalogue images in the Merchant feed). */
  @Matches(/^https?:\/\/[^/]+$/, {
    message: 'PUBLIC_API_BASE_URL must be an origin without a trailing slash',
  })
  PUBLIC_API_BASE_URL = 'https://api.packio.invalid';

  /**
   * Storefront URL of a stock product for the Google Merchant feed; `{sku}` is replaced. The route
   * belongs to packio-web, so it is configuration, not code.
   */
  @Matches(/^https?:\/\/.+\{sku\}/, { message: 'MERCHANT_FEED_LINK_TEMPLATE must be a URL containing {sku}' })
  MERCHANT_FEED_LINK_TEMPLATE = 'https://www.packio.invalid/th/products/{sku}';
}
