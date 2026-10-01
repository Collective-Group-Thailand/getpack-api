import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Business calendar maintenance (D-161, D-170, D-209; B6.3 launch gap, U-B0.3). */

export const CALENDAR_DAY_KINDS = ['holiday', 'closure', 'extra_working_day'] as const;
export const HOLIDAY_KINDS = ['holiday', 'extra_working_day'] as const;
export const OBSERVANCES = ['all', 'government_only', 'financial_institutions'] as const;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class CalendarDayDto {
  @ApiProperty({ format: 'date', example: '2027-04-13' })
  day!: string;

  @ApiProperty({ enum: CALENDAR_DAY_KINDS, enumName: 'CalendarDayKind', example: 'holiday' })
  kind!: string;

  @ApiProperty({
    enum: OBSERVANCES,
    enumName: 'HolidayObservance',
    example: 'all',
    description: 'Only `all` makes a day non-working for lead times and SLAs (D-161)',
  })
  observance!: string;

  @ApiProperty({ example: 'วันสงกรานต์' })
  nameTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Songkran' })
  nameEn!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-12-01T10:00:00+07:00' })
  updatedAt!: string;
}

export class HolidayYearQuery {
  @ApiProperty({ type: 'integer', example: 2027, minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

export class PutHolidayDto {
  @ApiProperty({ enum: HOLIDAY_KINDS, enumName: 'NationalDayKind', example: 'holiday' })
  @IsIn(HOLIDAY_KINDS)
  kind!: (typeof HOLIDAY_KINDS)[number];

  @ApiProperty({ enum: OBSERVANCES, enumName: 'HolidayObservance', example: 'all' })
  @IsIn(OBSERVANCES)
  observance!: (typeof OBSERVANCES)[number];

  @ApiProperty({ example: 'วันสงกรานต์', minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nameTh!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Songkran', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string | null;
}

export class ClosureQuery {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Closures on or after (default: today)',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;
}

export class PutClosureDto {
  @ApiProperty({ example: 'ปิดซ่อมบำรุงเครื่องจักร', minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nameTh!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Machine maintenance', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string | null;
}

export const CALENDAR_DAY_EXAMPLE: CalendarDayDto = {
  day: '2027-04-13',
  kind: 'holiday',
  observance: 'all',
  nameTh: 'วันสงกรานต์',
  nameEn: 'Songkran',
  updatedAt: '2026-12-01T10:00:00+07:00',
};
