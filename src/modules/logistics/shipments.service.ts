import { createHash, randomBytes } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Shipment, type ShipmentStatus } from '@generated/prisma/client';
import {
  type CarrierBookingRequest,
  type FallbackCarrierCode,
} from '@integrations/carriers/carrier-adapter.port';
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

export const shipmentEtag = (s: { publicId: string; rowVersion: number }) => etagOf(s.publicId, s.rowVersion);

/** D-230: what staff may do with a failed or returned delivery. */
const RESOLUTIONS: Partial<Record<ShipmentStatus, readonly ('retry' | 'return' | 'cancel')[]>> = {
  failed: ['retry', 'return'],
  returned: ['retry', 'cancel'],
};

export interface SplitInput {
  items: { destinationId: string; quantity: number }[];
  cartonsCount: number;
  weightG: number;
  volumeCm3?: number;
  reason: string;
}

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
        // A new failure or return is a new exception (D-230).
        ...((to === 'failed' || to === 'returned') && {
          exceptionResolution: null,
          exceptionResolvedAt: null,
          exceptionResolvedById: null,
          exceptionNote: null,
        }),
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
    opts: { reason?: string; ifMatch?: string } = {},
  ): Promise<void> {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { factory: { include: { addresses: true, contacts: true } }, carrier: true, cartons: true },
    });
    assertIfMatch(opts.ifMatch, shipmentEtag(shipment), { required: false });
    if (shipment.status !== 'ready' || shipment.carrier.code !== 'factory_fleet')
      throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
    await this.prisma.withTx((tx) => this.assertShippable(tx, shipment.id));
    const route = this.route(shipment, code);
    const { booking, carrierId, costAmount } = await this.carriers.book(code, {
      reference: shipment.shipmentNo,
      ...route,
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
      const note = opts.reason ? `booked with ${code}: ${opts.reason}` : `booked with ${code}`;
      await this.addEvent(tx, shipment.id, 'ready', at, actor, { note }, 'staff');
      await this.record(
        tx,
        locked,
        'shipment.carrier_booked',
        { carrier: code, trackingNo: booking.trackingNo, reason: opts.reason ?? null },
        actor,
      );
    });
  }

  /** Quotes of every fallback carrier for the trip, from the factory's pickup address (D-114). */
  async carrierQuotes(shipmentId: bigint) {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { factory: { include: { addresses: true, contacts: true } }, carrier: true, cartons: true },
    });
    if (shipment.status !== 'draft' && shipment.status !== 'ready')
      throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
    const { from, to, parcels } = this.route(shipment, 'fallback');
    return this.carriers.quoteAll({ from, to, parcels });
  }

  /** Pickup at the factory (pickup, else plant address; primary contact) to the destination, per carton. */
  private route(
    shipment: Shipment & {
      factory: {
        addresses: {
          kind: string;
          line1: string;
          line2: string | null;
          postcode: string | null;
          lat: { toString(): string } | null;
          lng: { toString(): string } | null;
        }[];
        contacts: { isPrimary: boolean; name: string; phone: string | null }[];
      };
      cartons: { weightG: number | null }[];
    },
    carrier: string,
  ): Pick<CarrierBookingRequest, 'from' | 'to' | 'parcels'> {
    const pickup =
      shipment.factory.addresses.find((a) => a.kind === 'pickup') ??
      shipment.factory.addresses.find((a) => a.kind === 'plant');
    const contact = shipment.factory.contacts.find((c) => c.isPrimary) ?? shipment.factory.contacts[0];
    if (!pickup?.postcode || !contact?.phone)
      throw new DomainException('shipments.carrier_unavailable', {
        params: { carrier, reason: 'the factory has no pickup address or contact phone' },
      });
    const perCarton = Math.max(1, Math.round(shipment.weightG / shipment.cartonsCount));
    return {
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
      parcels:
        shipment.cartons.length > 0
          ? shipment.cartons.map((c) => ({ weightG: c.weightG ?? perCarton }))
          : Array.from({ length: shipment.cartonsCount }, () => ({ weightG: perCarton })),
    };
  }

  // --- exceptions and splits (D-230) --------------------------------------------------------------------------

  /** failed → retry (in transit again) or return; returned → closed as retry (ships again) or cancel. */
  async resolveException(
    actor: UserActor,
    shipmentId: bigint,
    resolution: 'retry' | 'return' | 'cancel',
    reason: string,
    ifMatch?: string,
  ): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      assertIfMatch(ifMatch, shipmentEtag(shipment), { required: false });
      if (!(RESOLUTIONS[shipment.status] ?? []).includes(resolution))
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      const at = new Date();
      if (shipment.status === 'failed') {
        const to = resolution === 'retry' ? 'in_transit' : 'returned';
        await this.transition(tx, shipment, to, at, actor, 'staff', { note: reason });
      } else if (shipment.exceptionResolvedAt) {
        throw new DomainException('shipments.invalid_status', { params: { status: 'returned (closed)' } });
      }
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          exceptionResolution: resolution,
          exceptionResolvedAt: at,
          exceptionResolvedById: actor.userId,
          exceptionNote: reason,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        shipment,
        'shipment.exception_resolved',
        { from: shipment.status, resolution, reason },
        actor,
      );
    });
  }

  /** Moves pieces of a draft shipment to a new draft to the same address (D-230); returns the new one. */
  async split(actor: UserActor, shipmentId: bigint, input: SplitInput, ifMatch?: string): Promise<string> {
    const invalid = (path: string, message: string): never => {
      throw new DomainException('validation.failed', { errors: [{ path, code: 'split', message }] });
    };
    const destinationIds = input.items.map((i) => i.destinationId);
    if (new Set(destinationIds).size !== destinationIds.length)
      invalid('items', 'each destination appears once');
    return this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      assertIfMatch(ifMatch, shipmentEtag(shipment), { required: false });
      if (shipment.status !== 'draft')
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      const items = await tx.shipmentItem.findMany({
        where: { shipmentId: shipment.id },
        include: { orderDestination: { select: { publicId: true } } },
      });
      const moves = input.items.map((m, i) => {
        const item = items.find((x) => x.orderDestination.publicId === m.destinationId);
        if (!item) return invalid(`items.${i}.destinationId`, 'not on this shipment');
        if (m.quantity > item.quantity) invalid(`items.${i}.quantity`, `at most ${item.quantity}`);
        return { item, quantity: m.quantity };
      });
      const moved = moves.reduce((a, m) => a + m.quantity, 0);
      const total = items.reduce((a, i) => a + i.quantity, 0);
      if (moved >= total) invalid('items', 'at least one piece stays on the shipment');
      if (input.cartonsCount >= shipment.cartonsCount)
        invalid('cartonsCount', `fewer than the shipment's ${shipment.cartonsCount}`);
      if (input.weightG >= shipment.weightG)
        invalid('weightG', `less than the shipment's ${shipment.weightG}`);
      const volume = shipment.volumeCm3 === null ? null : Number(shipment.volumeCm3);
      if (input.volumeCm3 !== undefined && volume !== null && input.volumeCm3 >= volume)
        invalid('volumeCm3', `less than the shipment's ${volume}`);

      const at = new Date();
      const created = await tx.shipment.create({
        data: {
          shipmentNo: await this.numbering.next(tx, 'shipment', at, shipment.entityId),
          entityId: shipment.entityId,
          factoryId: shipment.factoryId,
          carrierId: shipment.carrierId,
          recipientName: shipment.recipientName,
          phone: shipment.phone,
          line1: shipment.line1,
          line2: shipment.line2,
          subdistrictId: shipment.subdistrictId,
          postcode: shipment.postcode,
          provinceId: shipment.provinceId,
          cartonsCount: input.cartonsCount,
          weightG: input.weightG,
          volumeCm3: input.volumeCm3 === undefined ? null : BigInt(input.volumeCm3),
          plannedShipOn: shipment.plannedShipOn,
          splitFromId: shipment.id,
          createdById: actor.userId,
        },
      });
      for (const { item, quantity } of moves) {
        if (quantity === item.quantity)
          await tx.shipmentItem.update({ where: { id: item.id }, data: { shipmentId: created.id } });
        else {
          await tx.shipmentItem.update({
            where: { id: item.id },
            data: { quantity: item.quantity - quantity },
          });
          await tx.shipmentItem.create({
            data: {
              shipmentId: created.id,
              orderId: item.orderId,
              orderDestinationId: item.orderDestinationId,
              productionJobId: item.productionJobId,
              quantity,
            },
          });
        }
      }
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          cartonsCount: shipment.cartonsCount - input.cartonsCount,
          weightG: shipment.weightG - input.weightG,
          ...(input.volumeCm3 !== undefined &&
            volume !== null && { volumeCm3: BigInt(volume - input.volumeCm3) }),
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.addEvent(tx, created.id, 'draft', at, actor, { note: input.reason });
      const split = {
        createdShipmentId: created.publicId,
        createdShipmentNo: created.shipmentNo,
        items: moves.map((m) => ({ destinationId: m.item.orderDestination.publicId, quantity: m.quantity })),
        reason: input.reason,
      };
      await this.record(tx, shipment, 'shipment.split', split, actor);
      await this.record(
        tx,
        created,
        'shipment.created',
        { splitFrom: shipment.publicId, cartonsCount: input.cartonsCount },
        actor,
      );
      return created.publicId;
    });
  }

  // --- proof-of-delivery review (D-229) ----------------------------------------------------------------------

  /** Staff accept or reject (with a note) a recorded POD; the delivery itself stands. */
  async reviewPod(
    actor: UserActor,
    shipmentId: bigint,
    decision: 'accepted' | 'rejected',
    note: string | null,
    ifMatch?: string,
  ): Promise<void> {
    if (decision === 'rejected' && !note)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'note', code: 'required', message: 'a rejection says why' }],
      });
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      assertIfMatch(ifMatch, shipmentEtag(shipment), { required: false });
      const pod = await tx.proofOfDelivery.findUnique({ where: { shipmentId: shipment.id } });
      if (!pod)
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });
      await tx.proofOfDeliveryReview.create({
        data: { proofOfDeliveryId: pod.id, decision, note, reviewedById: actor.userId },
      });
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(
        tx,
        shipment,
        decision === 'accepted' ? 'shipment.pod_accepted' : 'shipment.pod_rejected',
        { podId: pod.publicId, note },
        actor,
      );
    });
  }

  /**
   * The factory asks Packio for a fallback carrier for a packed trip its own fleet cannot serve (D-013, D-114;
   * U-B0.3): recorded with the reason and raised to Logistics (`shipment.carrier_requested`), who books through
   * `admin.shipments.bookCarrier`. The factory never books a carrier itself.
   */
  async requestCarrier(actor: UserActor, shipmentId: bigint, reason: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.lock(tx, shipmentId);
      const carrier = await tx.carrier.findUniqueOrThrow({ where: { id: shipment.carrierId } });
      if (shipment.status !== 'ready' || carrier.code !== 'factory_fleet' || shipment.carrierRequestedAt)
        throw new DomainException('shipments.invalid_status', {
          params: { status: shipment.carrierRequestedAt ? 'carrier already requested' : shipment.status },
        });
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          carrierRequestedAt: new Date(),
          carrierRequestReason: reason,
          carrierRequestedById: actor.userId,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, shipment, 'shipment.carrier_requested', { reason }, actor);
    });
  }

  /**
   * What the factory can ship (U-B0.3): its completed production jobs whose orders are not delivered, per
   * destination the pieces already on live shipments and what remains, and whether pickup would be refused today
   * (the shipping gate: payment before shipping, Packio inspection).
   */
  async shipPlan(factoryId: bigint) {
    const jobs = await this.prisma.productionJob.findMany({
      where: {
        factoryId,
        status: 'completed',
        jobKind: 'production',
        order: { deliveredAt: null, cancelledAt: null },
      },
      include: {
        order: {
          select: {
            id: true,
            orderCode: true,
            destinations: {
              orderBy: [{ sort: 'asc' }, { id: 'asc' }],
              include: { province: { select: { nameTh: true } } },
            },
          },
        },
        inspections: { select: { status: true, selected: true } },
      },
      orderBy: { promisedShipDate: 'asc' },
      take: 200,
    });
    const shipped = jobs.length
      ? await this.prisma.shipmentItem.groupBy({
          by: ['productionJobId', 'orderDestinationId'],
          where: {
            productionJobId: { in: jobs.map((j) => j.id) },
            shipment: { status: { notIn: NOT_SHIPPED } },
          },
          _sum: { quantity: true },
        })
      : [];
    const out = [];
    for (const job of jobs) {
      const paid = await this.schedules.canShip(job.order.id);
      const inspected =
        !job.inspectionRequired ||
        job.inspections.some((i) => i.selected && (i.status === 'passed' || i.status === 'waived'));
      out.push({
        job,
        blockedReason: !paid ? 'payment_pending' : !inspected ? 'inspection_pending' : null,
        destinations: job.order.destinations.map((d) => {
          const done =
            shipped.find((x) => x.productionJobId === job.id && x.orderDestinationId === d.id)?._sum
              .quantity ?? 0;
          return { destination: d, shipped: done, remaining: Math.max(d.quantity - done, 0) };
        }),
      });
    }
    return out;
  }

  /** Shipments not picked up yet whose orders still owe instalments due before shipping (B3.2). */
  async blockedByPayment(rows: { id: bigint; status: ShipmentStatus; items: { orderId: bigint }[] }[]) {
    const waiting = rows.filter((r) => r.status === 'draft' || r.status === 'ready');
    const orderIds = [...new Set(waiting.flatMap((r) => r.items.map((i) => i.orderId)))];
    const open = new Map<bigint, boolean>();
    for (const orderId of orderIds) open.set(orderId, await this.schedules.canShip(orderId));
    return new Set(waiting.filter((r) => r.items.some((i) => !open.get(i.orderId))).map((r) => r.id));
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
