import {
  ApiEndpoint,
  ApiPublic,
  ApiStandardErrors,
  ApiSuccess,
  ApiUnthrottled,
} from '@common/openapi/decorators';
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExtraModels, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthIndicatorState, HealthResponse } from './health.dto';
import { DependencyHealthIndicators } from './health.indicators';

const UP = { status: 'up' };

/** Liveness/readiness for load balancers and ops (contract §2). Returns 503 when a dependency is down. */
@ApiTags('ops.health')
@ApiPublic()
@SkipThrottle()
@ApiUnthrottled()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: DependencyHealthIndicators,
  ) {}

  @Get()
  @HealthCheck({ swaggerDocumentation: false })
  @ApiEndpoint({
    id: 'ops.health.check',
    summary: 'Check the API and its dependencies',
    description:
      'Pings PostgreSQL, Redis and object storage (S3) with a 2 s timeout each. 200 when all are up; ' +
      '503 `service.unavailable` when any is down. Unauthenticated and not rate limited, for load balancers.',
    implements: ['ADR-0001', 'ADR-0003'],
  })
  @ApiExtraModels(HealthIndicatorState)
  @ApiSuccess(200, {
    description: 'All dependencies are up',
    type: HealthResponse,
    example: {
      status: 'ok',
      info: { database: UP, redis: UP, storage: UP },
      error: {},
      details: { database: UP, redis: UP, storage: UP },
    },
  })
  @ApiStandardErrors('service.unavailable')
  check() {
    return this.health.check([
      () => this.indicators.database(),
      () => this.indicators.redisPing(),
      () => this.indicators.objectStorage(),
    ]);
  }
}
