import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import {
  ChangeSettingDto,
  SETTING_DETAIL_EXAMPLE,
  SETTING_EXAMPLE,
  SettingDetailDto,
  SettingDto,
} from './settings.dto';
import { SettingsAdminService, type SettingWithVersions } from './settings-admin.service';

@ApiSurface('admin', 'settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly admin: SettingsAdminService,
    private readonly permissions: PermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Can('settings.read')
  @ApiEndpoint({
    id: 'admin.settings.list',
    summary: 'List effective-dated settings',
    description:
      'Every configurable business value with the version in force, scheduled versions and any pending change ' +
      '(ADR-0005). Sensitive values are masked without `settings.read_sensitive`.',
    implements: ['ADR-0005', 'D-063'],
  })
  @ApiSuccess(200, { description: 'Settings', type: [SettingDto], example: [SETTING_EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async list(@CurrentActor() actor: Actor): Promise<SettingDto[]> {
    const reveal = await this.canReadSensitive(actor);
    const entities = await this.entityIds();
    return (await this.admin.list()).map((s) => this.toDto(s, reveal, entities));
  }

  @Get(':settingId')
  @Can('settings.read')
  @ApiEndpoint({
    id: 'admin.settings.get',
    summary: 'Get one setting with its full history',
    description: 'Versions are immutable; history is never rewritten (ADR-0005).',
    implements: ['ADR-0005'],
  })
  @ApiSuccess(200, { description: 'The setting', type: SettingDetailDto, example: SETTING_DETAIL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('settingId', ParseUUIDPipe) settingId: string,
  ): Promise<SettingDetailDto> {
    return this.toDetail(
      await this.admin.get(settingId),
      await this.canReadSensitive(actor),
      await this.entityIds(),
    );
  }

  @Post(':settingId/versions')
  @Can('settings.change')
  @ApiEndpoint({
    id: 'admin.settings.changeValue',
    summary: 'Change a setting from a date (new version)',
    description:
      "Adds a version effective from `effectiveFrom` (now or later). Only the setting's owner role may change it " +
      "(Superadmin for platform thresholds, D-063) — or Superadmin for any setting, acting on the owner's behalf " +
      '(DECISIONS-STAGE-A §11.6, audited as the Superadmin). When the setting names an approval policy the version waits ' +
      'for approval (ADR-0006); otherwise it is approved at once. Audited; emits `setting.changed`.',
    implements: ['ADR-0005', 'D-063', 'D-448'],
  })
  @ApiBody({
    type: ChangeSettingDto,
    examples: {
      default: {
        value: {
          value: '12',
          effectiveFrom: '2027-01-01T00:00:00+07:00',
          reason: 'Raise the floor for the new fiscal year',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Version added', type: SettingDetailDto, example: SETTING_DETAIL_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'settings.not_owner',
    'settings.backdated',
    'settings.pending_exists',
    'approval.no_matching_step',
  )
  async change(
    @CurrentActor() actor: Actor,
    @Param('settingId', ParseUUIDPipe) settingId: string,
    @Body() body: ChangeSettingDto,
  ): Promise<SettingDetailDto> {
    if (actor.type !== 'user') throw new DomainException('auth.forbidden');
    const updated = await this.admin.proposeChange(actor, settingId, body);
    return this.toDetail(updated, await this.canReadSensitive(actor), await this.entityIds());
  }

  private async canReadSensitive(actor: Actor): Promise<boolean> {
    return (
      actor.type === 'user' &&
      (await this.permissions.forUser(actor.userId)).permissions.has('settings.read_sensitive')
    );
  }

  private async entityIds(): Promise<Map<bigint, string>> {
    return new Map(
      (await this.prisma.entity.findMany({ select: { id: true, publicId: true } })).map((e) => [
        e.id,
        e.publicId,
      ]),
    );
  }

  private toDto(setting: SettingWithVersions, reveal: boolean, entities: Map<bigint, string>): SettingDto {
    const masked = setting.isSensitive && !reveal;
    const value = (v: unknown) => (masked ? null : v);
    const now = Date.now();
    const approved = setting.versions.filter((v) => v.status === 'approved');
    const current = approved.find((v) => v.effectiveFrom.getTime() <= now);
    const pending = setting.versions.find((v) => v.status === 'proposed');
    const brief = (v: (typeof setting.versions)[number]) => ({
      versionNo: v.versionNo,
      effectiveFrom: toBangkokIso(v.effectiveFrom),
      value: value(v.value),
    });
    return {
      id: setting.publicId,
      key: setting.key,
      scopeType: setting.scopeType,
      scopeId:
        setting.scopeType === 'entity' && setting.scopeId !== null
          ? (entities.get(setting.scopeId) ?? null)
          : null,
      valueType: setting.valueType,
      description: setting.description,
      decisionRefs: setting.decisionRefs,
      ownerRole: setting.ownerRoleKey,
      approvalPolicy: setting.approvalPolicyKey,
      confirmationStatus: setting.confirmationStatus,
      sensitive: setting.isSensitive,
      masked,
      current: current ? brief(current) : null,
      scheduled: approved
        .filter((v) => v.effectiveFrom.getTime() > now)
        .reverse()
        .map(brief),
      pending: pending ? brief(pending) : null,
    };
  }

  private toDetail(
    setting: SettingWithVersions,
    reveal: boolean,
    entities: Map<bigint, string>,
  ): SettingDetailDto {
    const dto = this.toDto(setting, reveal, entities);
    return {
      ...dto,
      versions: setting.versions.map((v) => ({
        versionNo: v.versionNo,
        effectiveFrom: toBangkokIso(v.effectiveFrom),
        value: dto.masked ? null : v.value,
        status: v.status,
        reason: v.reason,
        createdAt: toBangkokIso(v.createdAt),
        decidedAt: v.decidedAt ? toBangkokIso(v.decidedAt) : null,
      })),
    };
  }
}
