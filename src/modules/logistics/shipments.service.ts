import { createHash, randomBytes } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Shipment, type ShipmentStatus } from '@generated/prisma/client';
import { type FallbackCarrierCode } from '@integrations/carriers/carrier-adapter.port';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { JobsQueryService } from '@modules/production/jobs-query.service';
import { CarriersService } from '@modules/shipping/carriers/carriers.service';
import { ShippingRatesResolver } from '@modules/shipping/rates/shipping-rates.resolver';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { renderLabelsHtml, renderPackingListHtml, type ShipmentDocument } from './shipment-documents';

export interface ShipmentInput {
  items: { jobId: string; destinationId: string; quantity: number }[];
  cartonsCount: number;
  weightG: number;
  volumeCm3?: number;
  plannedShipOn?: string;
  note?: string;
}

export interface TransitUpdate {
  status: 'in_transit' | 'out_for_delivery' | 'failed' | 'returned';
  occurredAt?: Date;
  location?: string;
  note?: string;
}

/** Goods on these shipments no longer count as shipped (they come back or never left). */
export const NOT_SHIPPED: ShipmentStatus[] = ['cancelled', 'returned'];
export const IN_TRANSIT: ShipmentStatus[] = ['picked_up', 'in_transit', 'out_for_delivery', 'failed'];

/** Allowed moves between pickup and delivery (delivery itself needs a proof of delivery). */
export const TRANSITIONS: Partial<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  picked_up: ['in_transit', 'out_for_delivery', 'failed', 'returned'],
  in_transit: ['in_transit', 'out_for_delivery', 'failed', 'returned'],
  out_for_delivery: ['in_transit', 'out_for_delivery', 'failed', 'returned'],
  failed: ['in_transit', 'out_for_delivery', 'returned'],
};

export const hashToken = (token: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash('sha256').update(token).digest());

/**
 * Shipments (D-013, D-114, D-142): the factory ships completed jobs with its own fleet by default — one
 * shipment is one trip to one address, split across trips and destinations as needed, never more than the
 * job made. Ready = packed: carton labels (100 × 150 mm, QR → public tracking) and a packing list are
 * generated and the factory's shipping payout is frozen from its rate card. Pickup is the shipping gate:
 * instalments due before shipping paid (B3.2) and a required Packio inspection passed (D-076); it records
 * the order's `shipped` fact. Where the factory cannot serve an area, staff book a fallback carrier whose
 * callbacks move the shipment. Every change: one transaction, activity + domain event.
 */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly jobs: JobsQueryService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly orders: OrdersService,
    private readonly schedules: PaymentSchedulesService,
    private readonly rates: ShippingRatesResolver,
    private readonly carriers: CarriersService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    @Inject(PDF_RENDERER) private readonly pdf: PdfRenderer,
  ) {}

  // --- create -------------------------------------------------------------------------------------------

  async create(actor: Actor, input: ShipmentInput): Promise<string> {
    const destinationIds = input.items.map((i) => i.destinationId);
    if (new Set(destinationIds).size !== destinationIds.length)
      throw new DomainException('validation.failed', {
        params: { detail: 'each destination appears once per shipment' },
      });
    return this.prisma.withTx(async (tx) => {
      const jobs = new Map<string, Awaited<ReturnType<JobsQueryService['get']>>>();
      for (const id of new Set(input.items.map((i) => i.jobId)))
        jobs.set(id, await this.jobs.get(actor, id, tx));
      const factoryIds = new Set([...jobs.values()].map((j) => j.factoryId));
      if (factoryIds.size !== 1)
        throw new DomainException('validation.failed', { params: { detail: 'one factory per shipment' } });
      for (const job of jobs.values()) {
        if (job.status !== 'completed' || job.jobKind === 'mockup')
          throw new DomainException('shipments.job_not_shippable', { params: { status: job.status } });
      }
      const rows = input.items.map((item) => {
        const job = jobs.get(item.jobId)!;
        const destination = job.order.destinations.find((d) => d.publicId === item.destinationId);
        if (!destination) throw new DomainException('http.not_found');
        return { item, job, destination };
      });
      const first = rows[0]!.destination;
      const same = (d: typeof first) =>
        d.recipientName === first.recipientName &&
        d.phone === first.phone &&
        d.line1 === first.line1 &&
        (d.line2 ?? null) === (first.line2 ?? null) &&
        (d.subdistrictId ?? null) === (first.subdistrictId ?? null) &&
        d.postcode === first.postcode &&
        d.provinceId === first.provinceId;
      if (!rows.every((r) => same(r.destination))) throw new DomainException('shipments.destinations_differ');

      // Never more than the job made (serialised per job: concurrent trips cannot both take the rest).
      for (const job of jobs.values()) {
        await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${job.id} FOR UPDATE`;
        const shipped = await tx.shipmentItem.aggregate({
          where: { productionJobId: job.id, shipment: { status: { notIn: NOT_SHIPPED } } },
          _sum: { quantity: true },
        });
        const available = (job.quantityGood ?? job.quantityOrdered) - (shipped._sum.quantity ?? 0);
        const wanted = rows.filter((r) => r.job.id === job.id).reduce((a, r) => a + r.item.quantity, 0);
        if (wanted > available)
          throw new DomainException('shipments.quantity_exceeds', {
            params: { available: Math.max(available, 0) },
          });
      }

      const job0 = rows[0]!.job;
      const carrier = await tx.carrier.findUniqueOrThrow({ where: { code: 'factory_fleet' } });
      const at = new Date();
      const shipment = await tx.shipment.create({
        data: {
          shipmentNo: await this.numbering.next(tx, 'shipment', at, job0.entityId),
          entityId: job0.entityId,
          factoryId: job0.factoryId,
          carrierId: carrier.id,
          recipientName: first.recipientName,
          phone: first.phone,
          line1: first.line1,
          line2: first.line2,
          subdistrictId: first.subdistrictId,
          postcode: first.postcode,
          provinceId: first.provinceId,
          cartonsCount: input.cartonsCount,
          weightG: input.weightG,
          volumeCm3: input.volumeCm3 === undefined ? null : BigInt(input.volumeCm3),
          plannedShipOn: input.plannedShipOn ? new Date(`${input.plannedShipOn}T00:00:00Z`) : null,
          note: input.note ?? null,
          createdById: actor.type === 'user' ? actor.userId : null,
          items: {
            create: rows.map((r) => ({
              orderId: r.job.orderId,
              orderDestinationId: r.destination.id,
              productionJobId: r.job.id,
              quantity: r.item.quantity,
            })),
          },
        },
      });
      await this.addEvent(tx, shipment.id, 'draft', at, actor, {});
      await this.record(
        tx,
        shipment,
        'shipment.created',
        {
          items: rows.map((r) => ({
            jobId: r.job.publicId,
            orderId: r.job.order.publicId,
            quantity: r.item.quantity,
          })),
          cartonsCount: input.cartonsCount,
        },
        actor,
      );
      return shipment.publicId;
    });
  }

  // --- ready (packed) ---------------------------------------------------------------------------------------

  /** Packed: cartons, labels with the tracking QR, the packing list and the frozen shipping payout. */
  async markReady(actor: Actor, shipmentId: bigint): Promise<void> {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: {
        items: { include: { order: true, productionJob: true } },
      },
    });
    if (shipment.status !== 'draft')
      throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
    const at = new Date();
    const token = randomBytes(24).toString('base64url');
    const cartons = Array.from({ length: shipment.cartonsCount }, (_, i) => ({
      seq: i + 1,
      labelCode: `${randomBytes(6).toString('hex').toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
    }));
    const doc: ShipmentDocument = {
      shipmentNo: shipment.shipmentNo,
      trackingUrl: this.trackingUrl(token),
      sender: await this.sender(shipment.entityId, at),
      recipient: {
        name: shipment.recipientName,
        phone: shipment.phone,
        line1: shipment.line1,
        line2: shipment.line2,
        postcode: shipment.postcode,
      },
      cartons,
      items: shipment.items.map((i) => ({
        orderCode: i.order.orderCode,
        description:
          ((i.productionJob.specSnapshot as { productTypeNameTh?: string }).productTypeNameTh ?? '') +
          ` (${i.productionJob.jobNo})`,
        quantity: i.quantity,
      })),
      totalWeightKg: (shipment.weightG / 1000).toFixed(2),
      plannedShipOn: shipment.plannedShipOn?.toISOString().slice(0, 10) ?? null,
      note: shipment.note,
    };
    // Rendered and stored first: a rolled-back transaction leaves only unreferenced objects.
    const [labels, packingList] = await Promise.all([
      this.pdf.render(await renderLabelsHtml(doc)),
      this.pdf.render(renderPackingListHtml(doc)),
    ]);
    const store = (body: Buffer, kind: string) =>
      this.files.storeSystem({
        body,
        fileName: `${shipment.shipmentNo}-${kind}.pdf`,
        mimeType: 'application/pdf',
        retentionClass: 'standard',
        ownerUserId: null,
        ownerFactoryId: shipment.factoryId,
      });
    const [labelFile, packingFile] = await Promise.all([
      store(labels, 'labels'),
      store(packingList, 'packing-list'),
    ]);
    const payout = await this.rates.factoryPayout(
      shipment.factoryId,
      shipment.postcode,
      {
        weightG: shipment.weightG,
        volumeCm3: shipment.volumeCm3 === null ? null : Number(shipment.volumeCm3),
      },
      at,
    );

    await this.prisma.withTx(async (tx) => {
      const moved = await tx.shipment.updateMany({
        where: { id: shipment.id, status: 'draft', rowVersion: shipment.rowVersion },
        data: {
          status: 'ready',
          statusChangedAt: at,
          readyAt: at,
          labelFileId: labelFile.id,
          packingListFileId: packingFile.id,
          ...(payout.priced && {
            factoryPayoutVersionId: payout.versionId,
            payoutAmount: payout.net.toFixed(2),
          }),
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      if (moved.count === 0)
        throw new DomainException('shipments.invalid_status', { params: { status: 'ready' } });
      await tx.shipmentCarton.createMany({ data: cartons.map((c) => ({ shipmentId: shipment.id, ...c })) });
      await tx.trackingLink.create({
        data: { tokenHash: hashToken(token), orderId: shipment.items[0]!.orderId, shipmentId: shipment.id },
      });
      await this.addEvent(tx, shipment.id, 'ready', at, actor, {});
      await this.record(
        tx,
        shipment,
        'shipment.ready',
        {
          cartonsCount: shipment.cartonsCount,
          payoutPriced: payout.priced,
        },
        actor,
      );
    });
  }

  // --- pickup (the shipping gate) -----------------------------------------------------------------------------

  /** Factory fleet picked the goods up: the gate is checked and the orders record `shipped`. */
  async dispatch(actor: Actor, shipmentId: bigint, at = new Date()): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      if (shipment.status !== 'ready')
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      const carrier = await tx.carrier.findUniqueOrThrow({ where: { id: shipment.carrierId } });
      if (carrier.code !== 'factory_fleet')
        throw new DomainException('shipments.invalid_status', {
          params: { status: `booked with ${carrier.code}` },
        });
      await this.assertShippable(tx, shipment.id);
      await this.pickedUp(tx, shipment, at, actor, 'factory');
    });
  }

  /** The shipping gate (B3.2 + D-076): every order paid for shipping, every required inspection passed. */
  async assertShippable(tx: Tx, shipmentId: bigint): Promise<void> {
    const items = await tx.shipmentItem.findMany({
      where: { shipmentId },
      include: { productionJob: { include: { inspections: true } } },
    });
    for (const orderId of new Set(items.map((i) => i.orderId))) {
      if (!(await this.schedules.canShip(orderId, tx)))
        throw new DomainException('shipments.payment_pending');
    }
    for (const item of items) {
      const job = item.productionJob;
      if (!job.inspectionRequired) continue;
      if (!job.inspections.some((i) => i.status === 'passed' || i.status === 'waived'))
        throw new DomainException('shipments.inspection_pending');
    }
  }

  async pickedUp(
    tx: Tx,
    shipment: Shipment,
    at: Date,
    actor: Actor,
    source: 'factory' | 'carrier_webhook' | 'staff',
    extra: EventExtra = {},
  ) {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: 'picked_up',
        statusChangedAt: at,
        pickedUpAt: at,
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    await this.addEvent(tx, shipment.id, 'picked_up', at, actor, extra, source);
    const orderIds = await tx.shipmentItem.findMany({
      where: { shipmentId: shipment.id },
      select: { orderId: true },
    });
    for (const orderId of new Set(orderIds.map((o) => o.orderId)))
      await this.orders.applyFact(tx, orderId, { kind: 'shipped' }, actor, at);
    await this.record(tx, shipment, 'shipment.picked_up', { source }, actor);
  }

  // --- in transit ---------------------------------------------------------------------------------------------

  async updateStatus(
    actor: Actor,
    shipmentId: bigint,
    update: TransitUpdate,
    source: 'factory' | 'staff',
  ): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      const carrier = await tx.carrier.findUniqueOrThrow({ where: { id: shipment.carrierId } });
      // A carrier's own callbacks move its shipments; the factory reports only its own fleet's trips.
      if (source === 'factory' && carrier.code !== 'factory_fleet')
        throw new DomainException('shipments.invalid_status', {
          params: { status: `booked with ${carrier.code}` },
        });
      await this.transition(tx, shipment, update.status, update.occurredAt ?? new Date(), actor, source, {
        location: update.location,
        note: update.note,
      });
    });
  }

  async transition(
    tx: Tx,
    shipment: Shipment,
    to: ShipmentStatus,
    at: Date,
    actor: Actor,
    source: 'factory' | 'carrier_webhook' | 'staff',
    extra: EventExtra,
  ) {
    if (!(TRANSITIONS[shipment.status] ?? []).includes(to))
      throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: to,
        statusChangedAt: at,
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    await this.addEvent(tx, shipment.id, to, at, actor, extra, source);
    await this.record(tx, shipment, 'shipment.status_changed', { from: shipment.status, to, source }, actor);
  }

  // --- cancel -----------------------------------------------------------------------------------------------

  /** Before pickup only; a booked carrier is cancelled first; tracking links stop working. */
  async cancel(actor: Actor, shipmentId: bigint, reason: string): Promise<void> {
    const current = await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (current.status !== 'draft' && current.status !== 'ready')
      throw new DomainException('shipments.invalid_status', { params: { status: current.status } });
    if (current.carrierBookingRef)
      await this.carriers.cancelBooking(current.carrierId, current.carrierBookingRef);
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      if (shipment.status !== 'draft' && shipment.status !== 'ready')
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      const at = new Date();
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: 'cancelled',
          statusChangedAt: at,
          cancelledAt: at,
          cancelReason: reason,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      await tx.trackingLink.updateMany({
        where: { shipmentId: shipment.id, revokedAt: null },
        data: { revokedAt: at },
      });
      await this.addEvent(tx, shipment.id, 'cancelled', at, actor, { note: reason });
      await this.record(tx, shipment, 'shipment.cancelled', { reason }, actor);
    });
  }

  // --- fallback carriers (D-114) ----------------------------------------------------------------------------

  /** Staff book a fallback carrier for a packed shipment the factory's fleet cannot deliver. */
  async bookCarrier(
    actor: UserActor,
    shipmentId: bigint,
    code: FallbackCarrierCode,
    pickupAt?: Date,
  ): Promise<void> {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { factory: { include: { addresses: true, contacts: true } }, carrier: true, cartons: true },
    });
    if (shipment.status !== 'ready' || shipment.carrier.code !== 'factory_fleet')
      throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
    await this.prisma.withTx((tx) => this.assertShippable(tx, shipment.id));
    const pickup =
      shipment.factory.addresses.find((a) => a.kind === 'pickup') ??
      shipment.factory.addresses.find((a) => a.kind === 'plant');
    const contact = shipment.factory.contacts.find((c) => c.isPrimary) ?? shipment.factory.contacts[0];
    if (!pickup?.postcode || !contact?.phone)
      throw new DomainException('shipments.carrier_unavailable', {
        params: { carrier: code, reason: 'the factory has no pickup address or contact phone' },
      });
    const perCarton = Math.max(1, Math.round(shipment.weightG / shipment.cartonsCount));
    const { booking, carrierId, costAmount } = await this.carriers.book(code, {
      reference: shipment.shipmentNo,
      from: {
        name: contact.name,
        phone: contact.phone,
        addressLine: [pickup.line1, pickup.line2].filter(Boolean).join(' '),
        postcode: pickup.postcode,
        lat: pickup.lat === null ? null : Number(pickup.lat),
        lng: pickup.lng === null ? null : Number(pickup.lng),
      },
      to: {
        name: shipment.recipientName,
        phone: shipment.phone,
        addressLine: [shipment.line1, shipment.line2].filter(Boolean).join(' '),
        postcode: shipment.postcode,
      },
      parcels: shipment.cartons.map((c) => ({ weightG: c.weightG ?? perCarton })),
      pickupAt: pickupAt ?? null,
    });
    await this.prisma.withTx(async (tx) => {
      const locked = await this.lock(tx, shipment.id);
      if (locked.status !== 'ready' || locked.carrierId !== shipment.carrierId)
        throw new DomainException('shipments.invalid_status', { params: { status: locked.status } });
      const at = new Date();
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          carrierId,
          carrierBookingRef: booking.bookingRef,
          trackingNo: booking.trackingNo,
          trackingUrl: booking.trackingUrl,
          bookedAt: at,
          carrierCostAmount: costAmount?.toFixed(2) ?? null,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.addEvent(tx, shipment.id, 'ready', at, actor, { note: `booked with ${code}` }, 'staff');
      await this.record(
        tx,
        locked,
        'shipment.carrier_booked',
        { carrier: code, trackingNo: booking.trackingNo },
        actor,
      );
    });
  }

  // --- helpers --------------------------------------------------------------------------------------------

  async lock(tx: Tx, shipmentId: bigint): Promise<Shipment> {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId} FOR UPDATE`;
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  }

  async addEvent(
    tx: Tx,
    shipmentId: bigint,
    status: ShipmentStatus,
    at: Date,
    actor: Actor,
    extra: EventExtra,
    source: 'factory' | 'carrier_webhook' | 'carrier_poll' | 'staff' = actor.type === 'user' &&
    actor.audience === 'staff'
      ? 'staff'
      : 'factory',
  ) {
    await tx.shipmentEvent.create({
      data: {
        shipmentId,
        occurredAt: at,
        status,
        source,
        location: extra.location ?? null,
        note: extra.note ?? null,
        carrierEventId: extra.carrierEventId ?? null,
        providerStatus: extra.providerStatus ?? null,
        recordedById: actor.type === 'user' ? actor.userId : null,
      },
    });
  }

  async record(
    tx: Tx,
    shipment: Shipment,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
    visibility: ('internal' | 'partner')[] = ['internal', 'partner'],
  ) {
    const factory = await tx.factory.findUniqueOrThrow({
      where: { id: shipment.factoryId },
      select: { publicId: true },
    });
    const orders = await tx.shipmentItem.findMany({
      where: { shipmentId: shipment.id },
      select: { order: { select: { publicId: true } } },
    });
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'shipment',
        aggregateId: shipment.publicId,
        entityId: shipment.entityId,
        payload: {
          shipmentId: shipment.publicId,
          shipmentNo: shipment.shipmentNo,
          factoryId: factory.publicId,
          orderIds: [...new Set(orders.map((o) => o.order.publicId))],
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'shipment',
      aggregatePublicId: shipment.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility,
      entityId: shipment.entityId,
      domainEventId: event.id,
      actor,
    });
  }

  trackingUrl(token: string): string {
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.packio.invalid';
    return `${web.replace(/\/$/, '')}/track/${token}`;
  }

  /** Sender on labels: the legal entity from settings under the Packio brand; never the factory (D-050). */
  private async sender(entityId: bigint, at: Date): Promise<ShipmentDocument['sender']> {
    const read = async (key: string): Promise<string | null> => {
      try {
        return String(
          (await this.settings.at(key as never, { at, scope: { type: 'entity', id: entityId } })).value,
        );
      } catch (error) {
        if (error instanceof SettingNotFoundError) return null;
        throw error;
      }
    };
    const name = await read('entity.legal_name_th');
    return { name: name ? `Packio · ${name}` : 'Packio', phone: await read('entity.phone') };
  }
}

export interface EventExtra {
  location?: string;
  note?: string;
  carrierEventId?: string;
  providerStatus?: string;
}
