import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export const SETTING_SCOPES = ['platform', 'entity', 'product_type'] as const;
export const SETTING_VALUE_TYPES = [
  'string',
  'integer',
  'decimal',
  'money',
  'percent',
  'boolean',
  'duration',
  'time_of_day_window',
  'date',
  'enum',
  'json',
] as const;
export const SETTING_CONFIRMATIONS = ['confirmed', 'proposed', 'pending_cpa', 'pending_business'] as const;
export const CONFIG_VERSION_STATUSES = [
  'draft',
  'proposed',
  'pending_acceptance',
  'approved',
  'rejected',
  'withdrawn',
] as const;

/** A setting value: money and percentages are decimal strings (CLAUDE.md); objects for JSON types. */
const VALUE_SCHEMA = {
  nullable: true,
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'object', additionalProperties: true },
    { type: 'array', items: { type: 'object', additionalProperties: true } },
  ],
};

export class SettingValueVersionDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2027-01-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ ...VALUE_SCHEMA, example: '12', description: 'null when masked (sensitive setting)' })
  value!: unknown;
}

export class SettingVersionDto extends SettingValueVersionDto {
  @ApiProperty({ enum: CONFIG_VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: (typeof CONFIG_VERSION_STATUSES)[number];

  @ApiProperty({ example: 'Raise the floor for the new fiscal year' })
  reason!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-23T14:05:00+07:00' })
  decidedAt!: string | null;
}

export class SettingDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000e0e0' })
  id!: string;

  @ApiProperty({ example: 'pricing.margin_floor_pct' })
  key!: string;

  @ApiProperty({ enum: SETTING_SCOPES, enumName: 'SettingScope', example: 'platform' })
  scopeType!: (typeof SETTING_SCOPES)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Entity id for entity settings',
  })
  scopeId!: string | null;

  @ApiProperty({ enum: SETTING_VALUE_TYPES, enumName: 'SettingValueType', example: 'percent' })
  valueType!: (typeof SETTING_VALUE_TYPES)[number];

  @ApiProperty({ example: 'D-012 margin floor for automatic reassignment and discounts (percent)' })
  description!: string;

  @ApiProperty({ type: [String], example: ['D-012', 'D-063'] })
  decisionRefs!: string[];

  @ApiProperty({ example: 'superadmin', description: 'Role allowed to change it (D-063)' })
  ownerRole!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Approval policy a change goes through',
  })
  approvalPolicy!: string | null;

  @ApiProperty({ enum: SETTING_CONFIRMATIONS, enumName: 'SettingConfirmation', example: 'confirmed' })
  confirmationStatus!: (typeof SETTING_CONFIRMATIONS)[number];

  @ApiProperty({ example: false, description: 'Values hidden without `settings.read_sensitive`' })
  sensitive!: boolean;

  @ApiProperty({ example: false, description: 'True when values below are hidden for this user' })
  masked!: boolean;

  @ApiProperty({ type: SettingValueVersionDto, nullable: true, description: 'The version in force now' })
  current!: SettingValueVersionDto | null;

  @ApiProperty({ type: [SettingValueVersionDto], description: 'Approved versions that take effect later' })
  scheduled!: SettingValueVersionDto[];

  @ApiProperty({ type: SettingValueVersionDto, nullable: true, description: 'Version waiting for approval' })
  pending!: SettingValueVersionDto | null;
}

export class SettingDetailDto extends SettingDto {
  @ApiProperty({ type: [SettingVersionDto], description: 'Full history, newest first (immutable)' })
  versions!: SettingVersionDto[];
}

export const SETTING_EXAMPLE: SettingDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000e0e0',
  key: 'pricing.margin_floor_pct',
  scopeType: 'platform',
  scopeId: null,
  valueType: 'percent',
  description: 'D-012 margin floor for automatic reassignment and discounts (percent)',
  decisionRefs: ['D-012', 'D-063'],
  ownerRole: 'superadmin',
  approvalPolicy: null,
  confirmationStatus: 'confirmed',
  sensitive: false,
  masked: false,
  current: { versionNo: 1, effectiveFrom: '2026-01-01T00:00:00+07:00', value: '10' },
  scheduled: [{ versionNo: 2, effectiveFrom: '2027-01-01T00:00:00+07:00', value: '12' }],
  pending: null,
};

export const SETTING_DETAIL_EXAMPLE: SettingDetailDto = {
  ...SETTING_EXAMPLE,
  versions: [
    {
      versionNo: 2,
      effectiveFrom: '2027-01-01T00:00:00+07:00',
      value: '12',
      status: 'approved',
      reason: 'Raise the floor for the new fiscal year',
      createdAt: '2026-09-23T14:05:00+07:00',
      decidedAt: '2026-09-23T14:05:00+07:00',
    },
    {
      versionNo: 1,
      effectiveFrom: '2026-01-01T00:00:00+07:00',
      value: '10',
      status: 'approved',
      reason: 'Seed default from D-012',
      createdAt: '2026-09-22T09:00:00+07:00',
      decidedAt: '2026-09-22T09:00:00+07:00',
    },
  ],
};

export class ChangeSettingDto {
  @ApiProperty({
    ...VALUE_SCHEMA,
    example: '12',
    description: 'Typed per `valueType`; money and percent as decimal strings',
  })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    format: 'date-time',
    example: '2027-01-01T00:00:00+07:00',
    description: 'Now or later; never in the past',
  })
  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;

  @ApiProperty({ example: 'Raise the floor for the new fiscal year', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
