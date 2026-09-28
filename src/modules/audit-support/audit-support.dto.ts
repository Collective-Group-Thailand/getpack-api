import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { POPULATIONS } from './audit-support.service';

/** Audit support (B5.6, accounting-design §8). */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IDS = {
  sample: '0192f3a0-7c1e-7d2a-9b1f-000000570001',
  pbc: '0192f3a0-7c1e-7d2a-9b1f-000000570002',
  doc: '0192f3a0-7c1e-7d2a-9b1f-000000520001',
};

export class ExceptionItemDto {
  @ApiProperty({ type: String, nullable: true, example: IDS.doc })
  id!: string | null;

  @ApiProperty({ example: 'DEVTR-2610-00007' })
  reference!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-31' })
  date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1070.00' })
  amount!: string | null;

  @ApiProperty({ example: 'issued 2026-11-02' })
  detail!: string;
}

export class ExceptionReportDto {
  @ApiProperty({
    enum: [
      'series_gaps',
      'outside_business_hours',
      'back_dated_documents',
      'manual_journals_by_user',
      'reversals',
      'duplicate_vendor_bank_accounts',
      'duplicate_slip_references',
      'credit_notes_after_period_end',
      'payouts_without_valid_tax_invoice',
    ],
    enumName: 'AuditExceptionKey',
    example: 'back_dated_documents',
  })
  key!: string;

  @ApiProperty({ example: 'Documents and manual journals dated before the day they were made' })
  description!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  count!: number;

  @ApiProperty({ type: [ExceptionItemDto], description: 'Up to 200 items' })
  items!: ExceptionItemDto[];
}

export const EXCEPTION_EXAMPLE: ExceptionReportDto = {
  key: 'back_dated_documents',
  description: 'Documents and manual journals dated before the day they were made',
  count: 1,
  items: [
    {
      id: IDS.doc,
      reference: 'DEVTR-2610-00007',
      date: '2026-10-31',
      amount: '1070.00',
      detail: 'issued 2026-11-02',
    },
  ],
};

export class DrawSampleDto {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  period!: string;

  @ApiProperty({ enum: POPULATIONS, enumName: 'AuditPopulation', example: 'customer_documents' })
  @IsIn(POPULATIONS)
  population!: (typeof POPULATIONS)[number];

  @ApiProperty({
    enum: ['random', 'stratified'],
    enumName: 'SampleMethod',
    example: 'stratified',
    description: '`stratified`: three bands of equal value, sampled in proportion',
  })
  @IsIn(['random', 'stratified'])
  method!: 'random' | 'stratified';

  @ApiProperty({ type: 'integer', example: 25, minimum: 1, maximum: 500 })
  @IsInt()
  @Min(1)
  @Max(500)
  size!: number;

  @ApiPropertyOptional({
    example: '20261031',
    pattern: '^[0-9]{1,15}$',
    description: 'Reproduce an earlier sample (default: random)',
  })
  @IsOptional()
  @Matches(/^[0-9]{1,15}$/)
  seed?: string;
}

export class SampleItemDto {
  @ApiProperty({ format: 'uuid', example: IDS.doc })
  id!: string;

  @ApiProperty({ example: 'DEVTR-2610-00007' })
  number!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  date!: string;

  @ApiProperty({ example: '1070.00' })
  amount!: string;
}

export class AuditSampleDto {
  @ApiProperty({ format: 'uuid', example: IDS.sample })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ enum: POPULATIONS, enumName: 'AuditPopulation', example: 'customer_documents' })
  population!: string;

  @ApiProperty({ enum: ['random', 'stratified'], enumName: 'SampleMethod', example: 'stratified' })
  method!: string;

  @ApiProperty({ example: '20261031', description: 'Draw again with this seed to reproduce the sample' })
  seed!: string;

  @ApiProperty({ type: 'integer', example: 120 })
  populationSize!: number;

  @ApiProperty({ type: [SampleItemDto] })
  selected!: SampleItemDto[];

  @ApiProperty({ format: 'date-time', example: '2026-11-10T10:00:00+07:00' })
  createdAt!: string;
}

export const SAMPLE_EXAMPLE: AuditSampleDto = {
  id: IDS.sample,
  period: '2026-10',
  population: 'customer_documents',
  method: 'stratified',
  seed: '20261031',
  populationSize: 120,
  selected: [{ id: IDS.doc, number: 'DEVTR-2610-00007', date: '2026-10-31', amount: '1070.00' }],
  createdAt: '2026-11-10T10:00:00+07:00',
};

export class PbcExportDto {
  @ApiProperty({ format: 'uuid', example: IDS.pbc })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ example: '3f5a…', description: 'SHA-256 of the workbook (hex)' })
  sha256!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-10T10:00:00+07:00' })
  generatedAt!: string;
}

export const PBC_EXAMPLE: PbcExportDto = {
  id: IDS.pbc,
  period: '2026-10',
  sha256: '3f5a0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f',
  generatedAt: '2026-11-10T10:00:00+07:00',
};
