import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { type CursorPage, CursorQuery, DEFAULT_CURSOR_LIMIT } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID, ValidateIf } from 'class-validator';

import {
  CustomerFileAccessService,
  type FileAccessLogRow,
  type SupportAssignmentView,
} from './customer-file-access.service';
import { DownloadUrlDto } from './files.dto';
import { StudioRenderPreviewService } from './studio-render-preview.service';

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

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'D-449 (1): the reason a Superadmin typed before opening the file; null for every other access',
  })
  reason!: string | null;

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
  reason: null,
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
  reason: r.reason,
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
      'stored. Superadmin and Auditor (`customer_file_access_logs.read`, B-API-6); neither reads the files.',
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

// ------------------------------------------------------------------------------------------------ B-API-6

export class StaffRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8c' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ซัพพอร์ต ทดสอบ' })
  displayName!: string | null;
}

export class SetSupportAssignmentDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8c',
    description:
      'The support staff member who handles the order (an active staff user holding `customer_files.read_handled`); ' +
      '`null` ends the assignment',
  })
  @ValidateIf((o: { supportUserId: unknown }) => o.supportUserId !== null)
  @IsUUID()
  supportUserId!: string | null;
}

export class OrderSupportAssignmentDto {
  @ApiProperty({ type: FileAccessOrderDto })
  order!: FileAccessOrderDto;

  @ApiProperty({ type: StaffRefDto, nullable: true, description: 'null = no explicit assignment' })
  assignee!: StaffRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-26T10:15:00+07:00' })
  assignedAt!: string | null;

  @ApiProperty({ type: StaffRefDto, nullable: true, description: 'The CS Lead / Admin who assigned' })
  assignedBy!: StaffRefDto | null;
}

const ASSIGNMENT_EXAMPLE: OrderSupportAssignmentDto = {
  order: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000a001', orderCode: 'DEVOR-2610-00001' },
  assignee: { id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8c', displayName: 'ซัพพอร์ต ทดสอบ' },
  assignedAt: '2026-10-26T10:15:00+07:00',
  assignedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8d', displayName: 'หัวหน้าซีเอส ทดสอบ' },
};

export const toSupportAssignmentDto = (v: SupportAssignmentView): OrderSupportAssignmentDto => ({
  order: { id: v.order.publicId, orderCode: v.order.orderCode },
  assignee: v.assignment
    ? { id: v.assignment.user.publicId, displayName: v.assignment.user.displayName }
    : null,
  assignedAt: v.assignment ? toBangkokIso(v.assignment.assignedAt) : null,
  assignedBy: v.assignment?.assignedBy
    ? { id: v.assignment.assignedBy.publicId, displayName: v.assignment.assignedBy.displayName }
    : null,
});

const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });

/** D-444 + B-API-6: who on support handles an order (reads its customer artwork with `customer_files.read_handled`). */
@ApiSurface('admin', 'orderSupportAssignments')
@Controller('orders/:orderId/support-assignment')
export class OrderSupportAssignmentsController {
  constructor(private readonly access: CustomerFileAccessService) {}

  @Get()
  @Can('orders.assign_support')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orderSupportAssignments.get',
    summary: 'Read who on support handles an order',
    description:
      'D-444 (B-API-6): the live explicit support assignment of the order, set by CS Lead / Admin; `assignee` null ' +
      'when none. Support also handles an order through an open conversation about it assigned to them (not shown ' +
      'here). `orders.assign_support`.',
    implements: ['D-444'],
  })
  @ApiSuccess(200, {
    description: 'The assignment',
    type: OrderSupportAssignmentDto,
    example: ASSIGNMENT_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found')
  async get(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderSupportAssignmentDto> {
    return toSupportAssignmentDto(await this.access.supportAssignment(orderId));
  }

  @Put()
  @Can('orders.assign_support')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orderSupportAssignments.set',
    summary: 'Assign the support staff member who handles an order',
    description:
      'D-444 (B-API-6): CS Lead / Admin (`orders.assign_support`) name the support staff member who handles the order ' +
      '— an active staff user holding `customer_files.read_handled` (CS, CS Lead) — so they may read its customer ' +
      'artwork / originals and production copies (every download logged); `null` ends the assignment. One live ' +
      'assignment per order: a change ends the previous one (history kept). Setting the same user again changes ' +
      'nothing. Audited (`order.support_assigned`) with the event `order.support_assigned`.',
    implements: ['D-444'],
  })
  @ApiBody({
    type: SetSupportAssignmentDto,
    examples: {
      assign: { value: { supportUserId: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8c' } },
      end: { value: { supportUserId: null } },
    },
  })
  @ApiSuccess(200, {
    description: 'The assignment now',
    type: OrderSupportAssignmentDto,
    example: ASSIGNMENT_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async set(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SetSupportAssignmentDto,
  ): Promise<OrderSupportAssignmentDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    return toSupportAssignmentDto(await this.access.assignSupport(actor, orderId, body.supportUserId));
  }
}

// ------------------------------------------------------------------------------------------------ B-API-7

/** B-API-7 (D-446): the low-resolution preview of a Studio render for the staff handling its order. */
@ApiSurface('admin', 'files')
@Controller('files')
export class StudioRenderPreviewsController {
  constructor(private readonly previews: StudioRenderPreviewService) {}

  @Get(':fileId/preview')
  @ApiParam({
    name: 'fileId',
    format: 'uuid',
    description: 'The Studio render (`design_version_renders.file_id`).',
  })
  @ApiEndpoint({
    id: 'admin.files.preview',
    summary: 'Short-lived URL of a Studio render preview',
    description:
      'D-446 (B-API-7): a signed URL (5 minutes) for the low-resolution, metadata-free preview (WebP thumbnail) of a ' +
      'Studio render, for Prepress (`customer_files.read`) and for support (`customer_files.read_handled`) handling an ' +
      "order made from the render's design version — an explicit support assignment or an open order conversation. " +
      'The preview is made with the upload thumbnail pipeline when the render has none. The full-resolution render, ' +
      'customer artwork and originals stay restricted (D-444): every other staff role, or a file that is not a ' +
      'Studio render, gets 404. Every URL is logged in the customer file access log (purpose `thumbnail`).',
    implements: ['D-444', 'D-446'],
  })
  @ApiSuccess(200, {
    description: 'Signed URL of the preview',
    type: DownloadUrlDto,
    example: {
      url: 'https://getpack-files.s3.example.com/…thumb.webp?X-Amz-Expires=300',
      expiresAt: '2026-10-26T10:20:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async preview(
    @CurrentActor() actor: Actor,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<DownloadUrlDto> {
    const { url, expiresAt } = await this.previews.previewUrl(actor, fileId);
    return { url, expiresAt: toBangkokIso(expiresAt) };
  }
}
