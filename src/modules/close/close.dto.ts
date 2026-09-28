import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { CLOSE_TASKS } from './close.service';

/** Period close (B5.6, accounting-design §7). */

export const TASK_KEYS = CLOSE_TASKS.map((t) => t.key);
const IDS = {
  checklist: '0192f3a0-7c1e-7d2a-9b1f-000000560001',
  task: '0192f3a0-7c1e-7d2a-9b1f-000000560002',
  period: '0192f3a0-7c1e-7d2a-9b1f-000000510010',
  user: '0192f3a0-7c1e-7d2a-9b1f-000000000101',
  file: '0192f3a0-7c1e-7d2a-9b1f-000000560003',
};

export class CheckItemDto {
  @ApiProperty({ example: 'statement_line' })
  type!: string;

  @ApiProperty({ type: String, nullable: true, example: '0192f3a0-7c1e-7d2a-9b1f-000000530202' })
  id!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-27' })
  date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1234.37' })
  amount!: string | null;

  @ApiProperty({ example: 'TRF IN UNKNOWN' })
  description!: string;
}

export class CheckResultDto {
  @ApiProperty({ example: false })
  passed!: boolean;

  @ApiProperty({ example: '1 unmatched statement line(s), 0 settlement(s) not in the bank, 0 account(s) without a statement to 2026-10-31 (threshold 0)' })
  summary!: string;

  @ApiProperty({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] }, example: { unmatchedLines: 1, threshold: 0 } })
  figures!: Record<string, string | number>;

  @ApiProperty({ type: [CheckItemDto] })
  items!: CheckItemDto[];
}

export class EvidenceDto {
  @ApiProperty({ format: 'uuid', example: IDS.file })
  fileId!: string;

  @ApiProperty({ example: 'bank-reconciliation-2026-10.pdf' })
  name!: string;
}

export class CloseTaskDto {
  @ApiProperty({ format: 'uuid', example: IDS.task })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1, description: 'accounting-design §7 step' })
  stepNo!: number;

  @ApiProperty({ enum: TASK_KEYS, enumName: 'CloseTaskKey', example: 'statements_imported' })
  key!: string;

  @ApiProperty({ example: true, description: 'Has a blocking automatic check' })
  automatic!: boolean;

  @ApiProperty({ enum: ['pending', 'blocked', 'done', 'waived'], enumName: 'CloseTaskStatus', example: 'blocked' })
  status!: string;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  owner!: PersonRefDto | null;

  @ApiProperty({ type: CheckResultDto, nullable: true })
  checkResult!: CheckResultDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-03T09:00:00+07:00' })
  checkedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  waivedReason!: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  completedBy!: PersonRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;

  @ApiProperty({ type: [EvidenceDto] })
  evidence!: EvidenceDto[];
}

export class CloseChecklistDto {
  @ApiProperty({ format: 'uuid', example: IDS.checklist })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ enum: ['open', 'soft_closed', 'closed', 'locked'], enumName: 'PeriodStatus', example: 'open' })
  periodStatus!: string;

  @ApiProperty({ enum: ['open', 'in_review', 'closed', 'locked'], enumName: 'CloseStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  submittedBy!: PersonRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  submittedAt!: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  closedBy!: PersonRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  closedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  auditorSignedOffAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  lockedAt!: string | null;

  @ApiProperty({ type: [CloseTaskDto] })
  tasks!: CloseTaskDto[];
}

export const CHECKLIST_EXAMPLE: CloseChecklistDto = {
  id: IDS.checklist,
  period: '2026-10',
  periodStatus: 'open',
  status: 'open',
  submittedBy: null,
  submittedAt: null,
  closedBy: null,
  closedAt: null,
  auditorSignedOffAt: null,
  lockedAt: null,
  tasks: [
    {
      id: IDS.task,
      stepNo: 1,
      key: 'statements_imported',
      automatic: true,
      status: 'blocked',
      owner: null,
      checkResult: {
        passed: false,
        summary: '1 unmatched statement line(s), 0 settlement(s) not in the bank, 0 account(s) without a statement to 2026-10-31 (threshold 0)',
        figures: { unmatchedLines: 1, threshold: 0 },
        items: [{ type: 'statement_line', id: '0192f3a0-7c1e-7d2a-9b1f-000000530202', date: '2026-10-27', amount: '1234.37', description: 'TRF IN UNKNOWN' }],
      },
      checkedAt: '2026-11-03T09:00:00+07:00',
      note: null,
      waivedReason: null,
      completedBy: null,
      completedAt: null,
      evidence: [],
    },
  ],
};

export class NoteDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'กระทบยอดธนาคารแล้ว แนบไฟล์' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class AssignTaskDto {
  @ApiProperty({ format: 'uuid', example: IDS.user, description: 'A staff member' })
  @IsUUID()
  ownerUserId!: string;
}

export class EvidenceInputDto {
  @ApiProperty({ format: 'uuid', example: IDS.file, description: 'An uploaded file (purpose `document`)' })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ example: 'Bank reconciliation October', description: 'What the file shows (kept in the audit log)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;
}
