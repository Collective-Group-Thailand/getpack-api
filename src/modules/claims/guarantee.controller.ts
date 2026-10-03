import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { IntField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, ValidateNested } from 'class-validator';

import { CLAIM_SEVERITIES, CLAIM_TYPES } from './claims.dto';
import { GuaranteeService, type GuaranteeVersionRow } from './guarantee.service';

const MATRIX_REMEDIES = ['reprint', 'refund', 'partial_credit'] as const;
const VERSION_STATUSES = [
  'draft',
  'proposed',
  'pending_acceptance',
  'approved',
  'rejected',
  'withdrawn',
] as const;
const DECISIONS = ['D-198', 'D-199', 'D-260'];

export class GuaranteeRuleDto {
  @ApiProperty({ enum: CLAIM_TYPES, enumName: 'ClaimType', example: 'damaged' })
  @IsIn(CLAIM_TYPES)
  claimType!: (typeof CLAIM_TYPES)[number];

  @ApiProperty({ enum: CLAIM_SEVERITIES, enumName: 'ClaimSeverity', example: 'major' })
  @IsIn(CLAIM_SEVERITIES)
  severity!: (typeof CLAIM_SEVERITIES)[number];

  @ApiProperty({
    enum: MATRIX_REMEDIES,
    enumName: 'GuaranteeMatrixRemedy',
    isArray: true,
    example: ['reprint', 'refund'],
    description: 'Empty = no remedy (goodwill only through a discount memo, D-262)',
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(MATRIX_REMEDIES, { each: true })
  remedies!: (typeof MATRIX_REMEDIES)[number][];
}

export class ProposeGuaranteeDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-01T00:00:00+07:00',
    description: 'Never in the past',
  })
  @IsDateString()
  effectiveFrom!: string;

  @IntField({ example: 1, min: 0, max: 30, description: 'Business days to the first response (D-199)' })
  responseBusinessDays!: number;

  @IntField({
    example: 3,
    min: 0,
    max: 60,
    description: 'Business days to the decision from complete evidence',
  })
  decisionBusinessDays!: number;

  @TextField({ example: 'ขยายการรับประกันงานพิมพ์ (fake)', max: 800 })
  reason!: string;

  @ApiProperty({
    type: [GuaranteeRuleDto],
    description: 'Claim type × severity; one rule each, missing = no remedy',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLAIM_TYPES.length * CLAIM_SEVERITIES.length)
  @ValidateNested({ each: true })
  @Type(() => GuaranteeRuleDto)
  rules!: GuaranteeRuleDto[];
}

/** Withdrawing takes a reason — the shared `ReasonBodyDto`. */
export { ReasonBodyDto as WithdrawGuaranteeDto } from '@modules/partners/factories/factories.dto';
import { ReasonBodyDto as WithdrawGuaranteeDto } from '@modules/partners/factories/factories.dto';

export class PublicGuaranteeDto {
  @ApiProperty({ example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 1, description: 'Business days to the first response (D-199)' })
  responseBusinessDays!: number;

  @ApiProperty({ example: 3, description: 'Business days to the decision from complete evidence (D-199)' })
  decisionBusinessDays!: number;

  @ApiProperty({
    example: 7,
    description: 'Days after receipt to make a claim (`claims.window_days`, D-082)',
  })
  claimWindowDays!: number;

  @ApiProperty({ type: [GuaranteeRuleDto], description: 'Remedies for a claim on Packio’s side (D-083)' })
  rules!: GuaranteeRuleDto[];
}

export class GuaranteeVersionDto extends PublicGuaranteeDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d101' })
  id!: string;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ example: 'D-198 / D-199 (accepted 2026-09-30): remedies and claim SLAs at launch' })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvalRequestId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-01-01T00:00:00+07:00' })
  decidedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

const RULES_EXAMPLE: GuaranteeRuleDto[] = [
  { claimType: 'damaged', severity: 'major', remedies: ['reprint', 'refund'] },
  { claimType: 'damaged', severity: 'minor', remedies: ['partial_credit'] },
  { claimType: 'late', severity: 'major', remedies: [] },
];
const PUBLIC_EXAMPLE: PublicGuaranteeDto = {
  versionNo: 1,
  effectiveFrom: '2026-01-01T00:00:00+07:00',
  responseBusinessDays: 1,
  decisionBusinessDays: 3,
  claimWindowDays: 7,
  rules: RULES_EXAMPLE,
};
const VERSION_EXAMPLE: GuaranteeVersionDto = {
  ...PUBLIC_EXAMPLE,
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000d101',
  status: 'approved',
  reason: 'D-198 / D-199 (accepted 2026-09-30): remedies and claim SLAs at launch',
  approvalRequestId: null,
  decidedAt: '2026-01-01T00:00:00+07:00',
  createdAt: '2026-10-03T10:00:00+07:00',
};

function rulesOf(v: GuaranteeVersionRow): GuaranteeRuleDto[] {
  return v.rules.map((r) => ({
    claimType: r.claimType,
    severity: r.severity,
    remedies: r.remedies.filter((x): x is (typeof MATRIX_REMEDIES)[number] => x !== 'goodwill'),
  }));
}

function versionDto(v: GuaranteeVersionRow, claimWindowDays: number): GuaranteeVersionDto {
  return {
    id: v.publicId,
    versionNo: v.versionNo,
    status: v.status,
    effectiveFrom: toBangkokIso(v.effectiveFrom),
    responseBusinessDays: v.responseBusinessDays,
    decisionBusinessDays: v.decisionBusinessDays,
    claimWindowDays,
    reason: v.reason,
    rules: rulesOf(v),
    approvalRequestId: v.approvalRequest?.publicId ?? null,
    decidedAt: v.decidedAt ? toBangkokIso(v.decidedAt) : null,
    createdAt: toBangkokIso(v.createdAt),
  };
}

@ApiSurface('store', 'guarantee')
@Controller('guarantee')
export class StoreGuaranteeController {
  constructor(
    private readonly guarantee: GuaranteeService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEndpoint({
    id: 'store.guarantee.get',
    summary: 'Packio’s guarantee',
    description:
      'The guarantee in force — the same version the claim engine applies: what a claim on Packio’s side gets per ' +
      'claim type and severity (reprint, refund, partial credit), the response and decision times in business days ' +
      'and the claim window. A claim whose cause is the customer’s (e.g. artwork the customer approved) gets no ' +
      'remedy; there is no late-delivery guarantee at launch (D-198, D-199, D-260, D-083).',
    implements: [...DECISIONS, 'D-083', 'D-082'],
  })
  @ApiSuccess(200, { description: 'Guarantee', type: PublicGuaranteeDto, example: PUBLIC_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async get(): Promise<PublicGuaranteeDto> {
    const version = await this.guarantee.current();
    if (!version) throw new DomainException('http.not_found');
    const window = (await this.settings.at('claims.window_days')).value;
    return {
      versionNo: version.versionNo,
      effectiveFrom: toBangkokIso(version.effectiveFrom),
      responseBusinessDays: version.responseBusinessDays,
      decisionBusinessDays: version.decisionBusinessDays,
      claimWindowDays: window,
      rules: rulesOf(version),
    };
  }
}

@ApiSurface('admin', 'guaranteePolicies')
@Controller('guarantee-policies')
export class AdminGuaranteeController {
  constructor(
    private readonly guarantee: GuaranteeService,
    private readonly settings: SettingsService,
  ) {}

  private async window() {
    return (await this.settings.at('claims.window_days')).value;
  }

  @Get()
  @Can('guarantee_policies.read')
  @ApiEndpoint({
    id: 'admin.guaranteePolicies.list',
    summary: 'List guarantee policy versions',
    description: 'Every version, newest first, with its status and matrix (D-260).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [GuaranteeVersionDto], example: [VERSION_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(): Promise<GuaranteeVersionDto[]> {
    const window = await this.window();
    return (await this.guarantee.list()).map((v) => versionDto(v, window));
  }

  @Get(':versionId')
  @Can('guarantee_policies.read')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.guaranteePolicies.get',
    summary: 'Get a guarantee policy version',
    description: 'Its SLAs, remedy matrix, status and approval request (D-260).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Version', type: GuaranteeVersionDto, example: VERSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('versionId', ParseUUIDPipe) id: string): Promise<GuaranteeVersionDto> {
    return versionDto(await this.guarantee.get(id), await this.window());
  }

  @Post()
  @Can('guarantee_policies.manage')
  @ApiEndpoint({
    id: 'admin.guaranteePolicies.create',
    summary: 'Propose a new guarantee policy version',
    description:
      'The CS Lead drafts SLAs and the remedy matrix; the version goes to C-Level at once (approval ' +
      '`guarantee_policy_change`) and applies from its effective date once approved — never backwards; an effective ' +
      'date that passed while in approval becomes the approval time. One version in approval at a time (D-200, D-260).',
    implements: [...DECISIONS, 'D-200', 'D-063'],
  })
  @ApiBody({
    type: ProposeGuaranteeDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-11-01T00:00:00+07:00',
          responseBusinessDays: 1,
          decisionBusinessDays: 3,
          reason: 'ขยายการรับประกันงานพิมพ์ (fake)',
          rules: RULES_EXAMPLE,
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Proposed',
    type: GuaranteeVersionDto,
    example: { ...VERSION_EXAMPLE, versionNo: 2, status: 'proposed', decidedAt: null },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'guarantee.version_pending',
    'approval.no_matching_step',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: ProposeGuaranteeDto,
  ): Promise<GuaranteeVersionDto> {
    return versionDto(await this.guarantee.propose(actor as UserActor, body), await this.window());
  }

  @Post(':versionId/actions/withdraw')
  @HttpCode(200)
  @Can('guarantee_policies.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.guaranteePolicies.withdraw',
    summary: 'Withdraw a proposed guarantee version',
    description: 'Its approval request is withdrawn with it (D-260).',
    implements: DECISIONS,
  })
  @ApiBody({ type: WithdrawGuaranteeDto, examples: { default: { value: { reason: 'ทบทวนใหม่ (fake)' } } } })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: GuaranteeVersionDto,
    example: { ...VERSION_EXAMPLE, versionNo: 2, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'guarantee.version_not_proposed',
  )
  async withdraw(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) id: string,
    @Body() body: WithdrawGuaranteeDto,
  ): Promise<GuaranteeVersionDto> {
    return versionDto(
      await this.guarantee.withdraw(actor as UserActor, id, body.reason),
      await this.window(),
    );
  }
}
