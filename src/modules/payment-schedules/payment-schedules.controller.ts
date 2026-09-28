import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { OrdersService } from '@modules/orders/orders.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  ADMIN_SCHEDULE_EXAMPLE,
  AdminPaymentScheduleDto,
  CreateTemplateVersionDto,
  PaymentScheduleDto,
  SCHEDULE_EXAMPLE,
  ScheduleOverrideDto,
  TEMPLATE_EXAMPLE,
  TemplateDto,
} from './payment-schedules.dto';
import { PaymentSchedulesService, scheduleEtag } from './payment-schedules.service';
import { adminScheduleDto, scheduleDto, templateDto } from './schedule-views';

const DECISIONS = ['D-020', 'D-073'];
const groupParam = ApiParam({ name: 'groupId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'paymentSchedules')
@Controller('order-groups/:groupId/payment-schedule')
export class StorePaymentSchedulesController {
  constructor(
    private readonly schedules: PaymentSchedulesService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @groupParam
  @ApiEndpoint({
    id: 'store.paymentSchedules.get',
    summary: 'Get the payment schedule of my order group',
    description:
      'Instalments with due dates, amounts (cash after the expected withholding) and whether the production ' +
      'and shipping gates are open (D-020, D-073).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Schedule', type: PaymentScheduleDto, example: SCHEDULE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('groupId', ParseUUIDPipe) groupId: string) {
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    const group = await this.orders.group(groupId, actor.userId);
    return scheduleDto(await this.schedules.forGroup(group.id));
  }
}

@ApiSurface('admin', 'paymentSchedules')
@Controller()
export class AdminPaymentSchedulesController {
  constructor(
    private readonly schedules: PaymentSchedulesService,
    private readonly orders: OrdersService,
  ) {}

  @Get('order-groups/:groupId/payment-schedule')
  @Can('orders.read')
  @groupParam
  @ApiEndpoint({
    id: 'admin.paymentSchedules.get',
    summary: 'Get the payment schedule of an order group',
    description: 'Staff view with each instalment’s share per order (ADR-0008) and cancelled instalments.',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, {
    description: 'Schedule',
    type: AdminPaymentScheduleDto,
    example: ADMIN_SCHEDULE_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('groupId', ParseUUIDPipe) groupId: string, @Res({ passthrough: true }) res: Response) {
    const group = await this.orders.group(groupId);
    const row = await this.schedules.forGroup(group.id);
    res.setHeader('ETag', scheduleEtag(row));
    return adminScheduleDto(row);
  }

  @Post('order-groups/:groupId/payment-schedule/actions/override')
  @HttpCode(200)
  @Can('payment_schedules.override')
  @groupParam
  @ApiEndpoint({
    id: 'admin.paymentSchedules.override',
    summary: 'Replace the payment schedule of an unpaid group',
    description:
      'CS chooses another template in force with a reason (D-020 "overridden with permission"); only while ' +
      'nothing is paid. Open instalments are cancelled and the template’s instalments written. Guarded by ' +
      '`If-Match`.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ScheduleOverrideDto,
    examples: { default: { value: { templateKey: 'full_upfront', reason: 'ลูกค้าขอชำระเต็มจำนวน' } } },
  })
  @ApiSuccess(200, {
    description: 'New schedule',
    type: AdminPaymentScheduleDto,
    example: ADMIN_SCHEDULE_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'payments.schedule_has_payments',
  )
  async override(
    @CurrentActor() actor: Actor,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ScheduleOverrideDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.schedules.override(staff(actor), groupId, ifMatch, body);
    res.setHeader('ETag', scheduleEtag(row));
    return adminScheduleDto(row);
  }

  @Get('payment-schedule-templates')
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.paymentSchedules.listTemplates',
    summary: 'List payment schedule templates',
    description: 'Each template with its version in force: selection rule, priority, instalments (D-020).',
    implements: ['D-020'],
  })
  @ApiSuccess(200, { description: 'Templates', type: [TemplateDto], example: [TEMPLATE_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async templates() {
    return (await this.schedules.templates()).map(templateDto);
  }

  @Post('payment-schedule-templates/:key/versions')
  @Can('payment_schedule_templates.manage')
  @ApiParam({ name: 'key', schema: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' } })
  @ApiEndpoint({
    id: 'admin.paymentSchedules.createTemplateVersion',
    summary: 'Add a version of a payment schedule template',
    description:
      'Superadmin changes schedules as new effective-dated versions (D-063, ADR-0005): any number of ' +
      'instalments adding up to 100 %, each with a due trigger and what it gates. Never back-dated.',
    implements: ['D-020', 'D-063'],
  })
  @ApiBody({
    type: CreateTemplateVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-11-01T00:00:00+07:00',
          selectionRule: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
          priority: 100,
          instalments: TEMPLATE_EXAMPLE.instalments,
          reason: 'ปรับข้อความงวด',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Template with its version in force',
    type: TemplateDto,
    example: TEMPLATE_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async createVersion(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: CreateTemplateVersionDto,
  ) {
    await this.schedules.createVersion(staff(actor), key, body);
    const row = (await this.schedules.templates()).find((t) => t.key === key)!;
    return templateDto(row);
  }
}
