import { CurrentActor, OptionalActor, OptionalAuth } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiRequiredAuth, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CreateHandoffDto,
  CUSTOMER_TOKEN_PAIR_EXAMPLE,
  CustomerOtpVerifyDto,
  FirebaseLoginDto,
  HandoffCodeDto,
  LineLoginDto,
  OtpChallengeDto,
  OtpRequestDto,
  RedeemHandoffDto,
  TokenPairDto,
} from '../auth.dto';
import { CustomerLoginService } from '../login/customer-login.service';
import { HandoffService } from '../login/handoff.service';
import { OtpService } from '../login/otp.service';
import { toE164 } from '../login/phone';
import { LOGIN_THROTTLE, toTokenPairDto } from './token-pair.mapper';

const OTP_EXAMPLE: OtpChallengeDto = {
  challengeId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de',
  expiresAt: '2026-09-23T14:10:00+07:00',
  resendAvailableAt: '2026-09-23T14:06:00+07:00',
  codeLength: 6,
  maxAttempts: 5,
};

const signedInCustomer = (actor: Actor | undefined) =>
  actor?.type === 'user' && actor.audience === 'customer' ? actor : undefined;

@ApiSurface('auth', 'customer')
@Controller('customer')
export class CustomerAuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly logins: CustomerLoginService,
    private readonly handoffs: HandoffService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'auth.customer.requestOtp',
    summary: 'Send a one-time code by SMS',
    description:
      'Sends a 6-digit code to the phone (ThaiBulkSMS; SMS is used for OTP per D-143). Limits from ' +
      '`auth.otp_policy`: resend cool-down, requests per phone and per IP per hour → 429 `auth.otp_rate_limited` ' +
      'with `Retry-After`. `purpose: link_phone` verifies a phone to link a LINE account.',
    implements: ['ADR-0004', 'D-143'],
  })
  @ApiBody({
    type: OtpRequestDto,
    examples: { default: { value: { phone: '081-000-1234', purpose: 'login' } } },
  })
  @ApiSuccess(200, { description: 'Code sent', type: OtpChallengeDto, example: OTP_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.otp_rate_limited',
    'provider.unavailable',
  )
  async requestOtp(@Body() body: OtpRequestDto): Promise<OtpChallengeDto> {
    const phone = toE164(body.phone);
    if (!phone) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'phone', code: 'phone', message: 'Not a valid phone number' }],
      });
    }
    const issued = await this.otp.request(phone, body.purpose ?? 'login', RequestContext.current()?.ip);
    return {
      challengeId: issued.challengeId,
      expiresAt: toBangkokIso(issued.expiresAt),
      resendAvailableAt: toBangkokIso(issued.resendAvailableAt),
      codeLength: issued.codeLength,
      maxAttempts: issued.maxAttempts,
    };
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiEndpoint({
    id: 'auth.customer.verifyOtp',
    summary: 'Sign in with the SMS code',
    description:
      'Checks the code (limited attempts per challenge; a code works once). Signs in the customer with that ' +
      'phone, creating the account on first use (`customer.registered` event). `client: agent` opens an ' +
      'agent-zone session (agent.getpack.co), separate from storefront sessions (D-467).',
    implements: ['ADR-0004', 'D-467'],
  })
  @ApiBody({
    type: CustomerOtpVerifyDto,
    examples: {
      default: { value: { challengeId: OTP_EXAMPLE.challengeId, code: '123456' } },
      agentZone: { value: { challengeId: OTP_EXAMPLE.challengeId, code: '123456', client: 'agent' } },
    },
  })
  @ApiSuccess(200, { description: 'Signed in', type: TokenPairDto, example: CUSTOMER_TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.otp_invalid',
    'auth.otp_expired',
    'auth.account_inactive',
  )
  async verifyOtp(@Body() body: CustomerOtpVerifyDto): Promise<TokenPairDto> {
    return toTokenPairDto(await this.logins.withOtp(body.challengeId, body.code, body.client));
  }

  @Post('firebase')
  @HttpCode(200)
  @OptionalAuth('customer')
  @ApiEndpoint({
    id: 'auth.customer.firebase',
    summary: 'Sign in with Google or Apple (Firebase ID token)',
    description:
      'Exchanges a Firebase Auth ID token. A known identity signs in its customer; a new one is linked to the ' +
      'signed-in customer when a customer bearer token is sent, otherwise a new customer is created. Accounts ' +
      'are never linked by e-mail alone. `client: agent` opens an agent-zone session (D-467).',
    implements: ['ADR-0004', 'D-467'],
  })
  @ApiBody({
    type: FirebaseLoginDto,
    examples: {
      default: {
        value: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImV4YW1wbGUifQ.eyJzdWIiOiJleGFtcGxlIn0.c2ln' },
      },
      agentZone: {
        value: {
          idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImV4YW1wbGUifQ.eyJzdWIiOiJleGFtcGxlIn0.c2ln',
          client: 'agent',
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Signed in', type: TokenPairDto, example: CUSTOMER_TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.identity_token_invalid',
    'auth.identity_linked_elsewhere',
    'auth.account_inactive',
    'auth.unauthenticated',
    'auth.token_expired',
    'provider.unavailable',
  )
  async firebase(@Body() body: FirebaseLoginDto, @OptionalActor() actor?: Actor): Promise<TokenPairDto> {
    return toTokenPairDto(await this.logins.withFirebase(body.idToken, signedInCustomer(actor), body.client));
  }

  @Post('line')
  @HttpCode(200)
  @OptionalAuth('customer')
  @ApiEndpoint({
    id: 'auth.customer.line',
    summary: 'Sign in with LINE (LINE Login or LIFF)',
    description:
      'Send a LINE Login `idToken` (web) or a `liffAccessToken` (inside LINE, D-151). A known LINE account signs ' +
      'in its customer. A new one is linked: to the signed-in customer (bearer token), else to the customer of a ' +
      'verified `link_phone` OTP (`otpChallengeId` + `otpCode`, account created if new), else a new customer is created. ' +
      '`client: agent` opens an agent-zone session (D-467).',
    implements: ['ADR-0004', 'D-151', 'D-467'],
  })
  @ApiBody({
    type: LineLoginDto,
    examples: {
      liff: { value: { liffAccessToken: 'liff-access-token-example' } },
      agentZone: { value: { idToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.c2ln', client: 'agent' } },
      linkPhone: {
        value: {
          idToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.c2ln',
          otpChallengeId: OTP_EXAMPLE.challengeId,
          otpCode: '123456',
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Signed in', type: TokenPairDto, example: CUSTOMER_TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.identity_token_invalid',
    'auth.identity_linked_elsewhere',
    'auth.otp_invalid',
    'auth.otp_expired',
    'auth.account_inactive',
    'auth.unauthenticated',
    'auth.token_expired',
    'provider.unavailable',
  )
  async line(@Body() body: LineLoginDto, @OptionalActor() actor?: Actor): Promise<TokenPairDto> {
    if (!body.idToken === !body.liffAccessToken) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'idToken', code: 'one_of', message: 'Send exactly one of idToken or liffAccessToken' },
        ],
      });
    }
    return toTokenPairDto(await this.logins.withLine(body, signedInCustomer(actor), body.client));
  }

  // --- storefront → agent zone hand-off (D-467) ----------------------------------------------------------------

  @Post('handoff')
  @OptionalAuth('customer')
  @ApiRequiredAuth('customer')
  @ApiEndpoint({
    id: 'auth.customerHandoff.create',
    summary: 'Get a one-time code to open the agent zone',
    description:
      'The signed-in customer (storefront session) asks for a code that opens the agent zone (agent.getpack.co) ' +
      'without sharing a cookie across subdomains (D-467, PLAN A-08). The code is single use, valid for the setting ' +
      '`auth.handoff_code_ttl_seconds` (60 s), bound to `target` and to the device `fingerprint` the web server ' +
      'sends; only SHA-256 hashes are stored. Audited (`auth.handoff_created`). Redeem it with ' +
      '`auth.customerHandoff.redeem` from the agent zone’s server.',
    implements: ['ADR-0004', 'D-467'],
  })
  @ApiBody({
    type: CreateHandoffDto,
    examples: { default: { value: { target: 'agent', fingerprint: 'fp_example_7c1e9b1f3c4d5e6f' } } },
  })
  @ApiSuccess(201, {
    description: 'Code issued',
    type: HandoffCodeDto,
    example: {
      code: 'hc_example_Zm9vYmFyYmF6cXV4cXV1eGNvcmdl',
      expiresAt: '2026-11-03T14:06:00+07:00',
      target: 'agent',
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.wrong_audience')
  async createHandoff(@CurrentActor() actor: Actor, @Body() body: CreateHandoffDto): Promise<HandoffCodeDto> {
    const me = signedInCustomer(actor);
    if (!me) throw new DomainException('auth.unauthenticated');
    const issued = await this.handoffs.create(me, body);
    return { code: issued.code, expiresAt: toBangkokIso(issued.expiresAt), target: body.target };
  }

  @Post('handoff/actions/redeem')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiEndpoint({
    id: 'auth.customerHandoff.redeem',
    summary: 'Exchange a hand-off code for an agent-zone session',
    description:
      'Called by the agent zone’s server with the code and the same device fingerprint (D-467). Returns a NEW token ' +
      'pair whose session has client `agent` (its own session family, listed and revoked separately from the ' +
      'storefront). An unknown, expired, used or other-device code, or an account no longer active, answers one ' +
      'neutral 401 `auth.handoff_invalid`; a wrong fingerprint also uses the code up. Audited.',
    implements: ['ADR-0004', 'D-467'],
  })
  @ApiBody({
    type: RedeemHandoffDto,
    examples: {
      default: {
        value: {
          code: 'hc_example_Zm9vYmFyYmF6cXV4cXV1eGNvcmdl',
          fingerprint: 'fp_example_7c1e9b1f3c4d5e6f',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Signed in to the agent zone',
    type: TokenPairDto,
    example: CUSTOMER_TOKEN_PAIR_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.handoff_invalid')
  async redeemHandoff(@Body() body: RedeemHandoffDto): Promise<TokenPairDto> {
    return toTokenPairDto(await this.handoffs.redeem(body.code, body.fingerprint));
  }
}
