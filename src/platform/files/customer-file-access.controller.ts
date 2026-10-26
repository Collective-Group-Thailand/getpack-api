import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors } from '@common/openapi/decorators';
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { type CursorPage, CursorQuery, DEFAULT_CURSOR_LIMIT } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID } from 'class-validator';

import { CustomerFileAccessService, type FileAccessLogRow } from './customer-file-access.service';

const FILE_KINDS = ['customer_original', 'production_copy', 'approved_proof_copy'] as const;
// Alphabetical (the RUM zone enum lists the same surfaces in another order and means something else).
const CHANNELS = ['admin', 'partner', 'store'] as const;
const PURPOSES = ['download', 'thumbnail'] as const;

export class FileAccessLogQuery extends CursorQuery {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Order id',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000a001',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'File id',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1014',
  })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Acting user (or API client)',
    example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Exclusive',
    example: '2026-11-01T00:00:00+07:00',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class FileAccessActorDto {
  @ApiProperty({ enum: ['user', 'api_client'], enumName: 'FileAccessActorType', example: 'user' })
  type!: 'user' | 'api_client';

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
  })
  id!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'เตรียมพิมพ์ ทดสอบ' })
  name!: string | null;
}

export class FileAccessOrderDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a001' })
  id!: string;

  @ApiProperty({ example: 'DEVOR-2610-00001' })
  orderCode!: string;
}

export class FileAccessLogEntryDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000ac01' })
  id!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-26T10:15:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ type: FileAccessActorDto })
  actor!: FileAccessActorDto;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1014' })
  fileId!: string;

  @ApiProperty({ enum: FILE_KINDS, enumName: 'CustomerFileKind', example: 'customer_original' })
  fileKind!: (typeof FILE_KINDS)[number];

  @ApiProperty({
    type: FileAccessOrderDto,
    nullable: true,
    description: 'Null for an upload not yet in a submission',
  })
  order!: FileAccessOrderDto | null;

  @ApiProperty({ enum: CHANNELS, enumName: 'FileAccessChannel', example: 'admin' })
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ enum: PURPOSES, enumName: 'FileAccessPurpose', example: 'download' })
  purpose!: (typeof PURPOSES)[number];

  @ApiProperty({ type: String, nullable: true, example: 'req-3f2a9c1d' })
  requestId!: string | null;
}

const EXAMPLE: FileAccessLogEntryDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000ac01',
  occurredAt: '2026-10-26T10:15:00+07:00',
  actor: { type: 'user', id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b', name: 'เตรียมพิมพ์ ทดสอบ' },
  fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1014',
  fileKind: 'customer_original',
  order: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000a001', orderCode: 'DEVOR-2610-00001' },
  channel: 'admin',
  purpose: 'download',
  requestId: 'req-3f2a9c1d',
};

export const toFileAccessLogDto = (r: FileAccessLogRow): FileAccessLogEntryDto => ({
  id: r.publicId,
  occurredAt: toBangkokIso(r.occurredAt),
  actor: {
    type: r.actorType === 'api_client' ? 'api_client' : 'user',
    id: r.actorUser?.publicId ?? r.actorApiClient?.publicId ?? null,
    name: r.actorUser?.displayName ?? r.actorApiClient?.name ?? null,
  },
  fileId: r.fileObject.publicId,
  fileKind: r.fileKind,
  order: r.order ? { id: r.order.publicId, orderCode: r.order.orderCode } : null,
  channel: r.channel,
  purpose: r.purpose,
  requestId: r.requestId,
});

@ApiSurface('admin', 'customerFileAccessLogs')
@Controller('customer-file-access-logs')
export class CustomerFileAccessLogsController {
  constructor(private readonly access: CustomerFileAccessService) {}

  @Get()
  @Can('customer_file_access_logs.read')
  @ApiEndpoint({
    id: 'admin.customerFileAccessLogs.list',
    summary: 'Search the customer file access log',
    description:
      "D-444: every download URL issued for a customer's artwork / original, a production copy of one or an approved " +
      'proof copy — who, when, which file and order, through which surface (store / admin / partner) and for what ' +
      '(download / thumbnail). Newest first; filter by order, file, user and period. Append-only; no URL or token is ' +
      'stored. Superadmin only (`customer_file_access_logs.read`).',
    implements: ['D-444'],
  })
  @ApiCursorPaginated(FileAccessLogEntryDto, { example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: FileAccessLogQuery): Promise<CursorPage<FileAccessLogEntryDto>> {
    const { rows, nextCursor } = await this.access.list(
      {
        ...(query.orderId && { orderId: query.orderId }),
        ...(query.fileId && { fileId: query.fileId }),
        ...(query.userId && { actorId: query.userId }),
        ...(query.from && { from: query.from }),
        ...(query.to && { to: query.to }),
      },
      query.cursor,
      query.limit ?? DEFAULT_CURSOR_LIMIT,
    );
    return { data: rows.map(toFileAccessLogDto), meta: { nextCursor } };
  }
}
