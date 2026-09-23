import { OptionalActor, OptionalAuth } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CUSTOMER_TOKEN_PAIR_EXAMPLE,
  FirebaseLoginDto,
  LineLoginDto,
  OtpChallengeDto,
  OtpRequestDto,
  OtpVerifyDto,
  TokenPairDto,
} from '../auth.dto';
import { CustomerLoginService } from '../login/customer-login.service';
import { OtpService } from '../login/otp.service';
import { toE164 } from '../login/phone';
import { LOGIN_THROTTLE, toTokenPairDto } from './token-pair.mapper';

const OTP_EXAMPLE: OtpChallengeDto = {
  challengeId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de',
  expiresAt: '2026-09-23T14:10:00+07:00',
  resendAvailableAt: '2026-09-23T14:06:00+07:00',
};

const signedInCustomer = (actor: Actor | undefined) =>
  actor?.type === 'user' && actor.audience === 'customer' ? actor : undefined;

@ApiSurface('auth', 'customer')
@Controller('customer')
export class CustomerAuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly logins: CustomerLoginService,
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
      'phone, creating the account on first use (`customer.registered` event).',
    implements: ['ADR-0004'],
  })
  @ApiBody({
    type: OtpVerifyDto,
    examples: { default: { value: { challengeId: OTP_EXAMPLE.challengeId, code: '123456' } } },
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
  async verifyOtp(@Body() body: OtpVerifyDto): Promise<TokenPairDto> {
    return toTokenPairDto(await this.logins.withOtp(body.challengeId, body.code));
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
      'are never linked by e-mail alone.',
    implements: ['ADR-0004'],
  })
  @ApiBody({
    type: FirebaseLoginDto,
    examples: {
      default: {
        value: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImV4YW1wbGUifQ.eyJzdWIiOiJleGFtcGxlIn0.c2ln' },
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
    return toTokenPairDto(await this.logins.withFirebase(body.idToken, signedInCustomer(actor)));
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
      'verified `link_phone` OTP (`otpChallengeId` + `otpCode`, account created if new), else a new customer is created.',
    implements: ['ADR-0004', 'D-151'],
  })
  @ApiBody({
    type: LineLoginDto,
    examples: {
      liff: { value: { liffAccessToken: 'liff-access-token-example' } },
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
    return toTokenPairDto(await this.logins.withLine(body, signedInCustomer(actor)));
  }
}
