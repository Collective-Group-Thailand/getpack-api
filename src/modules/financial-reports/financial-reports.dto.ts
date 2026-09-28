import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { PL_DIMENSIONS } from './financial-reports.service';

/** Financial reports (B5.6, accounting-design §6 GL). Money: strings, THB; balances debit-positive unless noted. */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const JOURNAL = '0192f3a0-7c1e-7d2a-9b1f-000000510020';

/** One month (`YYYY-MM`), as a query or a body. */
export class MonthDto {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  period!: string;
}

export class MonthRangeQuery {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  from!: string;

  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  to!: string;
}

export class TrialBalanceQuery extends MonthRangeQuery {
  @ApiPropertyOptional({ example: false, description: 'Include accounts without balance or activity' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeZero?: boolean;
}

export class TrialBalanceRowDto {
  @ApiProperty({ example: '1121' })
  accountCode!: string;

  @ApiProperty({ example: 'เงินฝากธนาคาร บัญชีที่ 1' })
  nameTh!: string;

  @ApiProperty({ example: 'Bank account 1' })
  nameEn!: string;

  @ApiProperty({ enum: ['asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense'], enumName: 'AccountType', example: 'asset' })
  accountType!: string;

  @ApiProperty({ enum: ['debit', 'credit'], enumName: 'LedgerSide', example: 'debit' })
  normalSide!: string;

  @ApiProperty({ example: '100000.00' })
  opening!: string;

  @ApiProperty({ example: '5350.00' })
  debit!: string;

  @ApiProperty({ example: '5504.40' })
  credit!: string;

  @ApiProperty({ example: '99845.60' })
  closing!: string;
}

export class TbTotalsDto {
  @ApiProperty({ example: '0.00' })
  opening!: string;

  @ApiProperty({ example: '125000.00' })
  debit!: string;

  @ApiProperty({ example: '125000.00' })
  credit!: string;

  @ApiProperty({ example: '0.00' })
  closing!: string;
}

export class TrialBalanceDto {
  @ApiProperty({ example: '2026-10' })
  from!: string;

  @ApiProperty({ example: '2026-10' })
  to!: string;

  @ApiProperty({ type: [TrialBalanceRowDto] })
  accounts!: TrialBalanceRowDto[];

  @ApiProperty({ type: TbTotalsDto })
  totals!: TbTotalsDto;

  @ApiProperty({ example: true, description: 'Σ debit = Σ credit and balances sum to 0' })
  balanced!: boolean;
}

const TB_ROW: TrialBalanceRowDto = { accountCode: '1121', nameTh: 'เงินฝากธนาคาร บัญชีที่ 1', nameEn: 'Bank account 1', accountType: 'asset', normalSide: 'debit', opening: '100000.00', debit: '5350.00', credit: '5504.40', closing: '99845.60' };
export const TB_EXAMPLE: TrialBalanceDto = { from: '2026-10', to: '2026-10', accounts: [TB_ROW], totals: { opening: '0.00', debit: '125000.00', credit: '125000.00', closing: '0.00' }, balanced: true };

export class GlDetailQuery extends MonthRangeQuery {
  @ApiProperty({ example: '1121' })
  @Matches(/^[0-9A-Z][0-9A-Z.-]*$/)
  accountCode!: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  perPage: number = 100;
}

export class PersonRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000101' })
  id!: string;

  @ApiProperty({ example: 'ฝ่ายการเงิน (fake)' })
  name!: string;
}

export class GlLineDto {
  @ApiProperty({ format: 'uuid', example: JOURNAL, description: 'Drill down: GET /admin/ledger/journals/{id}' })
  journalEntryId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'JE202610-000012' })
  entryNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  jvNumber!: string | null;

  @ApiProperty({ enum: ['auto', 'manual', 'reversal', 'recurring', 'closing'], enumName: 'JournalKind', example: 'auto' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: 'P17' })
  ruleKey!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  entryDate!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  documentDate!: string;

  @ApiProperty({ example: 'จ่ายชำระโรงงาน DEVPV-26-00001' })
  description!: string;

  @ApiProperty({ type: String, nullable: true, example: 'payout_item' })
  sourceType!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0192f3a0-7c1e-7d2a-9b1f-000000530102' })
  sourceId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'DEVPV-26-00001' })
  sourceNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001' })
  domainEventId!: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  postedBy!: PersonRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'O2610-00001' })
  orderCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'โรงพิมพ์ตัวอย่าง (fake)' })
  vendorName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  customerName!: string | null;

  @ApiProperty({ enum: ['output_vat', 'output_vat_not_due', 'input_vat', 'input_vat_pending', 'wht_receivable', 'wht_pnd3', 'wht_pnd53'], enumName: 'TaxCode', nullable: true, example: null })
  taxCode!: string | null;

  @ApiProperty({ example: '0.00' })
  debit!: string;

  @ApiProperty({ example: '5504.40' })
  credit!: string;

  @ApiProperty({ example: '99845.60', description: 'Running balance (debit-positive)' })
  balance!: string;
}

export class GlDetailDto {
  @ApiProperty({ example: '1121' })
  accountCode!: string;

  @ApiProperty({ example: 'เงินฝากธนาคาร บัญชีที่ 1' })
  nameTh!: string;

  @ApiProperty({ example: '2026-10' })
  from!: string;

  @ApiProperty({ example: '2026-10' })
  to!: string;

  @ApiProperty({ example: '100000.00' })
  opening!: string;

  @ApiProperty({ example: '5350.00' })
  debit!: string;

  @ApiProperty({ example: '5504.40' })
  credit!: string;

  @ApiProperty({ example: '99845.60' })
  closing!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  total!: number;

  @ApiProperty({ type: [GlLineDto] })
  lines!: GlLineDto[];
}

export const GL_EXAMPLE: GlDetailDto = {
  accountCode: '1121',
  nameTh: 'เงินฝากธนาคาร บัญชีที่ 1',
  from: '2026-10',
  to: '2026-10',
  opening: '100000.00',
  debit: '5350.00',
  credit: '5504.40',
  closing: '99845.60',
  total: 1,
  lines: [
    {
      journalEntryId: JOURNAL,
      entryNo: 'JE202610-000012',
      jvNumber: null,
      kind: 'auto',
      ruleKey: 'P17',
      entryDate: '2026-10-27',
      documentDate: '2026-10-27',
      description: 'จ่ายชำระโรงงาน DEVPV-26-00001',
      sourceType: 'payout_item',
      sourceId: '0192f3a0-7c1e-7d2a-9b1f-000000530102',
      sourceNo: 'DEVPV-26-00001',
      domainEventId: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001',
      postedBy: null,
      orderCode: 'O2610-00001',
      vendorName: 'โรงพิมพ์ตัวอย่าง (fake)',
      customerName: null,
      taxCode: null,
      debit: '0.00',
      credit: '5504.40',
      balance: '94495.60',
    },
  ],
};

export class AsOfQuery {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  @Matches(DAY)
  asOf!: string;
}

export class BalanceLineDto {
  @ApiProperty({ example: '1121' })
  accountCode!: string;

  @ApiProperty({ example: 'เงินฝากธนาคาร บัญชีที่ 1' })
  nameTh!: string;

  @ApiProperty({ example: 'Bank account 1' })
  nameEn!: string;

  @ApiProperty({ example: '99845.60', description: 'In the section’s normal direction' })
  balance!: string;
}

export class BsTotalsDto {
  @ApiProperty({ example: '150000.00' })
  assets!: string;

  @ApiProperty({ example: '40000.00' })
  liabilities!: string;

  @ApiProperty({ example: '110000.00', description: 'Equity accounts + prior-year and current-year profit' })
  equity!: string;
}

export class BalanceSheetDto {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  asOf!: string;

  @ApiProperty({ format: 'date', example: '2026-01-01' })
  fiscalYearStart!: string;

  @ApiProperty({ type: [BalanceLineDto] })
  assets!: BalanceLineDto[];

  @ApiProperty({ type: [BalanceLineDto] })
  liabilities!: BalanceLineDto[];

  @ApiProperty({ type: [BalanceLineDto] })
  equity!: BalanceLineDto[];

  @ApiProperty({ example: '0.00', description: 'Profit of earlier years not yet closed to retained earnings' })
  priorYearsProfit!: string;

  @ApiProperty({ example: '10000.00' })
  currentYearProfit!: string;

  @ApiProperty({ type: BsTotalsDto })
  totals!: BsTotalsDto;

  @ApiProperty({ example: '0.00', description: 'assets − liabilities − equity; always 0 for a balanced ledger' })
  difference!: string;
}

export const BS_EXAMPLE: BalanceSheetDto = {
  asOf: '2026-10-31',
  fiscalYearStart: '2026-01-01',
  assets: [{ accountCode: '1121', nameTh: 'เงินฝากธนาคาร บัญชีที่ 1', nameEn: 'Bank account 1', balance: '150000.00' }],
  liabilities: [{ accountCode: '2210', nameTh: 'ภาษีขาย', nameEn: 'Output VAT', balance: '40000.00' }],
  equity: [{ accountCode: '3100', nameTh: 'ทุนเรือนหุ้น', nameEn: 'Share capital', balance: '100000.00' }],
  priorYearsProfit: '0.00',
  currentYearProfit: '10000.00',
  totals: { assets: '150000.00', liabilities: '40000.00', equity: '110000.00' },
  difference: '0.00',
};

export class ProfitAndLossQuery extends MonthRangeQuery {
  @ApiPropertyOptional({ enum: PL_DIMENSIONS, enumName: 'ProfitAndLossDimension', default: 'none' })
  @IsOptional()
  @IsIn(PL_DIMENSIONS)
  dimension: (typeof PL_DIMENSIONS)[number] = 'none';
}

export class PlAccountDto {
  @ApiProperty({ example: '4110' })
  accountCode!: string;

  @ApiProperty({ example: '10000.00', description: 'Credit − debit' })
  amount!: string;
}

export class PlLineDto {
  @ApiProperty({ example: 'F9001 [DEV] บริษัท โรงงานทดสอบ จำกัด', description: 'The dimension value, `(none)` when the lines carry none' })
  dimension!: string;

  @ApiProperty({ example: '10000.00' })
  revenue!: string;

  @ApiProperty({ example: '8000.00' })
  costOfSales!: string;

  @ApiProperty({ example: '2000.00' })
  grossMargin!: string;

  @ApiProperty({ type: String, nullable: true, example: '20.00' })
  grossMarginPct!: string | null;

  @ApiProperty({ example: '100.00' })
  expenses!: string;

  @ApiProperty({ example: '1900.00' })
  netProfit!: string;

  @ApiProperty({ type: [PlAccountDto] })
  accounts!: PlAccountDto[];
}

export class PlTotalsDto {
  @ApiProperty({ example: '10000.00' })
  revenue!: string;

  @ApiProperty({ example: '8000.00' })
  costOfSales!: string;

  @ApiProperty({ example: '2000.00' })
  grossMargin!: string;

  @ApiProperty({ example: '100.00' })
  expenses!: string;

  @ApiProperty({ example: '1900.00' })
  netProfit!: string;
}

export class ProfitAndLossDto {
  @ApiProperty({ example: '2026-10' })
  from!: string;

  @ApiProperty({ example: '2026-10' })
  to!: string;

  @ApiProperty({ enum: PL_DIMENSIONS, enumName: 'ProfitAndLossDimension', example: 'factory' })
  dimension!: string;

  @ApiProperty({ type: [PlLineDto] })
  lines!: PlLineDto[];

  @ApiProperty({ type: PlTotalsDto })
  totals!: PlTotalsDto;
}

export const PL_EXAMPLE: ProfitAndLossDto = {
  from: '2026-10',
  to: '2026-10',
  dimension: 'factory',
  lines: [
    {
      dimension: 'F9001 [DEV] บริษัท โรงงานทดสอบ จำกัด',
      revenue: '10000.00',
      costOfSales: '8000.00',
      grossMargin: '2000.00',
      grossMarginPct: '20.00',
      expenses: '100.00',
      netProfit: '1900.00',
      accounts: [{ accountCode: '4110', amount: '10000.00' }],
    },
  ],
  totals: { revenue: '10000.00', costOfSales: '8000.00', grossMargin: '2000.00', expenses: '100.00', netProfit: '1900.00' },
};

export class CashLineDto {
  @ApiProperty({ example: '1210' })
  accountCode!: string;

  @ApiProperty({ example: 'ลูกหนี้การค้า' })
  nameTh!: string;

  @ApiProperty({ example: '-5350.00', description: 'Cash effect of the account’s movement (credit − debit)' })
  amount!: string;
}

export class CashSectionDto {
  @ApiProperty({ type: [CashLineDto] })
  lines!: CashLineDto[];

  @ApiProperty({ example: '0.00' })
  total!: string;
}

export class OperatingSectionDto {
  @ApiProperty({ type: [CashLineDto], description: 'Working-capital changes and non-cash items' })
  adjustments!: CashLineDto[];

  @ApiProperty({ example: '1900.00' })
  total!: string;
}

export class CashFlowDto {
  @ApiProperty({ example: '2026-10' })
  from!: string;

  @ApiProperty({ example: '2026-10' })
  to!: string;

  @ApiProperty({ example: '1900.00' })
  netProfit!: string;

  @ApiProperty({ type: OperatingSectionDto })
  operating!: OperatingSectionDto;

  @ApiProperty({ type: CashSectionDto })
  investing!: CashSectionDto;

  @ApiProperty({ type: CashSectionDto })
  financing!: CashSectionDto;

  @ApiProperty({ example: '1900.00' })
  netChange!: string;

  @ApiProperty({ example: '1900.00', description: 'Movement of the cash-class accounts (bank, clearing)' })
  cashMovement!: string;

  @ApiProperty({ example: '0.00', description: 'Always 0 for a balanced ledger' })
  difference!: string;
}

export const CF_EXAMPLE: CashFlowDto = {
  from: '2026-10',
  to: '2026-10',
  netProfit: '1900.00',
  operating: { adjustments: [{ accountCode: '2110', nameTh: 'เจ้าหนี้การค้า — โรงงาน', amount: '0.00' }], total: '1900.00' },
  investing: { lines: [], total: '0.00' },
  financing: { lines: [], total: '0.00' },
  netChange: '1900.00',
  cashMovement: '1900.00',
  difference: '0.00',
};
