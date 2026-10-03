import { type Actor, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Shipment } from '@generated/prisma/client';
import { mainJobKind } from '@modules/orders/main-job';
import { OrderLifecycleHooks, OrdersService } from '@modules/orders/orders.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type EventExtra, IN_TRANSIT, NOT_SHIPPED, ShipmentsService } from './shipments.service';
import { evaluateTolerance } from './tolerance';

export interface PodInput {
  receiverName: string;
  signatureFileId?: string;
  photoFileIds?: string[];
  items: { destinationId: string; deliveredQuantity: number }[];
  capturedAt?: Date;
  lat?: number;
  lng?: number;
  carrierPodRef?: string;
  note?: string;
}

const DAY_MS = 86_400_000;

/**
 * Delivery (D-013, D-021, D-080, D-081, D-165). A shipment is delivered only with its proof of delivery:
 * the factory's photos + receiver name + signature (own fleet), or the carrier's POD (fallback); the
 * receiver's count per destination is recorded. Once every shipment of an order's production job is
 * delivered and nothing is left to ship, the order records `delivered` (claim window opens, D-082) and the
 * delivered quantity is reconciled against the tolerance frozen in the quote: shortage within → pro-rata
 * credit event (P19), overage within → no charge, outside → automatic claim (B4.5); the factory is payable
 * on min(delivered, ordered). Orders complete 7 days after delivery (`orders.auto_complete_days`) or when
 * the customer confirms receipt.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentsService,
    private readonly orders: OrdersService,
    private readonly hooks: OrderLifecycleHooks,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  // --- proof of delivery --------------------------------------------------------------------------------

  async recordPod(actor: Actor, shipmentId: bigint, input: PodInput): Promise<void> {
    const staff = actor.type === 'user' && actor.audience === 'staff';
    await this.prisma.withTx(async (tx) => {
      const shipment = await this.shipments.lock(tx, shipmentId);
      const carrier = await tx.carrier.findUniqueOrThrow({ where: { id: shipment.carrierId } });
      const fleet = carrier.code === 'factory_fleet';
      if (!fleet && !staff)
        throw new DomainException('shipments.invalid_status', {
          params: { status: `booked with ${carrier.code}` },
        });
      const deliverable = shipment.status === 'ready' ? fleet : IN_TRANSIT.includes(shipment.status);
      if (!deliverable)
        throw new DomainException('shipments.invalid_status', { params: { status: shipment.status } });

      // D-013: a factory delivery proves itself with photos and a signature; a carrier delivery by its POD.
      const kind = !fleet || (staff && input.carrierPodRef) ? 'carrier_pod' : 'factory_photo_signature';
      if (kind === 'carrier_pod' && !input.carrierPodRef) throw new DomainException('shipments.pod_required');
      if (kind === 'factory_photo_signature' && (!input.signatureFileId || !input.photoFileIds?.length))
        throw new DomainException('shipments.pod_required');
      const [signature] = input.signatureFileId
        ? await this.evidence(tx, actor, shipment, [input.signatureFileId])
        : [];
      const photos = await this.evidence(tx, actor, shipment, input.photoFileIds ?? []);

      const items = await tx.shipmentItem.findMany({
        where: { shipmentId: shipment.id },
        include: { orderDestination: { select: { publicId: true } } },
      });
      const reported = new Map(input.items.map((i) => [i.destinationId, i.deliveredQuantity]));
      if (
        reported.size !== input.items.length ||
        reported.size !== items.length ||
        items.some((i) => {
          const q = reported.get(i.orderDestination.publicId);
          return q === undefined || q > i.quantity;
        })
      )
        throw new DomainException('shipments.delivered_quantity_invalid');

      const at = input.capturedAt ?? new Date();
      if (shipment.status === 'ready') {
        await this.shipments.assertShippable(tx, shipment.id);
        await this.shipments.pickedUp(tx, shipment, at, actor, staff ? 'staff' : 'factory');
      }
      const total = items.reduce((a, i) => a + reported.get(i.orderDestination.publicId)!, 0);
      const pod = await tx.proofOfDelivery.create({
        data: {
          shipmentId: shipment.id,
          kind,
          receiverName: input.receiverName,
          signatureFileId: signature ?? null,
          deliveredQuantity: total,
          capturedAt: at,
          capturedById: actor.type === 'user' ? actor.userId : null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          carrierPodRef: input.carrierPodRef ?? null,
          note: input.note ?? null,
        },
      });
      for (const [i, fileObjectId] of photos.entries()) {
        await tx.attachment.create({
          data: {
            subjectType: 'proof_of_delivery',
            subjectId: pod.id,
            fileObjectId,
            role: 'pod.photo',
            sort: i,
            customerShareable: true,
          },
        });
      }
      for (const item of items) {
        await tx.shipmentItem.update({
          where: { id: item.id },
          data: { deliveredQuantity: reported.get(item.orderDestination.publicId)! },
        });
      }
      await this.delivered(tx, shipment, at, actor, { note: input.note }, staff ? 'staff' : 'factory');
    });
  }

  /** A carrier reported delivery: its POD stands (quantities as shipped), then the order is evaluated. */
  async carrierDelivered(
    tx: Tx,
    shipment: Shipment,
    at: Date,
    actor: Actor,
    extra: EventExtra,
  ): Promise<void> {
    if (!IN_TRANSIT.includes(shipment.status) && shipment.status !== 'ready') return;
    if (shipment.status === 'ready')
      await this.shipments.pickedUp(tx, shipment, at, actor, 'carrier_webhook');
    const items = await tx.shipmentItem.findMany({ where: { shipmentId: shipment.id } });
    await tx.proofOfDelivery.create({
      data: {
        shipmentId: shipment.id,
        kind: 'carrier_pod',
        receiverName: shipment.recipientName,
        deliveredQuantity: items.reduce((a, i) => a + i.quantity, 0),
        capturedAt: at,
        carrierPodRef: shipment.carrierBookingRef ?? extra.carrierEventId ?? 'carrier',
      },
    });
    for (const item of items)
      await tx.shipmentItem.update({ where: { id: item.id }, data: { deliveredQuantity: item.quantity } });
    await this.delivered(tx, shipment, at, actor, extra, 'carrier_webhook');
  }

  private async delivered(
    tx: Tx,
    shipment: Shipment,
    at: Date,
    actor: Actor,
    extra: EventExtra,
    source: 'factory' | 'carrier_webhook' | 'staff',
  ) {
    const current = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: 'delivered',
        statusChangedAt: at,
        deliveredAt: at,
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    await this.shipments.addEvent(tx, shipment.id, 'delivered', at, actor, extra, source);
    const items = await tx.shipmentItem.findMany({
      where: { shipmentId: shipment.id },
      include: { productionJob: { select: { publicId: true } }, order: { select: { publicId: true } } },
    });
    await this.shipments.record(
      tx,
      current,
      'shipment.delivered',
      {
        source,
        items: items.map((i) => ({
          jobId: i.productionJob.publicId,
          orderId: i.order.publicId,
          quantity: i.quantity,
          deliveredQuantity: i.deliveredQuantity,
        })),
      },
      actor,
    );
    for (const orderId of new Set(items.map((i) => i.orderId))) await this.evaluateOrder(tx, orderId, actor);
  }

  // --- order delivered + tolerance --------------------------------------------------------------------------

  /**
   * The order is delivered when its production job is complete, everything it made is on shipments and
   * every one of them is delivered (split and multi-destination deliveries count together).
   */
  async evaluateOrder(tx: Tx, orderId: bigint, actor: Actor): Promise<boolean> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.deliveredAt || order.cancelledAt) return false;
    const job = await tx.productionJob.findFirst({
      where: { orderId, jobKind: mainJobKind(order.kind), status: { notIn: ['rejected', 'cancelled'] } },
    });
    if (!job || job.status !== 'completed') return false;
    const items = await tx.shipmentItem.findMany({
      where: { productionJobId: job.id, shipment: { status: { notIn: NOT_SHIPPED } } },
      include: { shipment: { select: { status: true, deliveredAt: true } } },
    });
    const shipped = items.reduce((a, i) => a + i.quantity, 0);
    if (shipped < (job.quantityGood ?? job.quantityOrdered)) return false;
    if (items.length === 0 || items.some((i) => i.shipment.status !== 'delivered')) return false;

    const deliveredAt = new Date(Math.max(...items.map((i) => i.shipment.deliveredAt!.getTime())));
    const delivered = items.reduce((a, i) => a + (i.deliveredQuantity ?? 0), 0);
    const windowDays = (await this.settings.at('claims.window_days', { at: deliveredAt, tx })).value;
    await this.orders.applyFact(tx, order.id, { kind: 'delivered' }, actor, deliveredAt);
    await tx.order.update({
      where: { id: order.id },
      data: {
        quantityDelivered: delivered,
        claimWindowEndsAt: new Date(deliveredAt.getTime() + windowDays * DAY_MS),
      },
    });
    // D-258: a sample carries no quantity tolerance — nothing to reconcile.
    if (order.kind !== 'sample') await this.reconcile(tx, order.id, delivered, deliveredAt, actor);
    return true;
  }

  private async reconcile(tx: Tx, orderId: bigint, delivered: number, at: Date, actor: Actor) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { where: { lineType: 'product' } } },
    });
    // The tolerance frozen in the quote (D-021); none frozen → no tolerance (every deviation is a claim).
    const shortagePct = order.toleranceShortagePct?.toString() ?? '0';
    const overagePct = order.toleranceOveragePct?.toString() ?? '0';
    const productNet = order.lines.reduce(
      (a, l) => a.add(new MoneyDecimal(l.netAmount.toString()).sub(l.discountAmount.toString())),
      new MoneyDecimal(0),
    );
    const productVat = order.lines.reduce((a, l) => a.add(l.vatAmount.toString()), new MoneyDecimal(0));
    const result = evaluateTolerance({
      ordered: order.quantityOrdered,
      delivered,
      shortagePct,
      overagePct,
      productNet: formatMoney(productNet),
      productVat: formatMoney(productVat),
    });
    const reconciliation = await tx.deliveryReconciliation.create({
      data: {
        orderId: order.id,
        orderedQuantity: order.quantityOrdered,
        deliveredQuantity: delivered,
        payableQuantity: result.payable,
        toleranceShortagePct: shortagePct,
        toleranceOveragePct: overagePct,
        deviationPct: result.deviationPct,
        outcome: result.outcome,
        creditNetAmount: result.credit?.net ?? null,
        creditVatAmount: result.credit?.vat ?? null,
        creditAmount: result.credit?.gross ?? null,
        evaluatedAt: at,
      },
    });
    const data = {
      outcome: result.outcome,
      orderedQuantity: order.quantityOrdered,
      deliveredQuantity: delivered,
      payableQuantity: result.payable,
      deviationPct: result.deviationPct,
      toleranceShortagePct: shortagePct,
      toleranceOveragePct: overagePct,
      credit: result.credit,
    };
    const event = await this.events.record(
      tx,
      {
        type: 'delivery.reconciled',
        aggregateType: 'order',
        aggregateId: order.publicId,
        entityId: order.entityId,
        payload: { orderId: order.publicId, ...data },
      },
      actor,
    );
    await tx.deliveryReconciliation.update({
      where: { id: reconciliation.id },
      data: { domainEventId: event.id },
    });
    const { deviationPct: _d, toleranceShortagePct: _s, toleranceOveragePct: _o, ...customer } = data;
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: order.publicId,
      action: 'delivery.reconciled',
      messageKey: 'activity.delivery.reconciled',
      messageParams: customer,
      visibility: ['internal', 'customer'],
      entityId: order.entityId,
      domainEventId: event.id,
      actor,
    });
  }

  // --- completion (D-081) ---------------------------------------------------------------------------------

  /** The customer confirms receipt: the order completes now. */
  async confirmReceipt(actor: Actor, orderPublicId: string, customerUserId: bigint): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const order = await this.orders.order({ publicId: orderPublicId }, customerUserId, tx);
      if (!order.deliveredAt)
        throw new DomainException('order.invalid_transition', {
          params: { from: order.status, fact: 'completed', reason: 'the order has not been delivered' },
        });
      await this.orders.applyFact(tx, order.id, { kind: 'completed', mode: 'customer_confirmed' }, actor);
    });
  }

  /** Scheduled: delivered orders past `orders.auto_complete_days` complete automatically. */
  async autoComplete(now = new Date(), limit = 200): Promise<number> {
    const days = (await this.settings.at('orders.auto_complete_days', { at: now })).value;
    const due = await this.prisma.order.findMany({
      where: {
        deliveredAt: { lte: new Date(now.getTime() - days * DAY_MS) },
        completedAt: null,
        cancelledAt: null,
      },
      select: { id: true },
      orderBy: { deliveredAt: 'asc' },
      take: limit,
    });
    let done = 0;
    const actor = systemActor('orders.auto_complete');
    for (const { id } of due) {
      try {
        await this.prisma.withTx(async (tx) => {
          const order = await tx.order.findUniqueOrThrow({ where: { id } });
          if (order.completedAt || !order.deliveredAt) return;
          // Held while something is still open on the order (claims, B4.5).
          for (const hook of this.hooks.list()) if (await hook.blocksCompletion?.(tx, order.id)) return;
          const at = new Date(order.deliveredAt.getTime() + days * DAY_MS);
          if (await this.orders.applyFact(tx, id, { kind: 'completed', mode: 'auto_after_days' }, actor, at))
            done += 1;
        });
      } catch (error) {
        this.logger.error({ orderId: id.toString(), err: (error as Error).message }, 'auto-complete failed');
      }
    }
    return done;
  }

  // --- helpers --------------------------------------------------------------------------------------------

  /** Evidence must be clean uploads of the shipment's factory (or of the staff member recording it). */
  private async evidence(tx: Tx, actor: Actor, shipment: Shipment, publicIds: string[]): Promise<bigint[]> {
    if (publicIds.length === 0) return [];
    const files = await tx.fileObject.findMany({ where: { publicId: { in: publicIds } } });
    const owned = (f: (typeof files)[number]) =>
      f.ownerFactoryId === shipment.factoryId || (actor.type === 'user' && f.ownerUserId === actor.userId);
    if (
      files.length !== new Set(publicIds).size ||
      files.some((f) => !owned(f) || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected')
    )
      throw new DomainException('artwork.file_not_usable', { params: { fileId: publicIds.join(', ') } });
    return publicIds.map((id) => files.find((f) => f.publicId === id)!.id);
  }
}
