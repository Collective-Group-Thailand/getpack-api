import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface, type Surface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post, type Type } from '@nestjs/common';
import { ApiBody, ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

import { DeepLinksService } from './deep-links.service';

export class ResolveDeepLinkDto {
  @ApiProperty({
    example: 'sQ2hlY2tUaGlzSXNBRmFrZVRva2VuMDAw',
    description:
      'The token of `<web>/l/<token>`; its first letter names the zone (`s` store, `a` admin, `p` partner)',
  })
  @Matches(/^[sap][A-Za-z0-9_-]{32}$/)
  token!: string;
}

export class DeepLinkTargetDto {
  @ApiProperty({
    example: '/account/orders/0192f3a0-7c1e-7d2a-9b1f-0000000e7303',
    description: 'Page of this zone',
  })
  path!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-07T09:00:00+07:00' })
  expiresAt!: string;
}

const me = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

const EXAMPLE_PATH: Record<string, string> = {
  store: '/account/orders/0192f3a0-7c1e-7d2a-9b1f-0000000e7303',
  admin: '/orders/0192f3a0-7c1e-7d2a-9b1f-0000000e7303',
  partner: '/jobs/0192f3a0-7c1e-7d2a-9b1f-0000000e7310',
};

/** D-299: the recipient opens a notification's deep link signed in, on the zone the link is for. */
function deepLinksController(surface: Extract<Surface, 'store' | 'admin' | 'partner'>): Type<unknown> {
  @ApiSurface(surface, 'notifications')
  @Controller('deep-links')
  class DeepLinksController {
    constructor(readonly links: DeepLinksService) {}

    @Post('actions/resolve')
    @HttpCode(200)
    @ApiEndpoint({
      id: `${surface}.deepLinks.resolve`,
      summary: 'Open a notification link',
      description:
        'The page a notification link opens (D-299), for its recipient only: a link is bound to one person and one ' +
        'page of one zone, valid `notifications.deep_link_ttl_hours`, and never signs anyone in — the web signs the ' +
        'recipient in first, then resolves it here. Someone else’s or an unknown link → 404; an expired one → 410. ' +
        'Opening it again before it expires is allowed.',
      implements: ['D-299'],
    })
    @ApiBody({
      type: ResolveDeepLinkDto,
      examples: { default: { value: { token: 'sQ2hlY2tUaGlzSXNBRmFrZVRva2VuMDAw' } } },
    })
    @ApiSuccess(200, {
      description: 'Where the link goes',
      type: DeepLinkTargetDto,
      example: { path: EXAMPLE_PATH[surface], expiresAt: '2026-10-07T09:00:00+07:00' },
    })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'validation.failed',
      'http.not_found',
      'deep_links.expired',
    )
    resolve(@CurrentActor() actor: Actor, @Body() body: ResolveDeepLinkDto) {
      return this.links.resolve(me(actor), surface, body.token);
    }
  }
  Object.defineProperty(DeepLinksController, 'name', {
    value: `${surface[0]!.toUpperCase()}${surface.slice(1)}DeepLinksController`,
  });
  return DeepLinksController;
}

export const StoreDeepLinksController = deepLinksController('store');
export const AdminDeepLinksController = deepLinksController('admin');
export const PartnerDeepLinksController = deepLinksController('partner');
