import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AssignDesignerDto,
  CloseDesignServiceDto,
  ConfirmExtraRoundDto,
  DeliverDesignDto,
  DESIGN_SERVICE_EXAMPLE,
  DesignBriefDto,
  DesignServiceDto,
  DesignServiceListQuery,
  DS_IDS,
} from './design-services.dto';
import { DesignServicesService, type RequestRow } from './design-services.service';

const DECISIONS = ['D-071'];
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const idParam = ApiParam({ name: 'designServiceId', format: 'uuid' });
const BRIEF_EXAMPLE = {
  brandName: 'ร้านกาแฟทดสอบ',
  brandCategory: 'เครื่องดื่ม',
  description: 'กล่องโทนมินิมอล สีครีม มีโลโก้ด้านหน้า',
  attachmentFileIds: [DS_IDS.file],
};
const EXTRA_OFFERED = {
  ...DESIGN_SERVICE_EXAMPLE,
  status: 'revision_requested',
  revisionsUsed: 3,
  nextRevision: { revisionNo: 4, chargeable: true, feeNet: '500.00', feeGross: '535.00' },
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'designServices')
@Controller()
export class StoreDesignServicesController {
  constructor(private readonly designs: DesignServicesService) {}

  private async dto(row: RequestRow) {
    return this.designs.toDto(row, await this.designs.nextRevision(row), true);
  }

  @Get('orders/:orderId/design-service')
  @orderParam
  @ApiEndpoint({
    id: 'store.designServices.get',
    summary: 'Get the hired design of my order',
    description:
      'Status, brief, due dates (target 5 / maximum 10 business days from the start), rounds, and — once changes ' +
      'were requested — what the next revision costs: free for the first 3 revisions, then max(THB 500, 20 % of ' +
      'the design fee) (D-071, settings).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Design service', type: DesignServiceDto, example: DESIGN_SERVICE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.dto(await this.designs.forOrderView(orderId, customer(actor).userId));
  }

  @Put('orders/:orderId/design-service/brief')
  @orderParam
  @ApiEndpoint({
    id: 'store.designServices.submitBrief',
    summary: 'Send the design brief',
    description:
      'Brand name, category, description and attachments (legacy `brd_*`). Work starts once the brief is in and the ' +
      'order is paid for production (D-071).',
    implements: DECISIONS,
  })
  @ApiBody({ type: DesignBriefDto, examples: { default: { value: BRIEF_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Brief stored', type: DesignServiceDto, example: DESIGN_SERVICE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.invalid_status',
    'artwork.file_not_usable',
  )
  async submitBrief(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: DesignBriefDto,
  ) {
    return this.dto(
      await this.designs.submitBrief(customer(actor), orderId, {
        ...body,
        attachmentFileIds: body.attachmentFileIds ?? [],
      }),
    );
  }

  @Post('orders/:orderId/design-service/actions/confirm-extra-round')
  @HttpCode(200)
  @Idempotent()
  @orderParam
  @ApiEndpoint({
    id: 'store.designServices.confirmExtraRound',
    summary: 'Confirm a paid revision round',
    description:
      'Beyond the free revisions each round costs max(THB 500, 20 % of the design fee) (D-071): confirming adds it ' +
      'to the order with its own instalment, due now; the round starts once it is paid. Send the fee shown in ' +
      '`nextRevision.feeGross`; a different amount is refused (`design_services.fee_changed`).',
    implements: ['D-071', 'D-020'],
  })
  @ApiBody({
    type: ConfirmExtraRoundDto,
    examples: {
      default: { value: { expectedFeeGross: '535.00', changeRequest: 'ขอเปลี่ยนสีตัวอักษรเป็นสีทอง' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Round added, awaiting payment',
    type: DesignServiceDto,
    example: { ...EXTRA_OFFERED, nextRevision: null },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.no_extra_round',
    'design_services.fee_changed',
    'order.invalid_transition',
  )
  async confirmExtraRound(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: ConfirmExtraRoundDto,
  ) {
    return this.dto(await this.designs.confirmExtraRound(customer(actor), orderId, body));
  }
}

@ApiSurface('admin', 'designServices')
@Controller()
export class AdminDesignServicesController {
  constructor(private readonly designs: DesignServicesService) {}

  private async dto(row: RequestRow) {
    return this.designs.toDto(row, await this.designs.nextRevision(row), false);
  }

  @Get('design-services')
  @Can('artwork.read')
  @ApiEndpoint({
    id: 'admin.designServices.list',
    summary: 'The hired-design queue',
    description: 'Earliest target date first, with the due state against 5 / 10 business days (D-071).',
    implements: DECISIONS,
  })
  @ApiPaginated(DesignServiceDto, { example: DESIGN_SERVICE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: DesignServiceListQuery) {
    const me = staff(actor);
    const where: Prisma.DesignServiceRequestWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.assignee === 'me' && { assignedUserId: me.userId }),
    };
    const [rows, total] = await this.designs.list(where, q.page, q.perPage);
    return {
      data: await Promise.all(rows.map((r) => this.dto(r))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('design-services/:designServiceId')
  @Can('artwork.read')
  @idParam
  @ApiEndpoint({
    id: 'admin.designServices.get',
    summary: 'Get a hired design',
    description: 'With rounds and due state (D-071).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Design service', type: DesignServiceDto, example: DESIGN_SERVICE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('designServiceId', ParseUUIDPipe) id: string) {
    return this.dto(await this.designs.get(id));
  }

  @Post('design-services/:designServiceId/actions/assign')
  @HttpCode(200)
  @Can('design_services.manage')
  @idParam
  @ApiEndpoint({
    id: 'admin.designServices.assign',
    summary: 'Assign a designer',
    description: 'A Packio designer or a freelancer vendor (D-071).',
    implements: DECISIONS,
  })
  @ApiBody({ type: AssignDesignerDto, examples: { default: { value: { assigneeUserId: DS_IDS.user } } } })
  @ApiSuccess(200, {
    description: 'Assigned',
    type: DesignServiceDto,
    example: { ...DESIGN_SERVICE_EXAMPLE, assignee: { id: DS_IDS.user, displayName: 'นักออกแบบ ทดสอบ' } },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.invalid_status',
  )
  async assign(
    @CurrentActor() actor: Actor,
    @Param('designServiceId', ParseUUIDPipe) id: string,
    @Body() body: AssignDesignerDto,
  ) {
    return this.dto(await this.designs.assign(staff(actor), id, body));
  }

  @Post('design-services/:designServiceId/actions/deliver')
  @HttpCode(200)
  @Can('design_services.manage')
  @Idempotent({ optional: true })
  @idParam
  @ApiEndpoint({
    id: 'admin.designServices.deliver',
    summary: 'Deliver the design of the current round',
    description:
      'Becomes a new artwork version (source `design_service`): preflight, Prepress review and a proof follow (D-071, D-070).',
    implements: ['D-071', 'D-070'],
  })
  @ApiBody({
    type: DeliverDesignDto,
    examples: { default: { value: { fileIds: [DS_IDS.file], note: 'แบบรอบแรกตามบรีฟ' } } },
  })
  @ApiSuccess(200, {
    description: 'Delivered',
    type: DesignServiceDto,
    example: { ...DESIGN_SERVICE_EXAMPLE, status: 'delivered' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.invalid_status',
    'artwork.not_accepting',
    'artwork.file_not_usable',
  )
  async deliver(
    @CurrentActor() actor: Actor,
    @Param('designServiceId', ParseUUIDPipe) id: string,
    @Body() body: DeliverDesignDto,
  ) {
    return this.dto(await this.designs.deliver(staff(actor), id, body));
  }

  @Post('design-services/:designServiceId/actions/requote')
  @HttpCode(200)
  @Can('design_services.manage')
  @Idempotent({ optional: true })
  @idParam
  @ApiEndpoint({
    id: 'admin.designServices.requote',
    summary: 'Close for a new design quote',
    description:
      'A change to the structure / dieline or the concept is a new design, re-quoted — not a revision (D-071).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CloseDesignServiceDto,
    examples: { default: { value: { reason: 'ลูกค้าต้องการเปลี่ยนโครงสร้างกล่อง ต้องเสนอราคาออกแบบใหม่' } } },
  })
  @ApiSuccess(200, {
    description: 'Re-quoted',
    type: DesignServiceDto,
    example: {
      ...DESIGN_SERVICE_EXAMPLE,
      status: 'requoted',
      dueState: 'closed',
      closeReason: 'ลูกค้าต้องการเปลี่ยนโครงสร้างกล่อง',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.invalid_status',
  )
  async requote(
    @CurrentActor() actor: Actor,
    @Param('designServiceId', ParseUUIDPipe) id: string,
    @Body() body: CloseDesignServiceDto,
  ) {
    return this.dto(await this.designs.close(staff(actor), id, 'requoted', body.reason));
  }

  @Post('design-services/:designServiceId/actions/cancel')
  @HttpCode(200)
  @Can('design_services.manage')
  @idParam
  @ApiEndpoint({
    id: 'admin.designServices.cancel',
    summary: 'Cancel a hired design',
    description: 'With a reason (D-071).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CloseDesignServiceDto,
    examples: { default: { value: { reason: 'ลูกค้าส่งไฟล์เองแทน' } } },
  })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: DesignServiceDto,
    example: {
      ...DESIGN_SERVICE_EXAMPLE,
      status: 'cancelled',
      dueState: 'closed',
      closeReason: 'ลูกค้าส่งไฟล์เองแทน',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'design_services.invalid_status',
  )
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('designServiceId', ParseUUIDPipe) id: string,
    @Body() body: CloseDesignServiceDto,
  ) {
    return this.dto(await this.designs.close(staff(actor), id, 'cancelled', body.reason));
  }
}
