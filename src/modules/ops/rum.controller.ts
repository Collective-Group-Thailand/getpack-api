import { Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { DomainException } from '@common/errors/domain.exception';
import { ApiAsync, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Post, Query, type Type } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';

import { isRoutePattern, type RumZone } from './rum';
import { WEB_VITAL_EXAMPLE, WebVitalDto, WebVitalSummaryDto } from './rum.dto';
import { RumService } from './rum.service';

const DESCRIPTION =
  'A Core Web Vitals sample from the browser (posted with `sendBeacon`), aggregated per Bangkok day, zone, route ' +
  'pattern and metric. Fire-and-forget: 202 with no body. Only a route pattern is accepted (422 for a real path — ' +
  'PDPA, D-144); nothing identifies the visitor.';

function rumController(zone: RumZone): Type<unknown> {
  @ApiSurface(zone, 'rum')
  @Controller('rum')
  class RumController {
    constructor(readonly rum: RumService) {}

    @Post('web-vitals')
    @(zone === 'store' ? Public() : () => undefined)
    @HttpCode(202)
    @ApiEndpoint({
      id: `${zone}.rum.recordWebVital`,
      summary: 'Record a web-vital sample',
      description: zone === 'store' ? `${DESCRIPTION} Anonymous visitors may post.` : DESCRIPTION,
      implements: ['D-144'],
    })
    @ApiBody({ type: WebVitalDto, examples: { default: { value: { ...WEB_VITAL_EXAMPLE, zone } } } })
    @ApiAsync({ poll: null })
    @ApiSuccess(202, { description: 'Accepted' })
    @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
    async record(@Body() body: WebVitalDto): Promise<void> {
      if (!isRoutePattern(body.route))
        throw new DomainException('validation.failed', {
          errors: [
            { path: 'route', code: 'route_pattern', message: 'a route pattern such as /orders/[orderId]' },
          ],
        });
      await this.rum.record(zone, body);
    }
  }
  Object.defineProperty(RumController, 'name', {
    value: `${zone[0]!.toUpperCase()}${zone.slice(1)}RumController`,
  });
  return RumController;
}

export const StoreRumController = rumController('store');
export const AdminRumController = rumController('admin');
export const PartnerRumController = rumController('partner');

@ApiSurface('admin', 'ops')
@Controller('ops')
export class AdminWebVitalsController {
  constructor(private readonly rum: RumService) {}

  @Get('web-vitals')
  @Can('ops.read')
  @ApiQuery({
    name: 'date',
    required: true,
    example: '2026-10-01',
    description: 'Bangkok day (kept 35 days)',
  })
  @ApiEndpoint({
    id: 'admin.ops.webVitals',
    summary: 'Web vitals of a day',
    description: 'Samples, mean and share rated poor per zone, route pattern and metric, from real visits.',
    implements: ['D-144'],
  })
  @ApiSuccess(200, {
    description: 'Summary',
    type: [WebVitalSummaryDto],
    example: [
      { zone: 'store', route: '/orders/[orderId]', name: 'LCP', samples: 120, average: 2140.5, poorPct: 4.2 },
    ],
  })
  @ApiStandardErrors('validation.failed')
  async summary(@Query('date') date: string): Promise<WebVitalSummaryDto[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? ''))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'date', code: 'date', message: 'YYYY-MM-DD' }],
      });
    return this.rum.summary(date);
  }
}
