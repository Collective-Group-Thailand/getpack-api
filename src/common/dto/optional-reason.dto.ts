import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** A request body with an optional reason, recorded with the change (audit trail). */
export class OptionalReasonDto {
  @ApiPropertyOptional({ example: 'งบหมดก่อนกำหนด (fake)', minLength: 3, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
