import { Public } from '@common/auth/auth.decorators';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ClientCredentialsDto,
  ClientCredentialsTokenDto,
  JwksDto,
  RefreshDto,
  TOKEN_PAIR_EXAMPLE,
  TokenPairDto,
} from '../auth.dto';
import { AuthTokensService } from '../auth-tokens.service';
import { ClientCredentialsService } from '../login/client-credentials.service';
import { SessionService } from '../sessions/session.service';
import { SigningKeys } from '../tokens/signing-keys';
import { LOGIN_THROTTLE, toTokenPairDto } from './token-pair.mapper';

@ApiSurface('auth', 'tokens')
@Controller()
export class TokensController {
  constructor(
    private readonly sessions: SessionService,
    private readonly tokens: AuthTokensService,
    private readonly clients: ClientCredentialsService,
    private readonly keys: SigningKeys,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'auth.tokens.refresh',
    summary: 'Rotate a refresh token',
    description:
      'Exchanges a refresh token for a new token pair; the old refresh token stops working. Presenting a refresh ' +
      'token that was already used revokes the whole session (`auth.refresh_reused`, theft detection).',
    implements: ['ADR-0004'],
  })
  @ApiBody({
    type: RefreshDto,
    examples: { default: { value: { refreshToken: TOKEN_PAIR_EXAMPLE.refreshToken } } },
  })
  @ApiSuccess(200, { description: 'New token pair', type: TokenPairDto, example: TOKEN_PAIR_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.refresh_invalid',
    'auth.refresh_reused',
    'auth.scope_unavailable',
  )
  async refresh(@Body() body: RefreshDto): Promise<TokenPairDto> {
    const result = await this.sessions.rotate(body.refreshToken);
    if (!result.ok)
      throw new DomainException(result.reason === 'reused' ? 'auth.refresh_reused' : 'auth.refresh_invalid');
    return toTokenPairDto(await this.tokens.forRotated(result.userId, result.audience, result.session));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiEndpoint({
    id: 'auth.tokens.logout',
    summary: 'Sign out (revoke the session)',
    description:
      'Revokes the session of the refresh token, including access tokens already issued for it. Unknown or ' +
      'already revoked tokens also return 204.',
    implements: ['ADR-0004'],
  })
  @ApiBody({
    type: RefreshDto,
    examples: { default: { value: { refreshToken: TOKEN_PAIR_EXAMPLE.refreshToken } } },
  })
  @ApiSuccess(204, { description: 'Signed out' })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async logout(@Body() body: RefreshDto): Promise<void> {
    await this.sessions.logout(body.refreshToken);
  }

  @Post('token')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiEndpoint({
    id: 'auth.tokens.clientCredentials',
    summary: 'Get a token for a machine client (OAuth2 client credentials)',
    description:
      'RFC 6749 §4.4 for factory systems and company API clients. Client id and secret in HTTP Basic auth or in ' +
      'the body. The response follows RFC 6749 (snake_case fields); errors are problem details like every other ' +
      "endpoint. A factory's client gets a `partner` token with its factory scope (`/v1/partner`), a company's " +
      'client a `b2b` token with its company scope and `b2b_*` scopes (`/v1/b2b`, D-291); there is no refresh token.',
    implements: ['ADR-0004', 'D-291'],
  })
  @ApiBody({
    type: ClientCredentialsDto,
    examples: {
      default: {
        value: {
          grant_type: 'client_credentials',
          client_id: 'pc_example_factory_erp',
          client_secret: 'example-client-secret',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Access token',
    type: ClientCredentialsTokenDto,
    example: {
      access_token: TOKEN_PAIR_EXAMPLE.accessToken,
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'factory:0192f3a0-7c1e-7d2a-9b1f-000000000f01',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'auth.invalid_client',
    'auth.scope_unavailable',
  )
  async clientCredentials(
    @Body() body: ClientCredentialsDto,
    @Headers('authorization') authorization?: string,
  ): Promise<ClientCredentialsTokenDto> {
    const basic = parseBasic(authorization);
    const clientId = basic?.id ?? body.client_id;
    const secret = basic?.secret ?? body.client_secret;
    if (!clientId || !secret) throw new DomainException('auth.invalid_client');
    return this.clients.issue(clientId, secret);
  }

  @Get('.well-known/jwks.json')
  @Public()
  @ApiEndpoint({
    id: 'auth.tokens.jwks',
    summary: 'Public keys that verify access tokens',
    description:
      'JWKS of the Ed25519 keys (EdDSA) that sign access tokens; during rotation it lists old and new keys.',
    implements: ['ADR-0004'],
  })
  @ApiSuccess(200, {
    description: 'Key set',
    type: JwksDto,
    example: {
      keys: [
        {
          kty: 'OKP',
          crv: 'Ed25519',
          x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
          kid: 'getpack-2026-09',
          alg: 'EdDSA',
          use: 'sig',
        },
      ],
    },
  })
  @ApiStandardErrors('http.not_found')
  async jwks(): Promise<JwksDto> {
    return (await this.keys.jwks()) as JwksDto;
  }
}

function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.toLowerCase().startsWith('basic ')) return null;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, separator)),
    secret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}
