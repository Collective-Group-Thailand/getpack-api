import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PARTNER_TOKEN_PAIR_EXAMPLE, PartnerLoginDto, TokenPairDto } from '../auth.dto';
import { PasswordLoginService } from '../login/password-login.service';
import { LOGIN_THROTTLE, toTokenPairDto } from './token-pair.mapper';

@ApiSurface('auth', 'partner')
@Controller('partner')
export class PartnerAuthController {
  constructor(private readonly logins: PasswordLoginService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiEndpoint({
    id: 'auth.partner.login',
    summary: 'Sign in a partner-factory user',
    description:
      'Either e-mail + password, or e-mail + `deviceId` + `pin` on a device whose PIN the user registered ' +
      "(`POST /v1/partner/me/device-pins`). The token carries the factory scopes of the user's roles " +
      '(`factory:<uuid>`); a user without an available factory scope is refused with `auth.scope_unavailable`.',
    implements: ['ADR-0004', 'D-140', 'D-011'],
  })
  @ApiBody({
    type: PartnerLoginDto,
    examples: {
      password: { value: { email: 'planner@factory.example', password: 'correct horse battery staple' } },
      devicePin: { value: { email: 'planner@factory.example', deviceId: 'tablet-line-2', pin: '123456' } },
    },
  })
  @ApiSuccess(200, { description: 'Signed in', type: TokenPairDto, example: PARTNER_TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.invalid_credentials',
    'auth.pin_invalid',
    'auth.account_locked',
    'auth.account_inactive',
    'auth.scope_unavailable',
  )
  async login(@Body() body: PartnerLoginDto): Promise<TokenPairDto> {
    if (body.password && !body.pin) {
      return toTokenPairDto(await this.logins.withPassword('partner', body.email, body.password));
    }
    if (body.deviceId && body.pin && !body.password) {
      return toTokenPairDto(await this.logins.withDevicePin(body.email, body.deviceId, body.pin));
    }
    throw new DomainException('validation.failed', {
      errors: [{ path: 'password', code: 'one_of', message: 'Send either password, or deviceId and pin' }],
    });
  }
}
