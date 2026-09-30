import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** The free-text reason every audited staff action takes (one component for all modules). */
export class ReasonDto {
  @ApiProperty({ example: 'สินค้าบกพร่อง ไม่ครบตามสั่ง', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
