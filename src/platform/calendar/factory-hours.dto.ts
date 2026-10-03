import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export class DayHoursDto {
  @ApiProperty({ example: '08:00', description: 'Asia/Bangkok `HH:mm`' })
  @IsString()
  @Matches(HHMM)
  from!: string;

  @ApiProperty({ example: '17:00', description: 'Asia/Bangkok `HH:mm`, after `from`' })
  @IsString()
  @Matches(HHMM)
  to!: string;
}

const day = (example: { from: string; to: string } | null) =>
  ApiProperty({ type: DayHoursDto, nullable: true, example, description: 'Null: closed that day' });

/** D-292 a factory's hours for each day of the week. */
export class WeeklyHoursDto {
  @day({ from: '08:00', to: '17:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  mon!: DayHoursDto | null;

  @day({ from: '08:00', to: '17:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  tue!: DayHoursDto | null;

  @day({ from: '08:00', to: '17:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  wed!: DayHoursDto | null;

  @day({ from: '08:00', to: '17:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  thu!: DayHoursDto | null;

  @day({ from: '08:00', to: '17:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  fri!: DayHoursDto | null;

  @day({ from: '08:00', to: '12:00' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  sat!: DayHoursDto | null;

  @day(null)
  @IsOptional()
  @ValidateNested()
  @Type(() => DayHoursDto)
  sun!: DayHoursDto | null;
}

export class FactoryHoursVersionDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000e7501' })
  id!: string;

  @ApiProperty({ format: 'date', example: '2026-10-05', description: 'In force from this Bangkok day' })
  effectiveFrom!: string;

  @ApiProperty({ type: WeeklyHoursDto })
  hours!: WeeklyHoursDto;

  @ApiProperty({ example: true, description: 'The version in force today' })
  inForce!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T15:00:00+07:00' })
  createdAt!: string;
}

export const WEEKLY_EXAMPLE: WeeklyHoursDto = {
  mon: { from: '08:00', to: '17:00' },
  tue: { from: '08:00', to: '17:00' },
  wed: { from: '08:00', to: '17:00' },
  thu: { from: '08:00', to: '17:00' },
  fri: { from: '08:00', to: '17:00' },
  sat: { from: '08:00', to: '12:00' },
  sun: null,
};

export const HOURS_EXAMPLE: FactoryHoursVersionDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000e7501',
  effectiveFrom: '2026-10-05',
  hours: WEEKLY_EXAMPLE,
  inForce: true,
  createdAt: '2026-10-03T15:00:00+07:00',
};

export class SetFactoryHoursDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-05',
    description: 'From tomorrow (Asia/Bangkok) on (D-292)',
  })
  @IsString()
  @Matches(DAY)
  effectiveFrom!: string;

  @ApiProperty({ type: WeeklyHoursDto })
  @ValidateNested()
  @Type(() => WeeklyHoursDto)
  hours!: WeeklyHoursDto;
}
