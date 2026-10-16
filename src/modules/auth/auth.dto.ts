import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export const TOKEN_AUDIENCES = ['customer', 'staff', 'partner'] as const;

// --- examples (obviously fake, contract/spectral/README.md) -----------------------------------
const USER_ID = '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b';
const FACTORY_ID = '0192f3a0-7c1e-7d2a-9b1f-000000000f01';
const ACCESS_TOKEN =
  'eyJhbGciOiJFZERTQSIsImtpZCI6ImV4YW1wbGUiLCJ0eXAiOiJhdCtqd3QifQ.eyJzdWIiOiJleGFtcGxlIn0.c2lnbmF0dXJl';
const REFRESH_TOKEN = 'rt_example_Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0';

export class TokenSubjectDto {
  @ApiProperty({ format: 'uuid', example: USER_ID, description: 'Public id of the user (JWT `sub`)' })
  id!: string;

  @ApiProperty({ enum: TOKEN_AUDIENCES, enumName: 'TokenAudience', example: 'staff' })
  type!: (typeof TOKEN_AUDIENCES)[number];

  @ApiProperty({ type: [String], example: ['finance'], description: 'Role keys (D-140)' })
  roles!: string[];

  @ApiProperty({
    type: [String],
    example: ['approvals.act', 'approvals.read'],
    description: 'Permission keys `resource.action`',
  })
  permissions!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Scopes such as `factory:<uuid>` or `company:<uuid>`',
  })
  scopes!: string[];
}

export class TokenPairDto {
  @ApiProperty({ example: ACCESS_TOKEN, description: 'EdDSA JWT, 10–15 minutes (ADR-0004)' })
  accessToken!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:15:00+07:00' })
  accessTokenExpiresAt!: string;

  @ApiProperty({
    example: REFRESH_TOKEN,
    description: 'Opaque, single use; rotate with `POST /v1/auth/refresh`',
  })
  refreshToken!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-23T16:05:00+07:00',
    description: 'Idle expiry; each refresh extends it up to the absolute session lifetime',
  })
  refreshTokenExpiresAt!: string;

  @ApiProperty({ type: TokenSubjectDto })
  subject!: TokenSubjectDto;
}

export const TOKEN_PAIR_EXAMPLE: TokenPairDto = {
  accessToken: ACCESS_TOKEN,
  accessTokenExpiresAt: '2026-09-23T14:15:00+07:00',
  refreshToken: REFRESH_TOKEN,
  refreshTokenExpiresAt: '2026-09-23T16:05:00+07:00',
  subject: {
    id: USER_ID,
    type: 'staff',
    roles: ['finance'],
    permissions: ['approvals.act', 'approvals.read'],
    scopes: [],
  },
};

export const PARTNER_TOKEN_PAIR_EXAMPLE: TokenPairDto = {
  ...TOKEN_PAIR_EXAMPLE,
  subject: {
    id: USER_ID,
    type: 'partner',
    roles: ['factory_owner'],
    permissions: ['factory_profile.read', 'factory_users.manage'],
    scopes: [`factory:${FACTORY_ID}`],
  },
};

export const CUSTOMER_TOKEN_PAIR_EXAMPLE: TokenPairDto = {
  ...TOKEN_PAIR_EXAMPLE,
  subject: { id: USER_ID, type: 'customer', roles: [], permissions: [], scopes: [] },
};

// --- staff & partner ----------------------------------------------------------------------------
export class StaffLoginDto {
  @ApiProperty({ example: 'finance.one@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple', minLength: 1, maxLength: 256, format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class PartnerLoginDto {
  @ApiProperty({ example: 'planner@factory.example', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({
    example: 'correct horse battery staple',
    maxLength: 256,
    format: 'password',
    description: 'Password login',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password?: string;

  @ApiPropertyOptional({
    example: 'tablet-line-2',
    maxLength: 128,
    description: 'Device-PIN login: the registered device id',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({
    example: '123456',
    pattern: '^\\d{4,8}$',
    description: 'Device-PIN login: the PIN (`auth.device_pin_policy`)',
  })
  @IsOptional()
  @Matches(/^\d{4,8}$/)
  pin?: string;
}

export class DevicePinDto {
  @ApiProperty({ example: 'tablet-line-2', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  deviceId!: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{4,8}$' })
  @Matches(/^\d{4,8}$/)
  pin!: string;
}

// --- customer -------------------------------------------------------------------------------------
export const OTP_REQUEST_PURPOSES = ['login', 'link_phone'] as const;

export class OtpRequestDto {
  @ApiProperty({ example: '081-000-1234', description: 'Thai mobile or E.164 number' })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({
    enum: OTP_REQUEST_PURPOSES,
    enumName: 'OtpRequestPurpose',
    default: 'login',
    example: 'login',
    description: '`link_phone` = verify a phone to link a LINE account to it',
  })
  @IsOptional()
  @IsIn(OTP_REQUEST_PURPOSES)
  purpose?: (typeof OTP_REQUEST_PURPOSES)[number];
}

export class OtpChallengeDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de' })
  challengeId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:10:00+07:00' })
  expiresAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-23T14:06:00+07:00',
    description: 'When a new code may be requested',
  })
  resendAvailableAt!: string;

  @ApiProperty({
    type: 'integer',
    example: 6,
    description: 'Digits in the code sent (setting `auth.otp_policy.codeLength`); never assume 6',
  })
  codeLength!: number;

  @ApiProperty({
    type: 'integer',
    example: 5,
    description:
      'Codes that may be tried on this challenge (`auth.otp_policy.maxAttempts`); a wrong code answers `auth.otp_invalid` with `attemptsRemaining`',
  })
  maxAttempts!: number;
}

export class OtpVerifyDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{4,8}$' })
  @Matches(/^\d{4,8}$/)
  code!: string;
}

export class FirebaseLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImV4YW1wbGUifQ.eyJzdWIiOiJleGFtcGxlIn0.c2ln',
    description: 'Firebase Auth ID token (Google or Apple)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  idToken!: string;
}

export class LineLoginDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.c2ln',
    description: 'LINE Login ID token (web)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  idToken?: string;

  @ApiPropertyOptional({
    example: 'liff-access-token-example',
    description: 'LIFF access token (inside LINE, D-151)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  liffAccessToken?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de',
    description: 'Verified `link_phone` challenge to link to that phone',
  })
  @IsOptional()
  @IsUUID()
  otpChallengeId?: string;

  @ApiPropertyOptional({ example: '123456', pattern: '^\\d{4,8}$' })
  @IsOptional()
  @Matches(/^\d{4,8}$/)
  otpCode?: string;
}

// --- tokens ---------------------------------------------------------------------------------------
export class RefreshDto {
  @ApiProperty({ example: REFRESH_TOKEN })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}

export class ClientCredentialsDto {
  @ApiProperty({ enum: ['client_credentials'], enumName: 'OAuthGrantType', example: 'client_credentials' })
  @IsIn(['client_credentials'])
  grant_type!: 'client_credentials';

  @ApiPropertyOptional({ example: 'pc_example_factory_erp', description: 'Or send it in HTTP Basic auth' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  client_id?: string;

  @ApiPropertyOptional({
    example: 'example-client-secret',
    format: 'password',
    description: 'Or send it in HTTP Basic auth',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  client_secret?: string;

  @ApiPropertyOptional({
    example: 'jobs.read',
    description: 'Ignored: the token always carries the client’s configured scopes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  scope?: string;
}

export class ClientCredentialsTokenDto {
  @ApiProperty({ example: ACCESS_TOKEN })
  access_token!: string;

  @ApiProperty({ enum: ['Bearer'], enumName: 'OAuthTokenType', example: 'Bearer' })
  token_type!: 'Bearer';

  @ApiProperty({ type: 'integer', example: 600, description: 'Seconds' })
  expires_in!: number;

  @ApiProperty({ example: `factory:${FACTORY_ID}`, description: 'Space-separated scopes' })
  scope!: string;
}

export class JwkDto {
  @ApiProperty({ example: 'OKP' })
  kty!: string;

  @ApiProperty({ example: 'Ed25519' })
  crv!: string;

  @ApiProperty({ example: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' })
  x!: string;

  @ApiProperty({ example: 'getpack-2026-09' })
  kid!: string;

  @ApiProperty({ example: 'EdDSA' })
  alg!: string;

  @ApiProperty({ example: 'sig' })
  use!: string;
}

export class JwksDto {
  @ApiProperty({ type: [JwkDto] })
  keys!: JwkDto[];
}
