import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { PAYABLE_EXAMPLE, PayableDto } from '@modules/payables/payables.dto';
import { PayablesQueryService } from '@modules/payables/payables-query.service';
import { payableDto } from '@modules/payables/payables-views';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ReasonDto } from '@modules/receivables/receivables.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import {
  ConfirmPayoutRunDto,
  CreatePayoutRunDto,
  EligibleQuery,
  EXCEPTION_EXAMPLE,
  PAID_ITEM_EXAMPLE,
  PARTNER_PAYOUT_DETAIL_EXAMPLE,
  PARTNER_PAYOUT_EXAMPLE,
  PartnerPayoutDetailDto,
  PartnerPayoutDto,
  PAYOUT_IDS,
  PAYOUT_SCHEDULE_EXAMPLE,
  PayoutExceptionDto,
  PayoutItemDocumentsDto,
  PayoutRunDto,
  PayoutScheduleJobDto,
  PayoutStatementQuery,
  RUN_EXAMPLE,
  STATEMENT_OF_ACCOUNT_EXAMPLE,
  StatementOfAccountDto,
  StatementOfAccountQuery,
} from './payouts.dto';
import { PayoutsService, type RunRow } from './payouts.service';
import {
  exceptionDto,
  partnerPayoutDetailDto,
  partnerPayoutDto,
  payoutScheduleDto,
  runDto,
  statementOfAccountDto,
} from './payouts-views';

const DOCS = ['D-022', 'D-093', 'D-164', 'D-166'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const DOWNLOAD_EXAMPLE = {
  url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
  expiresAt: '2026-10-27T10:05:00+07:00',
};
const runParam = ApiParam({ name: 'runId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

const download = (d: { url: string; expiresAt: Date }): DownloadUrlDto => ({
  url: d.url,
  expiresAt: toBangkokIso(d.expiresAt),
});

/** The remittance advice and 50 ทวิ of a paid item as short-lived signed URLs (U-B0.3). */
async function documentsDto(
  files: DocumentFilesService,
  docs: Awaited<ReturnType<PayoutsService['itemDocuments']>>,
): Promise<PayoutItemDocumentsDto> {
  return {
    remittanceAdvice: download(await files.downloadUrl(docs.remittanceFileId)),
    whtCertificates: await Promise.all(
      docs.certificates.map(async (c) => ({
        id: c.publicId,
        wtNumber: c.wtNumber,
        form: c.form,
        paidOn: c.paidOn.toISOString().slice(0, 10),
        paidAmount: c.paidAmount.toFixed(2),
        whtRatePct: c.whtRatePct.toFixed(4),
        whtAmount: c.whtAmount.toFixed(2),
        pdfReady: c.fileObjectId !== null,
        download: c.fileObjectId ? download(await files.downloadUrl(c.fileObjectId)) : null,
      })),
    ),
  };
}

@ApiSurface('admin', 'payouts')
@Controller()
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly files: DocumentFilesService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async run(actor: Actor, row: Promise<RunRow> | RunRow) {
    return runDto(await row, await permissionsOf(this.permissions, actor));
  }

  @Get('payouts/eligible')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payouts.eligible',
    summary: 'Payables eligible by a date',
    description:
      'The proposal queue: advances on acceptance, balances after POD + claim window, released retentions and vendor bills due (D-022, D-164).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Eligible payables', type: [PayableDto], example: [PAYABLE_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async eligible(@Query() q: EligibleQuery): Promise<PayableDto[]> {
    return (await this.payouts.eligible(q.payOn)).map(payableDto);
  }

  @Get('payout-runs')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payouts.list',
    summary: 'List payout runs',
    description: 'Newest first, with their items and approval (D-166).',
    implements: DOCS,
  })
  @ApiPaginated(PayoutRunDto, { example: RUN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const { rows, total } = await this.payouts.list(q.page, q.perPage);
    const perms = await permissionsOf(this.permissions, actor);
    return { data: rows.map((r) => runDto(r, perms)), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('payout-runs/:runId')
  @Can('payables.read')
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.get',
    summary: 'Get a payout run',
    description: 'Items per vendor and kind with WHT, retention and cash (§6).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Payout run', type: PayoutRunDto, example: RUN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<PayoutRunDto> {
    return this.run(actor, this.payouts.get(runId));
  }

  @Post('payout-runs')
  @Can('payouts.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.payouts.create',
    summary: 'Create a payout run',
    description:
      'Selects the payables eligible by `payOn`, groups them per vendor and kind, withholds tax per line type (hire of work, transport, services — rates from tax-rate versions) and holds the retention on balances (D-164). Vendors without an active verified bank account are excluded. Draft until proposed. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: CreatePayoutRunDto,
    examples: { default: { value: { companyBankAccountId: PAYOUT_IDS.bank, payOn: '2026-10-27' } } },
  })
  @ApiSuccess(201, {
    description: 'Draft run',
    type: PayoutRunDto,
    example: { ...RUN_EXAMPLE, status: 'draft', approvalRequestId: null },
  })
  @ApiStandardErrors(...WRITE, 'payouts.nothing_eligible', 'payouts.bank_account_missing')
  async create(@CurrentActor() actor: Actor, @Body() body: CreatePayoutRunDto): Promise<PayoutRunDto> {
    return this.run(actor, this.payouts.create(staff(actor), body));
  }

  @Post('payout-runs/:runId/actions/propose')
  @HttpCode(200)
  @Can('payouts.manage')
  @Idempotent()
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.propose',
    summary: 'Propose a payout run for approval',
    description:
      'Finance proposes; a C-Level other than the proposer approves it in the approvals inbox (policy `payout_run`, §8, D-166). Requires `Idempotency-Key`.',
    implements: [...DOCS, 'D-169'],
  })
  @ApiSuccess(200, { description: 'Proposed run', type: PayoutRunDto, example: RUN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'payouts.run_invalid_status',
    'payouts.nothing_eligible',
    'approval.no_matching_step',
  )
  async propose(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<PayoutRunDto> {
    return this.run(actor, this.payouts.propose(staff(actor), runId));
  }

  @Post('payout-runs/:runId/actions/cancel')
  @HttpCode(200)
  @Can('payouts.manage')
  @Idempotent()
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.cancel',
    summary: 'Cancel a payout run',
    description: 'Only before the bank file: its payables go back to the queue. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'รวมกับรอบถัดไป' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled run',
    type: PayoutRunDto,
    example: { ...RUN_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors(...WRITE, 'payouts.run_invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() body: ReasonDto,
  ): Promise<PayoutRunDto> {
    return this.run(actor, this.payouts.cancel(staff(actor), runId, body.reason));
  }

  @Post('payout-runs/:runId/actions/generate-bank-file')
  @HttpCode(200)
  @Can('payouts.execute')
  @Idempotent()
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.generateBankFile',
    summary: 'Generate the bank transfer file',
    description:
      'For an approved run, by the run’s bank-file adapter (D-093); stored as a financial record and audited as an export. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Run with its file',
    type: PayoutRunDto,
    example: { ...RUN_EXAMPLE, status: 'file_generated', bankFileReady: true },
  })
  @ApiStandardErrors('http.bad_request', 'http.not_found', 'validation.failed', 'payouts.run_invalid_status')
  async generate(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<PayoutRunDto> {
    return this.run(actor, this.payouts.bankFile(staff(actor), runId));
  }

  @Get('payout-runs/:runId/bank-file')
  @Can('payouts.execute')
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.downloadBankFile',
    summary: 'Download the bank transfer file',
    description: 'A short-lived signed URL (D-093). `file.not_ready` before it is generated.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async bankFile(@Param('runId', ParseUUIDPipe) runId: string): Promise<DownloadUrlDto> {
    return download(await this.files.downloadUrl(await this.payouts.bankFileId(runId)));
  }

  @Post('payout-runs/:runId/actions/confirm')
  @HttpCode(200)
  @Can('payouts.execute')
  @Idempotent()
  @runParam
  @ApiEndpoint({
    id: 'admin.payouts.confirm',
    summary: 'Record the bank’s confirmation',
    description:
      'Per item paid or failed (lines or the bank’s file). Paid items get a PV number and post (P14 / P17 / P18 / P25P), withholding gets its 50 ทวิ, balances open their retention payable (D-164); failed transfers return to the queue. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: ConfirmPayoutRunDto,
    examples: {
      default: {
        value: { confirmations: [{ reference: PAYOUT_IDS.item, status: 'paid', bankRef: 'SCB0001' }] },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Confirmed run',
    type: PayoutRunDto,
    example: { ...RUN_EXAMPLE, status: 'confirmed', bankFileReady: true, items: [PAID_ITEM_EXAMPLE] },
  })
  @ApiStandardErrors(
    ...WRITE,
    'payouts.run_invalid_status',
    'payouts.confirmation_mismatch',
    'numbering.series_missing',
  )
  async confirm(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() body: ConfirmPayoutRunDto,
  ): Promise<PayoutRunDto> {
    if (!body.confirmations?.length && !body.fileId)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'confirmations', code: 'required', message: 'confirmations or fileId' }],
      });
    return this.run(
      actor,
      this.payouts.confirm(staff(actor), runId, {
        ...(body.fileId && { fileId: body.fileId }),
        ...(body.confirmations && {
          confirmations: body.confirmations.map((c) => ({
            reference: c.reference,
            status: c.status,
            bankRef: c.bankRef ?? null,
            reason: c.reason ?? null,
          })),
        }),
      }),
    );
  }

  @Get('payout-runs/:runId/items/:itemId/documents')
  @Can('payables.read')
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payouts.itemDocuments',
    summary: 'Documents of a paid payout item',
    description:
      'The factory remittance advice (rendered and kept on first request) and the 50 ทวิ issued with the payment, ' +
      'as 5-minute signed URLs (D-022, D-166). 409 before the item is paid.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Documents',
    type: PayoutItemDocumentsDto,
    example: {
      remittanceAdvice: DOWNLOAD_EXAMPLE,
      whtCertificates: [{ ...PARTNER_PAYOUT_EXAMPLE.whtCertificates[0]!, download: DOWNLOAD_EXAMPLE }],
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'payouts.run_invalid_status')
  async itemDocuments(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<PayoutItemDocumentsDto> {
    return documentsDto(this.files, await this.payouts.itemDocuments(itemId, { runPublicId: runId }));
  }

  @Get('payout-exceptions')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payouts.exceptions',
    summary: 'Payout exceptions',
    description: 'Failed transfers and items excluded for a missing bank account (§8 exception report).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Exceptions', type: [PayoutExceptionDto], example: [EXCEPTION_EXAMPLE] })
  @ApiStandardErrors()
  async exceptions(): Promise<PayoutExceptionDto[]> {
    return (await this.payouts.exceptions()).map(exceptionDto);
  }
}

@ApiSurface('partner', 'payables')
@Controller('factories/:factoryId')
export class PartnerPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly query: PayablesQueryService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get('payouts')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.payoutStatement',
    summary: 'My payout statement',
    description:
      'What Packio paid the factory: PV number, net, VAT, withholding (with its 50 ทวิ), retention held and the transfer (D-022, D-164).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Payouts', type: [PartnerPayoutDto], example: [PARTNER_PAYOUT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: PayoutStatementQuery,
  ): Promise<PartnerPayoutDto[]> {
    const vendorId = await this.query.vendorOfFactory(actor, factoryId);
    return (await this.payouts.statementOf(vendorId, q.from, q.to, q.status)).map(partnerPayoutDto);
  }

  @Get('payouts/:payoutId')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'payoutId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.getPayout',
    summary: 'One of my payouts',
    description:
      'A payout with the payables it settles (job, PO, goods receipt, billing statement), the claim deductions taken ' +
      'from them, retention held, withholding with its 50 ทวิ, the bank reference or why the transfer failed ' +
      '(U-B0.3, D-022, D-164, D-166). Another factory’s payout is 404.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Payout',
    type: PartnerPayoutDetailDto,
    example: PARTNER_PAYOUT_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async payout(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
  ): Promise<PartnerPayoutDetailDto> {
    const vendorId = await this.query.vendorOfFactory(actor, factoryId);
    return partnerPayoutDetailDto(await this.payouts.partnerPayout(vendorId, payoutId));
  }

  @Get('payouts/:payoutId/documents')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'payoutId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.payoutDocuments',
    summary: 'Documents of one of my payouts',
    description:
      'The remittance advice (rendered and kept on first request) and the 50 ทวิ of a paid payout, as 5-minute ' +
      'signed URLs (U-B0.3, D-022, D-166). 409 before the payout is paid.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Documents',
    type: PayoutItemDocumentsDto,
    example: {
      remittanceAdvice: DOWNLOAD_EXAMPLE,
      whtCertificates: [{ ...PARTNER_PAYOUT_EXAMPLE.whtCertificates[0]!, download: DOWNLOAD_EXAMPLE }],
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'payouts.run_invalid_status')
  async payoutDocuments(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
  ): Promise<PayoutItemDocumentsDto> {
    const vendorId = await this.query.vendorOfFactory(actor, factoryId);
    await this.payouts.partnerPayout(vendorId, payoutId);
    return documentsDto(this.files, await this.payouts.itemDocuments(payoutId, { vendorId }));
  }

  @Get('payout-schedule')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.payoutSchedule',
    summary: 'My payout schedule',
    description:
      'Per job (purchase order), newest first: the payout terms the PO keeps and its advance, balance and retention ' +
      'payables — status, when each becomes payable, what it waits for and the payout that paid it (U-B0.3, D-022, ' +
      'D-164). The balance opens with the goods receipt at proof of delivery (`balancePending`).',
    implements: DOCS,
  })
  @ApiPaginated(PayoutScheduleJobDto, { example: PAYOUT_SCHEDULE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async schedule(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: PageQuery,
  ) {
    const factory = await this.query.factoryOf(actor, factoryId);
    const { rows, total } = await this.query.payoutSchedule(factory.id, q);
    const now = new Date();
    return {
      data: rows.map((r) => payoutScheduleDto(r, now)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('statement-of-account')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.statementOfAccount',
    summary: 'My statement of account',
    description:
      'The factory’s account with Packio between two days (default: this month to today, at most 366 days): the ' +
      'opening balance, every posted entry — goods received, advances applied, payouts, claim deductions, ' +
      'adjustments — with a running balance, and the closing balance. Excluding VAT (booked at payment, §2); a ' +
      'positive balance is what Packio owes the factory (U-B0.3, D-022, D-083, D-164).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Statement of account',
    type: StatementOfAccountDto,
    example: STATEMENT_OF_ACCOUNT_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statementOfAccount(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: StatementOfAccountQuery,
  ): Promise<StatementOfAccountDto> {
    const vendorId = await this.query.vendorOfFactory(actor, factoryId);
    const today = bangkokDate(new Date());
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to || addCalendarDays(from, 366) < to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'from', code: 'range', message: 'from ≤ to, at most 366 days' }],
      });
    return statementOfAccountDto(factoryId, from, to, await this.query.accountEntries(vendorId, from, to));
  }

  @Get('wht-certificates/:certificateId/pdf')
  @Can('factory_payables.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiParam({ name: 'certificateId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.whtCertificatePdf',
    summary: 'Download my 50 ทวิ',
    description: 'The withholding certificate Packio issued with a payout (§6).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async certificate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
  ): Promise<DownloadUrlDto> {
    const vendorId = await this.query.vendorOfFactory(actor, factoryId);
    const cert = await this.payouts.certificate(certificateId, vendorId);
    return download(await this.files.downloadUrl(cert.fileObjectId));
  }
}
