import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { type CursorPage, CursorQuery, DEFAULT_CURSOR_LIMIT } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

import { type AuditFilter, AuditQueryService, type AuditRow, EXPORT_MAX_ROWS } from './audit-query.service';

const CATEGORIES = ['security', 'finance', 'config', 'data_access', 'export', 'approval', 'iam'] as const;
const OUTCOMES = ['success', 'denied', 'failure'] as const;
const ACTOR_TYPES = ['user', 'api_client', 'system', 'webhook'] as const;

export class AuditFilterDto {
  @ApiPropertyOptional({ enum: CATEGORIES, enumName: 'AuditCategory', example: 'security' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @ApiPropertyOptional({ enum: OUTCOMES, enumName: 'AuditOutcome', example: 'denied' })
  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: (typeof OUTCOMES)[number];

  @ApiPropertyOptional({ example: 'auth.login_failed' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_.]*$/)
  action?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  resourceType?: string;

  @ApiPropertyOptional({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b' })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
    description: 'Acting user',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-09-01T00:00:00+07:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-10-01T00:00:00+07:00',
    description: 'Exclusive',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class AuditListQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: CATEGORIES, enumName: 'AuditCategory' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @ApiPropertyOptional({ enum: OUTCOMES, enumName: 'AuditOutcome' })
  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: (typeof OUTCOMES)[number];

  @ApiPropertyOptional({ example: 'auth.login_failed' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_.]*$/)
  action?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  resourceType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class AuditActorDto {
  @ApiProperty({ enum: ACTOR_TYPES, enumName: 'ActorType', example: 'user' })
  type!: (typeof ACTOR_TYPES)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
  })
  id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'แอดมิน ทดสอบ' })
  name!: string | null;
}

export class AuditEntryDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ enum: CATEGORIES, enumName: 'AuditCategory', example: 'iam' })
  category!: (typeof CATEGORIES)[number];

  @ApiProperty({ example: 'iam.role_granted' })
  action!: string;

  @ApiProperty({ enum: OUTCOMES, enumName: 'AuditOutcome', example: 'success' })
  outcome!: (typeof OUTCOMES)[number];

  @ApiProperty({ type: AuditActorDto })
  actor!: AuditActorDto;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'CS acting for a customer',
  })
  onBehalfOf!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'user' })
  resourceType!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c0',
  })
  resourceId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'req-3f2a9c1d' })
  requestId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { role: 'finance', reason: 'Joined the finance team' },
    description: 'Redacted before storage (PDPA)',
  })
  data!: Record<string, unknown>;
}

export class AuditExportDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f11e' })
  fileId!: string;

  @ApiProperty({ example: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300' })
  url!: string;

  @ApiProperty({ type: 'integer', example: 1250 })
  rows!: number;

  @ApiProperty({
    example: false,
    description: `True when more than ${EXPORT_MAX_ROWS} rows matched; narrow the period`,
  })
  truncated!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:10:00+07:00' })
  expiresAt!: string;
}

const EXAMPLE: AuditEntryDto = {
  occurredAt: '2026-09-23T14:05:00+07:00',
  category: 'iam',
  action: 'iam.role_granted',
  outcome: 'success',
  actor: { type: 'user', id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b', name: 'แอดมิน ทดสอบ' },
  onBehalfOf: null,
  resourceType: 'user',
  resourceId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c0',
  requestId: 'req-3f2a9c1d',
  data: { role: 'finance', reason: 'Joined the finance team' },
};

const toDto = (r: AuditRow): AuditEntryDto => ({
  occurredAt: toBangkokIso(r.occurredAt),
  category: r.category,
  action: r.action,
  outcome: r.outcome,
  actor: {
    type: r.actorType,
    id: r.actorUser?.publicId ?? r.actorApiClient?.publicId ?? null,
    name: r.actorUser?.displayName ?? r.actorApiClient?.name ?? null,
  },
  onBehalfOf: r.onBehalfOf?.publicId ?? null,
  resourceType: r.resourceType,
  resourceId: r.resourcePublicId,
  requestId: r.requestId,
  data: (r.data ?? {}) as Record<string, unknown>,
});

const filterOf = (q: AuditFilterDto): AuditFilter => ({
  ...(q.category && { category: q.category }),
  ...(q.outcome && { outcome: q.outcome }),
  ...(q.action && { action: q.action }),
  ...(q.resourceType && { resourceType: q.resourceType }),
  ...(q.resourceId && { resourceId: q.resourceId }),
  ...(q.actorId && { actorId: q.actorId }),
  ...(q.from && { from: q.from }),
  ...(q.to && { to: q.to }),
});

@ApiSurface('admin', 'auditLogs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @Can('audit_logs.read')
  @ApiEndpoint({
    id: 'admin.auditLogs.list',
    summary: 'Search the audit log',
    description:
      'Security- and finance-relevant actions (logins, role changes, permission denials, setting changes, exports, ' +
      'approvals), newest first. Data is redacted before storage (PDPA). Read-only for the time-boxed Auditor (§8).',
    implements: ['D-140', 'D-033'],
  })
  @ApiCursorPaginated(AuditEntryDto, { example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: AuditListQuery): Promise<CursorPage<AuditEntryDto>> {
    const { rows, nextCursor } = await this.audit.list(
      filterOf(query),
      query.cursor,
      query.limit ?? DEFAULT_CURSOR_LIMIT,
    );
    return { data: rows.map(toDto), meta: { nextCursor } };
  }

  @Post('exports')
  @HttpCode(200)
  @Can('audit_logs.export')
  @ApiEndpoint({
    id: 'admin.auditLogs.export',
    summary: 'Export the audit log as CSV',
    description: `Up to ${EXPORT_MAX_ROWS} rows per export as UTF-8 CSV (formula-safe), served by a 5-minute signed URL. The export itself is audited (\`export.generated\`).`,
    implements: ['D-033'],
  })
  @ApiBody({
    type: AuditFilterDto,
    examples: {
      default: {
        value: { category: 'security', from: '2026-09-01T00:00:00+07:00', to: '2026-10-01T00:00:00+07:00' },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Export ready',
    type: AuditExportDto,
    example: {
      fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f11e',
      url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
      rows: 1250,
      truncated: false,
      expiresAt: '2026-09-23T14:10:00+07:00',
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async export(@CurrentActor() actor: Actor, @Body() body: AuditFilterDto): Promise<AuditExportDto> {
    if (actor.type !== 'user') throw new DomainException('auth.forbidden');
    const result = await this.audit.export(actor, filterOf(body));
    return {
      fileId: result.fileId,
      url: result.url,
      rows: result.rows,
      truncated: result.truncated,
      expiresAt: toBangkokIso(result.expiresAt),
    };
  }
}
