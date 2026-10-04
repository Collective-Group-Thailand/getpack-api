import { createHmac } from 'node:crypto';

import { AppConfig } from '@config/app-config';
import { type Tx } from '@database/prisma.service';
import { WEBHOOK_SENDER, type WebhookSender } from '@integrations/webhooks-out/webhook-sender.port';
import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

interface Conditions {
  productTypeCodes?: string[];
  categoryCodes?: string[];
  catalogProductIds?: string[];
}

/** Events that change what a card says (D-308): prices, tiers and pricing modes, catalogue rows, promotions. */
const PRICE_EVENTS = [
  'price_list.version_approved',
  'product_type.quote_mode_changed',
  'factory.participation_changed',
  'factory.pricing_arrangement_changed',
];
const CATALOG_EVENTS = [
  'catalog.catalog_product.created',
  'catalog.catalog_product.updated',
  'catalog.catalog_product.deleted',
  'catalog.product_type.updated',
];
const PROMOTION_EVENTS = [
  'promotion.created',
  'promotion.updated',
  'promotion.ended',
  'promotion.priority_changed',
  'campaign.updated',
  'campaign.exhausted',
];

/**
 * D-308 storefront cache revalidation: a change that alters cards records `storefront.cache_invalidated` with the cache
 * tags concerned (`catalog:type:{id}`, `catalog:product:{slug}`, `promo:{id}`), and that event is posted, signed, to the
 * web app's revalidation URL when one is configured (retried by the outbox on failure).
 */
@Injectable()
export class StorefrontRevalidation {
  private readonly logger = new Logger(StorefrontRevalidation.name);

  constructor(
    private readonly events: DomainEvents,
    private readonly config: AppConfig,
    @Inject(WEBHOOK_SENDER) private readonly sender: WebhookSender,
  ) {}

  /** Tags of every active product type — a price or tier change rarely names the types it touches. */
  private async allTypes(tx: Tx): Promise<string[]> {
    const types = await tx.productType.findMany({ where: { status: 'active' }, select: { publicId: true } });
    return types.map((t) => `catalog:type:${t.publicId}`);
  }

  @OnDomainEvent(PRICE_EVENTS, { consumer: 'storefront.revalidate.prices' })
  async onPrices(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    await this.emit(tx, event, await this.allTypes(tx));
  }

  @OnDomainEvent(CATALOG_EVENTS, { consumer: 'storefront.revalidate.catalog' })
  async onCatalog(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.type.startsWith('catalog.product_type.')) {
      await this.emit(tx, event, [`catalog:type:${event.aggregateId}`]);
      return;
    }
    const p = await tx.catalogProduct.findUnique({
      where: { publicId: event.aggregateId },
      select: { slug: true, productType: { select: { publicId: true } } },
    });
    if (p)
      await this.emit(tx, event, [`catalog:type:${p.productType.publicId}`, `catalog:product:${p.slug}`]);
  }

  @OnDomainEvent(PROMOTION_EVENTS, { consumer: 'storefront.revalidate.promotions' })
  async onPromotion(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const promotions = event.type.startsWith('campaign.')
      ? await tx.promotion.findMany({ where: { campaign: { publicId: event.aggregateId } } })
      : await tx.promotion.findMany({ where: { publicId: event.aggregateId } });
    const tags = new Set<string>();
    for (const p of promotions) {
      tags.add(`promo:${p.publicId}`);
      const c = (p.conditions ?? {}) as Conditions;
      if (!c.productTypeCodes && !c.categoryCodes && !c.catalogProductIds) {
        for (const t of await this.allTypes(tx)) tags.add(t);
        continue;
      }
      const types = await tx.productType.findMany({
        where: {
          OR: [
            ...(c.productTypeCodes ? [{ code: { in: c.productTypeCodes } }] : []),
            ...(c.categoryCodes ? [{ category: { code: { in: c.categoryCodes } } }] : []),
            ...(c.catalogProductIds
              ? [{ catalogProducts: { some: { publicId: { in: c.catalogProductIds } } } }]
              : []),
          ],
        },
        select: { publicId: true },
      });
      for (const t of types) tags.add(`catalog:type:${t.publicId}`);
      if (c.catalogProductIds) {
        const products = await tx.catalogProduct.findMany({
          where: { publicId: { in: c.catalogProductIds } },
          select: { slug: true },
        });
        for (const p of products) tags.add(`catalog:product:${p.slug}`);
      }
    }
    await this.emit(tx, event, [...tags]);
  }

  private async emit(tx: Tx, cause: DomainEventEnvelope, tags: string[]) {
    if (tags.length === 0) return;
    await this.events.record(tx, {
      type: 'storefront.cache_invalidated',
      aggregateType: 'storefront',
      aggregateId: cause.id,
      payload: { tags: [...new Set(tags)].sort(), cause: cause.type },
    });
  }

  /** Posts the tags to the web app (signed); without a URL the event is the record. A failure retries via the outbox. */
  @OnDomainEvent(['storefront.cache_invalidated'], { consumer: 'storefront.revalidate.post' })
  async post(event: DomainEventEnvelope): Promise<void> {
    const url = this.config.get('STOREFRONT_REVALIDATE_URL');
    if (!url) return;
    const body = JSON.stringify({ tags: event.payload['tags'], eventId: event.id });
    const signature = createHmac('sha256', this.config.get('STOREFRONT_REVALIDATE_SECRET') ?? '')
      .update(body)
      .digest('hex');
    const status = await this.sender.post(
      url,
      { 'content-type': 'application/json', 'x-packio-signature': `sha256=${signature}` },
      body,
    );
    if (status >= 300) throw new Error(`storefront revalidation answered ${status}`);
    this.logger.debug(`revalidated ${String((event.payload['tags'] as string[]).length)} tags`);
  }
}

/** Loaded by both processes: the subscribers run in the worker. */
@Global()
@Module({ providers: [StorefrontRevalidation], exports: [StorefrontRevalidation] })
export class StorefrontRevalidationModule {}
