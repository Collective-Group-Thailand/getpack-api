import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { bangkokDate } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { ReasonDto } from '@modules/receivables/receivables.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  BANK_IDS,
  BankStatementLineDto,
  CASH_EXAMPLE,
  CashPositionDto,
  CashPositionQuery,
  COMPANY_ACCOUNT_EXAMPLE,
  CompanyBankAccountDto,
  IdentifyReceiptDto,
  ImportResultDto,
  ImportSettlementDto,
  ImportStatementDto,
  LINE_EXAMPLE,
  ManualMatchDto,
  ProposeCompanyBankAccountDto,
  RECEIPT_EXAMPLE,
  SETTLEMENT_EXAMPLE,
  SettlementDto,
  StatementLineQuery,
  UnidentifiedQuery,
  UnidentifiedReceiptDto,
} from './banking.dto';
import { BankingService } from './banking.service';
import { cashDto, companyAccountDto, lineDto, receiptDto } from './banking-views';
import { CompanyBankAccountsService } from './company-bank-accounts.service';

const DOCS = ['D-061', 'D-093'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const lineParam = ApiParam({ name: 'lineId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'banking')
@Controller()
export class AdminBankingController {
  constructor(
    private readonly banking: BankingService,
    private readonly accounts: CompanyBankAccountsService,
  ) {}

  @Get('company-bank-accounts')
  @Can('banking.read')
  @ApiEndpoint({
    id: 'admin.banking.listAccounts',
    summary: 'List company bank accounts',
    description: 'Each tied to its own cash GL account; only the last 4 digits are returned (PDPA, D-093).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Accounts',
    type: [CompanyBankAccountDto],
    example: [COMPANY_ACCOUNT_EXAMPLE],
  })
  @ApiStandardErrors()
  async accountsList(): Promise<CompanyBankAccountDto[]> {
    return (await this.accounts.list()).map(companyAccountDto);
  }

  @Post('company-bank-accounts')
  @Can('banking.accounts.propose')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.banking.proposeAccount',
    summary: 'Propose a company bank account',
    description:
      'Usable only after two different people approve it (policy `company_bank_account_change`: Finance, then Finance Manager — §8, D-169). Stored encrypted with a keyed hash; never returned or logged. Requires `Idempotency-Key`.',
    implements: [...DOCS, 'D-169'],
  })
  @ApiBody({
    type: ProposeCompanyBankAccountDto,
    examples: {
      default: {
        value: {
          bankCode: '014',
          accountName: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด (fake)',
          accountNo: '000-0-00000-1',
          glAccountCode: '1121',
          purpose: 'both',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Proposed account',
    type: CompanyBankAccountDto,
    example: { ...COMPANY_ACCOUNT_EXAMPLE, status: 'pending_approval' },
  })
  @ApiStandardErrors(...WRITE, 'banking.gl_account_invalid', 'approval.no_matching_step')
  async propose(
    @CurrentActor() actor: Actor,
    @Body() body: ProposeCompanyBankAccountDto,
  ): Promise<CompanyBankAccountDto> {
    return companyAccountDto(await this.accounts.propose(staff(actor), body));
  }

  @Post('bank-statements')
  @Can('banking.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.banking.importStatement',
    summary: 'Import a bank statement',
    description:
      'A statement file (parsed by the bank adapter, D-093) or rows from a bank API. A file already imported is refused; lines already imported from an overlapping file are skipped. New lines are matched automatically by amount, reference and date window (setting `banking.auto_match`): slip transfers (P05), gateway settlements (P04), payout runs and refunds. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: ImportStatementDto,
    examples: {
      file: {
        value: { companyBankAccountId: BANK_IDS.account, fileId: BANK_IDS.file, format: 'generic_csv' },
      },
      rows: {
        value: {
          companyBankAccountId: BANK_IDS.account,
          rows: [
            { txnDate: '2026-10-27', amount: '5350.00', description: 'TRF IN', reference: 'PK2610ABCD' },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Import result',
    type: ImportResultDto,
    example: { importId: BANK_IDS.import, lines: 12, matched: 9 },
  })
  @ApiStandardErrors(
    ...WRITE,
    'banking.duplicate_import',
    'banking.statement_invalid',
    'payouts.bank_account_missing',
    'file.not_ready',
  )
  async importStatement(
    @CurrentActor() actor: Actor,
    @Body() body: ImportStatementDto,
  ): Promise<ImportResultDto> {
    if (!body.fileId === !body.rows)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'fileId', code: 'one_of', message: 'fileId or rows' }],
      });
    return this.banking.importStatement(staff(actor), {
      companyBankAccountId: body.companyBankAccountId,
      ...(body.fileId && { fileId: body.fileId }),
      ...(body.format && { format: body.format }),
      ...(body.rows && {
        rows: body.rows.map((r) => ({
          txnDate: r.txnDate,
          valueDate: r.valueDate ?? null,
          amount: r.amount,
          description: r.description,
          reference: r.reference ?? null,
          counterparty: r.counterparty ?? null,
          balance: r.balance ?? null,
        })),
      }),
    });
  }

  @Get('bank-statement-lines')
  @Can('banking.read')
  @ApiEndpoint({
    id: 'admin.banking.listLines',
    summary: 'List bank statement lines',
    description: 'Newest first; filter by account and match status (the unmatched queue, §6).',
    implements: DOCS,
  })
  @ApiPaginated(BankStatementLineDto, { example: LINE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async lines(@Query() q: StatementLineQuery) {
    const where: Prisma.BankStatementLineWhereInput = {
      ...(q.companyBankAccountId && { companyBankAccount: { publicId: q.companyBankAccountId } }),
      ...(q.matchStatus && { matchStatus: q.matchStatus }),
    };
    const { rows, total } = await this.banking.lines(where, q.page, q.perPage);
    return { data: rows.map(lineDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('bank-statement-lines/:lineId/actions/match')
  @HttpCode(200)
  @Can('banking.manage')
  @Idempotent()
  @lineParam
  @ApiEndpoint({
    id: 'admin.banking.matchLine',
    summary: 'Match a statement line by hand',
    description:
      'To a slip / bank payment (P05), a gateway settlement (P04), a payout run, a refund or a tax payment; amounts must agree (§6). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: ManualMatchDto,
    examples: {
      default: { value: { targetType: 'payment', targetId: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001' } },
    },
  })
  @ApiSuccess(200, { description: 'Line', type: BankStatementLineDto, example: LINE_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'banking.line_already_matched', 'banking.match_amount_mismatch')
  async match(
    @CurrentActor() actor: Actor,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: ManualMatchDto,
  ): Promise<BankStatementLineDto> {
    return lineDto(await this.banking.manualMatch(staff(actor), lineId, body));
  }

  @Post('bank-statement-lines/:lineId/actions/ignore')
  @HttpCode(200)
  @Can('banking.manage')
  @Idempotent()
  @lineParam
  @ApiEndpoint({
    id: 'admin.banking.ignoreLine',
    summary: 'Ignore a statement line',
    description:
      'A line that is not a transaction to post (e.g. a transfer between company accounts already journalised), with the reason. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: ReasonDto,
    examples: { default: { value: { reason: 'โอนระหว่างบัญชีบริษัท บันทึกด้วยสมุดรายวันแล้ว' } } },
  })
  @ApiSuccess(200, {
    description: 'Line',
    type: BankStatementLineDto,
    example: { ...LINE_EXAMPLE, matchStatus: 'ignored', matches: [] },
  })
  @ApiStandardErrors(...WRITE, 'banking.line_already_matched')
  async ignore(
    @CurrentActor() actor: Actor,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: ReasonDto,
  ): Promise<BankStatementLineDto> {
    return lineDto(await this.banking.ignore(staff(actor), lineId, body.reason));
  }

  @Post('bank-statement-lines/:lineId/actions/mark-unidentified')
  @HttpCode(200)
  @Can('banking.manage')
  @Idempotent()
  @lineParam
  @ApiEndpoint({
    id: 'admin.banking.markUnidentified',
    summary: 'Park money in as unidentified',
    description:
      'Money in that no order claims goes to unidentified receipts (1140, P29) until Finance identifies the payer. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Line',
    type: BankStatementLineDto,
    example: { ...LINE_EXAMPLE, amount: '5350.00', matchStatus: 'unidentified', matches: [] },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'banking.line_already_matched',
  )
  async markUnidentified(
    @CurrentActor() actor: Actor,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<BankStatementLineDto> {
    return lineDto(await this.banking.markUnidentified(staff(actor), lineId));
  }

  @Get('unidentified-receipts')
  @Can('banking.read')
  @ApiEndpoint({
    id: 'admin.banking.listUnidentified',
    summary: 'List unidentified receipts',
    description: 'Money parked in 1140 (P29) and what became of it (§6).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Receipts', type: [UnidentifiedReceiptDto], example: [RECEIPT_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async unidentified(@Query() q: UnidentifiedQuery): Promise<UnidentifiedReceiptDto[]> {
    return (await this.banking.unidentified(q.status)).map(receiptDto);
  }

  @Post('unidentified-receipts/:receiptId/actions/identify')
  @HttpCode(200)
  @Can('banking.manage')
  @Idempotent()
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.banking.identify',
    summary: 'Identify an unidentified receipt',
    description:
      'The receipt becomes a bank payment of the order group, applied to its schedule like any payment; its tax invoice comes out of 1140 (P02). Requires `Idempotency-Key`.',
    implements: [...DOCS, 'D-033'],
  })
  @ApiBody({ type: IdentifyReceiptDto, examples: { default: { value: { orderGroupId: BANK_IDS.group } } } })
  @ApiSuccess(200, {
    description: 'Receipt',
    type: UnidentifiedReceiptDto,
    example: { ...RECEIPT_EXAMPLE, status: 'matched' },
  })
  @ApiStandardErrors(...WRITE, 'banking.line_already_matched')
  async identify(
    @CurrentActor() actor: Actor,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() body: IdentifyReceiptDto,
  ): Promise<UnidentifiedReceiptDto> {
    return receiptDto(await this.banking.identify(staff(actor), receiptId, body.orderGroupId));
  }

  @Post('gateway-settlements')
  @Can('banking.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.banking.importSettlement',
    summary: 'Import a gateway settlement report',
    description:
      'The SCB / 2C2P settlement with its fees and VAT on fees; posted (P04: net to bank, fee to expense, VAT to input VAT with the gateway’s tax invoice) when matched to the bank line. A report already imported is refused. Requires `Idempotency-Key`.',
    implements: ['D-061', 'D-093'],
  })
  @ApiBody({
    type: ImportSettlementDto,
    examples: {
      default: {
        value: {
          provider: 'scb',
          companyBankAccountId: BANK_IDS.account,
          settlementDate: '2026-10-28',
          vatOnFee: '5.99',
          feeTaxInvoiceNo: 'SCB-TI-2610-01',
          lines: [{ providerRef: 'SCB-TXN-0001', grossAmount: '5350.00', feeAmount: '85.60' }],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Settlement', type: SettlementDto, example: SETTLEMENT_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'banking.duplicate_import',
    'banking.statement_invalid',
    'payouts.bank_account_missing',
  )
  async importSettlement(
    @CurrentActor() actor: Actor,
    @Body() body: ImportSettlementDto,
  ): Promise<SettlementDto> {
    const s = await this.banking.importSettlement(staff(actor), body);
    return {
      id: s.publicId,
      provider: s.provider,
      settlementDate: bangkokDate(s.settlementDate),
      grossAmount: s.grossAmount.toFixed(2),
      feeAmount: s.feeAmount.toFixed(2),
      vatOnFee: s.vatOnFee.toFixed(2),
      netAmount: s.netAmount.toFixed(2),
      status: s.status,
      lineCount: s.lines.length,
      unmatchedLines: s.lines.filter((l) => l.paymentId === null).length,
    };
  }

  @Get('cash-position')
  @Can('banking.read')
  @ApiEndpoint({
    id: 'admin.banking.cashPosition',
    summary: 'Daily cash position',
    description:
      'Per company bank account its GL balance, last statement balance and unmatched lines; the clearing and unidentified accounts (§6).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Cash position', type: CashPositionDto, example: CASH_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async cash(@Query() q: CashPositionQuery): Promise<CashPositionDto> {
    return cashDto(await this.banking.cashPosition(q.asOf ?? bangkokDate(new Date())));
  }
}
