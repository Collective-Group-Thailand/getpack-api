import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

export enum HealthStatus {
  Ok = 'ok',
  Error = 'error',
  ShuttingDown = 'shutting_down',
}

export enum HealthIndicatorStatus {
  Up = 'up',
  Down = 'down',
  Degraded = 'degraded',
}

export class HealthIndicatorState {
  @ApiProperty({
    enum: HealthIndicatorStatus,
    enumName: 'HealthIndicatorStatus',
    example: HealthIndicatorStatus.Up,
  })
  status!: HealthIndicatorStatus;
}

const indicatorMap = (description: string) =>
  ({
    type: 'object',
    description,
    additionalProperties: { $ref: getSchemaPath(HealthIndicatorState) },
    example: { database: { status: 'up' }, redis: { status: 'up' }, storage: { status: 'up' } },
  }) as const;

export class HealthResponse {
  @ApiProperty({ enum: HealthStatus, enumName: 'HealthStatus', example: HealthStatus.Ok })
  status!: HealthStatus;

  @ApiPropertyOptional(indicatorMap('Dependencies that are up, by name'))
  info?: Record<string, HealthIndicatorState>;

  @ApiPropertyOptional({ ...indicatorMap('Dependencies that are down, by name'), example: {} })
  error?: Record<string, HealthIndicatorState>;

  @ApiProperty(indicatorMap('Every dependency, by name'))
  details!: Record<string, HealthIndicatorState>;
}
