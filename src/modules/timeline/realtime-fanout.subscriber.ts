import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { RealtimePublisher, type RealtimeSignal } from '@platform/realtime/realtime.publisher';

/** Shipment steps the customer follows live (their activity rows are internal / partner only). */
const CUSTOMER_SHIPMENT_TYPES = new Set([
  'shipment.ready',
  'shipment.picked_up',
  'shipment.status_changed',
  'shipment.carrier_booked',
  'shipment.delivered',
]);

/**
 * Realtime fan-out of key events (D-143, contract §6): after each event the principals it concerns get a
 * signal — ids and type only, clients refetch through the API. The customer of an order when the event
 * is visible to them (a customer-visible activity row, or a shipment step); the factory's channel when it
 * is visible to partners; staff @mentioned in an internal note. Web push and the other channels go through
 * the notification routing matrix. Signals are best effort and never block the event.
 */
@Injectable()
export class RealtimeFanout {
  constructor(private readonly realtime: RealtimePublisher) {}

  @OnDomainEvent('*', { consumer: 'realtime.fanout' })
  async fanOut(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const signals = await this.signalsFor(event, tx);
    for (const [channel, signal] of signals) await this.realtime.publish(channel, signal);
  }

  private async signalsFor(event: DomainEventEnvelope, tx: Tx): Promise<[string, RealtimeSignal][]> {
    const out: [string, RealtimeSignal][] = [];
    const visibility = new Set(
      (
        await tx.activityLog.findMany({ where: { domainEventId: event.id }, select: { visibility: true } })
      ).flatMap((a) => a.visibility),
    );
    switch (event.aggregateType) {
      case 'order': {
        if (event.type === 'order.note_added') {
          const mentions = (event.payload['mentionIds'] as string[] | undefined) ?? [];
          for (const id of mentions)
            out.push([`user:${id}`, { type: 'order.note_mentioned', id: event.aggregateId }]);
          break;
        }
        if (!visibility.has('customer')) break;
        const order = await tx.order.findUnique({
          where: { publicId: event.aggregateId },
          select: { customer: { select: { publicId: true } } },
        });
        if (order)
          out.push([`user:${order.customer.publicId}`, { type: 'order.updated', id: event.aggregateId }]);
        break;
      }
      case 'order_group': {
        if (!visibility.has('customer')) break;
        const group = await tx.orderGroup.findUnique({
          where: { publicId: event.aggregateId },
          select: { customer: { select: { publicId: true } } },
        });
        if (group)
          out.push([
            `user:${group.customer.publicId}`,
            { type: 'order_group.updated', id: event.aggregateId },
          ]);
        break;
      }
      case 'production_job': {
        const factoryId = event.payload['factoryId'];
        if (visibility.has('partner') && typeof factoryId === 'string')
          out.push([`factory:${factoryId}`, { type: 'production_job.updated', id: event.aggregateId }]);
        break;
      }
      case 'claim': {
        const customerId = event.payload['customerId'];
        const factoryId = event.payload['factoryId'];
        if (visibility.has('customer') && typeof customerId === 'string')
          out.push([`user:${customerId}`, { type: 'claim.updated', id: event.aggregateId }]);
        if (visibility.has('partner') && typeof factoryId === 'string')
          out.push([`factory:${factoryId}`, { type: 'claim.updated', id: event.aggregateId }]);
        break;
      }
      case 'shipment': {
        const factoryId = event.payload['factoryId'];
        if (visibility.has('partner') && typeof factoryId === 'string')
          out.push([`factory:${factoryId}`, { type: 'shipment.updated', id: event.aggregateId }]);
        if (!CUSTOMER_SHIPMENT_TYPES.has(event.type)) break;
        const orderIds = (event.payload['orderIds'] as string[] | undefined) ?? [];
        const orders = await tx.order.findMany({
          where: { publicId: { in: orderIds } },
          select: { publicId: true, customer: { select: { publicId: true } } },
        });
        for (const o of orders)
          out.push([`user:${o.customer.publicId}`, { type: 'order.updated', id: o.publicId }]);
        break;
      }
    }
    return out;
  }
}
