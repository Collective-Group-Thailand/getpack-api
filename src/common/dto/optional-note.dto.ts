import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A request body that only carries an optional free-text note (≤ 1000 characters). */
export class OptionalNoteDto {
  @ApiPropertyOptional({ example: 'บันทึกเพิ่มเติม (fake)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
