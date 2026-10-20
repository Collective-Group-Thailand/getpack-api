import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { type FileTextStatus } from '@generated/prisma/client';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';

import {
  AdminFileSearchQuery,
  AdminReindexFilesDto,
  AdminReindexFilesResultDto,
  FileSearchResponseDto,
  FileTextStateDto,
} from './file-search.dto';
import { FILE_SEARCH_EXAMPLE, FILE_TEXT_STATE_EXAMPLE } from './file-search.examples';
import { FileSearchService } from './file-search.service';
import { FileTextIndexJobs } from './file-text-index.jobs';

/**
 * Back-office content search (D-427): every file getpack keeps that the allowlist covers — vendor invoices, customer
 * documents, slips, RFQ, claim and job attachments, conversation files, agreements … — each shown only to staff
 * holding its record's read permission. Factories' own ERP files are not here (they are the factory's).
 */
@ApiSurface('admin', 'fileSearch')
@Controller('file-search')
export class AdminFileSearchController {
  constructor(
    private readonly search: FileSearchService,
    private readonly jobs: FileTextIndexJobs,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Can('files.read')
  @ApiEndpoint({
    id: 'admin.fileSearch.search',
    summary: 'Search inside documents and attachments',
    description:
      'Words found in the text read from each file (text layer or OCR, Thai and English; spaces and case ignored, ' +
      'close OCR misreadings allowed) and — when on — by meaning. One hit per file with where it is used and up to ' +
      'three highlighted passages with their page; exact matches first. Only usages whose record the caller may ' +
      'read (`vendor_invoice` needs `payables.read`, `claim_attachment` `claims.read`, …). Searches are audited ' +
      '(data access) (D-427).',
    implements: ['D-427', 'ADR-0013'],
  })
  @ApiSuccess(200, { description: 'Files found', type: FileSearchResponseDto, example: FILE_SEARCH_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async find(
    @CurrentActor() actor: Actor,
    @Query() query: AdminFileSearchQuery,
  ): Promise<FileSearchResponseDto> {
    const permissions = await permissionsOf(this.permissions, actor);
    const result = await this.search.search({ surface: 'admin', permissions }, query);
    await this.audit.recordStandalone({
      category: 'data_access',
      action: 'file_search.searched',
      outcome: 'success',
      actor,
      resourceType: 'file_search',
      data: { q: query.q.slice(0, 100), sources: query.sources ?? null, hits: result.meta.total },
    });
    return result;
  }

  @Get(':fileId/text')
  @Can('files.read')
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.fileSearch.textState',
    summary: 'How a file’s text stands',
    description:
      'Whether it is searchable, still being read, or could not be read — and how it was read (D-427).',
    implements: ['D-427'],
  })
  @ApiSuccess(200, { description: 'The state', type: FileTextStateDto, example: FILE_TEXT_STATE_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async state(@Param('fileId', ParseUUIDPipe) fileId: string): Promise<FileTextStateDto> {
    const file = await this.prisma.fileObject.findUnique({
      where: { publicId: fileId },
      select: { id: true },
    });
    if (!file) throw new DomainException('http.not_found');
    return (await this.search.state([file.id])).get(file.id)!;
  }

  @Post('actions/reindex')
  @HttpCode(200)
  @Can('files.reindex')
  @ApiEndpoint({
    id: 'admin.fileSearch.reindex',
    summary: 'Read files again',
    description:
      'Queues the given files — or every file in the given text states (default: failed) — to be read again, e.g. ' +
      'after an OCR language was installed or the limits were raised. Unchanged text keeps its index (D-427).',
    implements: ['D-427'],
  })
  @ApiBody({ type: AdminReindexFilesDto, examples: { default: { value: { statuses: ['failed'] } } } })
  @ApiSuccess(200, { description: 'Queued', type: AdminReindexFilesResultDto, example: { queued: 4 } })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async reindex(
    @CurrentActor() actor: Actor,
    @Body() body: AdminReindexFilesDto,
  ): Promise<AdminReindexFilesResultDto> {
    const ids = body.fileIds?.length
      ? (
          await this.prisma.fileObject.findMany({
            where: { publicId: { in: body.fileIds } },
            select: { id: true },
          })
        ).map((f) => f.id)
      : undefined;
    const queued = await this.jobs.requeue({
      ...(ids ? { fileObjectIds: ids } : { status: (body.statuses ?? ['failed']) as FileTextStatus[] }),
    });
    await this.audit.recordStandalone({
      category: 'config',
      action: 'file_search.reindexed',
      outcome: 'success',
      actor,
      resourceType: 'file_search',
      data: { files: body.fileIds?.length ?? null, statuses: body.statuses ?? null, queued },
    });
    return { queued };
  }
}
