import { systemActor } from '@common/context/actor';
import { type DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type ShipmentStatus } from '@generated/prisma/client';
import { type FallbackCarrierCode } from '@integrations/carriers/carrier-adapter.port';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { DeliveryService } from './delivery.service';
import { type EventExtra, ShipmentsService, TRANSITIONS } from './shipments.service';

/** Normalised carrier status → shipment status (D-114); `booked` changes nothing. */
const FROM_CARRIER: Record<string, ShipmentStatus | null> = {
  booked: null,
  picked_up: 'picked_up',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  returned: 'returned',
  cancelled: 'cancelled',
};

/**
 * Fallback-carrier callbacks (published by `CarriersService.webhook`, D-114) move the booking's shipment,
 * once per inbox event (`shipment_events.carrier_event_id`); a carrier delivery is proven by the carrier's
 * POD. Also the worker's logistics housekeeping: automatic completion 7 days after delivery (D-081).
 */
@Injectable()
export class LogisticsSubscribers {
  private readonly logger = new Logger(LogisticsSubscribers.name);

  constructor(
    private readonly shipments: ShipmentsService,
    private readonly delivery: DeliveryService,
  ) {}

  @OnDomainEvent('carrier.webhook_received', { consumer: 'logistics.carrier_events' })
  async onCarrierWebhook(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const p = event.payload as {
      carrier: string;
      inboxId: string;
      bookingRef: string | null;
      status: string | null;
      providerStatus: string | null;
    };
    if (!p.bookingRef || !p.status) return;
    const found = await tx.shipment.findFirst({
      where: { carrierBookingRef: p.bookingRef, carrier: { code: p.carrier as FallbackCarrierCode } },
    });
    if (!found) return;
    const carrierEventId = `inbox:${p.inboxId}`;
    if (await tx.shipmentEvent.count({ where: { shipmentId: found.id, carrierEventId } })) return;
    const actor = systemActor('logistics.carrier_events');
    const at = new Date(event.occurredAt);
    const extra: EventExtra = { carrierEventId, providerStatus: p.providerStatus ?? undefined };
    const shipment = await this.shipments.lock(tx, found.id);
    const to = FROM_CARRIER[p.status] ?? null;
    const note = () =>
      this.shipments.addEvent(tx, shipment.id, shipment.status, at, actor, extra, 'carrier_webhook');

    if (
      to === null ||
      to === shipment.status ||
      shipment.status === 'delivered' ||
      shipment.status === 'cancelled'
    )
      return note();
    if (to === 'delivered') return this.delivery.carrierDelivered(tx, shipment, at, actor, extra);
    if (to === 'cancelled') {
      await note();
      await this.shipments.record(tx, shipment, 'shipment.carrier_cancelled', { carrier: p.carrier }, actor, [
        'internal',
      ]);
      return;
    }
    if (shipment.status === 'ready') {
      try {
        await this.shipments.assertShippable(tx, shipment.id);
      } catch (error) {
        // The carrier already has the goods: record the pickup and tell staff the gate was bypassed.
        this.logger.warn({ shipment: shipment.shipmentNo }, 'carrier pickup before the shipping gate');
        await this.shipments.record(
          tx,
          shipment,
          'shipment.gate_bypassed',
          { reason: (error as DomainException).code ?? 'gate' },
          actor,
          ['internal'],
        );
      }
      await this.shipments.pickedUp(
        tx,
        shipment,
        at,
        actor,
        'carrier_webhook',
        to === 'picked_up' ? extra : {},
      );
      if (to === 'picked_up') return;
    }
    const now = await this.shipments.lock(tx, shipment.id);
    if ((TRANSITIONS[now.status] ?? []).includes(to))
      await this.shipments.transition(tx, now, to, at, actor, 'carrier_webhook', extra);
    else await this.shipments.addEvent(tx, now.id, now.status, at, actor, extra, 'carrier_webhook');
  }

  /** Delivered orders complete 7 days later unless the customer confirmed earlier (D-081). */
  @ScheduledJob({ name: 'orders.auto_complete', every: 15 * 60_000 })
  autoComplete(): Promise<number> {
    return this.delivery.autoComplete();
  }
}
