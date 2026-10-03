import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import { factoryConsultationDto, rfqDto, staffRfqDto } from './rfq-views';
import {
  AcceptRfqQuoteDto,
  AdminRfqListQuery,
  AssignRfqDto,
  CandidateFactoryDto,
  ConsultationListQuery,
  DeclineConsultationDto,
  DeclineRfqDto,
  DraftRfqQuoteDto,
  FactoryConsultationDto,
  RecordRfqAcceptanceDto,
  RequestConsultationDto,
  RespondConsultationDto,
  RFQ_FORM_EXAMPLE,
  RFQ_IDS,
  RfqDto,
  RfqListQuery,
  RfqMessageInputDto,
  StaffDeclineRfqDto,
  StaffRfqDto,
  StaffRfqMessageInputDto,
  StaffSubmitRfqDto,
  StoreRfqFormDto,
  StoreRfqMessageInputDto,
  SubmitRfqDto,
  UNMET_EXAMPLE,
  UnmetDemandReasonDto,
} from './rfqs.dto';
import { rfqEtag, type RfqFiles, type RfqRow, RfqsService } from './rfqs.service';

const DECISIONS = ['D-100', 'D-043', 'D-102'];
const rfqParam = ApiParam({ name: 'rfqId', format: 'uuid' });

const QUOTATION = {
  id: RFQ_IDS.quote,
  versionNo: 1,
  status: 'sent',
  validUntil: '2026-10-16T09:00:00+07:00',
  sentAt: '2026-10-01T09:00:00+07:00',
  note: 'Price includes delivery to Bangkok (fake)',
  lines: [
    {
      quantity: 1000,
      unitPrice: '12.500000',
      netAmount: '12800.00',
      vatAmount: '896.00',
      grossAmount: '13696.00',
      shippingNetAmount: '300.00',
      leadTimeDays: 14,
    },
  ],
};
const RFQ_EXAMPLE: RfqDto = {
  id: RFQ_IDS.rfq,
  rfqCode: 'RFQ-2610-00001',
  status: 'quoted',
  productTypeCode: 'paper_bag',
  productTypeName: 'ถุงกระดาษ',
  spec: UNMET_EXAMPLE,
  lengthMm: 250,
  widthMm: 120,
  heightMm: 320,
  measurementBasis: 'internal',
  quantities: [500, 1000, 3000],
  targetDate: '2026-11-15',
  targetPricePerUnit: null,
  deliveryPostcode: '10110',
  notes: 'Logo on both sides (fake)',
  slaDueAt: null,
  files: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000f001',
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 245760,
    },
  ],
  messages: [
    {
      id: RFQ_IDS.message,
      author: 'packio',
      body: 'Quotation sent (fake)',
      files: [],
      createdAt: '2026-10-01T09:00:00+07:00',
    },
  ],
  quotations: [QUOTATION],
  acceptedQuoteId: null,
  declineReasonCode: null,
  submittedAt: '2026-09-30T15:00:00+07:00',
  closedAt: null,
  nextActions: [{ key: 'rfq.post_message', irreversible: false, disabledReason: null }],
};
const STAFF_EXAMPLE: StaffRfqDto = {
  ...RFQ_EXAMPLE,
  channel: 'web',
  customer: { id: RFQ_IDS.user, displayName: 'Fake Customer' },
  assignedTo: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e706', displayName: 'Dev CS' },
  firstResponseAt: '2026-10-01T09:00:00+07:00',
  overdue: false,
  messages: [
    {
      ...RFQ_EXAMPLE.messages[0]!,
      visibility: 'customer',
      authorUser: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e706', displayName: 'Dev CS' },
    },
  ],
  quotations: [
    {
      ...QUOTATION,
      lines: QUOTATION.lines.map((l) => ({
        ...l,
        factoryId: RFQ_IDS.factory,
        buyUnitPrice: '9.800000',
        marginPct: '21.6000',
        belowMarginFloor: false,
      })),
    },
  ],
  consultations: [
    {
      id: RFQ_IDS.consultation,
      factoryId: RFQ_IDS.factory,
      factoryCode: 'F9001',
      status: 'responded',
      dueAt: '2026-10-03T17:00:00+07:00',
      note: 'Please quote the three tiers (fake)',
      lines: [{ quantity: 1000, buyUnitPrice: '9.800000', leadTimeDays: 12 }],
      responseNote: 'Price valid 30 days (fake)',
      respondedAt: '2026-10-02T11:00:00+07:00',
      requestedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e706', displayName: 'Dev CS' },
    },
  ],
  customerCode: 'CU-000042',
  contact: { email: 'someone@example.test', phone: '+66800000001' },
  slaTargetHours: 8,
  routedFromCalculator: false,
  specLines: [
    {
      key: 'material',
      labelTh: 'วัสดุ',
      labelEn: 'Material',
      valueTh: 'kraft 150 gsm (fake)',
      valueEn: 'kraft 150 gsm (fake)',
    },
  ],
  quoteDefaults: { validUntil: '2026-10-16T10:00:00+07:00' },
};
const CONSULTATION_EXAMPLE: FactoryConsultationDto = {
  id: RFQ_IDS.consultation,
  status: 'requested',
  dueAt: '2026-10-03T17:00:00+07:00',
  note: 'Please quote the three tiers (fake)',
  rfqCode: 'RFQ-2610-00001',
  productTypeCode: 'paper_bag',
  productTypeName: 'ถุงกระดาษ',
  spec: UNMET_EXAMPLE,
  lengthMm: 250,
  widthMm: 120,
  heightMm: 320,
  measurementBasis: 'internal',
  quantities: [500, 1000, 3000],
  targetDate: '2026-11-15',
  deliveryProvince: 'กรุงเทพมหานคร',
  lines: null,
  respondedAt: null,
};
const SUBMIT_EXAMPLE = {
  productTypeCode: 'paper_bag',
  spec: UNMET_EXAMPLE,
  lengthMm: 250,
  widthMm: 120,
  heightMm: 320,
  measurementBasis: 'internal',
  quantities: [500, 1000, 3000],
  targetDate: '2026-11-15',
  deliveryPostcode: '10110',
  notes: 'Logo on both sides (fake)',
};
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;

function customerOf(actor: Actor): bigint {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor.userId;
}

/** `/v1/store/rfq-forms/{productTypeCode}`: the public RFQ form of a product type (U-B0.1). */
@ApiTags('store.rfqs')
@Controller('rfq-forms')
export class StoreRfqFormsController {
  constructor(private readonly rfqs: RfqsService) {}

  @Get(':productTypeCode')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiParam({ name: 'productTypeCode', example: 'paper_bag' })
  @ApiEndpoint({
    id: 'store.rfqs.getForm',
    summary: 'Get the request-for-quote form of a product type',
    description:
      "The category's spec fields rendered from its admin schema as typed fields (labels, help, units, limits, " +
      'options), whether dimensions are asked, how many quantities, the file rules and the first-response SLA. ' +
      'Any active type has one: an instant type still routes to RFQ outside its price paths (D-043, D-100). Send ' +
      '`specSchemaVersion` back with the request.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The form', type: StoreRfqFormDto, example: RFQ_FORM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  form(@Param('productTypeCode') productTypeCode: string): Promise<StoreRfqFormDto> {
    return this.rfqs.form(productTypeCode);
  }
}

@ApiSurface('store', 'rfqs')
@Controller('rfqs')
export class StoreRfqsController {
  constructor(private readonly rfqs: RfqsService) {}

  private async view(row: RfqRow) {
    return rfqDto(row, await this.rfqs.attachments(row));
  }

  @Post()
  @Idempotent()
  @ApiEndpoint({
    id: 'store.rfqs.submit',
    summary: 'Request a quote',
    description:
      'For every type not quoted instantly, and when no instant price path covers a configuration (D-100, ' +
      'D-043): spec fields of the category (validated against its schema), up to 10 quantity tiers, target ' +
      'date, delivery postcode, uploaded files. CS answers within the category SLA when one is set.',
    implements: DECISIONS,
  })
  @ApiBody({ type: SubmitRfqDto, examples: { default: { value: SUBMIT_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: RfqDto,
    example: { ...RFQ_EXAMPLE, status: 'submitted', messages: [], quotations: [] },
  })
  @ApiStandardErrors(...WRITE, 'numbering.series_missing', 'specs.unit_not_accepted')
  async submit(@CurrentActor() actor: Actor, @Body() body: SubmitRfqDto): Promise<RfqDto> {
    return this.view(await this.rfqs.submit(customerOf(actor), 'web', body));
  }

  @Get()
  @ApiEndpoint({
    id: 'store.rfqs.list',
    summary: 'List my requests for quote',
    description: 'Newest first (D-100).',
    implements: DECISIONS,
  })
  @ApiPaginated(RfqDto, { example: RFQ_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: RfqListQuery) {
    const { rows, total } = await this.rfqs.list(
      { customerUserId: customerOf(actor), ...(query.status ? { status: query.status } : {}) },
      query.page,
      query.perPage,
    );
    return {
      data: await Promise.all(rows.map((r) => this.view(r))),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Get(':rfqId')
  @rfqParam
  @ApiEndpoint({
    id: 'store.rfqs.get',
    summary: 'Get one of my requests for quote',
    description:
      'The conversation with Packio and the quotations sent (never drafts or internal notes, D-100).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Request', type: RfqDto, example: RFQ_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('rfqId', ParseUUIDPipe) rfqId: string): Promise<RfqDto> {
    return this.view(await this.rfqs.forCustomer(customerOf(actor), rfqId));
  }

  @Post(':rfqId/messages')
  @rfqParam
  @ApiEndpoint({
    id: 'store.rfqs.postMessage',
    summary: 'Answer Packio on a request for quote',
    description: 'A request waiting for information goes back to review (D-100).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StoreRfqMessageInputDto,
    examples: { default: { value: { body: 'Flat handles are fine (fake)' } } },
  })
  @ApiSuccess(201, { description: 'Request', type: RfqDto, example: RFQ_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'rfq.closed')
  async message(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: StoreRfqMessageInputDto,
  ): Promise<RfqDto> {
    return this.view(await this.rfqs.customerMessage(customerOf(actor), rfqId, body.body, body.fileIds));
  }

  @Post(':rfqId/actions/accept')
  @HttpCode(200)
  @Idempotent()
  @rfqParam
  @ApiEndpoint({
    id: 'store.rfqs.accept',
    summary: 'Accept a quotation',
    description:
      'A sent, valid quotation (all tiers or some) becomes a saved quotation (`source = rfq`, manual snapshot) ' +
      'price-locked until its validity, ready for the cart like any quotation (D-100, D-051).',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiBody({
    type: AcceptRfqQuoteDto,
    examples: { default: { value: { rfqQuoteId: RFQ_IDS.quote, quantities: [1000] } } },
  })
  @ApiSuccess(200, {
    description: 'Accepted',
    type: RfqDto,
    example: {
      ...RFQ_EXAMPLE,
      status: 'accepted',
      acceptedQuoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000e601',
      closedAt: '2026-10-02T09:00:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE, 'rfq.quote_not_open', 'pricing.vat_rate_missing')
  async accept(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: AcceptRfqQuoteDto,
  ): Promise<RfqDto> {
    return this.view(await this.rfqs.accept(customerOf(actor), rfqId, body.rfqQuoteId, body.quantities));
  }

  @Post(':rfqId/actions/decline')
  @HttpCode(200)
  @rfqParam
  @ApiEndpoint({
    id: 'store.rfqs.decline',
    summary: 'Decline a request for quote',
    description: 'Closes the request (reason `customer_declined`); recorded as unmet demand (D-102).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: DeclineRfqDto,
    examples: { default: { value: { note: 'Found another supplier (fake)' } } },
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: RfqDto,
    example: { ...RFQ_EXAMPLE, status: 'declined', declineReasonCode: 'customer_declined' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.closed')
  async decline(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: DeclineRfqDto,
  ): Promise<RfqDto> {
    return this.view(await this.rfqs.customerDecline(customerOf(actor), rfqId, body.note));
  }
}

@ApiSurface('admin', 'rfqs')
@Controller()
export class AdminRfqsController {
  constructor(
    private readonly rfqs: RfqsService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('rfqs')
  @Can('rfqs.read')
  @ApiEndpoint({
    id: 'admin.rfqs.list',
    summary: 'List requests for quote',
    description:
      '`q` matches the RFQ code; filter by status, assignee, overdue first response, product type, channel, ' +
      'submission dates (Bangkok) or an open factory consultation (`awaitingFactory`) (D-100).',
    implements: DECISIONS,
  })
  @ApiPaginated(StaffRfqDto, { example: STAFF_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: AdminRfqListQuery) {
    const now = new Date();
    const where: Prisma.RfqWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { rfqCode: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.assignedToId ? { assignedTo: { publicId: query.assignedToId } } : {}),
      ...(query.productTypeCode && { productType: { code: query.productTypeCode } }),
      ...(query.channel && { channel: query.channel }),
      ...((query.submittedFrom || query.submittedTo) && {
        submittedAt: {
          ...(query.submittedFrom && { gte: startOfBangkokDay(query.submittedFrom) }),
          ...(query.submittedTo && { lt: startOfBangkokDay(addCalendarDays(query.submittedTo, 1)) }),
        },
      }),
      ...(query.awaitingFactory && { consultations: { some: { status: 'requested' } } }),
      ...(query.overdue
        ? {
            status: { in: ['submitted', 'in_review', 'need_info'] },
            firstResponseAt: null,
            slaDueAt: { lt: now },
          }
        : {}),
    };
    const { rows, total } = await this.rfqs.list(where, query.page, query.perPage);
    const grants = await this.grants(actor);
    const ctx = await this.rfqs.staffContext(rows, now);
    return {
      data: rows.map((r) =>
        staffRfqDto(r, grants, now, undefined, {
          slaTargetHours: ctx.hours.get(r.productTypeId) ?? null,
          validUntil: ctx.validUntil,
          schema: ctx.schemas.get(r.productTypeId) ?? null,
        }),
      ),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Get('unmet-demand-reasons')
  @Can('rfqs.read')
  @ApiEndpoint({
    id: 'admin.rfqs.listUnmetDemandReasons',
    summary: 'List the unmet-demand reasons',
    description: 'The active reasons a declined request records (D-102), for the decline dialog.',
    implements: ['D-102'],
  })
  @ApiSuccess(200, {
    description: 'Reasons',
    type: [UnmetDemandReasonDto],
    example: [{ code: 'price_too_high', nameTh: 'ราคาสูงเกินไป', nameEn: 'Price too high' }],
  })
  @ApiStandardErrors('validation.failed')
  async unmetDemandReasons(): Promise<UnmetDemandReasonDto[]> {
    return (await this.rfqs.unmetDemandReasons()).map((r) => ({
      code: r.code,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
    }));
  }

  @Get('rfqs/:rfqId')
  @Can('rfqs.read')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.get',
    summary: 'Get a request for quote with the staff view',
    description: 'Every message, consultation and quotation version; buy prices and margins per D-141.',
    implements: [...DECISIONS, 'D-141'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffRfqDto> {
    const row = await this.rfqs.get(rfqId);
    res.setHeader('ETag', rfqEtag(row));
    return this.view(actor, row, await this.rfqs.attachments(row));
  }

  @Post('rfqs')
  @Can('rfqs.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.rfqs.submit',
    summary: 'Enter a request for quote for a customer (CS)',
    description: 'Same rules as the store; channel `cs`, the CS member is recorded (D-100).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StaffSubmitRfqDto,
    examples: { default: { value: { ...SUBMIT_EXAMPLE, customerUserId: RFQ_IDS.user } } },
  })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: StaffRfqDto,
    example: { ...STAFF_EXAMPLE, channel: 'cs', status: 'submitted' },
  })
  @ApiStandardErrors(...WRITE, 'numbering.series_missing')
  async submit(@CurrentActor() actor: Actor, @Body() body: StaffSubmitRfqDto): Promise<StaffRfqDto> {
    const customer = await this.rfqs.customer(body.customerUserId);
    if (!customer) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'customerUserId', code: 'exists', message: 'not a customer' }],
      });
    }
    const rfq = await this.rfqs.submit(customer.id, 'cs', body, actor as UserActor);
    return this.view(actor, rfq);
  }

  @Post('rfqs/:rfqId/actions/assign')
  @HttpCode(200)
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.assign',
    summary: 'Assign a request to a staff member',
    description: 'A submitted request moves to review (D-100).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AssignRfqDto,
    examples: { default: { value: { userId: '0192f3a0-7c1e-7d2a-9b1f-00000000e706' } } },
  })
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'rfq.closed', 'rfq.invalid_transition')
  async assign(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: AssignRfqDto,
  ) {
    return this.view(actor, await this.rfqs.assign(actor as UserActor, rfqId, body.userId));
  }

  @Post('rfqs/:rfqId/messages')
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.postMessage',
    summary: 'Write on a request for quote',
    description: 'To the customer (the first one records the first response) or an internal note (D-100).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StaffRfqMessageInputDto,
    examples: { default: { value: { body: 'Quotation within 24 hours (fake)', visibility: 'customer' } } },
  })
  @ApiSuccess(201, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'rfq.closed')
  async message(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: StaffRfqMessageInputDto,
  ) {
    return this.view(
      actor,
      await this.rfqs.staffMessage(actor as UserActor, rfqId, body.body, body.visibility, body.fileIds),
    );
  }

  @Post('rfqs/:rfqId/actions/request-info')
  @HttpCode(200)
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.requestInfo',
    summary: 'Ask the customer for information',
    description: 'Sends the question to the customer and moves the request to `need_info` (D-100).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RfqMessageInputDto,
    examples: { default: { value: { body: 'Which print colours? (fake)' } } },
  })
  @ApiSuccess(200, {
    description: 'Request',
    type: StaffRfqDto,
    example: { ...STAFF_EXAMPLE, status: 'need_info' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.closed', 'rfq.invalid_transition')
  async requestInfo(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: RfqMessageInputDto,
  ) {
    return this.view(actor, await this.rfqs.requestInfo(actor as UserActor, rfqId, body.body));
  }

  @Post('rfqs/:rfqId/consultations')
  @Idempotent({ optional: true })
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.requestConsultation',
    summary: 'Ask a factory for its buy price',
    description:
      'The factory sees the spec, tiers, target date and delivery province only — never the customer or the ' +
      'sell price (D-044, D-142). One open request per factory (D-100).',
    implements: [...DECISIONS, 'D-044'],
  })
  @ApiBody({
    type: RequestConsultationDto,
    examples: {
      default: {
        value: {
          factoryId: RFQ_IDS.factory,
          dueAt: '2026-10-03T17:00:00+07:00',
          note: 'Please quote the three tiers (fake)',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'rfq.closed', 'rfq.consultation_open')
  async consult(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: RequestConsultationDto,
  ) {
    return this.view(actor, await this.rfqs.requestConsultation(actor as UserActor, rfqId, body));
  }

  @Post('rfqs/:rfqId/actions/start-review')
  @HttpCode(200)
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.startReview',
    summary: 'Start reviewing a request',
    description:
      'Submitted → in review without assigning it (D-100); 409 `rfq.invalid_transition` otherwise.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'rfq.closed', 'rfq.invalid_transition')
  async startReview(@CurrentActor() actor: Actor, @Param('rfqId', ParseUUIDPipe) rfqId: string) {
    return this.view(actor, await this.rfqs.startReview(rfqId));
  }

  @Get('rfqs/:rfqId/candidate-factories')
  @Can('rfqs.read')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.listCandidateFactories',
    summary: 'Factories that could quote a request',
    description:
      'Active or trial factories with an active capability for the category: participation tier in force (D-043), ' +
      'whether the tiers fit the capability, whether already consulted, on-time shipping of the latest scorecard ' +
      '(D-155). No prices.',
    implements: ['D-043', 'D-155', 'D-100'],
  })
  @ApiSuccess(200, {
    description: 'Candidates',
    type: [CandidateFactoryDto],
    example: [
      {
        factoryId: RFQ_IDS.factory,
        code: 'F9001',
        name: 'โรงพิมพ์ ทดสอบ',
        status: 'active',
        tier: 'A',
        capable: true,
        reason: null,
        alreadyConsulted: false,
        onTimeShippingPct: '96.50',
      },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  candidates(@Param('rfqId', ParseUUIDPipe) rfqId: string): Promise<CandidateFactoryDto[]> {
    return this.rfqs.candidates(rfqId);
  }

  @Post('rfq-consultations/:consultationId/actions/remind')
  @HttpCode(204)
  @Can('rfqs.manage')
  @Idempotent({ optional: true })
  @ApiParam({ name: 'consultationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.rfqs.remindConsultation',
    summary: 'Remind a factory of a price request',
    description:
      'Notifies the factory again (partner zone, e-mail, LINE — D-143). 409 `rfq.consultation_not_open` when it is ' +
      'no longer waiting, `rfq.reminder_recent` within an hour of the last reminder.',
    implements: ['D-143', 'D-100'],
  })
  @ApiSuccess(204, { description: 'Reminded' })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'rfq.consultation_not_open',
    'rfq.reminder_recent',
  )
  async remind(
    @CurrentActor() actor: Actor,
    @Param('consultationId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.rfqs.remindConsultation(actor as UserActor, id);
  }

  @Put('rfq-quotations/:rfqQuoteId')
  @Can('rfqs.manage')
  @ApiParam({ name: 'rfqQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.rfqs.replaceDraftQuotation',
    summary: 'Revise the draft quotation',
    description:
      'Replaces the lines and note of the draft, priced as a new draft (VAT in force, margin floor — D-012). ' +
      '`If-Match` the request’s ETag (`admin.rfqs.get`); drafts only (409 `rfq.quote_not_draft`).',
    implements: [...DECISIONS, 'D-012'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: DraftRfqQuoteDto,
    examples: {
      default: { value: { lines: [{ quantity: 1000, unitPrice: '12.000000', leadTimeDays: 14 }] } },
    },
  })
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE, headers: ['ETag'] })
  @ApiStandardErrors(...WRITE, 'rfq.closed', 'rfq.quote_not_draft', 'pricing.vat_rate_missing')
  async replaceDraft(
    @CurrentActor() actor: Actor,
    @Param('rfqQuoteId', ParseUUIDPipe) rfqQuoteId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: DraftRfqQuoteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.rfqs.replaceDraft(actor as UserActor, rfqQuoteId, ifMatch, body);
    res.setHeader('ETag', rfqEtag(row));
    return this.view(actor, row);
  }

  @Post('rfq-quotations/:rfqQuoteId/actions/record-acceptance')
  @HttpCode(200)
  @Can('rfqs.manage')
  @Idempotent()
  @ApiParam({ name: 'rfqQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.rfqs.recordAcceptance',
    summary: 'Record the customer’s acceptance of a quotation',
    description:
      'When the customer accepts by phone or LINE: the same result as their own acceptance — a saved quotation ' +
      '(source `rfq`) CS then puts in their cart (D-100, D-051); audited with how it was given.',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiBody({
    type: RecordRfqAcceptanceDto,
    examples: { default: { value: { quantities: [1000], via: 'phone' } } },
  })
  @ApiSuccess(200, {
    description: 'Request',
    type: StaffRfqDto,
    example: { ...STAFF_EXAMPLE, status: 'accepted' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.quote_not_open')
  async recordAcceptance(
    @CurrentActor() actor: Actor,
    @Param('rfqQuoteId', ParseUUIDPipe) rfqQuoteId: string,
    @Body() body: RecordRfqAcceptanceDto,
  ) {
    return this.view(actor, await this.rfqs.recordAcceptance(actor as UserActor, rfqQuoteId, body));
  }

  @Post('rfqs/:rfqId/quotations')
  @Idempotent({ optional: true })
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.draftQuotation',
    summary: 'Draft a quotation',
    description:
      'Price per tier (per piece and shipping, before VAT); VAT at the rate in force; margin and the margin-' +
      'floor flag from the buy price (D-012). One draft at a time; send it to replace the quotation the ' +
      'customer holds (D-100).',
    implements: [...DECISIONS, 'D-012'],
  })
  @ApiBody({
    type: DraftRfqQuoteDto,
    examples: {
      default: {
        value: {
          lines: [
            {
              quantity: 1000,
              unitPrice: '12.500000',
              shippingNetAmount: '300.00',
              leadTimeDays: 14,
              factoryId: RFQ_IDS.factory,
              buyUnitPrice: '9.800000',
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'rfq.closed', 'rfq.draft_open', 'pricing.vat_rate_missing')
  async draft(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: DraftRfqQuoteDto,
  ) {
    return this.view(actor, await this.rfqs.draftQuote(actor as UserActor, rfqId, body));
  }

  @Post('rfq-quotations/:rfqQuoteId/actions/send')
  @Idempotent({ optional: true })
  @HttpCode(200)
  @Can('rfqs.manage')
  @ApiParam({ name: 'rfqQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.rfqs.sendQuotation',
    summary: 'Send a quotation to the customer',
    description:
      'Valid for `quotes.validity_days` (D-051); the previous quotation is superseded; the request becomes `quoted`.',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'rfq.closed',
    'rfq.quote_not_draft',
    'rfq.quote_empty',
  )
  async send(@CurrentActor() actor: Actor, @Param('rfqQuoteId', ParseUUIDPipe) rfqQuoteId: string) {
    return this.view(actor, await this.rfqs.sendQuote(actor as UserActor, rfqQuoteId));
  }

  @Post('rfq-quotations/:rfqQuoteId/actions/discard')
  @HttpCode(200)
  @Can('rfqs.manage')
  @ApiParam({ name: 'rfqQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.rfqs.discardQuotation',
    summary: 'Discard a draft quotation',
    description: 'Drafts only (D-100).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Request', type: StaffRfqDto, example: STAFF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'rfq.quote_not_draft')
  async discard(@CurrentActor() actor: Actor, @Param('rfqQuoteId', ParseUUIDPipe) rfqQuoteId: string) {
    return this.view(actor, await this.rfqs.discardDraft(rfqQuoteId));
  }

  @Post('rfqs/:rfqId/actions/decline')
  @Idempotent({ optional: true })
  @HttpCode(200)
  @Can('rfqs.manage')
  @rfqParam
  @ApiEndpoint({
    id: 'admin.rfqs.decline',
    summary: 'Decline a request for quote',
    description:
      'With an unmet-demand reason code (capability, capacity, price, feasibility…); recorded for D-102.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: StaffDeclineRfqDto,
    examples: {
      default: {
        value: { reasonCode: 'capability_missing', note: 'No factory makes rigid boxes yet (fake)' },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: StaffRfqDto,
    example: { ...STAFF_EXAMPLE, status: 'declined', declineReasonCode: 'capability_missing' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.closed')
  async decline(
    @CurrentActor() actor: Actor,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body() body: StaffDeclineRfqDto,
  ) {
    return this.view(
      actor,
      await this.rfqs.staffDecline(actor as UserActor, rfqId, body.reasonCode, body.note),
    );
  }

  private async view(actor: Actor, row: RfqRow, files?: RfqFiles): Promise<StaffRfqDto> {
    const now = new Date();
    const ctx = await this.rfqs.staffContext([row], now);
    return staffRfqDto(row, await this.grants(actor), now, files, {
      slaTargetHours: ctx.hours.get(row.productTypeId) ?? null,
      validUntil: ctx.validUntil,
      schema: ctx.schemas.get(row.productTypeId) ?? null,
    });
  }

  private async grants(actor: Actor) {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    return { cost: granted.has('factory_cost.read'), margin: granted.has('margin.read'), perms: granted };
  }
}

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const consultationParam = ApiParam({ name: 'consultationId', format: 'uuid' });

@ApiSurface('partner', 'rfqConsultations')
@Controller('factories/:factoryId/rfq-consultations')
export class PartnerRfqConsultationsController {
  constructor(private readonly rfqs: RfqsService) {}

  @Get()
  @Can('factory_rfq.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.rfqConsultations.list',
    summary: 'List requests for my buy price',
    description:
      'Spec, tiers, target date and delivery province; never the customer or the sell price (D-044, D-142).',
    implements: ['D-100', 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Requests',
    type: [FactoryConsultationDto],
    example: [CONSULTATION_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: ConsultationListQuery,
  ) {
    return (await this.rfqs.consultations(actor, factoryId, query.status)).map(factoryConsultationDto);
  }

  @Post(':consultationId/actions/respond')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_rfq.respond')
  @factoryParam
  @consultationParam
  @ApiEndpoint({
    id: 'partner.rfqConsultations.respond',
    summary: 'Answer with my buy price per tier',
    description: 'Buy price per piece before VAT and lead time for the requested tiers (D-100, D-042).',
    implements: ['D-100', 'D-042'],
  })
  @ApiBody({
    type: RespondConsultationDto,
    examples: {
      default: {
        value: {
          lines: [{ quantity: 1000, buyUnitPrice: '9.800000', leadTimeDays: 12 }],
          note: 'Price valid 30 days (fake)',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Answered',
    type: FactoryConsultationDto,
    example: { ...CONSULTATION_EXAMPLE, status: 'responded' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.consultation_closed')
  async respond(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() body: RespondConsultationDto,
  ): Promise<FactoryConsultationDto> {
    await this.rfqs.respondConsultation(actor as UserActor, factoryId, consultationId, {
      lines: body.lines,
      note: body.note,
    });
    return this.one(actor, factoryId, consultationId);
  }

  @Post(':consultationId/actions/decline')
  @HttpCode(200)
  @Can('factory_rfq.respond')
  @factoryParam
  @consultationParam
  @ApiEndpoint({
    id: 'partner.rfqConsultations.decline',
    summary: 'Decline to quote',
    description: 'The factory cannot or will not quote (D-100).',
    implements: ['D-100'],
  })
  @ApiBody({
    type: DeclineConsultationDto,
    examples: { default: { value: { note: 'Cannot make this material (fake)' } } },
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: FactoryConsultationDto,
    example: { ...CONSULTATION_EXAMPLE, status: 'declined' },
  })
  @ApiStandardErrors(...WRITE, 'rfq.consultation_closed')
  async decline(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() body: DeclineConsultationDto,
  ): Promise<FactoryConsultationDto> {
    await this.rfqs.respondConsultation(actor as UserActor, factoryId, consultationId, {
      decline: true,
      note: body.note,
    });
    return this.one(actor, factoryId, consultationId);
  }

  private async one(actor: Actor, factoryId: string, consultationId: string) {
    const row = (await this.rfqs.consultations(actor, factoryId)).find((c) => c.publicId === consultationId);
    if (!row) throw new DomainException('http.not_found');
    return factoryConsultationDto(row);
  }
}
