import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { E164, SALES_CHANNELS } from './agents.dto';

/** P7 pilot switch: a visitor asks to hear when agent sign-up opens (anonymous). */
export class JoinAgentWaitlistDto {
  @ApiProperty({ example: 'สมชาย ขายเก่ง', description: 'Your name' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0810005678',
    description: 'Thai mobile (0XXXXXXXXX) or E.164; a phone or an e-mail is required',
  })
  @IsOptional()
  @Matches(/^(0\d{8,9}|\+[1-9]\d{7,14})$/)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'somchai@example.invalid' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({
    enum: SALES_CHANNELS,
    enumName: 'AgentSalesChannel',
    nullable: true,
    example: 'line_groups',
    description: 'How you sell (optional)',
  })
  @IsOptional()
  @IsIn(SALES_CHANNELS)
  salesChannel?: (typeof SALES_CHANNELS)[number] | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'The waiting-list consent version read and accepted (`waitlistConsent.versionNo`)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  consentVersionNo!: number;
}

export class AgentWaitlistReceiptDto {
  @ApiProperty({
    enum: ['received'],
    enumName: 'AgentWaitlistReceiptStatus',
    example: 'received',
    description: 'Always `received` — the same answer whether the contact was already on the list (neutral)',
  })
  status!: 'received';
}

export class AdminAgentWaitlistEntryDto {
  @IdField('0192f3a0-7c1e-7d2a-9b1f-0000000000a1')
  id!: string;

  @ApiProperty({ example: 'สมชาย ขายเก่ง' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '+66810005678', pattern: E164.source })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'somchai@example.invalid' })
  email!: string | null;

  @ApiProperty({
    enum: SALES_CHANNELS,
    enumName: 'AgentSalesChannel',
    nullable: true,
    example: 'line_groups',
  })
  salesChannel!: (typeof SALES_CHANNELS)[number] | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Sign-ups with this contact (a repeat refreshes the row)',
  })
  joinCount!: number;

  @TimestampField('2026-11-04T10:00:00+07:00')
  createdAt!: string;

  @TimestampField('2026-11-04T10:00:00+07:00')
  lastJoinedAt!: string;
}

export const ADMIN_WAITLIST_EXAMPLE: AdminAgentWaitlistEntryDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000000a1',
  name: 'สมชาย ขายเก่ง',
  phone: '+66810005678',
  email: 'somchai@example.invalid',
  salesChannel: 'line_groups',
  joinCount: 1,
  createdAt: '2026-11-04T10:00:00+07:00',
  lastJoinedAt: '2026-11-04T10:00:00+07:00',
};

export class AgentWaitlistExportDto {
  @ApiProperty({ example: 'https://getpack-files.s3.example.com/…', description: 'Signed link, 5 minutes' })
  url!: string;

  @TimestampField('2026-11-04T10:05:00+07:00')
  expiresAt!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  rows!: number;
}
