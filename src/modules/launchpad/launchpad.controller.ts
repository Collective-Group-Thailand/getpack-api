import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';

import {
  DEFAULTS_EXAMPLE,
  DefaultsDto,
  DefaultsQuery,
  LAUNCHPAD_EXAMPLE,
  LaunchpadDto,
} from './launchpad.dto';
import { LaunchpadService } from './launchpad.service';

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'me')
@Controller('me')
export class StoreLaunchpadController {
  constructor(private readonly launchpad: LaunchpadService) {}

  @Get('launchpad')
  @ApiEndpoint({
    id: 'store.me.getLaunchpad',
    summary: 'My launchpad',
    description:
      'The signed-in home in one call (D-297): my 5 latest designs, up to 5 reorder candidates (open reorder ' +
      'suggestions soonest first, then delivered orders), every order or order group waiting for me with the action ' +
      'it waits for (pay → approve proof → upload artwork → confirm receipt) and one recommended next step — the first ' +
      'waiting action, else a due reorder, else resuming the latest design, else starting a configuration. Only my ' +
      'own records and those of companies I may order for.',
    implements: ['D-297', 'D-288', 'D-153'],
  })
  @ApiSuccess(200, { description: 'Launchpad', type: LaunchpadDto, example: LAUNCHPAD_EXAMPLE })
  @ApiStandardErrors()
  get(@CurrentActor() actor: Actor): Promise<LaunchpadDto> {
    return this.launchpad.launchpad(customer(actor));
  }

  @Get('defaults')
  @ApiEndpoint({
    id: 'store.me.getDefaults',
    summary: 'My defaults for pre-filling',
    description:
      'What the configurator, studio and checkout pre-fill (D-298): my default delivery address (else the one I ' +
      'last shipped to), my default tax profile, the companies I belong to with their tax data, default branch, ' +
      'whether I may order for them and whether they have a brand kit, and per product type the material and print ' +
      'type of my latest quotation of it. Read only; nothing is applied on the server.',
    implements: ['D-298'],
  })
  @ApiSuccess(200, { description: 'Defaults', type: DefaultsDto, example: DEFAULTS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  defaults(@CurrentActor() actor: Actor, @Query() q: DefaultsQuery): Promise<DefaultsDto> {
    return this.launchpad.defaults(customer(actor), q.productTypes?.split(','));
  }
}
