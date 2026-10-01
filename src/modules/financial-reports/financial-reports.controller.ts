import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';

import {
  AccountRollForwardDto,
  AccountRollForwardQuery,
  AsOfQuery,
  BalanceSheetDto,
  BS_EXAMPLE,
  CashFlowDto,
  CF_EXAMPLE,
  GL_EXAMPLE,
  GlDetailDto,
  GlDetailQuery,
  MonthRangeQuery,
  PL_EXAMPLE,
  ProfitAndLossDto,
  ProfitAndLossQuery,
  TB_EXAMPLE,
  TrialBalanceDto,
  TrialBalanceQuery,
} from './financial-reports.dto';
import { FinancialReportsService } from './financial-reports.service';

const DOCS = ['D-031', 'D-033'];

@ApiSurface('admin', 'financialReports')
@Controller('financial-reports')
export class AdminFinancialReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get('trial-balance')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.trialBalance',
    summary: 'Trial balance',
    description:
      'Per account: opening, debit, credit and closing balance for months `from`..`to` from the posted journals (D-031); `balanced` checks Σ debit = Σ credit.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Trial balance', type: TrialBalanceDto, example: TB_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  trialBalance(@Query() q: TrialBalanceQuery): Promise<TrialBalanceDto> {
    return this.reports.trialBalance(q.from, q.to, q.includeZero ?? false);
  }

  @Get('gl-detail')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.glDetail',
    summary: 'General-ledger detail',
    description:
      'Lines of one account with the running balance; each drills down to its journal, source document, domain event and the user who posted it (accounting-design §1.7).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'GL detail', type: GlDetailDto, example: GL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  glDetail(@Query() q: GlDetailQuery): Promise<GlDetailDto> {
    return this.reports.glDetail(q.accountCode, q.from, q.to, q.page, q.perPage);
  }

  @Get('roll-forward')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.accountRollForward',
    summary: 'Account roll-forward',
    description:
      'One account month by month in its normal direction — opening, increases and decreases by posting rule, ' +
      'closing — e.g. 2330 points liability or 2130 retention, computed server-side (D-031, D-033).',
    implements: ['D-031', 'D-033'],
  })
  @ApiSuccess(200, {
    description: 'Roll-forward',
    type: AccountRollForwardDto,
    example: {
      accountCode: '2330',
      nameTh: 'หนี้สินคะแนนสะสม',
      normalSide: 'credit',
      months: [
        {
          month: '2026-10',
          opening: '0.00',
          increases: '1200.00',
          decreases: '200.00',
          closing: '1000.00',
          byRule: [{ ruleKey: 'P11', increase: '1200.00', decrease: '200.00' }],
        },
      ],
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  accountRollForward(@Query() q: AccountRollForwardQuery): Promise<AccountRollForwardDto> {
    return this.reports.rollForward(q.accountCode, q.from, q.to);
  }

  @Get('balance-sheet')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.balanceSheet',
    summary: 'Balance sheet',
    description:
      'Assets, liabilities and equity at a date with prior-year and current-year profit (while no closing entries exist); `difference` is always 0 for a balanced ledger.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Balance sheet', type: BalanceSheetDto, example: BS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  balanceSheet(@Query() q: AsOfQuery): Promise<BalanceSheetDto> {
    return this.reports.balanceSheet(q.asOf);
  }

  @Get('profit-and-loss')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.profitAndLoss',
    summary: 'Profit and loss by dimension',
    description:
      'Revenue, cost of sales, gross margin, expenses and net profit, optionally per factory, product type, channel, campaign or cost centre (margins from dimensions, §3).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Profit and loss', type: ProfitAndLossDto, example: PL_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  profitAndLoss(@Query() q: ProfitAndLossQuery): Promise<ProfitAndLossDto> {
    return this.reports.profitAndLoss(q.from, q.to, q.dimension);
  }

  @Get('cash-flow')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.cashFlow',
    summary: 'Cash-flow statement (indirect)',
    description:
      'Net profit adjusted by each balance-sheet account’s movement per its cash-flow class (operating, investing, financing); reconciled to the cash accounts’ movement.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Cash flow', type: CashFlowDto, example: CF_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  cashFlow(@Query() q: MonthRangeQuery): Promise<CashFlowDto> {
    return this.reports.cashFlow(q.from, q.to);
  }
}
