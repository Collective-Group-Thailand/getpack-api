import { type Tx } from '@database/prisma.service';
import { type Prisma, type UnmetDemandSource } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { dimensionBand, quantityBand } from './rfq-spec';

/** Why a calculation had no instant price → the unmet-demand source (D-102). */
const CALCULATION_SOURCES: Record<string, UnmetDemandSource> = {
  no_price_path: 'no_price_path',
  not_priceable: 'capability_missing',
  delivery_unavailable: 'capability_missing',
  capacity_unavailable: 'capacity_limited',
};

/**
 * Demand Packio could not serve (D-102): declined and expired RFQs, and calculations without an
 * instant price. Banded (quantities, 50 mm dimensions, province), no customer identity or price; one
 * record per event (`domain_event_id` unique), so redelivery is harmless.
 */
@Injectable()
export class UnmetDemandSubscriber {
  @OnDomainEvent(['rfq.declined', 'rfq.expired'], { consumer: 'rfq.unmet-demand' })
  async onRfqClosed(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const rfq = await tx.rfq.findUnique({
      where: { publicId: String(event.payload['rfqId']) },
      include: { tiers: true },
    });
    if (!rfq) return;
    const top = Math.max(...rfq.tiers.map((t) => t.quantity), 0);
    await this.write(tx, event, {
      occurredAt: rfq.closedAt ?? new Date(event.occurredAt),
      source: event.type === 'rfq.declined' ? 'rfq_declined' : 'rfq_expired',
      reasonId: rfq.declineReasonId,
      productTypeId: rfq.productTypeId,
      specBand: {
        lengthMm: dimensionBand(rfq.lengthMm?.toNumber()),
        widthMm: dimensionBand(rfq.widthMm?.toNumber()),
        heightMm: dimensionBand(rfq.heightMm?.toNumber()),
        tiers: rfq.tiers.length,
      },
      quantityBand: quantityBand(top),
      provinceId: rfq.provinceId,
      rfqId: rfq.id,
    });
  }

  @OnDomainEvent('quote.calculated', { consumer: 'rfq.unmet-demand-calculations' })
  async onCalculated(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['instant'] === true) return;
    const reasons = (event.payload['reasons'] as string[] | undefined) ?? [];
    const source = reasons.map((r) => CALCULATION_SOURCES[r]).find((s) => s !== undefined);
    if (!source) return;
    const quantities = (event.payload['quantities'] as number[] | undefined) ?? [];
    const dims = (event.payload['dimensionsMm'] as { w?: number; l?: number; d?: number } | undefined) ?? {};
    const postcode = event.payload['deliveryPostcode'] as string | null | undefined;
    const province = postcode
      ? await tx.geoSubdistrict.findFirst({
          where: { postcode },
          select: { district: { select: { provinceId: true } } },
        })
      : null;
    await this.write(tx, event, {
      occurredAt: new Date((event.payload['occurredAt'] as string | undefined) ?? event.occurredAt),
      source,
      reasonId: null,
      productTypeId: BigInt(String(event.payload['productTypeId'])),
      specBand: {
        widthMm: dimensionBand(dims.w),
        lengthMm: dimensionBand(dims.l),
        heightMm: dimensionBand(dims.d),
      },
      quantityBand: quantityBand(Math.max(...quantities, 0)),
      provinceId: province?.district.provinceId ?? null,
      calculateLogId:
        typeof event.payload['calculateLogId'] === 'string' ? BigInt(event.payload['calculateLogId']) : null,
    });
  }

  private async write(
    tx: Tx,
    event: DomainEventEnvelope,
    data: Omit<Prisma.UnmetDemandRecordUncheckedCreateInput, 'domainEventId' | 'specBand'> & {
      specBand: object;
    },
  ) {
    // Append-only table: never an UPDATE, even an empty one.
    if (await tx.unmetDemandRecord.findUnique({ where: { domainEventId: event.id }, select: { id: true } }))
      return;
    await tx.unmetDemandRecord.create({
      data: { ...data, specBand: data.specBand, domainEventId: event.id },
    });
  }
}
