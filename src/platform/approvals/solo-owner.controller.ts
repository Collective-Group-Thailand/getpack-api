import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { SettingsAdminService } from '@platform/settings/settings-admin.service';

import { SetSoloOwnerModeDto, SOLO_OWNER_MODE_EXAMPLE, SoloOwnerModeDto } from './approvals.dto';
import {
  SOLO_OWNER_SETTING,
  SoloOwnerModeService,
  type SoloOwnerModeValue,
  type SoloOwnerState,
} from './solo-owner';

const toDto = (state: SoloOwnerState): SoloOwnerModeDto => ({
  enabled: state.enabled,
  expiresAt: state.expiresAt ? toBangkokIso(new Date(state.expiresAt)) : null,
  active: state.active,
  maxDays: state.maxDays,
  changedAt: state.changedAt ? toBangkokIso(state.changedAt) : null,
  changedBy: state.changedBy
    ? { id: state.changedBy.publicId, displayName: state.changedBy.displayName }
    : null,
});

/** D-449 A (owner decision 2026-10-28, C1d): solo-owner mode of the approval engine. */
@ApiSurface('admin', 'approvals')
@Controller('approval-solo-owner-mode')
export class SoloOwnerModeController {
  constructor(
    private readonly soloOwner: SoloOwnerModeService,
    private readonly settingsAdmin: SettingsAdminService,
  ) {}

  @Get()
  @Can('approvals.read')
  @ApiEndpoint({
    id: 'admin.approvalSoloOwnerMode.get',
    summary: 'Solo-owner mode of the approvals',
    description:
      'D-449 A: whether a Superadmin may approve their own maker-checker request now (on and not expired), its expiry, ' +
      'the longest duration (`approvals.solo_owner_mode_max_days`, 90 days) and who changed it last. Even while on, it ' +
      'never applies to a step another active user could decide.',
    implements: ['D-449'],
  })
  @ApiSuccess(200, { description: 'The mode', type: SoloOwnerModeDto, example: SOLO_OWNER_MODE_EXAMPLE })
  @ApiStandardErrors()
  async get(): Promise<SoloOwnerModeDto> {
    return toDto(await this.soloOwner.state());
  }

  @Put()
  @Can('settings.change')
  @ApiEndpoint({
    id: 'admin.approvalSoloOwnerMode.set',
    summary: 'Turn solo-owner mode on or off (Superadmin)',
    description:
      'D-449 A: only a Superadmin (owner of the setting `approvals.solo_owner_mode`; anyone else 403 ' +
      '`settings.not_owner`). On: expires at `expiresAt`, default and latest now + `approvals.solo_owner_mode_max_days` ' +
      '(90 days; renew by turning it on again). A new effective-dated version from now, audited (`setting.changed`) and ' +
      'evented; it turns itself off at expiry (worker `approvals.solo_owner_mode_expiry`).',
    implements: ['D-449', 'D-063'],
  })
  @ApiBody({
    type: SetSoloOwnerModeDto,
    examples: {
      on: { value: { enabled: true, reason: 'บริษัทยังมีผู้อนุมัติคนเดียวช่วงเปิดตัว' } },
      off: { value: { enabled: false, reason: 'มีผู้อนุมัติฝ่ายการเงินแล้ว' } },
    },
  })
  @ApiSuccess(200, { description: 'The mode now', type: SoloOwnerModeDto, example: SOLO_OWNER_MODE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'settings.not_owner')
  async set(@CurrentActor() actor: Actor, @Body() body: SetSoloOwnerModeDto): Promise<SoloOwnerModeDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    const now = new Date();
    const maxDays = (await this.soloOwner.maxDays()) ?? 0;
    const value: SoloOwnerModeValue = body.enabled
      ? {
          enabled: true,
          expiresAt: new Date(
            body.expiresAt ? Date.parse(body.expiresAt) : now.getTime() + maxDays * 86_400_000,
          ).toISOString(),
        }
      : { enabled: false, expiresAt: null };
    await this.settingsAdmin.changeFromEditor(
      actor,
      SOLO_OWNER_SETTING,
      { value, effectiveFrom: now, reason: body.reason },
      { checkOwner: true },
    );
    return toDto(await this.soloOwner.state());
  }
}
