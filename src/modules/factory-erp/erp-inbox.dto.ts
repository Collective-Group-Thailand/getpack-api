import { ApiProperty } from '@nestjs/swagger';

/** D-399: what the person can act on now across the ERP. */

export const ERP_INBOX_SECTIONS = ['approve', 'overdue', 'today', 'soon'] as const;
export const ERP_INBOX_TONES = ['danger', 'warning', 'info'] as const;
export const ERP_INBOX_KINDS = [
  'purchase_request',
  'purchase_request_more',
  'invoice_variance',
  'invoice_variance_more',
  'journal',
  'journal_more',
  'account_change',
  'rule_version',
  'receipt_late',
  'receipt_late_more',
  'receipt_today',
  'po_draft',
  'stock_low',
  'payable_overdue',
  'payable_week',
  'mo_late',
  'mo_late_more',
  'mo_to_release',
  'machine_down',
  'ncr_due',
  'ncr_due_more',
  'quotation_expiring',
  'so_draft',
  'followup_today',
  'followup_late',
  'delivery_late',
  'delivery_late_more',
  'delivery_today',
  'receivable_overdue',
  'period_to_close',
  'bank_lines',
  'tax_due',
  'alerts',
] as const;

export class ErpInboxDocumentDto {
  @ApiProperty({ example: 'erp_purchase_request', description: 'What the item opens: an ERP document type' })
  type!: string;

  @ApiProperty({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000f901', description: 'Its public id (a period, a filing: its own key)' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'PR-2610-0004' })
  number!: string | null;
}

export class ErpInboxItemDto {
  @ApiProperty({ example: 'purchase_request:0192f3a0-7c1e-7d2a-9b1f-00000000f901' })
  key!: string;

  @ApiProperty({ enum: ERP_INBOX_SECTIONS, enumName: 'ErpInboxSection', example: 'approve' })
  section!: (typeof ERP_INBOX_SECTIONS)[number];

  @ApiProperty({ enum: ERP_INBOX_KINDS, enumName: 'ErpInboxKind', example: 'purchase_request' })
  kind!: string;

  @ApiProperty({ enum: ERP_INBOX_TONES, enumName: 'ErpInboxTone', example: 'warning' })
  tone!: (typeof ERP_INBOX_TONES)[number];

  @ApiProperty({ example: 1, description: 'Documents behind the item (1 for one document; more for a count)' })
  count!: number;

  @ApiProperty({ type: ErpInboxDocumentDto, nullable: true, description: 'The one document it is about; null for a count' })
  document!: ErpInboxDocumentDto | null;

  @ApiProperty({ nullable: true, example: 'ฝ่ายจัดซื้อ ทดสอบ', description: 'Who or what it concerns (supplier, customer, machine, proposer)' })
  party!: string | null;

  @ApiProperty({ nullable: true, example: '12500.00', pattern: '^-?\\d+\\.\\d{2}$' })
  amount!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-14', description: 'Its due / reference day' })
  date!: string | null;
}

export class ErpInboxCountsDto {
  @ApiProperty({ example: 2 }) approve!: number;
  @ApiProperty({ example: 1 }) overdue!: number;
  @ApiProperty({ example: 3 }) today!: number;
  @ApiProperty({ example: 4 }) soon!: number;
}

export class ErpInboxDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-14' })
  asOf!: string;

  @ApiProperty({ type: [ErpInboxItemDto], description: 'Approvals first, then overdue, today and soon' })
  items!: ErpInboxItemDto[];

  @ApiProperty({ type: ErpInboxCountsDto })
  counts!: ErpInboxCountsDto;
}
