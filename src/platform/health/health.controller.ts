import { ApiProblemResponse } from '@common/errors/api-problem-response.decorator';
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthIndicatorState, HealthResponse } from './health.dto';
import { DependencyHealthIndicators } from './health.indicators';

/** Liveness/readiness for load balancers and ops (contract §2). Returns 503 when a dependency is down. */
@ApiTags('ops.health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: DependencyHealthIndicators,
  ) {}

  @Get()
  @HealthCheck({ swaggerDocumentation: false })
  @ApiExtraModels(HealthIndicatorState)
  @ApiOkResponse({ type: HealthResponse, description: 'All dependencies are up' })
  @ApiProblemResponse(503, 'A dependency is down (`service.unavailable`)')
  check() {
    return this.health.check([
      () => this.indicators.database(),
      () => this.indicators.redisPing(),
      () => this.indicators.objectStorage(),
    ]);
  }
}
