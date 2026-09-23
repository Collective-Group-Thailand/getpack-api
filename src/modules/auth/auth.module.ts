import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthTokensService } from './auth-tokens.service';
import { AuthGuard } from './guards/auth.guard';
import { ClientCredentialsService } from './login/client-credentials.service';
import { CustomerLoginService } from './login/customer-login.service';
import { OtpService } from './login/otp.service';
import { PasswordLoginService } from './login/password-login.service';
import { PasswordService } from './password.service';
import { PrincipalService } from './principal.service';
import { SessionService } from './sessions/session.service';
import { SigningKeys } from './tokens/signing-keys';
import { TokenService } from './tokens/token.service';

const SERVICES = [
  SigningKeys,
  TokenService,
  PasswordService,
  SessionService,
  PrincipalService,
  AuthTokensService,
  OtpService,
  PasswordLoginService,
  CustomerLoginService,
  ClientCredentialsService,
  AuthGuard,
];

/** Authentication (ADR-0004). Controllers live in the surface modules; the guard is global. */
@Global()
@Module({
  providers: [...SERVICES, { provide: APP_GUARD, useExisting: AuthGuard }],
  exports: SERVICES,
})
export class AuthModule {}
