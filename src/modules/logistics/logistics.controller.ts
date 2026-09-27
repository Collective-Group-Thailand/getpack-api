import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { orderDto } from '@modules/orders/order-views';
import { ORDER_EXAMPLE, OrderDto } from '@modules/orders/orders.dto';
import { OrdersService } from '@modules/orders/orders.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { DeliveryService } from './delivery.service';
import {
  ADMIN_SHIPMENT_EXAMPLE,
  AdminShipmentDto,
  BookCarrierDto,
  CancelShipmentDto,
  CreateShipmentDto,
  DeliveryReconciliationDto,
  PARTNER_SHIPMENT_EXAMPLE,
  PartnerShipmentDto,
  POD_EXAMPLE,
  RECONCILIATION_EXAMPLE,
  RecordPodDto,
  SHIPMENT_IDS,
  ShipmentListQuery,
  ShipmentStatusUpdateDto,
  STORE_SHIPMENT_EXAMPLE,
  StoreShipmentDto,
} from './logistics.dto';
import {
  adminShipmentDto,
  partnerShipmentDto,
  reconciliationDto,
  SHIPMENT_INCLUDE,
  type ShipmentRow,
  storeShipmentDto,
} from './shipment-views';
import { ShipmentsService } from './shipments.service';
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
  ) {}

  private async dto(actor: Actor, publicId: string) {
    const row = await this.query.get(actor, publicId);
    return partnerShipmentDto(row, (await this.query.podPhotos([row])).get(row.id));
  }

  @Get('shipments')
  @Can('factory_shipments.read')
  @ApiEndpoint({
    id: 'partner.shipments.list',
    summary: 'List my factory’s shipments',
    description: 'Newest first; destination contacts only (D-142), no prices.',
    implements: ['D-013', 'D-142'],
  })
  @ApiPaginated(PartnerShipmentDto, { example: PARTNER_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ShipmentListQuery) {
    const [rows, total] = await this.query.list(actor, listWhere(q), q.page, q.perPage);
    const photos = await this.query.podPhotos(rows);
    return {
      data: rows.map((r) => partnerShipmentDto(r, photos.get(r.id))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
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

  private async dtos(actor: Actor, rows: ShipmentRow[]) {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    const photos = await this.query.podPhotos(rows);
    return rows.map((r) => adminShipmentDto(r, { cost: granted.has('factory_cost.read') }, photos.get(r.id)));
  }

  private async dto(actor: Actor, publicId: string) {
    return (await this.dtos(actor, [await this.query.get(actor, publicId)]))[0]!;
  }

  @Get('shipments')
  @Can('shipments.read')
  @ApiEndpoint({
    id: 'admin.shipments.list',
    summary: 'List shipments',
    description: 'Newest first; payout and carrier cost only with `factory_cost.read` (D-141).',
    implements: ['D-013', 'D-141'],
  })
  @ApiPaginated(AdminShipmentDto, { example: ADMIN_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ShipmentListQuery) {
    const [rows, total] = await this.query.list(actor, listWhere(q), q.page, q.perPage);
    return { data: await this.dtos(actor, rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('shipments/:shipmentId')
  @Can('shipments.read')
  @shipmentParam
  @ApiEndpoint({
    id: 'admin.shipments.get',
    summary: 'Get a shipment',
    description: 'Items, events, POD, carrier booking; costs per D-141.',
    implements: ['D-013', 'D-141'],
  })
  @ApiSuccess(200, { description: 'Shipment', type: AdminShipmentDto, example: ADMIN_SHIPMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('shipmentId', ParseUUIDPipe) shipmentId: string) {
    return this.dto(actor, shipmentId);
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
      'shipping gate applies. Carrier callbacks then move the shipment; delivery by carrier POD.',
    implements: ['D-013', 'D-114'],
  })
  @ApiBody({ type: BookCarrierDto, examples: { default: { value: { carrier: 'flash_express' } } } })
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
  ) {
    const row = await this.query.get(actor, shipmentId);
    await this.shipments.bookCarrier(staff(actor), row.id, body.carrier, when(body.pickupAt));
    return this.dto(actor, shipmentId);
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
    return orderDto(await this.orders.order({ publicId: orderId }, customer));
  }
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
