import { createHmac, randomBytes } from 'node:crypto';

import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type WebhookDelivery, type WebhookSubscription } from '@generated/prisma/client';
import { WEBHOOK_SENDER, type WebhookSender } from '@integrations/webhooks-out/webhook-sender.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import {
  type CreatedWebhookSubscriptionDto,
  type WebhookDeliveryDto,
  type WebhookEventType,
  type WebhookSubscriptionDto,
} from './b2b.dto';
import { type B2bClient } from './b2b.service';

/** Back-off after each failed attempt (assumption (5), D-291): 1, 5, 30 min, 2 h, 12 h — then `failed`. */
export const WEBHOOK_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const BATCH = 50;

interface Mapped {
  companyId: bigint;
  type: WebhookEventType;
  data: Record<string, unknown>;
}

/** `Packio-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export function signature(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/**
 * D-291 webhooks. A company's subscriptions (managed by its API clients with `b2b_webhooks.manage`) receive order,
 * shipment and document events of the company: each domain event becomes a delivery per matching subscription, with
 * a body of ids, codes and statuses only (no personal data). The delivery job POSTs it signed with the subscription's
 * secret (HMAC-SHA256), logs the status, and retries with back-off until it gives up.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
    @Inject(WEBHOOK_SENDER) private readonly sender: WebhookSender,
  ) {}

  // --- subscriptions --------------------------------------------------------------------------------------------

  async list(client: B2bClient): Promise<WebhookSubscriptionDto[]> {
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { companyId: client.company.id },
      orderBy: { id: 'desc' },
    });
    return rows.map(subscriptionDto);
  }

  async create(
    client: B2bClient,
    input: { url: string; eventTypes: WebhookEventType[] },
  ): Promise<CreatedWebhookSubscriptionDto> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.prisma.withTx(async (tx) => {
      const row = await tx.webhookSubscription.create({
        data: {
          companyId: client.company.id,
          url: input.url,
          eventTypes: [...new Set(input.eventTypes)].sort(),
          secretEnc: this.encryption.encrypt(secret),
          createdByClientId: client.apiClientId,
        },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'webhook_subscription.created',
        actor: client.actor,
        resourceType: 'webhook_subscription',
        resourcePublicId: row.publicId,
        data: { companyId: client.company.publicId, eventTypes: row.eventTypes },
      });
      return { ...subscriptionDto(row), secret };
    });
  }

  async disable(client: B2bClient, publicId: string): Promise<WebhookSubscriptionDto> {
    return this.prisma.withTx(async (tx) => {
      const row = await tx.webhookSubscription.findFirst({
        where: { publicId, companyId: client.company.id },
      });
      if (!row) throw new DomainException('http.not_found');
      if (row.status === 'disabled') return subscriptionDto(row);
      const updated = await tx.webhookSubscription.update({
        where: { id: row.id },
        data: { status: 'disabled', disabledAt: new Date() },
      });
      await tx.webhookDelivery.updateMany({
        where: { subscriptionId: row.id, status: 'pending' },
        data: { status: 'failed', nextAttemptAt: null, lastError: 'subscription disabled' },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'webhook_subscription.disabled',
        actor: client.actor,
        resourceType: 'webhook_subscription',
        resourcePublicId: row.publicId,
      });
      return subscriptionDto(updated);
    });
  }

  async deliveries(
    client: B2bClient,
    publicId: string,
    page: number,
    perPage: number,
  ): Promise<{ rows: WebhookDeliveryDto[]; total: number }> {
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { publicId, companyId: client.company.id },
    });
    if (!sub) throw new DomainException('http.not_found');
    const [rows, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { id: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.webhookDelivery.count({ where: { subscriptionId: sub.id } }),
    ]);
    return { rows: rows.map(deliveryDto), total };
  }

  // --- fan-out --------------------------------------------------------------------------------------------------

  @OnDomainEvent(
    [
      'order_group.placed',
      'order.fact_recorded',
      'shipment.picked_up',
      'shipment.delivered',
      'customer_document.rendered',
    ],
    { consumer: 'b2b.webhooks' },
  )
  async onEvent(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    for (const m of await this.map(event, tx)) {
      const subscriptions = await tx.webhookSubscription.findMany({
        where: { companyId: m.companyId, status: 'active', eventTypes: { has: m.type } },
        select: { id: true },
      });
      if (subscriptions.length === 0) continue;
      const body = {
        event: { id: event.id, type: m.type, occurredAt: toBangkokIso(new Date(event.occurredAt)) },
        data: m.data,
      } as Prisma.InputJsonValue;
      await tx.webhookDelivery.createMany({
        data: subscriptions.map((s) => ({
          subscriptionId: s.id,
          domainEventId: event.id,
          eventType: m.type,
          body,
          nextAttemptAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }
  }

  /** The company (or companies) a domain event concerns and the webhook it becomes. */
  private async map(event: DomainEventEnvelope, tx: Tx): Promise<Mapped[]> {
    const p = event.payload;
    switch (event.type) {
      case 'order_group.placed': {
        const group = await tx.orderGroup.findUnique({
          where: { publicId: event.aggregateId },
          include: { orders: { select: { publicId: true, orderCode: true, status: true } } },
        });
        if (!group?.companyId) return [];
        return [
          {
            companyId: group.companyId,
            type: 'order.placed',
            data: {
              orderGroupId: group.publicId,
              groupCode: group.groupCode,
              orders: group.orders.map((o) => ({
                orderId: o.publicId,
                orderCode: o.orderCode,
                status: o.status,
              })),
            },
          },
        ];
      }
      case 'order.fact_recorded': {
        const order = await tx.order.findUnique({
          where: { publicId: event.aggregateId },
          include: { orderGroup: { select: { companyId: true, publicId: true } } },
        });
        if (!order?.orderGroup.companyId) return [];
        return [
          {
            companyId: order.orderGroup.companyId,
            type: 'order.updated',
            data: {
              orderId: order.publicId,
              orderCode: order.orderCode,
              orderGroupId: order.orderGroup.publicId,
              fact: p['fact'],
              status: order.status,
            },
          },
        ];
      }
      case 'shipment.picked_up':
      case 'shipment.delivered': {
        const shipment = await tx.shipment.findUnique({
          where: { publicId: event.aggregateId },
          select: { publicId: true, shipmentNo: true, status: true },
        });
        const orderIds = (p['orderIds'] as string[] | undefined) ?? [];
        if (!shipment || orderIds.length === 0) return [];
        const orders = await tx.order.findMany({
          where: { publicId: { in: orderIds }, orderGroup: { companyId: { not: null } } },
          select: { publicId: true, orderCode: true, orderGroup: { select: { companyId: true } } },
        });
        const byCompany = new Map<bigint, { orderId: string; orderCode: string }[]>();
        for (const o of orders) {
          const list = byCompany.get(o.orderGroup.companyId!) ?? [];
          list.push({ orderId: o.publicId, orderCode: o.orderCode });
          byCompany.set(o.orderGroup.companyId!, list);
        }
        return [...byCompany].map(([companyId, list]) => ({
          companyId,
          type: event.type === 'shipment.delivered' ? 'shipment.delivered' : 'shipment.shipped',
          data: {
            shipmentId: shipment.publicId,
            shipmentNo: shipment.shipmentNo,
            status: shipment.status,
            orders: list,
          },
        }));
      }
      case 'customer_document.rendered': {
        const doc = await tx.customerDocument.findUnique({
          where: { publicId: event.aggregateId },
          select: {
            publicId: true,
            docNumber: true,
            docType: true,
            companyId: true,
            order: { select: { publicId: true, orderCode: true } },
          },
        });
        if (!doc?.companyId) return [];
        return [
          {
            companyId: doc.companyId,
            type: 'document.issued',
            data: {
              documentId: doc.publicId,
              docNumber: doc.docNumber,
              docType: doc.docType,
              orderId: doc.order?.publicId ?? null,
              orderCode: doc.order?.orderCode ?? null,
            },
          },
        ];
      }
      default:
        return [];
    }
  }

  // --- delivery -------------------------------------------------------------------------------------------------

  /** Sends the deliveries that are due; returns how many were attempted. */
  async deliverDue(now = new Date()): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      include: { subscription: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH,
    });
    for (const d of due) await this.attempt(d, now);
    return due.length;
  }

  private async attempt(
    d: WebhookDelivery & { subscription: WebhookSubscription },
    now: Date,
  ): Promise<void> {
    // Claim it: a concurrent worker that already moved it on skips it.
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: 'pending', attempts: d.attempts },
      data: { attempts: { increment: 1 }, lastAttemptAt: now },
    });
    if (claimed.count === 0) return;
    const body = JSON.stringify(d.body);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const secret = this.encryption.decrypt(d.subscription.secretEnc);
      status = await this.sender.post(
        d.subscription.url,
        {
          'Packio-Signature': signature(secret, Math.floor(now.getTime() / 1000), body),
          'Packio-Event': d.eventType,
          'Packio-Delivery': d.publicId,
        },
        body,
      );
    } catch (e) {
      // Network errors only — never the response or request body (PDPA).
      error = e instanceof Error ? e.name : 'error';
      this.logger.warn(`webhook delivery ${d.publicId} failed: ${error}`);
    }
    const attempts = d.attempts + 1;
    if (status !== null && status >= 200 && status < 300) {
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'delivered',
          deliveredAt: now,
          nextAttemptAt: null,
          lastStatusCode: status,
          lastError: null,
        },
      });
      return;
    }
    const wait = WEBHOOK_BACKOFF_MS[attempts - 1];
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: wait === undefined ? 'failed' : 'pending',
        nextAttemptAt: wait === undefined ? null : new Date(now.getTime() + wait),
        lastStatusCode: status,
        lastError: error ?? (status !== null ? `HTTP ${status}` : null),
      },
    });
  }
}

function subscriptionDto(r: WebhookSubscription): WebhookSubscriptionDto {
  return {
    id: r.publicId,
    url: r.url,
    eventTypes: r.eventTypes as WebhookEventType[],
    status: r.status,
    createdAt: toBangkokIso(r.createdAt),
  };
}

function deliveryDto(r: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: r.publicId,
    eventType: r.eventType as WebhookEventType,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.nextAttemptAt ? toBangkokIso(r.nextAttemptAt) : null,
    lastStatusCode: r.lastStatusCode,
    lastError: r.lastError,
    deliveredAt: r.deliveredAt ? toBangkokIso(r.deliveredAt) : null,
    body: r.body as Record<string, unknown>,
    createdAt: toBangkokIso(r.createdAt),
  };
}
