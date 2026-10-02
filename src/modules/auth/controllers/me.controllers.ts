import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type LoginMethod } from '@generated/prisma/client';
import { menuFor } from '@modules/iam/menu.catalog';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ScopeDirectory } from '@modules/iam/scope-directory';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';

import { DevicePinDto } from '../auth.dto';
import { PasswordLoginService } from '../login/password-login.service';
import {
  ADMIN_ME_EXAMPLE,
  AdminMeDto,
  IDENTITY_PROVIDERS,
  PARTNER_ME_EXAMPLE,
  PartnerMeDto,
  STORE_ME_EXAMPLE,
  StoreMeDto,
  UpdatePreferencesDto,
} from '../me.dto';

function userActor(actor: Actor): UserActor {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
}

async function baseOf(prisma: PrismaService, resolver: PermissionResolver, actor: UserActor) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const access = await resolver.forUser(actor.userId);
  return {
    user,
    access,
    base: {
      id: user.publicId,
      displayName: user.displayName,
      email: user.email,
      locale: user.locale,
      displayUnit: user.displayUnit,
      roles: [...new Set(access.roles.map((r) => r.key))].sort(),
      permissions: [...access.permissions].sort(),
    },
  };
}

/** D-183: the display unit is the user's own preference (the API stays millimetre-only); audited and evented. */
async function savePreferences(
  prisma: PrismaService,
  audit: AuditService,
  events: DomainEvents,
  me: UserActor,
  body: UpdatePreferencesDto,
): Promise<void> {
  await prisma.withTx(async (tx) => {
    await tx.user.update({ where: { id: me.userId }, data: { displayUnit: body.displayUnit } });
    await audit.record(tx, {
      category: 'config',
      action: 'user.preferences_updated',
      resourceType: 'user',
      resourcePublicId: me.publicId,
      data: { displayUnit: body.displayUnit },
      actor: me,
    });
    await events.record(
      tx,
      {
        type: 'user.preferences_updated',
        aggregateType: 'user',
        aggregateId: me.publicId,
        payload: { userId: me.publicId, displayUnit: body.displayUnit },
      },
      me,
    );
  });
}

const PREFERENCES_BODY = {
  type: UpdatePreferencesDto,
  examples: { default: { value: { displayUnit: 'cm' } } },
};
const PREFERENCES_DOC = {
  summary: 'Set my display unit',
  description:
    'The unit the web shows sizes in: mm, cm or in (D-183). Every size in the API stays in millimetres — a request ' +
    'that sends a unit is refused with `specs.unit_not_accepted`. Audited.',
  implements: ['D-183'],
};

/** The sessions each sign-in identity opens (an unlinked identity's sessions are revoked). */
const LOGIN_METHODS: Record<string, LoginMethod[]> = {
  firebase_google: ['firebase_google'],
  firebase_apple: ['firebase_apple'],
  line: ['line', 'line_liff'],
};

@ApiSurface('store', 'me')
@Controller('me')
export class StoreMeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Delete('identities/:provider')
  @ApiParam({ name: 'provider', enum: IDENTITY_PROVIDERS, enumName: 'IdentityProvider' })
  @ApiEndpoint({
    id: 'store.me.unlinkIdentity',
    summary: 'Remove one of my sign-in methods',
    description:
      'Google, Apple or LINE. The account phone cannot be removed (409 `auth.identity_not_unlinkable`: it is the ' +
      'account’s key for OTP sign-in), nor the last method (409 `auth.identity_last_method`). Sessions opened with ' +
      'that method are signed out; audited (D-143).',
    implements: ['ADR-0004', 'D-143'],
  })
  @ApiSuccess(200, { description: 'The customer', type: StoreMeDto, example: STORE_ME_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'auth.identity_last_method',
    'auth.identity_not_unlinkable',
  )
  async unlinkIdentity(
    @CurrentActor() actor: Actor,
    @Param('provider') provider: string,
  ): Promise<StoreMeDto> {
    const me = userActor(actor);
    if (!(IDENTITY_PROVIDERS as readonly string[]).includes(provider))
      throw new DomainException('http.not_found');
    if (provider === 'phone_otp') throw new DomainException('auth.identity_not_unlinkable');
    await this.prisma.withTx(async (tx) => {
      const live = await tx.userIdentity.findMany({ where: { userId: me.userId, unlinkedAt: null } });
      const target = live.find((i) => i.provider === provider);
      if (!target) throw new DomainException('http.not_found');
      if (live.length === 1) throw new DomainException('auth.identity_last_method');
      const now = new Date();
      await tx.userIdentity.update({ where: { id: target.id }, data: { unlinkedAt: now } });
      await tx.authSession.updateMany({
        where: { userId: me.userId, revokedAt: null, loginMethod: { in: LOGIN_METHODS[provider] ?? [] } },
        data: { revokedAt: now, revokeReason: 'logout' },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'customer.identity_unlinked',
        resourceType: 'user',
        resourcePublicId: me.publicId,
        data: { provider },
        actor: me,
      });
      await this.events.record(
        tx,
        {
          type: 'customer.identity_unlinked',
          aggregateType: 'user',
          aggregateId: me.publicId,
          payload: { userId: me.publicId, provider },
        },
        me,
      );
    });
    return this.get(actor);
  }

  @Patch('preferences')
  @ApiEndpoint({ id: 'store.me.updatePreferences', ...PREFERENCES_DOC })
  @ApiBody(PREFERENCES_BODY)
  @ApiSuccess(200, { description: 'The customer', type: StoreMeDto, example: STORE_ME_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.token_expired')
  async updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() body: UpdatePreferencesDto,
  ): Promise<StoreMeDto> {
    await savePreferences(this.prisma, this.audit, this.events, userActor(actor), body);
    return this.get(actor);
  }

  @Get()
  @ApiEndpoint({
    id: 'store.me.get',
    summary: 'The signed-in customer',
    description: 'Profile, linked sign-in methods and company scopes of the signed-in customer.',
    implements: ['ADR-0004', 'D-140'],
  })
  @ApiSuccess(200, { description: 'The customer', type: StoreMeDto, example: STORE_ME_EXAMPLE })
  @ApiStandardErrors('auth.token_expired', 'auth.session_revoked', 'auth.wrong_audience')
  async get(@CurrentActor() actor: Actor): Promise<StoreMeDto> {
    const me = userActor(actor);
    const { user, base } = await baseOf(this.prisma, this.resolver, me);
    const identities = await this.prisma.userIdentity.findMany({
      where: { userId: me.userId, unlinkedAt: null },
      orderBy: { linkedAt: 'asc' },
    });
    return {
      ...base,
      phone: user.phone,
      scopes: [...me.scopes],
      identities: identities.map((i) => ({ provider: i.provider, linkedAt: toBangkokIso(i.linkedAt) })),
    };
  }
}

@ApiSurface('admin', 'me')
@Controller('me')
export class AdminMeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Patch('preferences')
  @ApiEndpoint({ id: 'admin.me.updatePreferences', ...PREFERENCES_DOC })
  @ApiBody(PREFERENCES_BODY)
  @ApiSuccess(200, { description: 'The staff member', type: AdminMeDto, example: ADMIN_ME_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.token_expired')
  async updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() body: UpdatePreferencesDto,
  ): Promise<AdminMeDto> {
    await savePreferences(this.prisma, this.audit, this.events, userActor(actor), body);
    return this.get(actor);
  }

  @Get()
  @ApiEndpoint({
    id: 'admin.me.get',
    summary: 'The signed-in staff member with menu entitlements',
    description:
      'Roles (D-140), effective permissions, the admin-zone menu entries those permissions open, and the feature ' +
      'flags enabled for this user. Cost and margin permissions follow D-141.',
    implements: ['ADR-0004', 'D-140', 'D-141'],
  })
  @ApiSuccess(200, { description: 'The staff member', type: AdminMeDto, example: ADMIN_ME_EXAMPLE })
  @ApiStandardErrors('auth.token_expired', 'auth.session_revoked', 'auth.wrong_audience')
  async get(@CurrentActor() actor: Actor): Promise<AdminMeDto> {
    const me = userActor(actor);
    const { access, base } = await baseOf(this.prisma, this.resolver, me);
    return { ...base, menu: menuFor(access.permissions), featureFlags: await this.flags.enabledFor(me) };
  }
}

@ApiSurface('partner', 'me')
@Controller('me')
export class PartnerMeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    private readonly scopes: ScopeDirectory,
    private readonly logins: PasswordLoginService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Patch('preferences')
  @ApiEndpoint({ id: 'partner.me.updatePreferences', ...PREFERENCES_DOC })
  @ApiBody(PREFERENCES_BODY)
  @ApiSuccess(200, { description: 'The factory user', type: PartnerMeDto, example: PARTNER_ME_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.token_expired')
  async updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() body: UpdatePreferencesDto,
  ): Promise<PartnerMeDto> {
    await savePreferences(this.prisma, this.audit, this.events, userActor(actor), body);
    return this.get(actor);
  }

  @Get()
  @ApiEndpoint({
    id: 'partner.me.get',
    summary: 'The signed-in factory user and their factories',
    description: 'Roles per factory (D-140). Only the factories in the token scope are listed.',
    implements: ['ADR-0004', 'D-140'],
  })
  @ApiSuccess(200, { description: 'The factory user', type: PartnerMeDto, example: PARTNER_ME_EXAMPLE })
  @ApiStandardErrors('auth.token_expired', 'auth.session_revoked', 'auth.wrong_audience')
  async get(@CurrentActor() actor: Actor): Promise<PartnerMeDto> {
    const me = userActor(actor);
    const { access, base } = await baseOf(this.prisma, this.resolver, me);
    const factoryRoles = access.roles.filter((r) => r.scopeType === 'factory' && r.scopeId !== null);
    const publicIds = await this.scopes.publicIds('factory', [
      ...new Set(factoryRoles.map((r) => r.scopeId!)),
    ]);
    const byFactory = new Map<string, Set<string>>();
    for (const role of factoryRoles) {
      const factoryId = publicIds.get(role.scopeId!);
      if (!factoryId || !me.scopes.includes(`factory:${factoryId}`)) continue;
      byFactory.set(factoryId, (byFactory.get(factoryId) ?? new Set()).add(role.key));
    }
    const factories = await this.prisma.factory.findMany({
      where: { publicId: { in: [...byFactory.keys()] } },
      select: { publicId: true, code: true, tradeName: true, legalName: true },
    });
    const named = new Map(factories.map((f) => [f.publicId, f]));
    return {
      ...base,
      factories: [...byFactory].map(([factoryId, roles]) => ({
        factoryId,
        code: named.get(factoryId)?.code ?? '',
        name: named.get(factoryId)?.tradeName ?? named.get(factoryId)?.legalName ?? '',
        roles: [...roles].sort(),
      })),
    };
  }

  @Post('device-pins')
  @HttpCode(204)
  @ApiEndpoint({
    id: 'partner.me.setDevicePin',
    summary: 'Register a PIN for this device',
    description:
      'Lets a factory user sign in on a shared shop-floor device with e-mail + PIN (`auth.device_pin_policy`). ' +
      'Replaces any earlier PIN of the same device.',
    implements: ['ADR-0004'],
  })
  @ApiBody({
    type: DevicePinDto,
    examples: { default: { value: { deviceId: 'tablet-line-2', pin: '123456' } } },
  })
  @ApiSuccess(204, { description: 'PIN registered' })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'auth.token_expired')
  async setDevicePin(@CurrentActor() actor: Actor, @Body() body: DevicePinDto): Promise<void> {
    await this.logins.setDevicePin(userActor(actor).userId, body.deviceId, body.pin);
  }

  @Delete('device-pins/:deviceId')
  @HttpCode(204)
  @ApiEndpoint({
    id: 'partner.me.removeDevicePin',
    summary: 'Remove the PIN of a device',
    description: 'PIN sign-in stops working on that device.',
    implements: ['ADR-0004'],
  })
  @ApiSuccess(204, { description: 'PIN removed' })
  @ApiStandardErrors('validation.failed', 'auth.token_expired')
  async removeDevicePin(@CurrentActor() actor: Actor, @Param('deviceId') deviceId: string): Promise<void> {
    await this.logins.removeDevicePin(userActor(actor).userId, deviceId.slice(0, 128));
  }
}
