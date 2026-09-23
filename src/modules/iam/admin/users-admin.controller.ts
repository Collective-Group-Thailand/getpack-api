import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import { ScopeDirectory } from '../scope-directory';
import {
  CreateUserDto,
  GrantRoleDto,
  ReasonDto,
  RoleDto,
  USER_ADMIN_EXAMPLE,
  UserAdminDto,
  UserListQuery,
} from './users-admin.dto';
import { UsersAdminService, type UserWithRoles } from './users-admin.service';

const staffActor = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

@ApiSurface('admin', 'users')
@Controller('users')
export class UsersAdminController {
  constructor(
    private readonly users: UsersAdminService,
    private readonly scopes: ScopeDirectory,
  ) {}

  @Get()
  @Can('users.read')
  @ApiEndpoint({
    id: 'admin.users.list',
    summary: 'List staff, partner and customer accounts',
    description:
      'Filter by kind and status; `q` searches e-mail and display name. Anonymised accounts are hidden.',
    implements: ['D-140'],
  })
  @ApiPaginated(UserAdminDto, { example: USER_ADMIN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: UserListQuery): Promise<Page<UserAdminDto>> {
    const { rows, total } = await this.users.list(query);
    return paginated(await Promise.all(rows.map((u) => this.toDto(u))), total, query);
  }

  @Get(':userId')
  @Can('users.read')
  @ApiEndpoint({
    id: 'admin.users.get',
    summary: 'Get one account with its role grants',
    description: 'Active grants only.',
    implements: ['D-140'],
  })
  @ApiSuccess(200, { description: 'The account', type: UserAdminDto, example: USER_ADMIN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserAdminDto> {
    return this.toDto(await this.users.get(userId));
  }

  @Post()
  @Can('users.manage')
  @ApiEndpoint({
    id: 'admin.users.create',
    summary: 'Create a staff or partner account',
    description:
      'With an initial password (argon2id). Roles are granted separately. Customers sign up themselves (OTP, LINE, Google/Apple).',
    implements: ['D-140', 'ADR-0004'],
  })
  @ApiBody({
    type: CreateUserDto,
    examples: {
      default: {
        value: {
          kind: 'staff',
          email: 'new.staff@example.com',
          displayName: 'พนักงาน ทดสอบ',
          initialPassword: 'temporary-passphrase-1',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Created',
    type: UserAdminDto,
    example: { ...USER_ADMIN_EXAMPLE, roles: [] },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'iam.user_exists')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateUserDto): Promise<UserAdminDto> {
    return this.toDto(await this.users.create(staffActor(actor), body));
  }

  @Post(':userId/actions/deactivate')
  @HttpCode(200)
  @Can('users.manage')
  @ApiEndpoint({
    id: 'admin.users.deactivate',
    summary: 'Deactivate an account',
    description: 'Sign-in stops and every open session ends at once. Nobody can deactivate themselves.',
    implements: ['D-140', 'ADR-0004'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'Left the company' } } } })
  @ApiSuccess(200, {
    description: 'Deactivated',
    type: UserAdminDto,
    example: { ...USER_ADMIN_EXAMPLE, status: 'inactive' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'iam.self_grant',
  )
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: ReasonDto,
  ): Promise<UserAdminDto> {
    return this.toDto(await this.users.setStatus(staffActor(actor), userId, 'inactive', body.reason));
  }

  @Post(':userId/actions/reactivate')
  @HttpCode(200)
  @Can('users.manage')
  @ApiEndpoint({
    id: 'admin.users.reactivate',
    summary: 'Reactivate an account',
    description: 'The user can sign in again.',
    implements: ['D-140'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'Returned from leave' } } } })
  @ApiSuccess(200, { description: 'Reactivated', type: UserAdminDto, example: USER_ADMIN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'iam.self_grant',
  )
  async reactivate(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: ReasonDto,
  ): Promise<UserAdminDto> {
    return this.toDto(await this.users.setStatus(staffActor(actor), userId, 'active', body.reason));
  }

  @Post(':userId/actions/revoke-sessions')
  @HttpCode(204)
  @Can('users.manage')
  @ApiEndpoint({
    id: 'admin.users.revokeSessions',
    summary: 'Sign an account out everywhere',
    description: 'Revokes every refresh session and the access tokens issued for them.',
    implements: ['ADR-0004'],
  })
  @ApiSuccess(204, { description: 'Sessions revoked' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async revokeSessions(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.users.revokeSessions(staffActor(actor), userId);
  }

  @Post(':userId/roles')
  @Can('roles.assign')
  @ApiEndpoint({
    id: 'admin.users.grantRole',
    summary: 'Grant a role (optionally scoped and time-boxed)',
    description:
      'Factory and company roles need a scope. Nobody grants their own roles; staff roles can be granted only by ' +
      "someone who holds all of the role's permissions; segregation-of-duties role pairs are refused (D-168).",
    implements: ['D-140', 'D-168'],
  })
  @ApiBody({
    type: GrantRoleDto,
    examples: {
      default: { value: { role: 'finance', reason: 'Joined the finance team' } },
      auditor: { value: { role: 'auditor', validTo: '2026-12-31T23:59:59+07:00', reason: 'Year-end audit' } },
    },
  })
  @ApiSuccess(201, { description: 'Granted', type: UserAdminDto, example: USER_ADMIN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'http.conflict',
    'validation.failed',
    'iam.self_grant',
    'iam.role_escalation',
    'iam.role_scope_mismatch',
    'iam.sod_conflict',
  )
  async grantRole(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: GrantRoleDto,
  ): Promise<UserAdminDto> {
    return this.toDto(
      await this.users.grantRole(staffActor(actor), userId, {
        roleKey: body.role,
        ...(body.scope && { scope: body.scope }),
        ...(body.validTo && { validTo: body.validTo }),
        reason: body.reason,
      }),
    );
  }

  @Post(':userId/roles/:grantId/actions/revoke')
  @HttpCode(200)
  @Can('roles.assign')
  @ApiEndpoint({
    id: 'admin.users.revokeRole',
    summary: 'Revoke a role grant',
    description: 'Takes effect at once for new requests.',
    implements: ['D-140'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'Moved to another team' } } } })
  @ApiSuccess(200, {
    description: 'Revoked',
    type: UserAdminDto,
    example: { ...USER_ADMIN_EXAMPLE, roles: [] },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'iam.self_grant',
    'iam.role_escalation',
  )
  async revokeRole(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: ReasonDto,
  ): Promise<UserAdminDto> {
    return this.toDto(await this.users.revokeRole(staffActor(actor), userId, grantId, body.reason));
  }

  private async toDto(user: UserWithRoles): Promise<UserAdminDto> {
    const lookup = async (type: 'factory' | 'company') =>
      this.scopes.publicIds(
        type,
        user.roles.filter((r) => r.scopeType === type && r.scopeId !== null).map((r) => r.scopeId!),
      );
    const [factories, companies] = await Promise.all([lookup('factory'), lookup('company')]);
    return {
      id: user.publicId,
      kind: user.kind,
      status: user.status,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      lastLoginAt: user.lastLoginAt ? toBangkokIso(user.lastLoginAt) : null,
      createdAt: toBangkokIso(user.createdAt),
      roles: user.roles.map((grant) => ({
        id: grant.publicId,
        role: grant.role.key,
        scopeType: grant.scopeType,
        scopeId:
          grant.scopeId === null
            ? null
            : ((grant.scopeType === 'factory' ? factories : companies).get(grant.scopeId) ?? null),
        validFrom: toBangkokIso(grant.validFrom),
        validTo: grant.validTo ? toBangkokIso(grant.validTo) : null,
        reason: grant.reason,
      })),
    };
  }
}

@ApiSurface('admin', 'roles')
@Controller('roles')
export class RolesAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  @Can('users.read')
  @ApiEndpoint({
    id: 'admin.roles.list',
    summary: 'The role catalogue with permissions',
    description:
      'Roles of D-140 for every audience with their permissions (`docs/rbac.md` is generated from the same catalogue).',
    implements: ['D-140', 'D-141'],
  })
  @ApiSuccess(200, {
    description: 'Roles',
    type: [RoleDto],
    example: [
      {
        key: 'finance',
        audience: 'staff',
        scopeType: 'platform',
        nameTh: 'การเงิน',
        nameEn: 'Finance',
        permissions: ['approvals.act', 'factory_cost.read'],
      },
    ],
  })
  @ApiStandardErrors('http.not_found')
  async list(): Promise<RoleDto[]> {
    return (await this.users.roles()).map((role) => ({
      key: role.key,
      audience: role.audience,
      scopeType: role.scopeType,
      nameTh: role.nameTh,
      nameEn: role.nameEn,
      permissions: role.permissions.map((rp) => rp.permission.key).sort(),
    }));
  }
}
