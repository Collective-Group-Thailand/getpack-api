import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { MonthDto } from '@modules/financial-reports/financial-reports.dto';
import { dayOf } from '@common/ledger-core/dates';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import {
  AuditSampleDto,
  DrawSampleDto,
  EXCEPTION_EXAMPLE,
  ExceptionReportDto,
  PBC_EXAMPLE,
  PbcExportDto,
  SAMPLE_EXAMPLE,
  type SampleItemDto,
} from './audit-support.dto';
import { AuditSupportService } from './audit-support.service';

const DOCS = ['D-033'];

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'auditSupport')
@Controller('audit')
export class AdminAuditSupportController {
  constructor(
    private readonly support: AuditSupportService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get('exceptions')
  @Can('audit_support.read')
  @ApiEndpoint({
    id: 'admin.auditSupport.exceptions',
    summary: 'Exception reports of a month',
    description:
      'Series gaps, journals posted outside business hours, back-dated documents, manual journals by user, reversals, duplicate vendor bank accounts, duplicate slip references, credit notes after the period end, payouts without a valid tax invoice (§8).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Exception reports',
    type: [ExceptionReportDto],
    example: [EXCEPTION_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  exceptions(@Query() q: MonthDto): Promise<ExceptionReportDto[]> {
    return this.support.exceptions(q.period);
  }

  @Post('samples')
  @Can('audit_support.sample')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.auditSupport.drawSample',
    summary: 'Draw an audit sample',
    description:
      'A random or value-stratified sample of a month’s documents, journals, payouts or 50 ทวิ; kept with its seed so it can be reproduced (§8 sample selection helper). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: DrawSampleDto,
    examples: {
      default: {
        value: { period: '2026-10', population: 'customer_documents', method: 'stratified', size: 25 },
      },
    },
  })
  @ApiSuccess(201, { description: 'Sample', type: AuditSampleDto, example: SAMPLE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async draw(@CurrentActor() actor: Actor, @Body() body: DrawSampleDto): Promise<AuditSampleDto> {
    const s = await this.support.sample(staff(actor), body);
    return {
      id: s.publicId,
      period: s.period,
      population: s.population,
      method: s.method,
      seed: s.seed.toString(),
      populationSize: s.populationSize,
      selected: s.selected as unknown as SampleItemDto[],
      createdAt: toBangkokIso(s.createdAt),
    };
  }

  @Get('samples')
  @Can('audit_support.read')
  @ApiEndpoint({
    id: 'admin.auditSupport.listSamples',
    summary: 'List audit samples',
    description: 'Newest first, with their seeds (§8).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Samples', type: [AuditSampleDto], example: [SAMPLE_EXAMPLE] })
  @ApiStandardErrors()
  async samples(): Promise<AuditSampleDto[]> {
    return (await this.support.samples()).map((s) => ({
      id: s.publicId,
      period: dayOf(s.fiscalPeriod.startDate).slice(0, 7),
      population: s.population,
      method: s.method,
      seed: s.seed.toString(),
      populationSize: s.populationSize,
      selected: s.selected as unknown as SampleItemDto[],
      createdAt: toBangkokIso(s.createdAt),
    }));
  }

  @Post('pbc-exports')
  @Can('audit_support.export')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.auditSupport.pbcExport',
    summary: 'Generate the PBC pack of a month',
    description:
      'One workbook: trial balance, GL detail, document registers, tax papers, fixed-asset roll-forward, close checklist and exceptions; stored as a financial record with its SHA-256 and audited as an export (§8). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: MonthDto, examples: { default: { value: { period: '2026-10' } } } })
  @ApiSuccess(201, { description: 'Export', type: PbcExportDto, example: PBC_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async pbc(@CurrentActor() actor: Actor, @Body() body: MonthDto): Promise<PbcExportDto> {
    const row = await this.support.pbcExport(staff(actor), body.period);
    return {
      id: row.publicId,
      period: row.period,
      sha256: row.sha256Hex,
      generatedAt: toBangkokIso(row.generatedAt),
    };
  }

  @Get('pbc-exports')
  @Can('audit_support.export')
  @ApiEndpoint({
    id: 'admin.auditSupport.listPbcExports',
    summary: 'List PBC packs',
    description: 'Newest first (§8).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Exports', type: [PbcExportDto], example: [PBC_EXAMPLE] })
  @ApiStandardErrors()
  async pbcList(): Promise<PbcExportDto[]> {
    return (await this.support.pbcExports()).map((r) => ({
      id: r.publicId,
      period: dayOf(r.fiscalPeriod.startDate).slice(0, 7),
      sha256: Buffer.from(r.sha256).toString('hex'),
      generatedAt: toBangkokIso(r.generatedAt),
    }));
  }

  @Get('pbc-exports/:exportId/file')
  @Can('audit_support.export')
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.auditSupport.pbcFile',
    summary: 'Download a PBC pack',
    description: 'A short-lived signed URL of the workbook.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Signed URL',
    type: DownloadUrlDto,
    example: {
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      expiresAt: '2026-11-10T10:05:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async pbcFile(@Param('exportId', ParseUUIDPipe) exportId: string): Promise<DownloadUrlDto> {
    const d = await this.files.downloadUrl(await this.support.pbcFile(exportId));
    return { url: d.url, expiresAt: toBangkokIso(d.expiresAt) };
  }
}
