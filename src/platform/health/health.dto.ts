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
  @ApiProperty({ enum: HealthIndicatorStatus, enumName: 'HealthIndicatorStatus' })
  status!: HealthIndicatorStatus;
}

const indicatorMap = {
  type: 'object',
  additionalProperties: { $ref: getSchemaPath(HealthIndicatorState) },
} as const;

export class HealthResponse {
  @ApiProperty({ enum: HealthStatus, enumName: 'HealthStatus' })
  status!: HealthStatus;

  @ApiPropertyOptional(indicatorMap)
  info?: Record<string, HealthIndicatorState>;

  @ApiPropertyOptional(indicatorMap)
  error?: Record<string, HealthIndicatorState>;

  @ApiProperty(indicatorMap)
  details!: Record<string, HealthIndicatorState>;
}
