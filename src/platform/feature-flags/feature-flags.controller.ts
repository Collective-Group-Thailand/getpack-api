import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { FeatureFlagsAdminService } from './feature-flags-admin.service';

const AUDIENCES = ['customer', 'staff', 'partner'] as const;

export class FeatureFlagRulesDto {
  @ApiPropertyOptional({ enum: AUDIENCES, enumName: 'TokenAudience', isArray: true, example: ['staff'] })
  @IsOptional()
  @IsIn(AUDIENCES, { each: true })
  audiences?: (typeof AUDIENCES)[number][];

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [], description: 'Users always included' })
  @IsOptional()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: 100,
    example: 100,
    description: 'Stable share of principals',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;
}

export class FeatureFlagDto {
  @ApiProperty({ example: 'carriers.deliveree' })
  key!: string;

  @ApiProperty({ example: 'Deliveree carrier adapter (D-114)' })
  description!: string;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({
    example: false,
    description:
      'A development aid (e.g. a stubbed adapter): never on in production (D-296); set by the code',
  })
  devOnly!: boolean;

  @ApiProperty({ type: FeatureFlagRulesDto })
  rules!: FeatureFlagRulesDto;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  updatedAt!: string;
}

export class UpdateFeatureFlagDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ example: 'Deliveree carrier adapter (D-114)', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: FeatureFlagRulesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeatureFlagRulesDto)
  rules?: FeatureFlagRulesDto;
}

const EXAMPLE: FeatureFlagDto = {
  key: 'carriers.deliveree',
  description: 'Deliveree carrier adapter (D-114)',
  enabled: true,
  devOnly: false,
  rules: { audiences: ['staff'], percentage: 100 },
  updatedAt: '2026-09-23T14:05:00+07:00',
};

type Row = Awaited<ReturnType<FeatureFlagsAdminService['upsert']>>;
const toDto = (f: Row): FeatureFlagDto => ({
  key: f.key,
  description: f.description,
  enabled: f.enabled,
  devOnly: f.devOnly,
  rules: (f.rules ?? {}) as FeatureFlagRulesDto,
  updatedAt: toBangkokIso(f.updatedAt),
});

@ApiSurface('admin', 'featureFlags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsAdminService) {}

  @Get()
  @Can('feature_flags.read')
  @ApiEndpoint({
    id: 'admin.featureFlags.list',
    summary: 'List feature flags',
    description:
      'Operational toggles (e.g. R2 adapters off, D-111). Business values are settings, not flags (ADR-0005).',
    implements: ['ADR-0005', 'D-111'],
  })
  @ApiSuccess(200, { description: 'Flags', type: [FeatureFlagDto], example: [EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async list(): Promise<FeatureFlagDto[]> {
    return (await this.flags.list()).map(toDto);
  }

  @Put(':key')
  @Can('feature_flags.manage')
  @ApiEndpoint({
    id: 'admin.featureFlags.set',
    summary: 'Create or change a feature flag',
    description:
      'Audited; takes effect on every process within seconds. A development-only flag cannot be switched on in ' +
      'production (409 `feature_flags.dev_only`, D-296).',
    implements: ['ADR-0005', 'D-063', 'D-296'],
  })
  @ApiBody({
    type: UpdateFeatureFlagDto,
    examples: { default: { value: { enabled: true, rules: { audiences: ['staff'] } } } },
  })
  @ApiSuccess(200, { description: 'Saved', type: FeatureFlagDto, example: EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'feature_flags.dev_only')
  async set(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagDto> {
    if (actor.type !== 'user') throw new DomainException('auth.forbidden');
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(key) || key.length > 100) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'key', code: 'pattern', message: 'dotted snake_case key' }],
      });
    }
    return toDto(
      await this.flags.upsert(actor, key, {
        enabled: body.enabled,
        ...(body.description && { description: body.description }),
        ...(body.rules && { rules: body.rules }),
      }),
    );
  }
}
