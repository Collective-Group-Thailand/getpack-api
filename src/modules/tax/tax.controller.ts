import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { dateOnly } from '@common/ledger-core/dates';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import {
  CALENDAR_EXAMPLE,
  FileTaxReportDto,
  GenerateTaxReportDto,
  PayTaxReportDto,
  REPORT_EXAMPLE,
  SUMMARY_EXAMPLE,
  TAX_IDS,
  TaxCalendarItemDto,
  TaxCalendarQuery,
  TaxReportDto,
  TaxReportListQuery,
  TaxReportSummaryDto,
} from './tax.dto';
import { TaxCalendarService } from './tax-calendar.service';
import { TaxReportsService } from './tax-reports.service';
import { calendarDto, reportDto, summaryDto } from './tax-views';

const DOCS = ['D-033'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const reportParam = ApiParam({ name: 'reportId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'tax')
@Controller()
export class AdminTaxController {
  constructor(
    private readonly reports: TaxReportsService,
    private readonly calendar: TaxCalendarService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get('tax-reports')
  @Can('tax.read')
  @ApiEndpoint({
    id: 'admin.tax.list',
    summary: 'List tax reports',
    description:
      'Sales / purchase tax reports, ภ.พ.30 and ภ.ง.ด.3 / 53 working papers and the WHT registers per month, with their GL reconciliation (§6, §7 step 7).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Reports', type: [TaxReportSummaryDto], example: [SUMMARY_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: TaxReportListQuery): Promise<TaxReportSummaryDto[]> {
    const where: Prisma.TaxReportWhereInput = {
      ...(q.kind && { kind: q.kind }),
      ...(q.period && { fiscalPeriod: { startDate: dateOnly(`${q.period}-01`) } }),
    };
    return (await this.reports.list(where)).map(summaryDto);
  }

  @Get('tax-reports/:reportId')
  @Can('tax.read')
  @reportParam
  @ApiEndpoint({
    id: 'admin.tax.get',
    summary: 'Get a tax report',
    description: 'With its lines, each traceable to its journal entry and source document (§1.7).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Report', type: TaxReportDto, example: REPORT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('reportId', ParseUUIDPipe) reportId: string): Promise<TaxReportDto> {
    return reportDto(await this.reports.get(reportId));
  }

  @Post('tax-reports')
  @Can('tax.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.tax.generate',
    summary: 'Generate a tax report',
    description:
      'Builds (or rebuilds while draft) the report of a month from the posted journals and certificates, and reconciles it to its GL control accounts (setting `tax.gl_accounts`). Late documents are included with a `late` flag. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: GenerateTaxReportDto,
    examples: { default: { value: { kind: 'pp30', period: '2026-10' } } },
  })
  @ApiSuccess(201, { description: 'Draft report', type: TaxReportDto, example: REPORT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'tax.report_not_draft')
  async generate(@CurrentActor() actor: Actor, @Body() body: GenerateTaxReportDto): Promise<TaxReportDto> {
    return reportDto(await this.reports.generate(staff(actor), body.kind, body.period));
  }

  @Post('tax-reports/:reportId/actions/finalise')
  @HttpCode(200)
  @Can('tax.manage')
  @Idempotent()
  @reportParam
  @ApiEndpoint({
    id: 'admin.tax.finalise',
    summary: 'Finalise a tax report',
    description:
      'Rebuilt and refused unless it agrees with the GL (difference 0, §7 step 7); its CSV (ภ.ง.ด.3 / 53: the attachment) is stored; its figures never change afterwards. The ภ.พ.30 working paper closes the month’s VAT (P27). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Final report',
    type: TaxReportDto,
    example: {
      ...REPORT_EXAMPLE,
      status: 'final',
      finalisedAt: '2026-11-05T10:05:00+07:00',
      fileReady: true,
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'tax.report_not_draft',
    'tax.gl_difference',
  )
  async finalise(
    @CurrentActor() actor: Actor,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ): Promise<TaxReportDto> {
    return reportDto(await this.reports.finalise(staff(actor), reportId));
  }

  @Post('tax-reports/:reportId/actions/file')
  @HttpCode(200)
  @Can('tax.manage')
  @Idempotent()
  @reportParam
  @ApiEndpoint({
    id: 'admin.tax.file',
    summary: 'Record the filing',
    description:
      'The Revenue Department’s reference of the filed return; its calendar item is done. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: FileTaxReportDto, examples: { default: { value: { filingRef: 'RD-2611-000123' } } } })
  @ApiSuccess(200, {
    description: 'Filed report',
    type: TaxReportDto,
    example: {
      ...REPORT_EXAMPLE,
      status: 'filed',
      filedAt: '2026-11-14T10:00:00+07:00',
      filingRef: 'RD-2611-000123',
      fileReady: true,
    },
  })
  @ApiStandardErrors(...WRITE, 'tax.report_not_final')
  async file(
    @CurrentActor() actor: Actor,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() body: FileTaxReportDto,
  ): Promise<TaxReportDto> {
    return reportDto(
      await this.reports.file(staff(actor), reportId, {
        filingRef: body.filingRef,
        ...(body.filedAt && { filedAt: body.filedAt }),
      }),
    );
  }

  @Post('tax-reports/:reportId/actions/pay')
  @HttpCode(200)
  @Can('tax.pay')
  @Idempotent()
  @reportParam
  @ApiEndpoint({
    id: 'admin.tax.pay',
    summary: 'Record the tax payment',
    description:
      'The net VAT of a final ภ.พ.30 (P27P) or the withholding tax of a final ภ.ง.ด.3 / 53 (P28) paid from a company bank account; once. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: PayTaxReportDto,
    examples: { default: { value: { paidOn: '2026-11-14', companyBankAccountId: TAX_IDS.bank } } },
  })
  @ApiSuccess(200, {
    description: 'Paid report',
    type: TaxReportDto,
    example: {
      ...REPORT_EXAMPLE,
      kind: 'pp30',
      status: 'filed',
      paidOn: '2026-11-14',
      paidAmount: '140.00',
      fileReady: true,
    },
  })
  @ApiStandardErrors(...WRITE, 'tax.report_not_payable', 'payouts.bank_account_missing')
  async pay(
    @CurrentActor() actor: Actor,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() body: PayTaxReportDto,
  ): Promise<TaxReportDto> {
    return reportDto(await this.reports.pay(staff(actor), reportId, body));
  }

  @Get('tax-reports/:reportId/export')
  @Can('tax.read')
  @reportParam
  @ApiEndpoint({
    id: 'admin.tax.export',
    summary: 'Download a tax report',
    description: 'A short-lived signed URL of the CSV stored at finalising (`file.not_ready` for a draft).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Signed URL',
    type: DownloadUrlDto,
    example: {
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      expiresAt: '2026-11-05T10:10:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async export(@Param('reportId', ParseUUIDPipe) reportId: string): Promise<DownloadUrlDto> {
    const d = await this.files.downloadUrl(await this.reports.fileId(reportId));
    return { url: d.url, expiresAt: toBangkokIso(d.expiresAt) };
  }

  @Get('tax-calendar')
  @Can('tax.read')
  @ApiEndpoint({
    id: 'admin.tax.calendar',
    summary: 'Tax calendar',
    description:
      'ภ.พ.30 and ภ.ง.ด.3 / 53 due dates per month (setting `tax.calendar`), reminded ahead, done when filed.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Items', type: [TaxCalendarItemDto], example: [CALENDAR_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async calendarItems(@Query() q: TaxCalendarQuery): Promise<TaxCalendarItemDto[]> {
    return (await this.calendar.list(q.status)).map(calendarDto);
  }
}
