import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

const IDS = {
  payable: '0192f3a0-7c1e-7d2a-9b1f-0000000e7601',
  po: '0192f3a0-7c1e-7d2a-9b1f-0000000e7602',
  run: '0192f3a0-7c1e-7d2a-9b1f-0000000e7603',
  payout: '0192f3a0-7c1e-7d2a-9b1f-0000000e7604',
} as const;

export class RunCalendarDto {
  @ApiProperty({
    type: 'integer',
    isArray: true,
    example: [2, 4],
    description: 'Days of week (0 = Sunday) payout runs pay on — `payouts.run_calendar` (Finance)',
  })
  weekdays!: number[];
}

export class CalendarPayableDto {
  @ApiProperty({ format: 'uuid', example: IDS.payable })
  id!: string;

  @ApiProperty({
    enum: ['advance', 'goods_receipt', 'vendor_invoice', 'retention'],
    enumName: 'PayableSource',
    example: 'goods_receipt',
  })
  source!: string;

  @ApiProperty({
    enum: ['open', 'eligible', 'in_run', 'paid', 'cancelled'],
    enumName: 'PayableStatus',
    example: 'eligible',
    description: 'Unpaid ones only: `open`, `eligible` or `in_run`',
  })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.po })
  purchaseOrderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'PO-2610-00012' })
  poNumber!: string | null;

  @ApiProperty({ example: '9800.00' })
  netAmount!: string;

  @ApiProperty({ example: '686.00' })
  vatAmount!: string;

  @ApiProperty({ example: '9800.00' })
  openNetAmount!: string;

  @ApiProperty({ example: '686.00' })
  openVatAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-13T10:00:00+07:00' })
  eligibleAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-14',
    description: 'When it is expected to be paid (D-293); null while it cannot be known (`expectedBasis`)',
  })
  expectedPayOn!: string | null;

  @ApiProperty({
    enum: ['scheduled_run', 'run_calendar', 'eligibility_pending', 'run_calendar_unset'],
    enumName: 'ExpectedPayOnBasis',
    example: 'run_calendar',
    description:
      '`scheduled_run`: the pay-on day of the run it is in; `run_calendar`: the first payout-run day on or after its ' +
      'eligibility; `eligibility_pending`: not payable yet (e.g. waiting for delivery or the claim window); ' +
      '`run_calendar_unset`: Finance has not set the run days',
  })
  expectedBasis!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  runId!: string | null;
}

export class CalendarRunLineDto {
  @ApiProperty({ format: 'uuid', example: IDS.payout })
  payoutId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PV-2610-00008' })
  pvNumber!: string | null;

  @ApiProperty({
    enum: ['advance', 'balance', 'retention_release', 'vendor_bill'],
    enumName: 'PayoutKind',
    example: 'balance',
  })
  kind!: string;

  @ApiProperty({
    enum: ['included', 'paid', 'failed', 'excluded'],
    enumName: 'PayoutItemStatus',
    example: 'paid',
  })
  status!: string;

  @ApiProperty({ example: '9800.00' })
  apNetAmount!: string;

  @ApiProperty({ example: '686.00' })
  vatAmount!: string;

  @ApiProperty({ example: '294.00' })
  whtAmount!: string;

  @ApiProperty({ example: '524.30' })
  retentionAmount!: string;

  @ApiProperty({ example: '9667.70' })
  cashAmount!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-14' })
  paidOn!: string | null;
}

export class CalendarRunDto {
  @ApiProperty({ format: 'uuid', example: IDS.run })
  id!: string;

  @ApiProperty({ example: 'PR-2610-0003' })
  runNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-14' })
  payOn!: string;

  @ApiProperty({
    enum: [
      'draft',
      'proposed',
      'approved',
      'file_generated',
      'confirmed',
      'partially_failed',
      'rejected',
      'cancelled',
    ],
    enumName: 'PayoutRunStatus',
    example: 'confirmed',
    description:
      'Runs from `proposed` on (a draft may still change; rejected and cancelled ones are left out)',
  })
  status!: string;

  @ApiProperty({ type: [CalendarRunLineDto], description: 'My lines only' })
  lines!: CalendarRunLineDto[];
}

/** D-293 when each unpaid payable is expected to be paid, and the runs that pay them. */
export class PayoutCalendarDto {
  @ApiProperty({ type: RunCalendarDto, nullable: true, description: 'Null until Finance sets the run days' })
  runCalendar!: RunCalendarDto | null;

  @ApiProperty({ type: [CalendarPayableDto], description: 'Unpaid payables, soonest eligible first' })
  payables!: CalendarPayableDto[];

  @ApiProperty({ type: [CalendarRunDto], description: 'Runs of the last 90 days and upcoming, newest first' })
  runs!: CalendarRunDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const PAYOUT_CALENDAR_EXAMPLE: PayoutCalendarDto = {
  runCalendar: { weekdays: [2, 4] },
  payables: [
    {
      id: IDS.payable,
      source: 'goods_receipt',
      status: 'eligible',
      purchaseOrderId: IDS.po,
      poNumber: 'PO-2610-00012',
      netAmount: '9800.00',
      vatAmount: '686.00',
      openNetAmount: '9800.00',
      openVatAmount: '686.00',
      eligibleAt: '2026-10-13T10:00:00+07:00',
      expectedPayOn: '2026-10-14',
      expectedBasis: 'run_calendar',
      runId: null,
    },
  ],
  runs: [
    {
      id: IDS.run,
      runNo: 'PR-2610-0003',
      payOn: '2026-10-07',
      status: 'confirmed',
      lines: [
        {
          payoutId: IDS.payout,
          pvNumber: 'PV-2610-00008',
          kind: 'advance',
          status: 'paid',
          apNetAmount: '4200.00',
          vatAmount: '294.00',
          whtAmount: '126.00',
          retentionAmount: '0.00',
          cashAmount: '4368.00',
          paidOn: '2026-10-07',
        },
      ],
    },
  ],
  currency: 'THB',
};

export class FinancePeriodDto {
  @ApiProperty({ format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ example: '0.00', description: 'What getpack owed the factory before `from` (net of VAT)' })
  opening!: string;

  @ApiProperty({ example: '14000.00', description: 'Goods received (P15)' })
  earned!: string;

  @ApiProperty({
    example: '13300.00',
    description: 'Payouts net of VAT: advances and balances less the retention held, plus retention released',
  })
  paid!: string;

  @ApiProperty({ example: '700.00', description: 'Retention held back at payment (D-164)' })
  retainedHeld!: string;

  @ApiProperty({ example: '0.00', description: 'Retention paid out after its release period (D-164)' })
  retainedReleased!: string;

  @ApiProperty({ example: '0.00', description: 'Claim deductions (P20, D-083)' })
  deducted!: string;

  @ApiProperty({ example: '0.00', description: 'Other postings (manual entries, reversals)' })
  adjustments!: string;

  @ApiProperty({ example: '700.00', description: 'opening + earned − paid − deducted + adjustments' })
  closing!: string;
}

export class FinancePurchaseOrderDto {
  @ApiProperty({ format: 'uuid', example: IDS.po })
  purchaseOrderId!: string;

  @ApiProperty({ example: 'PO-2610-00012' })
  poNumber!: string;

  @ApiProperty({
    enum: ['issued', 'accepted', 'cancelled', 'received', 'closed'],
    enumName: 'PoStatus',
    example: 'received',
  })
  status!: string;

  @ApiProperty({ example: '14000.00' })
  earned!: string;

  @ApiProperty({ example: '13300.00' })
  paid!: string;

  @ApiProperty({ example: '700.00' })
  retainedHeld!: string;

  @ApiProperty({ example: '0.00' })
  retainedReleased!: string;

  @ApiProperty({ example: '0.00' })
  deducted!: string;

  @ApiProperty({ example: '700.00', description: 'earned − paid − deducted: what getpack still owes on it' })
  owed!: string;
}

/** D-293 what the factory earned, was paid, has retained and had deducted — per period and per purchase order. */
export class FinanceSummaryDto {
  @ApiProperty({
    type: FinancePeriodDto,
    description: 'From the vendor sub-ledger; reconciles to the statement of account',
  })
  period!: FinancePeriodDto;

  @ApiProperty({
    type: [FinancePurchaseOrderDto],
    description: 'Lifetime, the latest 200 purchase orders, from documents',
  })
  purchaseOrders!: FinancePurchaseOrderDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const FINANCE_SUMMARY_EXAMPLE: FinanceSummaryDto = {
  period: {
    from: '2026-10-01',
    to: '2026-10-31',
    opening: '0.00',
    earned: '14000.00',
    paid: '13300.00',
    retainedHeld: '700.00',
    retainedReleased: '0.00',
    deducted: '0.00',
    adjustments: '0.00',
    closing: '700.00',
  },
  purchaseOrders: [
    {
      purchaseOrderId: IDS.po,
      poNumber: 'PO-2610-00012',
      status: 'received',
      earned: '14000.00',
      paid: '13300.00',
      retainedHeld: '700.00',
      retainedReleased: '0.00',
      deducted: '0.00',
      owed: '700.00',
    },
  ],
  currency: 'THB',
};

export class FinanceSummaryQuery {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Default: the first of `to`’s month',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Default: today (Asia/Bangkok)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
