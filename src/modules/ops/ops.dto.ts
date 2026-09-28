import { ApiProperty } from '@nestjs/swagger';

import { SIGNAL_KEYS } from './ops-signals.service';

export class OpsSignalDto {
  @ApiProperty({ enum: SIGNAL_KEYS, enumName: 'OpsSignalKey', example: 'outbox_dead_letters' })
  key!: string;

  @ApiProperty({ example: 'Domain events dead-lettered after every retry (replay from the outbox admin)' })
  description!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 0,
    description: 'Null when the source could not be read',
  })
  value!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'From the setting `ops.alert_thresholds`',
  })
  threshold!: number | null;

  @ApiProperty({ enum: ['ok', 'alert', 'unknown'], enumName: 'OpsSignalStatus', example: 'ok' })
  status!: string;
}
