import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { resolveServiceAmount } from '@modules/pricing/quotes/service-amount';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';

import { adminSampleDto, partnerSampleDto, sampleDto } from './sample-views';
import {
  ADMIN_SAMPLE_EXAMPLE,
  AdminSampleDto,
  CancelSampleDto,
  CreateAttachedSampleDto,
  OrderBulkDto,
  OrderBulkResultDto,
  PARTNER_SAMPLE_EXAMPLE,
  PartnerSampleDto,
  QuoteSampleDto,
  RequestSampleDto,
  SAMPLE_EXAMPLE,
  SampleDecisionDto,
  SampleDto,
  SampleEvidenceDto,
  SampleListQuery,
} from './samples.dto';
import { type SampleRow, SamplesService } from './samples.service';

const DECISIONS = ['D-253', 'D-192', 'D-072'];
const sampleParam = ApiParam({ name: 'sampleId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

async function creditWindow(settings: SettingsService): Promise<number> {
  return (await settings.at('samples.credit_window_days')).value;
}

@ApiSurface('store', 'samples')
@Controller('samples')
export class StoreSamplesController {
  constructor(
    private readonly samples: SamplesService,
    private readonly settings: SettingsService,
  ) {}

  private async view(row: SampleRow): Promise<SampleDto> {
    const photos = (await this.samples.photos([row.id])).get(row.id) ?? [];
    return sampleDto(row, photos, await creditWindow(this.settings));
  }

  @Get()
  @ApiEndpoint({
    id: 'store.samples.list',
    summary: 'List my samples',
    description: 'Attached samples of my orders and standalone samples I asked for, newest first (D-253).',
    implements: DECISIONS,
  })
  @ApiPaginated(SampleDto, { example: SAMPLE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: SampleListQuery) {
    const me = customer(actor);
    const { rows, total } = await this.samples.list(
      where(query, { customerUserId: me.userId }),
      query.page,
      query.perPage,
    );
    const photos = await this.samples.photos(rows.map((r) => r.id));
    const window = await creditWindow(this.settings);
    return {
      data: rows.map((r) => sampleDto(r, photos.get(r.id) ?? [], window)),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Get(':sampleId')
  @sampleParam
  @ApiEndpoint({
    id: 'store.samples.get',
    summary: 'Get one of my samples',
    description:
      'Its status, price, the factory’s evidence (measured size, material used, photos with their sha256), my ' +
      'decision and, for a standalone sample, the sample quotation to buy and the bulk credit (D-253, D-255, D-257).',
    implements: [...DECISIONS, 'D-255', 'D-257'],
  })
  @ApiSuccess(200, { description: 'Sample', type: SampleDto, example: SAMPLE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('sampleId', ParseUUIDPipe) id: string): Promise<SampleDto> {
    return this.view(await this.samples.getForCustomer(customer(actor).userId, id));
  }

  @Post()
  @ApiEndpoint({
    id: 'store.samples.request',
    summary: 'Ask for a sample before ordering',
    description:
      'A standalone sample of one of my saved quotations or draft configurations, printed or not; CS quotes it ' +
      '(price, freight at the customer rate card, lead time) and I buy it like a quotation (D-253, D-254, D-195).',
    implements: [...DECISIONS, 'D-254', 'D-195'],
  })
  @ApiBody({
    type: RequestSampleDto,
    examples: {
      default: { value: { quoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000f103', mockupOption: 'with_print' } },
    },
  })
  @ApiSuccess(201, {
    description: 'Requested',
    type: SampleDto,
    example: { ...SAMPLE_EXAMPLE, kind: 'standalone', status: 'requested', orderId: null, orderCode: null },
  })
  @ApiStandardErrors(...WRITE)
  async request(@CurrentActor() actor: Actor, @Body() body: RequestSampleDto): Promise<SampleDto> {
    return this.view(await this.samples.request(customer(actor).userId, body));
  }

  @Post(':sampleId/actions/approve')
  @HttpCode(200)
  @sampleParam
  @ApiEndpoint({
    id: 'store.samples.approve',
    summary: 'Approve a delivered sample',
    description:
      'Keeps who, when, IP, user agent and the sha256 of every evidence photo; locks the specification and the ' +
      'approved proof. An attached sample’s approval lets its bulk order start production (D-255, D-256, D-193).',
    implements: [...DECISIONS, 'D-255', 'D-256', 'D-193'],
  })
  @ApiBody({ type: SampleDecisionDto, examples: { default: { value: {} } } })
  @ApiSuccess(200, {
    description: 'Approved',
    type: SampleDto,
    example: { ...SAMPLE_EXAMPLE, status: 'approved' },
  })
  @ApiStandardErrors(...WRITE, 'samples.invalid_status')
  async approve(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: SampleDecisionDto,
  ): Promise<SampleDto> {
    return this.view(await this.samples.decide(customer(actor), id, 'approved', body.note));
  }

  @Post(':sampleId/actions/request-changes')
  @HttpCode(200)
  @sampleParam
  @ApiEndpoint({
    id: 'store.samples.requestChanges',
    summary: 'Ask for changes to a delivered sample',
    description:
      'The note says what to change; CS quotes a new sample. An attached sample keeps its bulk order on hold (D-253, ' +
      'D-256).',
    implements: [...DECISIONS, 'D-255', 'D-256'],
  })
  @ApiBody({ type: SampleDecisionDto, examples: { default: { value: { note: 'สีเข้มไปเล็กน้อย' } } } })
  @ApiSuccess(200, {
    description: 'Changes requested',
    type: SampleDto,
    example: { ...SAMPLE_EXAMPLE, status: 'changes_requested' },
  })
  @ApiStandardErrors(...WRITE, 'samples.invalid_status')
  async requestChanges(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: SampleDecisionDto,
  ): Promise<SampleDto> {
    return this.view(await this.samples.decide(customer(actor), id, 'changes_requested', body.note));
  }

  @Post(':sampleId/actions/reject')
  @HttpCode(200)
  @sampleParam
  @ApiEndpoint({
    id: 'store.samples.reject',
    summary: 'Reject a delivered sample',
    description:
      'The note says why; an attached sample keeps its bulk order on hold until CS acts (D-255, D-256).',
    implements: [...DECISIONS, 'D-255', 'D-256'],
  })
  @ApiBody({ type: SampleDecisionDto, examples: { default: { value: { note: 'ผิดสเปก' } } } })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: SampleDto,
    example: { ...SAMPLE_EXAMPLE, status: 'rejected' },
  })
  @ApiStandardErrors(...WRITE, 'samples.invalid_status')
  async reject(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: SampleDecisionDto,
  ): Promise<SampleDto> {
    return this.view(await this.samples.decide(customer(actor), id, 'rejected', body.note));
  }

  @Post(':sampleId/actions/order-bulk')
  @HttpCode(200)
  @sampleParam
  @ApiEndpoint({
    id: 'store.samples.orderBulk',
    summary: 'Order the approved sample in bulk',
    description:
      'The locked specification saved as a quotation at today’s prices for my quantity and put in my cart with the ' +
      'approved proof; within `samples.credit_window_days` (30) of the approval the checkout credits ' +
      '`samples.credit_pct` (100) % of the sample’s product price, once (D-257, D-197).',
    implements: [...DECISIONS, 'D-257', 'D-197', 'D-153'],
  })
  @ApiBody({ type: OrderBulkDto, examples: { default: { value: { quantity: 3000 } } } })
  @ApiSuccess(200, {
    description: 'In the cart',
    type: OrderBulkResultDto,
    example: {
      quoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000f103',
      cartId: '0192f3a0-7c1e-7d2a-9b1f-00000000f102',
      creditAvailable: true,
    },
  })
  @ApiStandardErrors(
    ...WRITE,
    'samples.invalid_status',
    'pricing.not_instant',
    'quotes.nothing_to_save',
    'cart.item_exists',
  )
  async orderBulk(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: OrderBulkDto,
  ): Promise<OrderBulkResultDto> {
    const result = await this.samples.orderBulk(customer(actor), id, body);
    return { quoteId: result.quoteId, cartId: result.cart.publicId, creditAvailable: result.creditAvailable };
  }
}

@ApiSurface('admin', 'samples')
@Controller()
export class AdminSamplesController {
  constructor(
    private readonly samples: SamplesService,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async view(actor: Actor, row: SampleRow): Promise<AdminSampleDto> {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    const photos = (await this.samples.photos([row.id])).get(row.id) ?? [];
    return adminSampleDto(row, photos, await creditWindow(this.settings), {
      cost: granted.has('factory_cost.read'),
    });
  }

  @Get('samples')
  @Can('samples.read')
  @ApiEndpoint({
    id: 'admin.samples.list',
    summary: 'List samples',
    description: 'Attached and standalone samples, newest first; filter by status, kind or order (D-253).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminSampleDto, { example: ADMIN_SAMPLE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: SampleListQuery) {
    const { rows, total } = await this.samples.list(where(query, {}), query.page, query.perPage);
    return {
      data: await Promise.all(rows.map((r) => this.view(actor, r))),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Get('samples/:sampleId')
  @Can('samples.read')
  @sampleParam
  @ApiEndpoint({
    id: 'admin.samples.get',
    summary: 'Get a sample',
    description:
      'With the factory buy amount for `factory_cost.read` (D-141) and the decision evidence (D-255).',
    implements: [...DECISIONS, 'D-141', 'D-255'],
  })
  @ApiSuccess(200, { description: 'Sample', type: AdminSampleDto, example: ADMIN_SAMPLE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
  ): Promise<AdminSampleDto> {
    return this.view(actor, await this.samples.getForStaff(id));
  }

  @Post('orders/:orderId/samples')
  @Can('samples.manage')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.samples.create',
    summary: 'Add a sample to an order',
    description:
      'CS prices a physical sample from an amount through the service sell table (buy price or sell price, D-194) — an ' +
      'add-on charge on the order with an instalment due now; once paid it goes to the order’s factory as a mockup job ' +
      'at the buy amount. The bulk order does not start production until the customer approves the sample (D-256). ' +
      'One sample in progress per order; after changes requested or a rejection, name it as `previousSampleId` ' +
      '(D-253, D-254). Replaces `admin.artwork.addMockup`.',
    implements: [...DECISIONS, 'D-254', 'D-256', 'D-194'],
  })
  @ApiBody({
    type: CreateAttachedSampleDto,
    examples: {
      default: {
        value: {
          serviceItemId: '0192f3a0-7c1e-7d2a-9b1f-00000000f105',
          basis: 'buy_price_net',
          unitAmount: '600.00',
          mockupOption: 'with_print',
          reason: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต (fake)',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Sample added',
    type: AdminSampleDto,
    example: { ...ADMIN_SAMPLE_EXAMPLE, status: 'quoted' },
  })
  @ApiStandardErrors(...WRITE, 'samples.exists', 'samples.invalid_status', 'order.invalid_transition')
  async create(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: CreateAttachedSampleDto,
  ): Promise<AdminSampleDto> {
    const amount = resolveServiceAmount(body, 'admin.samples.create');
    return this.view(
      actor,
      await this.samples.createAttached(actor as UserActor, orderId, { ...body, ...amount }),
    );
  }

  @Post('samples/:sampleId/actions/quote')
  @HttpCode(200)
  @Can('samples.manage')
  @sampleParam
  @ApiEndpoint({
    id: 'admin.samples.quote',
    summary: 'Quote a requested sample',
    description:
      'A sample quotation for the customer: CS amount through the service sell table (D-194), freight from the ' +
      'customer rate card for the parcel weight (D-195), lead time, made by the factory of the customer’s quotation ' +
      'unless named; valid `quotes.validity_days` (D-051). The customer buys it through the cart (D-254).',
    implements: [...DECISIONS, 'D-254', 'D-195', 'D-194', 'D-051'],
  })
  @ApiBody({
    type: QuoteSampleDto,
    examples: {
      default: {
        value: {
          serviceItemId: '0192f3a0-7c1e-7d2a-9b1f-00000000f105',
          basis: 'buy_price_net',
          unitAmount: '600.00',
          leadTimeDays: 7,
          parcelWeightG: 800,
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Quoted',
    type: AdminSampleDto,
    example: { ...ADMIN_SAMPLE_EXAMPLE, kind: 'standalone', status: 'quoted' },
  })
  @ApiStandardErrors(...WRITE, 'samples.invalid_status', 'samples.freight_unavailable')
  async quote(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: QuoteSampleDto,
  ): Promise<AdminSampleDto> {
    const amount = resolveServiceAmount(body, 'admin.samples.quote');
    return this.view(
      actor,
      await this.samples.quoteStandalone(actor as UserActor, id, { ...body, ...amount }),
    );
  }

  @Post('samples/:sampleId/actions/cancel')
  @HttpCode(200)
  @Can('samples.manage')
  @sampleParam
  @ApiEndpoint({
    id: 'admin.samples.cancel',
    summary: 'Cancel a sample',
    description:
      'With a reason (audited); an attached sample’s hold on its bulk order lifts (D-256). Money already paid is ' +
      'handled through the order’s credit-note flow.',
    implements: [...DECISIONS, 'D-256'],
  })
  @ApiBody({ type: CancelSampleDto, examples: { default: { value: { reason: 'ลูกค้ายกเลิก (fake)' } } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: AdminSampleDto,
    example: { ...ADMIN_SAMPLE_EXAMPLE, status: 'cancelled', cancelReason: 'ลูกค้ายกเลิก (fake)' },
  })
  @ApiStandardErrors(...WRITE, 'samples.invalid_status')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: CancelSampleDto,
  ): Promise<AdminSampleDto> {
    return this.view(actor, await this.samples.cancel(actor as UserActor, id, body.reason));
  }

  @Post('samples/:sampleId/evidence')
  @Can('samples.manage')
  @sampleParam
  @ApiEndpoint({
    id: 'admin.samples.recordEvidence',
    summary: 'Record a sample’s evidence',
    description:
      'Measured size with its basis, the material used and photos (the actor’s own clean uploads), once, before it ' +
      'ships (D-255).',
    implements: [...DECISIONS, 'D-255'],
  })
  @ApiBody({
    type: SampleEvidenceDto,
    examples: {
      default: {
        value: {
          lengthMm: 300,
          widthMm: 200,
          depthMm: 50,
          basis: 'internal',
          materialUsed: 'อาร์ตการ์ด 350 แกรม (fake)',
          photoFileIds: ['0192f3a0-7c1e-7d2a-9b1f-00000000f106'],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Recorded', type: AdminSampleDto, example: ADMIN_SAMPLE_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'samples.invalid_status',
    'samples.evidence_recorded',
    'artwork.file_not_usable',
  )
  async evidence(
    @CurrentActor() actor: Actor,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: SampleEvidenceDto,
  ): Promise<AdminSampleDto> {
    const sample = await this.samples.getForStaff(id);
    return this.view(actor, await this.samples.recordEvidence(staffOrPartner(actor), sample, body));
  }
}

@ApiSurface('partner', 'samples')
@Controller('factories/:factoryId/samples')
export class PartnerSamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get()
  @Can('factory_jobs.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.samples.list',
    summary: 'List my factory’s samples',
    description:
      'Samples made as the factory’s jobs: what to make and the evidence; no customer or price (D-142, D-050).',
    implements: [...DECISIONS, 'D-142'],
  })
  @ApiPaginated(PartnerSampleDto, { example: PARTNER_SAMPLE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: SampleListQuery,
  ) {
    const { rows, total } = await this.samples.listForPartner(actor, factoryId, query.page, query.perPage);
    const photos = await this.samples.photos(rows.map((r) => r.id));
    return {
      data: rows.map((r) => partnerSampleDto(r, photos.get(r.id) ?? [])),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Post(':sampleId/evidence')
  @Can('factory_samples.record_evidence')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @sampleParam
  @ApiEndpoint({
    id: 'partner.samples.recordEvidence',
    summary: 'Record a sample’s evidence',
    description:
      'Before the sample ships: the measured size with its basis, the material actually used and at least one photo ' +
      '(own clean uploads), once (D-255). Owner, Planner or QC.',
    implements: [...DECISIONS, 'D-255'],
  })
  @ApiBody({
    type: SampleEvidenceDto,
    examples: {
      default: {
        value: {
          lengthMm: 300,
          widthMm: 200,
          depthMm: 50,
          basis: 'internal',
          materialUsed: 'อาร์ตการ์ด 350 แกรม (fake)',
          photoFileIds: ['0192f3a0-7c1e-7d2a-9b1f-00000000f106'],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Recorded', type: PartnerSampleDto, example: PARTNER_SAMPLE_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'samples.invalid_status',
    'samples.evidence_recorded',
    'artwork.file_not_usable',
  )
  async evidence(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('sampleId', ParseUUIDPipe) id: string,
    @Body() body: SampleEvidenceDto,
  ): Promise<PartnerSampleDto> {
    const sample = await this.samples.getForPartner(actor, factoryId, id);
    const saved = await this.samples.recordEvidence(staffOrPartner(actor), sample, body);
    return partnerSampleDto(saved, (await this.samples.photos([saved.id])).get(saved.id) ?? []);
  }
}

function where(query: SampleListQuery, base: Prisma.SampleWhereInput): Prisma.SampleWhereInput {
  return {
    ...base,
    ...(query.status ? { status: query.status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.orderId ? { order: { publicId: query.orderId } } : {}),
  };
}
