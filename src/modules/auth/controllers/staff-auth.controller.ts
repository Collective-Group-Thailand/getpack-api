import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { StaffLoginDto, TOKEN_PAIR_EXAMPLE, TokenPairDto } from '../auth.dto';
import { PasswordLoginService } from '../login/password-login.service';
import { LOGIN_THROTTLE, toTokenPairDto } from './token-pair.mapper';

@ApiSurface('auth', 'staff')
@Controller('staff')
export class StaffAuthController {
  constructor(private readonly logins: PasswordLoginService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiEndpoint({
    id: 'auth.staff.login',
    summary: 'Sign in a getpack staff member',
    description:
      'E-mail + password (argon2id). Returns a staff-audience token pair (contract §4). Repeated failures lock ' +
      'the account for a while (`auth.password_lockout`); unknown e-mails and wrong passwords return the same problem.',
    implements: ['ADR-0004', 'D-140'],
  })
  @ApiBody({
    type: StaffLoginDto,
    examples: {
      default: { value: { email: 'finance.one@example.com', password: 'correct horse battery staple' } },
    },
  })
  @ApiSuccess(200, { description: 'Signed in', type: TokenPairDto, example: TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.invalid_credentials',
    'auth.account_locked',
    'auth.account_inactive',
  )
  async login(@Body() body: StaffLoginDto): Promise<TokenPairDto> {
    return toTokenPairDto(await this.logins.withPassword('staff', body.email, body.password));
  }
}
