import { CurrentActor } from '@common/auth/auth.decorators';
import { Can, CanAny } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AssignSalesInboundDto,
  BulkAssignResultDto,
  BulkAssignSalesInboundDto,
  CreateSalesInboundDto,
  DisqualifySalesInboundDto,
  INBOUND_EXAMPLE,
  inboundDto,
  MarkSalesInboundContactedDto,
  SalesInboundDto,
  SalesInboundListQuery,
} from './sales-inbound.dto';
import { SalesInboundService } from './sales-inbound.service';
import { SalesScopeService } from './sales-scope';

const DECISIONS = ['D-469', 'D-458', 'D-440'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

/**
 * D-469 items 2–4: the inbound pool — sales enquiries from contact tickets routed to sales (D-458), RFQs of customers
 * without an order, and staff; first-response due in working hours (P-05). A rep sees the enquiries assigned to
 * them; a manager the whole pool.
 */
@ApiSurface('admin', 'salesInbound')
@Controller('sales/inbound')
export class AdminSalesInboundController {
  constructor(
    private readonly scopes: SalesScopeService,
    private readonly inbound: SalesInboundService,
  ) {}

  @Get()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesInbound.list',
    summary: 'List the inbound sales enquiries',
    description:
      'Soonest first-response due first, with the SLA flag; by status, source, rep, unassigned, breached or text. ' +
      'A rep sees only the enquiries assigned to them (D-469).',
    implements: DECISIONS,
  })
  @ApiPaginated(SalesInboundDto, { example: INBOUND_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: SalesInboundListQuery) {
    const { rows, total } = await this.inbound.list(await this.scopes.of(actor), q);
    const now = new Date();
    return { data: rows.map((r) => inboundDto(r, now)), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesInbound.create',
    summary: 'Enter a sales enquiry by hand',
    description:
      'A phone call, a walk-in or a referral (source `manual`), with a phone or e-mail. A rep’s own entry is ' +
      'assigned to them; a manager may name a rep, else `sales.assignment_mode` applies. Due in ' +
      '`sales.first_response_hours` working hours (P-05, D-469).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateSalesInboundDto,
    examples: {
      default: {
        value: {
          contactName: 'คุณวิภา รักษ์ดี',
          contactPhone: '+66890002222',
          organisationName: 'บริษัท ขนมดี จำกัด',
          need: 'กล่องขนม 5,000 ใบต่อเดือน',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Enquiry', type: SalesInboundDto, example: INBOUND_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'sales.rep_unavailable')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateSalesInboundDto): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.createManual(await this.scopes.of(actor), body));
  }

  @Post('actions/bulk-assign')
  @HttpCode(200)
  @Can('sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesInbound.bulkAssign',
    summary: 'Assign several enquiries',
    description:
      'Each to the named rep, or round robin one by one when no rep is named (the rep with the fewest open ' +
      'enquiries below `sales.max_open_per_rep`, then the least recently assigned). Closed, unknown or ' +
      'unassignable ones are listed in `skipped`; moving one from another rep needs a reason (audited) (D-469).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: BulkAssignSalesInboundDto,
    examples: { default: { value: { ids: [INBOUND_EXAMPLE.id] } } },
  })
  @ApiSuccess(200, {
    description: 'Result',
    type: BulkAssignResultDto,
    example: { assigned: [INBOUND_EXAMPLE], skipped: [] },
  })
  @ApiStandardErrors(...WRITE, 'sales.rep_unavailable')
  async bulkAssign(
    @CurrentActor() actor: Actor,
    @Body() body: BulkAssignSalesInboundDto,
  ): Promise<BulkAssignResultDto> {
    const scope = await this.scopes.of(actor);
    const assigned: SalesInboundDto[] = [];
    const skipped: string[] = [];
    for (const id of [...new Set(body.ids)]) {
      try {
        assigned.push(inboundDto(await this.inbound.assign(scope, id, body)));
      } catch (error) {
        if (!(error instanceof DomainException) || error.code === 'sales.rep_unavailable') throw error;
        skipped.push(id);
      }
    }
    return { assigned, skipped };
  }

  @Post(':inboundId/actions/assign')
  @HttpCode(200)
  @Can('sales.pipeline.manage')
  @ApiParam({ name: 'inboundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesInbound.assign',
    summary: 'Assign or reassign an enquiry',
    description:
      'To a rep (`repUserId`), or round robin when omitted. Reassignment needs a reason (audited, kept in the ' +
      'assignment history). The lead is registered for the rep’s employee agent with the programme’s rules; a ' +
      'contact that cannot be a lead keeps the assignment with `leadRefusal` (D-469, D-417, D-440).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AssignSalesInboundDto,
    examples: {
      default: { value: { repUserId: INBOUND_EXAMPLE.assignee!.id } },
      roundRobin: { value: {} },
      reassign: { value: { repUserId: INBOUND_EXAMPLE.assignee!.id, reason: 'ลูกค้าขอคุยกับพนักงานคนเดิม' } },
    },
  })
  @ApiSuccess(200, { description: 'Enquiry', type: SalesInboundDto, example: INBOUND_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'sales.inbound_closed',
    'sales.rep_unavailable',
    'sales.no_rep_available',
  )
  async assign(
    @CurrentActor() actor: Actor,
    @Param('inboundId', ParseUUIDPipe) id: string,
    @Body() body: AssignSalesInboundDto,
  ): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.assign(await this.scopes.of(actor), id, body));
  }

  @Get(':inboundId')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'inboundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesInbound.get',
    summary: 'Get a sales enquiry',
    description: 'With its rep, lead and SLA (D-469).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Enquiry', type: SalesInboundDto, example: INBOUND_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('inboundId', ParseUUIDPipe) id: string,
  ): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.get(await this.scopes.of(actor), id));
  }

  @Post(':inboundId/actions/mark-contacted')
  @HttpCode(200)
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'inboundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesInbound.markContacted',
    summary: 'Record the first response to an enquiry',
    description:
      'The rep answered: status `contacted`, the first-response time is kept for the SLA % (P-05, D-469).',
    implements: DECISIONS,
  })
  @ApiBody({ type: MarkSalesInboundContactedDto, examples: { default: { value: { note: 'โทรแล้ว' } } } })
  @ApiSuccess(200, {
    description: 'Enquiry',
    type: SalesInboundDto,
    example: { ...INBOUND_EXAMPLE, status: 'contacted', firstRespondedAt: '2026-11-03T11:20:00+07:00' },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'sales.inbound_closed', 'sales.no_rep_available')
  async contacted(
    @CurrentActor() actor: Actor,
    @Param('inboundId', ParseUUIDPipe) id: string,
    @Body() body: MarkSalesInboundContactedDto,
  ): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.contacted(await this.scopes.of(actor), id, body.note));
  }

  @Post(':inboundId/actions/disqualify')
  @HttpCode(200)
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'inboundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesInbound.disqualify',
    summary: 'Disqualify an enquiry',
    description:
      'Closed with a reason (not a buyer, duplicate, no response, out of scope, spam, other) (D-469).',
    implements: DECISIONS,
  })
  @ApiBody({ type: DisqualifySalesInboundDto, examples: { default: { value: { reason: 'out_of_scope' } } } })
  @ApiSuccess(200, {
    description: 'Enquiry',
    type: SalesInboundDto,
    example: { ...INBOUND_EXAMPLE, status: 'disqualified', disqualifiedReason: 'out_of_scope' },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'sales.inbound_closed')
  async disqualify(
    @CurrentActor() actor: Actor,
    @Param('inboundId', ParseUUIDPipe) id: string,
    @Body() body: DisqualifySalesInboundDto,
  ): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.disqualify(await this.scopes.of(actor), id, body));
  }

  @Post(':inboundId/actions/convert')
  @HttpCode(200)
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'inboundId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesInbound.convert',
    summary: 'Work an enquiry as the rep’s lead',
    description:
      'Closes the enquiry as `converted_to_lead`; it needs the lead registered for the rep at assignment ' +
      '(`agents.lead_unavailable` when the contact cannot be a lead — one neutral reason, D-440) (D-469).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Enquiry',
    type: SalesInboundDto,
    example: { ...INBOUND_EXAMPLE, status: 'converted_to_lead' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'sales.inbound_closed',
    'sales.no_rep_available',
    'agents.lead_unavailable',
  )
  async convert(
    @CurrentActor() actor: Actor,
    @Param('inboundId', ParseUUIDPipe) id: string,
  ): Promise<SalesInboundDto> {
    return inboundDto(await this.inbound.convert(await this.scopes.of(actor), id));
  }
}
