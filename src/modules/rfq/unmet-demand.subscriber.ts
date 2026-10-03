import { type Tx } from '@database/prisma.service';
import { type Prisma, type UnmetDemandSource } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { dimensionBand, priceGapBand, quantityBand } from './rfq-spec';

/** Why a calculation had no instant price → the unmet-demand source (D-102). */
const CALCULATION_SOURCES: Record<string, UnmetDemandSource> = {
  no_price_path: 'no_price_path',
  not_priceable: 'capability_missing',
  // A tier-B path exists but not for this specification (D-234).
  envelope_not_covered: 'no_price_path',
  delivery_unavailable: 'capability_missing',
  capacity_unavailable: 'capacity_limited',
  // D-274: the style variant asked for is not publishable (no recipe, nobody makes it, not priced…).
  style_variant_not_publishable: 'style_not_publishable',
};

/**
 * Demand Packio could not serve (D-102): declined and expired RFQs, and calculations without an
 * instant price. Banded (quantities, 50 mm dimensions, province), no customer identity or price; one
 * record per event (`domain_event_id` unique), so redelivery is harmless.
 */
@Injectable()
export class UnmetDemandSubscriber {
  constructor(private readonly settings: SettingsService) {}

  /**
   * D-252: a quotation with a target that ended lost, expired or sent to CS above its target is demand at a price
   * Packio could not meet — banded by gap, with a distinct-customer key so target-price figures can be suppressed
   * below `analytics.target_price_min_group_size` (D-190). Never the target or the price itself.
   */
  @OnDomainEvent('quote.outcome_recorded', { consumer: 'rfq.unmet-demand-price-gap' })
  async onQuoteOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['aboveTarget'] !== true) return;
    if (!['lost', 'expired', 'converted_to_rfq'].includes(String(event.payload['outcome']))) return;
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      include: { outcome: true },
    });
    const outcome = quote?.outcome;
    if (!quote || !outcome?.gapPct || outcome.quantity === null) return;
    const bounds = (await this.settings.at('analytics.price_gap_bands_pct', { at: outcome.occurredAt, tx }))
      .value;
    const band = priceGapBand(outcome.gapPct.toNumber(), bounds);
    if (!band) return;
    const input = quote.input as { dimensions?: { entered?: { l?: number; w?: number; d?: number } } };
    const config = (quote.input as { configuration?: Record<string, unknown> }).configuration ?? {};
    const dim = (k: 'l' | 'w' | 'd') => {
      const v = input.dimensions?.entered?.[k] ?? config[k];
      return typeof v === 'number' ? v : null;
    };
    const province = quote.deliveryPostcode
      ? await tx.geoSubdistrict.findFirst({
          where: { postcode: quote.deliveryPostcode },
          select: { district: { select: { provinceId: true } } },
        })
      : null;
    // The prospectus's contributor key (a company once, else the customer, else the anonymous session).
    const customerKey = quote.companyId
      ? `c${quote.companyId}`
      : quote.customerUserId
        ? `u${quote.customerUserId}`
        : `a${quote.anonymousId ?? quote.publicId}`;
    await this.write(tx, event, {
      occurredAt: outcome.occurredAt,
      source: 'price_above_target',
      reasonId: null,
      productTypeId: quote.productTypeId,
      specBand: {
        widthMm: dimensionBand(dim('w')),
        lengthMm: dimensionBand(dim('l')),
        heightMm: dimensionBand(dim('d')),
      },
      quantityBand: quantityBand(outcome.quantity),
      provinceId: province?.district.provinceId ?? null,
      quoteId: quote.id,
      priceGapBand: band,
      customerKey,
    });
  }

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
    const variantCode = event.payload['styleVariantCode'];
    const styleBase =
      source === 'style_not_publishable' && typeof variantCode === 'string'
        ? await tx.styleVariant.findUnique({ where: { code: variantCode }, select: { baseId: true } })
        : null;
    await this.write(tx, event, {
      occurredAt: new Date((event.payload['occurredAt'] as string | undefined) ?? event.occurredAt),
      source,
      styleBaseId: styleBase?.baseId ?? null,
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
