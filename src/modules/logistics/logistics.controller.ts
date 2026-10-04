import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { formatMoney } from '@common/money/money';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { orderDto, orderViewContext } from '@modules/orders/order-views';
import { ORDER_EXAMPLE, OrderDto } from '@modules/orders/orders.dto';
import { OrdersService } from '@modules/orders/orders.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { SettingsService } from '@platform/settings/settings.service';
import { type Response } from 'express';

import { DeliveryService } from './delivery.service';
import {
  ADMIN_SHIPMENT_EXAMPLE,
  AdminShipmentDto,
  AdminShipmentListQuery,
  BookCarrierDto,
  CancelShipmentDto,
  CreateShipmentDto,
  DeliveryReconciliationDto,
  PARTNER_SHIPMENT_EXAMPLE,
  PartnerShipmentDto,
  PartnerShipmentListQuery,
  POD_EXAMPLE,
  RECONCILIATION_EXAMPLE,
  RecordPodDto,
  RequestCarrierDto,
  ResolveShipmentExceptionDto,
  ReviewPodDto,
  SHIP_PLAN_EXAMPLE,
  SHIPMENT_IDS,
  ShipmentCarrierQuoteDto,
  ShipmentListQuery,
  ShipmentStatusUpdateDto,
  ShipPlanJobDto,
  SplitShipmentDto,
  SplitShipmentResultDto,
  STORE_SHIPMENT_EXAMPLE,
  StoreShipmentDto,
} from './logistics.dto';
import { SHIPMENT_QUEUE_WHERE as QUEUES } from './shipment-queues';
import {
  adminShipmentDto,
  partnerShipmentDto,
  reconciliationDto,
  SHIPMENT_INCLUDE,
  type ShipmentRow,
  storeShipmentDto,
} from './shipment-views';
import { shipmentEtag, ShipmentsService } from './shipments.service';
import { ShipmentsQueryService } from './shipments-query.service';

const shipmentParam = ApiParam({ name: 'shipmentId', format: 'uuid' });
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });

const CREATE_EXAMPLE = {
  items: [{ jobId: SHIPMENT_IDS.job, destinationId: SHIPMENT_IDS.destination, quantity: 600 }],
  cartonsCount: 3,
  weightG: 18000,
  volumeCm3: 120000,
  plannedShipOn: '2026-10-20',
};
const STATUS_EXAMPLE = { status: 'out_for_delivery', location: 'บางนา', note: 'ออกส่งรอบบ่าย' };
const POD_BODY_EXAMPLE = {
  receiverName: 'สมหญิง ใจดี',
  signatureFileId: SHIPMENT_IDS.signature,
  photoFileIds: [SHIPMENT_IDS.photo],
  items: [{ destinationId: SHIPMENT_IDS.destination, deliveredQuantity: 590 }],
  lat: 13.7563,
  lng: 100.5018,
};
const CANCEL_EXAMPLE = { reason: 'รวมกับรอบส่งถัดไป' };

const POD_DESCRIPTION =
  'Mandatory for factory deliveries (D-013): receiver name, signature and at least one photo (evidence ' +
  'uploads), and the pieces accepted per destination on the trip (≤ shipped). Delivers the shipment; when ' +
  'every shipment of an order’s job is delivered the order is delivered and reconciled against the tolerance ' +
  'frozen in the quote (D-021, D-080: shortage within → pro-rata credit; overage within → no charge; outside ' +
  '→ automatic claim; factory payable min(delivered, ordered), D-165). A packed shipment the factory delivers ' +
  'straight away is picked up first (shipping gate applies). Idempotent.';

// =====================================================================================================
// Partner (factory-scoped: other factories' shipments are 404)
// =====================================================================================================

@ApiSurface('partner', 'logistics')
@Controller()
export class PartnerShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly delivery: DeliveryService,
    private readonly query: ShipmentsQueryService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async dtos(actor: Actor, rows: ShipmentRow[]) {
    const [photos, blocked, perms] = await Promise.all([
      this.query.podPhotos(rows),
      this.shipments.blockedByPayment(rows),
      permissionsOf(this.permissions, actor),
    ]);
    return rows.map((r) => partnerShipmentDto(r, photos.get(r.id), blocked.has(r.id), perms));
  }

  private async dto(actor: Actor, publicId: string) {
    return (await this.dtos(actor, [await this.query.get(actor, publicId)]))[0]!;
  }

  @Get('shipments')
  @Can('factory_shipments.read')
  @ApiEndpoint({
    id: 'partner.shipments.list',
    summary: 'List my factory’s shipments',
    description:
      'Newest first; `view` groups the statuses (open, in transit, delivered, exceptions). Destination contacts only ' +
      '(D-142), no prices; each trip says whether unpaid instalments block pickup and whether a carrier was asked for.',
    implements: ['D-013', 'D-142'],
  })
  @ApiPaginated(PartnerShipmentDto, { example: PARTNER_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: PartnerShipmentListQuery) {
    const where: Prisma.ShipmentWhereInput = { AND: [listWhere(q), q.view ? PARTNER_VIEWS[q.view] : {}] };
    const [rows, total] = await this.query.list(actor, where, q.page, q.perPage);
    return { data: await this.dtos(actor, rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('shipments/:shipmentId')
  @Can('factory_shipments.read')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.get',
    summary: 'Get one of my shipments',
    description:
      'Items, cartons’ label and packing-list files (download through the files API), events and POD.',
    implements: ['D-013', 'D-142'],
  })
  @ApiSuccess(200, { description: 'Shipment', type: PartnerShipmentDto, example: PARTNER_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('shipmentId', ParseUUIDPipe) shipmentId: string) {
    return this.dto(actor, shipmentId);
  }

  @Post('shipments')
  @Idempotent()
  @Can('factory_shipments.manage')
  @ApiEndpoint({
    id: 'partner.shipments.create',
    summary: 'Create a shipment',
    description:
      'One trip to one address from completed jobs of my factory: split deliveries and several destinations ' +
      'are several shipments; never more than the job made (`shipments.quantity_exceeds`). Carrier: the ' +
      'factory’s own fleet (D-013). Starts as `draft`.',
    implements: ['D-013', 'D-142'],
  })
  @ApiBody({ type: CreateShipmentDto, examples: { default: { value: CREATE_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Created',
    type: PartnerShipmentDto,
    example: {
      ...PARTNER_SHIPMENT_EXAMPLE,
      status: 'draft',
      readyAt: null,
      labelFileId: null,
      packingListFileId: null,
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.job_not_shippable',
    'shipments.destinations_differ',
    'shipments.quantity_exceeds',
    'samples.evidence_missing',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateShipmentDto) {
    return this.dto(actor, await this.shipments.create(actor, body));
  }

  @Post('shipments/:shipmentId/actions/ready')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.markReady',
    summary: 'Mark a shipment packed and print its labels',
    description:
      'Generates one 100 × 150 mm label per carton (QR → public tracking, Packio brand only, D-050) and the ' +
      'packing list; the shipping payout is fixed from the factory’s rate card (D-013).',
    implements: ['D-013', 'D-050'],
  })
  @ApiSuccess(200, { description: 'Ready', type: PartnerShipmentDto, example: PARTNER_SHIPMENT_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'provider.unavailable',
  )
  async ready(@CurrentActor() actor: Actor, @Param('shipmentId', ParseUUIDPipe) shipmentId: string) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.markReady(actor, row.id);
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/actions/dispatch')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.dispatch',
    summary: 'Hand a shipment to the factory’s fleet',
    description:
      'Blocked while instalments due before shipping are unpaid (`shipments.payment_pending`, B3.2) or a ' +
      'required Packio inspection has not passed (`shipments.inspection_pending`, D-076). Records the order’s ' +
      '`shipped` fact.',
    implements: ['D-013', 'D-020', 'D-076'],
  })
  @ApiSuccess(200, {
    description: 'Picked up',
    type: PartnerShipmentDto,
    example: { ...PARTNER_SHIPMENT_EXAMPLE, status: 'picked_up', pickedUpAt: '2026-10-20T08:00:00+07:00' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.payment_pending',
    'shipments.inspection_pending',
  )
  async dispatch(@CurrentActor() actor: Actor, @Param('shipmentId', ParseUUIDPipe) shipmentId: string) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.dispatch(actor, row.id);
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/events')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.updateStatus',
    summary: 'Report a delivery step of my own fleet',
    description:
      'In transit, out for delivery, failed attempt or returned (goods back at the factory; ship them again). ' +
      'Delivery itself is recorded with the proof of delivery. Carrier-booked shipments move by carrier callbacks.',
    implements: ['D-013'],
  })
  @ApiBody({ type: ShipmentStatusUpdateDto, examples: { default: { value: STATUS_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Updated',
    type: PartnerShipmentDto,
    example: { ...PARTNER_SHIPMENT_EXAMPLE, status: 'out_for_delivery' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async updateStatus(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: ShipmentStatusUpdateDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.updateStatus(
      actor,
      row.id,
      { ...body, occurredAt: when(body.occurredAt) },
      'factory',
    );
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/proof-of-delivery')
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.recordPod',
    summary: 'Record the proof of delivery',
    description: POD_DESCRIPTION,
    implements: ['D-013', 'D-021', 'D-080', 'D-165'],
  })
  @ApiBody({ type: RecordPodDto, examples: { default: { value: POD_BODY_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Delivered',
    type: PartnerShipmentDto,
    example: { ...PARTNER_SHIPMENT_EXAMPLE, status: 'delivered', proofOfDelivery: POD_EXAMPLE },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.pod_required',
    'shipments.delivered_quantity_invalid',
    'shipments.payment_pending',
    'shipments.inspection_pending',
    'artwork.file_not_usable',
  )
  async recordPod(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: RecordPodDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    const { carrierPodRef: _staffOnly, ...input } = body;
    await this.delivery.recordPod(actor, row.id, { ...input, capturedAt: when(body.capturedAt) });
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.cancel',
    summary: 'Cancel a shipment before pickup',
    description: 'Draft or packed only; the goods count as unshipped again and the labels’ tracking stops.',
    implements: ['D-013'],
  })
  @ApiBody({ type: CancelShipmentDto, examples: { default: { value: CANCEL_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: PartnerShipmentDto,
    example: { ...PARTNER_SHIPMENT_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: CancelShipmentDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.cancel(actor, row.id, body.reason);
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/actions/request-carrier')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'partner.shipments.requestCarrier',
    summary: 'Ask Packio for a carrier',
    description:
      'For a packed trip our own fleet cannot serve (D-013 fallback, D-114): recorded with the reason and raised to ' +
      'Packio Logistics, who book the carrier. We never book a carrier ourselves. Once per trip (409 otherwise).',
    implements: ['D-013', 'D-114'],
  })
  @ApiBody({
    type: RequestCarrierDto,
    examples: { default: { value: { reason: 'รถโรงงานไม่วิ่งเชียงราย' } } },
  })
  @ApiSuccess(200, {
    description: 'Requested',
    type: PartnerShipmentDto,
    example: {
      ...PARTNER_SHIPMENT_EXAMPLE,
      carrierRequest: { requestedAt: '2026-10-19T17:00:00+07:00', reason: 'รถโรงงานไม่วิ่งเชียงราย' },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async requestCarrier(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: RequestCarrierDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    if (actor.type !== 'user') throw new DomainException('auth.forbidden');
    await this.shipments.requestCarrier(actor, row.id, body.reason);
    return this.dto(actor, shipmentId);
  }
}

const PARTNER_VIEWS: Record<NonNullable<PartnerShipmentListQuery['view']>, Prisma.ShipmentWhereInput> = {
  open: { status: { in: ['draft', 'ready'] } },
  in_transit: { status: { in: ['picked_up', 'in_transit', 'out_for_delivery'] } },
  delivered: { status: 'delivered' },
  exceptions: { status: { in: ['failed', 'returned'] } },
};

@ApiSurface('partner', 'logistics')
@Controller('factories/:factoryId')
export class PartnerShipPlanController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly access: FactoryAccess,
  ) {}

  @Get('ship-plan')
  @Can('factory_shipments.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.shipments.shipPlan',
    summary: 'What my factory can ship',
    description:
      'Completed jobs whose orders are not delivered yet: per destination the pieces already on live trips and what ' +
      'remains, and whether pickup would be refused today (instalments before shipping, Packio inspection — the ' +
      'checks of dispatch, B3.2 / D-076). Destination contacts only (D-142).',
    implements: ['D-013', 'D-076', 'D-142'],
  })
  @ApiSuccess(200, { description: 'Plan', type: [ShipPlanJobDto], example: [SHIP_PLAN_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async shipPlan(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<ShipPlanJobDto[]> {
    const factory = await this.access.factory(actor, factoryId);
    return (await this.shipments.shipPlan(factory.id)).map(({ job, blockedReason, destinations }) => ({
      jobId: job.publicId,
      jobNo: job.jobNo,
      orderCode: job.order.orderCode,
      quantityOrdered: job.quantityOrdered,
      quantityGood: job.quantityGood,
      blockedReason,
      destinations: destinations.map(({ destination: d, shipped, remaining }) => ({
        destinationId: d.publicId,
        recipientName: d.recipientName,
        postcode: d.postcode,
        provinceNameTh: d.province.nameTh,
        quantity: d.quantity,
        shippedQuantity: shipped,
        remainingQuantity: remaining,
      })),
    }));
  }
}

// =====================================================================================================
// Admin
// =====================================================================================================

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'logistics')
@Controller()
export class AdminShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly delivery: DeliveryService,
    private readonly query: ShipmentsQueryService,
    private readonly permissions: PermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  private async canSeeCost(actor: Actor): Promise<boolean> {
    return (
      actor.type === 'user' &&
      (await this.permissions.forUser(actor.userId)).permissions.has('factory_buy_prices.read')
    );
  }

  private async dtos(actor: Actor, rows: ShipmentRow[]) {
    const [perms, photos, blocked] = await Promise.all([
      permissionsOf(this.permissions, actor),
      this.query.podPhotos(rows),
      this.shipments.blockedByPayment(rows),
    ]);
    const cost = perms.has('factory_buy_prices.read');
    return rows.map((r) => adminShipmentDto(r, { cost }, photos.get(r.id), blocked.has(r.id), perms));
  }

  private async dto(actor: Actor, publicId: string, res?: Response) {
    const row = await this.query.get(actor, publicId);
    res?.setHeader('ETag', shipmentEtag(row));
    return (await this.dtos(actor, [row]))[0]!;
  }

  @Get('shipments')
  @Can('shipments.read')
  @ApiEndpoint({
    id: 'admin.shipments.list',
    summary: 'List shipments',
    description:
      'Newest first; payout and carrier cost only with `factory_buy_prices.read` (D-141). `queue` picks a work queue ' +
      '(awaiting pickup, in transit, delivery exceptions D-230, POD reviews D-229); `carrier` and `factoryId` ' +
      'narrow it.',
    implements: ['D-013', 'D-141', 'D-229', 'D-230'],
  })
  @ApiPaginated(AdminShipmentDto, { example: ADMIN_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: AdminShipmentListQuery) {
    const [rows, total] = await this.query.list(actor, adminListWhere(q), q.page, q.perPage);
    return { data: await this.dtos(actor, rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('shipments/:shipmentId')
  @Can('shipments.read')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.get',
    summary: 'Get a shipment',
    description:
      'Items, cartons, events, POD with its review (D-229), the delivery exception (D-230), carrier booking, ' +
      'whether unpaid instalments block pickup (B3.2); costs per D-141. The `ETag` guards the staff actions.',
    implements: ['D-013', 'D-141', 'D-229', 'D-230'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Shipment', type: AdminShipmentDto, example: ADMIN_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dto(actor, shipmentId, res);
  }

  @Post('shipments/:shipmentId/actions/book-carrier')
  @HttpCode(200)
  @Idempotent()
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.bookCarrier',
    summary: 'Book a fallback carrier',
    description:
      'Where the factory’s fleet cannot serve the area (D-013, D-114): Packio’s carrier account books the ' +
      'pickup at the factory for a packed shipment; the carrier’s quote is kept as Packio’s cost (P25). The ' +
      'shipping gate applies. Carrier callbacks then move the shipment; delivery by carrier POD. An optional ' +
      '`reason` is kept on the event and the audit trail.',
    implements: ['D-013', 'D-114'],
  })
  @ApiConcurrency({ optional: true })
  @ApiBody({
    type: BookCarrierDto,
    examples: { default: { value: { carrier: 'flash_express', reason: 'โรงงานไม่มีรถวิ่งเชียงราย' } } },
  })
  @ApiSuccess(200, {
    description: 'Booked',
    type: AdminShipmentDto,
    example: {
      ...ADMIN_SHIPMENT_EXAMPLE,
      carrier: 'flash_express',
      carrierBookingRef: 'FLASH-1',
      trackingNo: 'TH0123',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.carrier_unavailable',
    'shipments.payment_pending',
    'shipments.inspection_pending',
    'provider.unavailable',
  )
  async bookCarrier(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: BookCarrierDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.bookCarrier(staff(actor), row.id, body.carrier, when(body.pickupAt), {
      reason: body.reason,
      ifMatch,
    });
    return this.dto(actor, shipmentId, res);
  }

  @Post('shipments/:shipmentId/carrier-quotes')
  @HttpCode(200)
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.carrierQuotes',
    summary: 'Quote the fallback carriers for a shipment',
    description:
      'Every fallback carrier’s quote for this trip — pickup at the factory, the destination, one parcel per ' +
      'carton (D-114) — before booking; a carrier that is not enabled, has no account or cannot quote comes back ' +
      'unavailable with the reason. Amounts are Packio’s cost, shown only with `factory_buy_prices.read` (D-141). ' +
      'Nothing is booked or stored.',
    implements: ['D-013', 'D-114', 'D-141'],
  })
  @ApiSuccess(200, {
    description: 'Quotes',
    type: [ShipmentCarrierQuoteDto],
    example: [
      {
        carrier: 'deliveree',
        available: false,
        amount: null,
        transitDays: null,
        reason: 'not enabled',
        currency: 'THB',
      },
      {
        carrier: 'flash_express',
        available: true,
        amount: '85.00',
        transitDays: 2,
        reason: null,
        currency: 'THB',
      },
    ],
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.carrier_unavailable',
  )
  async carrierQuotes(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
  ): Promise<ShipmentCarrierQuoteDto[]> {
    const row = await this.query.get(actor, shipmentId);
    const [quotes, cost] = await Promise.all([this.shipments.carrierQuotes(row.id), this.canSeeCost(actor)]);
    return quotes.map((q) => ({
      carrier: q.carrier,
      available: q.reason === null,
      amount: cost && q.amount ? formatMoney(q.amount) : null,
      transitDays: q.transitDays,
      reason: q.reason,
      currency: 'THB',
    }));
  }

  @Post('shipments/:shipmentId/actions/resolve-exception')
  @HttpCode(200)
  @Idempotent({ optional: true })
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.resolveException',
    summary: 'Resolve a failed or returned delivery',
    description:
      'D-230: a failed delivery → `retry` (in transit again for another attempt) or `return` (the goods go back ' +
      'to the factory and their quantity can ship again on a new trip); a returned shipment is closed as `retry` ' +
      '(it ships again on a new trip) or `cancel` (it will not be delivered). With a reason; audited, event ' +
      '`shipment.exception_resolved`.',
    implements: ['D-230', 'D-013'],
  })
  @ApiConcurrency({ optional: true })
  @ApiBody({
    type: ResolveShipmentExceptionDto,
    examples: { default: { value: { resolution: 'retry', reason: 'ลูกค้านัดรับใหม่พรุ่งนี้' } } },
  })
  @ApiSuccess(200, {
    description: 'Resolved',
    type: AdminShipmentDto,
    example: {
      ...ADMIN_SHIPMENT_EXAMPLE,
      status: 'in_transit',
      pickedUpAt: '2026-10-20T10:00:00+07:00',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async resolveException(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: ResolveShipmentExceptionDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.resolveException(staff(actor), row.id, body.resolution, body.reason, ifMatch);
    return this.dto(actor, shipmentId, res);
  }

  @Post('shipments/:shipmentId/actions/split')
  @Idempotent({ optional: true })
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.split',
    summary: 'Split a draft shipment',
    description:
      'Moves pieces (per destination) with their cartons and weight to a new draft shipment to the same address ' +
      'from the same factory (D-230); at least one piece, carton and gram stays. A packed shipment is not split ' +
      '(labels, tracking link and payout are frozen): cancel and re-pack it. Audited, events `shipment.split` ' +
      'and `shipment.created`.',
    implements: ['D-230', 'D-013'],
  })
  @ApiConcurrency({ optional: true })
  @ApiBody({
    type: SplitShipmentDto,
    examples: {
      default: {
        value: {
          items: [{ destinationId: SHIPMENT_IDS.destination, quantity: 200 }],
          cartonsCount: 1,
          weightG: 6000,
          reason: 'แยกส่งสองรอบ รถเล็ก',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'The original and the new shipment',
    type: SplitShipmentResultDto,
    example: {
      shipment: { ...ADMIN_SHIPMENT_EXAMPLE, status: 'draft', readyAt: null, cartons: [], cartonsCount: 2 },
      created: {
        ...ADMIN_SHIPMENT_EXAMPLE,
        id: '0192f3a0-7c1e-7d2a-9b1f-0000000f2008',
        shipmentNo: 'SH-2610-0002',
        status: 'draft',
        readyAt: null,
        cartons: [],
        cartonsCount: 1,
        weightG: 6000,
        splitFrom: { id: SHIPMENT_IDS.shipment, shipmentNo: 'SH-2610-0001' },
      },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async split(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: SplitShipmentDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SplitShipmentResultDto> {
    const row = await this.query.get(actor, shipmentId);
    const created = await this.shipments.split(staff(actor), row.id, body, ifMatch);
    return { shipment: await this.dto(actor, shipmentId, res), created: await this.dto(actor, created) };
  }

  @Post('shipments/:shipmentId/pod/actions/:decision')
  @HttpCode(200)
  @Can('shipments.manage')
  @shipmentParam
  @ApiParam({ name: 'decision', enum: ['accept', 'reject'], enumName: 'PodReviewAction' })
  @ApiEndpoint({
    id: 'admin.shipments.reviewPod',
    summary: 'Accept or reject a proof of delivery',
    description:
      'A staff check of the recorded POD (D-229): `reject` needs a note and raises `shipment.pod_rejected` for ' +
      'follow-up; neither changes the delivery, the tolerance reconciliation or the payout rule (D-022). ' +
      'Reviews are kept; the latest is the POD’s state.',
    implements: ['D-229', 'D-013', 'D-022'],
  })
  @ApiConcurrency({ optional: true })
  @ApiBody({ type: ReviewPodDto, examples: { default: { value: { note: 'ลายเซ็นไม่ชัด' } } } })
  @ApiSuccess(200, {
    description: 'Reviewed',
    type: AdminShipmentDto,
    example: {
      ...ADMIN_SHIPMENT_EXAMPLE,
      status: 'delivered',
      proofOfDelivery: POD_EXAMPLE,
      podReview: {
        state: 'rejected',
        note: 'ลายเซ็นไม่ชัด',
        reviewedAt: '2026-10-22T10:00:00+07:00',
        reviewedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f2009', displayName: 'Dev Logistics' },
      },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async reviewPod(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Param('decision') decision: string,
    @Body() body: ReviewPodDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (decision !== 'accept' && decision !== 'reject') throw new DomainException('http.not_found');
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.reviewPod(
      staff(actor),
      row.id,
      decision === 'accept' ? 'accepted' : 'rejected',
      body.note ?? null,
      ifMatch,
    );
    return this.dto(actor, shipmentId, res);
  }

  @Post('shipments/:shipmentId/events')
  @HttpCode(200)
  @Idempotent()
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.updateStatus',
    summary: 'Correct a shipment’s transit status',
    description: 'Staff correction for any carrier (recorded as a staff event); delivery needs a POD.',
    implements: ['D-013', 'D-114'],
  })
  @ApiBody({ type: ShipmentStatusUpdateDto, examples: { default: { value: STATUS_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Updated',
    type: AdminShipmentDto,
    example: { ...ADMIN_SHIPMENT_EXAMPLE, status: 'out_for_delivery' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
  )
  async updateStatus(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: ShipmentStatusUpdateDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.updateStatus(
      staff(actor),
      row.id,
      { ...body, occurredAt: when(body.occurredAt) },
      'staff',
    );
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/proof-of-delivery')
  @Idempotent()
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.recordPod',
    summary: 'Record a proof of delivery on the factory’s or carrier’s behalf',
    description: `${POD_DESCRIPTION} Staff may instead record a carrier POD with \`carrierPodRef\`.`,
    implements: ['D-013', 'D-021', 'D-080', 'D-165'],
  })
  @ApiBody({ type: RecordPodDto, examples: { default: { value: POD_BODY_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Delivered',
    type: AdminShipmentDto,
    example: { ...ADMIN_SHIPMENT_EXAMPLE, status: 'delivered', proofOfDelivery: POD_EXAMPLE },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.pod_required',
    'shipments.delivered_quantity_invalid',
    'shipments.payment_pending',
    'shipments.inspection_pending',
    'artwork.file_not_usable',
  )
  async recordPod(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: RecordPodDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.delivery.recordPod(staff(actor), row.id, { ...body, capturedAt: when(body.capturedAt) });
    return this.dto(actor, shipmentId);
  }

  @Post('shipments/:shipmentId/actions/cancel')
  @HttpCode(200)
  @Idempotent()
  @Can('shipments.manage')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.cancel',
    summary: 'Cancel a shipment before pickup',
    description: 'Draft or packed only; a booked fallback carrier is cancelled with the carrier first.',
    implements: ['D-013', 'D-114'],
  })
  @ApiBody({ type: CancelShipmentDto, examples: { default: { value: CANCEL_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'Cancelled',
    type: AdminShipmentDto,
    example: { ...ADMIN_SHIPMENT_EXAMPLE, status: 'cancelled' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipments.invalid_status',
    'shipments.carrier_unavailable',
    'provider.unavailable',
  )
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() body: CancelShipmentDto,
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.cancel(staff(actor), row.id, body.reason);
    return this.dto(actor, shipmentId);
  }

  @Get('orders/:orderId/delivery-reconciliation')
  @Can('shipments.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.shipments.reconciliation',
    summary: 'Get an order’s delivery reconciliation',
    description:
      'Delivered vs ordered with the tolerance frozen in the quote (D-021, D-080), the pro-rata credit and the ' +
      'factory payable quantity (D-165). 404 until the order is delivered.',
    implements: ['D-021', 'D-080', 'D-165'],
  })
  @ApiSuccess(200, {
    description: 'Reconciliation',
    type: DeliveryReconciliationDto,
    example: RECONCILIATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async reconciliation(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const r = await this.prisma.deliveryReconciliation.findFirst({ where: { order: { publicId: orderId } } });
    if (!r) throw new DomainException('http.not_found');
    return reconciliationDto(r);
  }
}

// =====================================================================================================
// Store (the customer's own orders)
// =====================================================================================================

function customerId(actor: Actor): bigint {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor.userId;
}

@ApiSurface('store', 'logistics')
@Controller()
export class StoreShipmentsController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly orders: OrdersService,
    private readonly query: ShipmentsQueryService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('orders/:orderId/shipments')
  @orderParam
  @ApiEndpoint({
    id: 'store.shipments.list',
    summary: 'List the shipments of my order',
    description:
      'Split and multi-destination deliveries with their steps and proof of delivery; no factory identity or ' +
      'costs (D-050). Cancelled trips are left out.',
    implements: ['D-050', 'D-013'],
  })
  @ApiSuccess(200, { description: 'Shipments', type: [StoreShipmentDto], example: [STORE_SHIPMENT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    const order = await this.orders.order({ publicId: orderId }, customerId(actor));
    const rows = await this.prisma.shipment.findMany({
      where: { items: { some: { orderId: order.id } }, status: { notIn: ['draft', 'cancelled'] } },
      include: SHIPMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const photos = await this.query.podPhotos(rows);
    return rows.map((r) => storeShipmentDto(r, order.id, photos.get(r.id)));
  }

  @Post('orders/:orderId/actions/confirm-receipt')
  @HttpCode(200)
  @Idempotent()
  @orderParam
  @ApiEndpoint({
    id: 'store.orders.confirmReceipt',
    summary: 'Confirm I received my order',
    description:
      'Completes a delivered order now instead of 7 days after delivery (D-081). Irreversible; claims stay ' +
      'possible within the claim window (D-082).',
    implements: ['D-081', 'D-082'],
  })
  @ApiSuccess(200, {
    description: 'Completed',
    type: OrderDto,
    example: { ...ORDER_EXAMPLE, status: 'completed' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'order.invalid_transition')
  async confirmReceipt(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    const customer = customerId(actor);
    await this.delivery.confirmReceipt(actor, orderId, customer);
    return orderDto(
      await this.orders.order({ publicId: orderId }, customer),
      await orderViewContext(this.settings),
    );
  }
}

function adminListWhere(q: AdminShipmentListQuery): Prisma.ShipmentWhereInput {
  return {
    AND: [
      listWhere(q),
      q.queue ? QUEUES[q.queue] : {},
      {
        ...(q.carrier && { carrier: { code: q.carrier } }),
        ...(q.factoryId && { factory: { publicId: q.factoryId } }),
      },
    ],
  };
}

function listWhere(q: ShipmentListQuery): Prisma.ShipmentWhereInput {
  return {
    ...(q.status && { status: q.status }),
    ...(q.orderId && { items: { some: { order: { publicId: q.orderId } } } }),
  };
}

function when(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}
