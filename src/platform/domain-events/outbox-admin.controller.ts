import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page, PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { OutboxAdminService } from './outbox-admin.service';

const OUTBOX_STATUSES = ['pending', 'dispatched', 'failed', 'dead'] as const;

export class OutboxQuery extends PageQuery {
  @ApiPropertyOptional({ enum: OUTBOX_STATUSES, enumName: 'OutboxStatus', example: 'dead' })
  @IsOptional()
  @IsIn(OUTBOX_STATUSES)
  status?: (typeof OUTBOX_STATUSES)[number];
}

export class OutboxMessageDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
    description: 'Domain event id',
  })
  eventId!: string;

  @ApiProperty({ example: 'approval.approved' })
  type!: string;

  @ApiProperty({ example: 'approval_request' })
  aggregateType!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a0a0' })
  aggregateId!: string;

  @ApiProperty({ enum: OUTBOX_STATUSES, enumName: 'OutboxStatus', example: 'dead' })
  status!: (typeof OUTBOX_STATUSES)[number];

  @ApiProperty({ type: 'integer', example: 3 })
  attempts!: number;

  @ApiProperty({ type: String, nullable: true, example: 'notifications.router: Error: provider down' })
  lastError!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  occurredAt!: string;
}

const EXAMPLE: OutboxMessageDto = {
  eventId: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
  type: 'approval.approved',
  aggregateType: 'approval_request',
  aggregateId: '0192f3a0-7c1e-7d2a-9b1f-00000000a0a0',
  status: 'dead',
  attempts: 3,
  lastError: 'notifications.router: Error: provider down',
  occurredAt: '2026-09-23T14:05:00+07:00',
};

type Row = Awaited<ReturnType<OutboxAdminService['replay']>>;
const toDto = (row: Row): OutboxMessageDto => ({
  eventId: row.eventId,
  type: row.event.type,
  aggregateType: row.event.aggregateType,
  aggregateId: row.event.aggregateId,
  status: row.status,
  attempts: row.attempts,
  lastError: row.lastError,
  occurredAt: toBangkokIso(row.event.occurredAt),
});

@ApiSurface('admin', 'outbox')
@Controller('outbox')
export class OutboxAdminController {
  constructor(private readonly outbox: OutboxAdminService) {}

  @Get()
  @Can('outbox.manage')
  @ApiEndpoint({
    id: 'admin.outbox.list',
    summary: 'List outbox messages (dead-letter list)',
    description:
      'Domain events and their relay status; `status=dead` lists events a subscriber could not process after all retries.',
    implements: ['ADR-0006', 'ADR-0005'],
  })
  @ApiPaginated(OutboxMessageDto, { example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: OutboxQuery): Promise<Page<OutboxMessageDto>> {
    const { rows, total } = await this.outbox.list(query);
    return paginated(rows.map(toDto), total, query);
  }

  @Post(':eventId/actions/replay')
  @HttpCode(200)
  @Can('outbox.manage')
  @ApiEndpoint({
    id: 'admin.outbox.replay',
    summary: 'Replay a failed or dead event',
    description:
      'Queues the event again. Subscribers that already processed it skip it (idempotent consumers), so only the ' +
      'failed ones run. Audited.',
    implements: ['ADR-0006'],
  })
  @ApiSuccess(200, {
    description: 'Queued again',
    type: OutboxMessageDto,
    example: { ...EXAMPLE, status: 'pending', lastError: null },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'outbox.not_replayable')
  async replay(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<OutboxMessageDto> {
    return toDto(await this.outbox.replay(eventId));
  }
}
