import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditExportDto } from '@platform/audit/audit.controller';
import { AuditService } from '@platform/audit/audit.service';
import { FilesService } from '@platform/files/files.service';
import { IsIn, IsObject, IsOptional } from 'class-validator';

import { LIST_EXPORT_MAX_ROWS, LIST_EXPORT_RESOURCES, listExportOf } from './list-exports';
import { type ReportRow } from './report-types';
import { writeReport } from './report-writer';

export class CreateListExportDto {
  @ApiProperty({ enum: LIST_EXPORT_RESOURCES, enumName: 'ListExportResource', example: 'orders' })
  @IsIn(LIST_EXPORT_RESOURCES)
  resource!: (typeof LIST_EXPORT_RESOURCES)[number];

  @ApiProperty({ enum: ['xlsx', 'csv'], enumName: 'ReportFormat', example: 'xlsx' })
  @IsIn(['xlsx', 'csv'])
  format!: 'xlsx' | 'csv';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { status: 'in_production' },
    description: 'The list’s filters (its URL parameters); unknown ones are ignored',
  })
  @IsOptional()
  @IsObject()
  query?: Record<string, string>;
}

@ApiSurface('admin', 'reports')
@Controller('exports')
export class AdminListExportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  @Can('reports.export')
  @ApiEndpoint({
    id: 'admin.exports.create',
    summary: 'Export a staff list',
    description:
      `Orders, customers, companies, shipments, claims or (C1f, D-451) the customer file access log with the list’s ` +
      `filters as XLSX or CSV (formula-safe), up ` +
      `to ${LIST_EXPORT_MAX_ROWS} rows, served by a 5-minute signed URL. Needs the list’s read permission and ` +
      '`reports.export`; contact details are left out of the file (PDPA). Audited (`export.generated`). Reports ' +
      'export through `admin.reports.export`.',
    implements: ['D-033', 'D-111'],
  })
  @ApiBody({
    type: CreateListExportDto,
    examples: {
      default: { value: { resource: 'orders', format: 'xlsx', query: { status: 'in_production' } } },
    },
  })
  @ApiSuccess(200, {
    description: 'Export ready',
    type: AuditExportDto,
    example: {
      fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f11f',
      url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
      rows: 1250,
      truncated: false,
      expiresAt: '2026-10-01T10:05:00+07:00',
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateListExportDto): Promise<AuditExportDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    const def = listExportOf(body.resource)!;
    if (!(await this.permissions.forUser(actor.userId)).permissions.has(def.permission))
      throw new DomainException('auth.forbidden');
    const query = Object.fromEntries(
      Object.entries(body.query ?? {}).filter(([k, v]) => def.filters.includes(k) && typeof v === 'string'),
    );
    let rows = 0;
    const capped = async function* (source: AsyncIterable<ReportRow>) {
      for await (const row of source) {
        if (rows === LIST_EXPORT_MAX_ROWS) {
          rows++;
          return;
        }
        rows++;
        yield row;
      }
    };
    const now = new Date();
    let written: Awaited<ReturnType<typeof writeReport>>;
    try {
      written = await writeReport(
        { key: def.resource, nameTh: def.nameTh, nameEn: def.nameEn, columns: def.columns },
        capped(def.rows(this.prisma, query)),
        body.format,
        { filters: {}, generatedAt: now },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'query', code: 'filter', message: 'a filter value the list does not know' }],
        });
      throw error;
    }
    const truncated = rows > LIST_EXPORT_MAX_ROWS;
    const file = await this.files.storeSystem({
      body: written.body,
      fileName: `${def.resource}-${now.toISOString().slice(0, 10)}.${written.extension}`,
      mimeType: written.mimeType,
      retentionClass: 'transient',
      ownerUserId: actor.userId,
    });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: def.resource,
      data: { query, rows: written.rowCount, truncated, fileId: file.publicId, format: body.format },
    });
    const signed = (await this.files.signedUrl(file))!;
    return {
      fileId: file.publicId,
      url: signed.url,
      rows: written.rowCount,
      truncated,
      expiresAt: toBangkokIso(signed.expiresAt),
    };
  }
}
