import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { OptionalNoteDto } from '@common/dto/optional-note.dto';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_REQUEST_EXAMPLE,
  AdminStructuralRequestDto,
  AssignStructuralRequestDto,
  CREATE_EXAMPLE,
  CreateStructuralRequestDto,
  DeliverStructuralDesignDto,
  LinkServiceRfqDto,
  PublishStructuralDesignDto,
  REQUEST_EXAMPLE,
  StructuralRequestDto,
  StructuralRequestQuery,
} from './structural-requests.dto';
import { StructuralRequestsService } from './structural-requests.service';

const DECISIONS = ['D-273'];
const requestParam = ApiParam({ name: 'requestId', format: 'uuid' });
const WRITE = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'structural_requests.invalid_transition',
] as const;
const FILE = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000fa02',
  originalName: 'design.dxf',
  mimeType: 'application/dxf',
  sizeBytes: 52120,
};
const DESIGNER = { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e605', displayName: 'Dev Prepress' };
const ASSIGNED = {
  ...ADMIN_REQUEST_EXAMPLE,
  status: 'assigned',
  assignedAt: '2026-10-03T11:00:00+07:00',
  assignedTo: DESIGNER,
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}
function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'structuralRequests')
@Controller('structural-requests')
export class StoreStructuralRequestsController {
  constructor(private readonly requests: StructuralRequestsService) {}

  @Post()
  @ApiEndpoint({
    id: 'store.structuralRequests.create',
    summary: 'Ask for a new structure',
    description:
      'A structure the style library lacks: what it must do, the product type, sizes with their basis, quantity and ' +
      'up to 10 reference files. CS assigns a structural designer; a fee, when one applies, is quoted as a service ' +
      'RFQ; I am notified at every step (D-273).',
    implements: DECISIONS,
  })
  @ApiBody({ type: CreateStructuralRequestDto, examples: { default: { value: CREATE_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Submitted', type: StructuralRequestDto, example: REQUEST_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'file.not_ready')
  create(@CurrentActor() actor: Actor, @Body() body: CreateStructuralRequestDto) {
    return this.requests.create(customer(actor), body);
  }

  @Get()
  @ApiEndpoint({
    id: 'store.structuralRequests.list',
    summary: 'List my structure requests',
    description: 'Newest first, with their step (D-273).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Requests', type: [StructuralRequestDto], example: [REQUEST_EXAMPLE] })
  @ApiStandardErrors()
  list(@CurrentActor() actor: Actor) {
    return this.requests.listMine(customer(actor).userId);
  }

  @Get(':requestId')
  @requestParam
  @ApiEndpoint({
    id: 'store.structuralRequests.get',
    summary: 'Get a structure request',
    description: 'The delivered dieline appears once Prepress approved it (D-273).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Request', type: StructuralRequestDto, example: REQUEST_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  get(@CurrentActor() actor: Actor, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.requests.getMine(customer(actor).userId, requestId);
  }

  @Post(':requestId/actions/cancel')
  @HttpCode(200)
  @requestParam
  @ApiEndpoint({
    id: 'store.structuralRequests.cancel',
    summary: 'Cancel a structure request',
    description: 'Before the design is delivered (D-273).',
    implements: DECISIONS,
  })
  @ApiBody({ type: OptionalNoteDto, examples: { default: { value: { note: 'ใช้แบบที่มีอยู่แล้ว' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: StructuralRequestDto,
    example: {
      ...REQUEST_EXAMPLE,
      status: 'cancelled',
      closedReason: 'ใช้แบบที่มีอยู่แล้ว',
      closedAt: '2026-10-03T12:00:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE)
  cancel(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: OptionalNoteDto,
  ) {
    return this.requests.cancel(customer(actor), requestId, body.note);
  }
}

@ApiSurface('admin', 'structuralRequests')
@Controller('structural-requests')
export class AdminStructuralRequestsController {
  constructor(private readonly requests: StructuralRequestsService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.structuralRequests.list',
    summary: 'List structural design requests',
    description: 'Newest first (latest 500), by step (D-273).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Requests',
    type: [AdminStructuralRequestDto],
    example: [ADMIN_REQUEST_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  list(@Query() query: StructuralRequestQuery) {
    return this.requests.list(query.status);
  }

  @Get(':requestId')
  @Can('styles.read')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.get',
    summary: 'Get a structural design request',
    description: 'With the customer, designer, service RFQ and delivered dieline (D-273).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Request',
    type: AdminStructuralRequestDto,
    example: ADMIN_REQUEST_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found')
  get(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.requests.get(requestId);
  }

  @Post(':requestId/actions/assign')
  @HttpCode(200)
  @Can('structural_requests.manage')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.assign',
    summary: 'Assign a structural designer',
    description: 'CS assigns (or reassigns) a Prepress structural designer (D-273).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AssignStructuralRequestDto,
    examples: { default: { value: { assigneeId: DESIGNER.id } } },
  })
  @ApiSuccess(200, { description: 'Assigned', type: AdminStructuralRequestDto, example: ASSIGNED })
  @ApiStandardErrors(...WRITE)
  assign(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: AssignStructuralRequestDto,
  ) {
    return this.requests.assign(staff(actor), requestId, body.assigneeId);
  }

  @Post(':requestId/actions/link-rfq')
  @HttpCode(200)
  @Can('structural_requests.manage')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.linkServiceRfq',
    summary: 'Link the service RFQ quoting the design fee',
    description:
      'When a fee applies, CS quotes it as a service RFQ of the same customer (`admin.rfqs.submit`, product type ' +
      '`service`, D-194 / D-100) and links it here (D-273).',
    implements: [...DECISIONS, 'D-194', 'D-100'],
  })
  @ApiBody({
    type: LinkServiceRfqDto,
    examples: { default: { value: { rfqId: '0192f3a0-7c1e-7d2a-9b1f-00000000ea02' } } },
  })
  @ApiSuccess(200, {
    description: 'Quoted',
    type: AdminStructuralRequestDto,
    example: { ...ASSIGNED, status: 'quoted', serviceRfqId: '0192f3a0-7c1e-7d2a-9b1f-00000000ea02' },
  })
  @ApiStandardErrors(...WRITE)
  linkRfq(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: LinkServiceRfqDto,
  ) {
    return this.requests.linkRfq(staff(actor), requestId, body.rfqId);
  }

  @Post(':requestId/actions/deliver')
  @HttpCode(200)
  @Can('structural_requests.design')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.deliver',
    summary: 'Deliver the structural design',
    description:
      'The designer delivers the dieline (DXF / PDF / SVG); it reaches the customer once approved (D-273).',
    implements: DECISIONS,
  })
  @ApiBody({ type: DeliverStructuralDesignDto, examples: { default: { value: { dielineFileId: FILE.id } } } })
  @ApiSuccess(200, {
    description: 'Delivered',
    type: AdminStructuralRequestDto,
    example: { ...ASSIGNED, status: 'delivered', deliveredFile: FILE },
  })
  @ApiStandardErrors(...WRITE, 'file.not_ready')
  deliver(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: DeliverStructuralDesignDto,
  ) {
    return this.requests.deliver(staff(actor), requestId, body.dielineFileId);
  }

  @Post(':requestId/actions/approve')
  @HttpCode(200)
  @Can('structural_requests.design')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.approve',
    summary: 'Approve the delivered design',
    description: 'Prepress approves the dieline; the customer can download it from now on (D-273).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Approved',
    type: AdminStructuralRequestDto,
    example: {
      ...ASSIGNED,
      status: 'approved',
      deliveredFile: FILE,
      approvedAt: '2026-10-05T10:00:00+07:00',
      approvedBy: DESIGNER,
    },
  })
  @ApiStandardErrors('http.not_found', 'structural_requests.invalid_transition')
  approve(@CurrentActor() actor: Actor, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.requests.approve(staff(actor), requestId);
  }

  @Post(':requestId/actions/publish')
  @HttpCode(200)
  @Can('structural_requests.design')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.publish',
    summary: 'Link the design to its published style',
    description:
      'Once the structure is in the style library as a published base (imported, approved and publishable, D-243), ' +
      'the request is linked to it and the customer is told (D-273).',
    implements: [...DECISIONS, 'D-243'],
  })
  @ApiBody({ type: PublishStructuralDesignDto, examples: { default: { value: { baseCode: 'PK-TE-07' } } } })
  @ApiSuccess(200, {
    description: 'Published',
    type: AdminStructuralRequestDto,
    example: {
      ...ASSIGNED,
      status: 'published',
      deliveredFile: FILE,
      approvedAt: '2026-10-05T10:00:00+07:00',
      approvedBy: DESIGNER,
      publishedBaseCode: 'PK-TE-07',
    },
  })
  @ApiStandardErrors(...WRITE)
  publish(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: PublishStructuralDesignDto,
  ) {
    return this.requests.publish(staff(actor), requestId, body.baseCode);
  }

  @Post(':requestId/actions/decline')
  @HttpCode(200)
  @Can('structural_requests.manage')
  @requestParam
  @ApiEndpoint({
    id: 'admin.structuralRequests.decline',
    summary: 'Decline a structural design request',
    description: 'With the reason the customer reads (D-273).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'โครงสร้างนี้มีในคลังแล้ว (PK-TE-01)' } } },
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: AdminStructuralRequestDto,
    example: {
      ...ADMIN_REQUEST_EXAMPLE,
      status: 'declined',
      closedReason: 'โครงสร้างนี้มีในคลังแล้ว (PK-TE-01)',
      closedAt: '2026-10-03T12:00:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE)
  decline(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: ReasonBodyDto,
  ) {
    return this.requests.decline(staff(actor), requestId, body.reason);
  }
}
