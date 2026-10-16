import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { FactoryUsersService } from './factory-users.service';
import {
  CreateFactoryUserDto,
  FactoryUserDto,
  FactoryUserListQuery,
  JOB_IDS,
  SetFactoryUserRolesDto,
} from './production.dto';

const USER_EXAMPLE: FactoryUserDto = {
  id: JOB_IDS.factory,
  email: 'planner@factory.example.invalid',
  displayName: 'ผู้วางแผน ทดสอบ',
  roles: ['factory_planner'],
  status: 'active',
  lastSignInAt: '2026-10-20T08:15:00+07:00',
  isSelf: false,
};
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });

function partnerUser(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'partner') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('partner', 'factoryUsers')
@Controller('factories/:factoryId/users')
export class PartnerFactoryUsersController {
  constructor(private readonly users: FactoryUsersService) {}

  @Get()
  @Can('factory_users.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factoryUsers.list',
    summary: 'List my factory’s users',
    description:
      'Everyone with a role in the factory (D-140), with the last sign-in and whether it is the signed-in user; ' +
      '`?status=deactivated` lists those whose roles were all revoked (U-B0.3).',
    implements: ['D-140'],
  })
  @ApiSuccess(200, { description: 'Users', type: [FactoryUserDto], example: [USER_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: FactoryUserListQuery,
  ) {
    return this.users.list(partnerUser(actor), factoryId, q.status);
  }

  @Post()
  @Can('factory_users.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factoryUsers.create',
    summary: 'Add a user to my factory',
    description:
      'With factory staff roles (planner, operator, QC, shipping, accountant — never owner, D-171); audited.',
    implements: ['D-140', 'D-171'],
  })
  @ApiBody({
    type: CreateFactoryUserDto,
    examples: {
      default: {
        value: {
          email: 'planner@factory.example.invalid',
          displayName: 'ผู้วางแผน ทดสอบ',
          initialPassword: 'correct-horse-battery',
          roles: ['factory_planner'],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: FactoryUserDto, example: USER_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'iam.user_exists',
    'factory_users.role_not_allowed',
  )
  create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateFactoryUserDto,
  ) {
    return this.users.create(partnerUser(actor), factoryId, body);
  }

  @Put(':userId/roles')
  @Can('factory_users.manage')
  @factoryParam
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.factoryUsers.setRoles',
    summary: 'Set a user’s roles in my factory',
    description:
      'Replaces a staff user’s factory roles (planner, operator, QC, shipping, accountant — never owner, D-171); ' +
      'a deactivated user of the factory is reactivated this way. Not the owner, not oneself. Audited (U-B0.3, D-140).',
    implements: ['D-140', 'D-171'],
  })
  @ApiBody({
    type: SetFactoryUserRolesDto,
    examples: { default: { value: { roles: ['factory_planner', 'factory_qc'] } } },
  })
  @ApiSuccess(200, {
    description: 'The user',
    type: FactoryUserDto,
    example: { ...USER_EXAMPLE, roles: ['factory_planner', 'factory_qc'] },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'iam.self_grant',
    'factory_users.role_not_allowed',
  )
  setRoles(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SetFactoryUserRolesDto,
  ) {
    return this.users.setRoles(partnerUser(actor), factoryId, userId, body.roles);
  }

  @Post(':userId/actions/deactivate')
  @HttpCode(204)
  @Can('factory_users.manage')
  @factoryParam
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.factoryUsers.deactivate',
    summary: 'Remove a user from my factory',
    description: 'Revokes the user’s roles in the factory; owners are managed by getpack (D-171). Audited.',
    implements: ['D-140'],
  })
  @ApiSuccess(204, { description: 'Deactivated' })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'iam.self_grant',
    'factory_users.role_not_allowed',
  )
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.users.deactivate(partnerUser(actor), factoryId, userId);
  }
}
