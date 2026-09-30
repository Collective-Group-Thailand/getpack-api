import { randomBytes } from 'node:crypto';

import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type CartRow, CartsService } from '@modules/carts/carts.service';
import { OrdersService } from '@modules/orders/orders.service';
import { type FoldingConfiguration } from '@modules/pricing/calculators/folding/folding-snapshot.loader';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { type Redis } from 'ioredis';

import { type BulkReorderPreviewDto, type BulkReorderResultDto, type ReorderPreviewDto } from './claims.dto';

/** Technical bound: how long a reorder preview's token is honoured (the price itself is re-checked). */
const PREVIEW_TTL_SECONDS = 30 * 60;

interface BulkBinding {
  companyId: string;
  userId: string;
  rows: { line: number; orderCode: string; quantity: number; grossAmount: string }[];
}

interface PreviewBinding {
  orderId: string;
  userId: string;
  quantity: number;
  reuseArtwork: boolean;
  grossAmount: string;
}

/**
 * Reorder (D-153): from a delivered order, the same specification priced again at today's cost (a new
 * quote — never the old price), quantity editable, into the cart. With the artwork unchanged the approved
 * proof carries over: when the new order is placed it gets an approved copy of that proof (same locked
 * file and hash) and the artwork step is skipped. A preview (U-B0.1) prices the same specification without saving
 * anything and hands out a short-lived token: a reorder sent with it is refused when today's price differs.
 */
@Injectable()
export class ReorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: SavedQuotesService,
    private readonly carts: CartsService,
    private readonly orders: OrdersService,
    private readonly activity: ActivityLogService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Today's price of reordering my order at `quantity` (D-153); nothing is saved. */
  async preview(
    actor: UserActor,
    orderPublicId: string,
    input: { quantity?: number; reuseArtwork?: boolean },
  ): Promise<ReorderPreviewDto> {
    const { order, spec, proof } = await this.source(actor, orderPublicId, input.reuseArtwork);
    const quantity = input.quantity ?? order.quantityOrdered;
    const step = await this.price(actor, spec, quantity);
    const token = randomBytes(24).toString('base64url');
    const binding: PreviewBinding = {
      orderId: order.publicId,
      userId: String(actor.userId),
      quantity,
      reuseArtwork: proof !== null,
      grossAmount: step.grossAmount!,
    };
    await this.redis.set(this.key(token), JSON.stringify(binding), 'EX', PREVIEW_TTL_SECONDS);
    return {
      orderId: order.publicId,
      orderCode: order.orderCode,
      quantity,
      previousQuantity: order.quantityOrdered,
      quantityLimits: {
        min: order.catalogProduct?.quantityMin ?? null,
        max: order.catalogProduct?.quantityMax ?? null,
      },
      unitPrice: step.unitPrice!,
      productAmount: step.productAmount!,
      designFeeAmount: step.designFeeAmount ?? '0.00',
      toolingAmount: step.toolingAmount,
      shippingAmount: step.shippingAmount,
      vatAmount: step.vatAmount!,
      grossAmount: step.grossAmount!,
      currency: 'THB',
      leadTimeDays: step.leadTimeDays,
      earliestShipDate: step.earliestShipDate,
      earliestDeliveryDate: step.earliestDeliveryDate,
      proofSkipped: proof !== null,
      previewToken: token,
      previewExpiresAt: toBangkokIso(new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000)),
    };
  }

  async reorder(
    actor: UserActor,
    orderPublicId: string,
    input: { quantity?: number; reuseArtwork?: boolean; previewToken?: string },
  ): Promise<CartRow> {
    const { order, spec, proof } = await this.source(actor, orderPublicId, input.reuseArtwork);
    const quantity = input.quantity ?? order.quantityOrdered;
    if (input.previewToken) {
      const raw = await this.redis.get(this.key(input.previewToken));
      const bound = raw ? (JSON.parse(raw) as PreviewBinding) : null;
      if (
        !bound ||
        bound.orderId !== order.publicId ||
        bound.userId !== String(actor.userId) ||
        bound.quantity !== quantity ||
        bound.reuseArtwork !== (proof !== null)
      )
        throw new DomainException('orders.reorder_preview_expired');
      const step = await this.price(actor, spec, quantity);
      if (step.grossAmount !== bound.grossAmount)
        throw new DomainException('orders.reorder_repriced', { params: { grossAmount: step.grossAmount! } });
    }
    const { cart } = await this.add(actor, order, spec, proof, quantity);
    if (input.previewToken) await this.redis.del(this.key(input.previewToken));
    return cart;
  }

  /** The same specification saved as a new quote at today's price and added to my cart as a reorder of `order`. */
  private async add(
    actor: UserActor,
    order: Awaited<ReturnType<ReorderService['source']>>['order'],
    spec: Awaited<ReturnType<ReorderService['source']>>['spec'],
    proof: Awaited<ReturnType<ReorderService['source']>>['proof'],
    quantity: number,
  ) {
    const quote = await this.quotes.save(
      { kind: 'customer', userId: actor.userId },
      'web',
      { ...spec, configuration: { ...spec.configuration, quantities: [quantity] } },
      { customerUserId: actor.userId },
    );
    const cart = await this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: quote.publicId,
        quoteOptionId: quote.options[0]!.publicId,
        designOption: proof ? 'own_file' : order.designOption,
      },
      { orderId: order.id, reuseArtworkProofId: proof?.id ?? null },
    );
    const item = cart.items.find((i) => i.quote.publicId === quote.publicId)!;
    return { cart, cartItemId: item.publicId };
  }

  // --- company bulk reorder (U-B0.1, D-153) -----------------------------------------------------------------

  /**
   * Checks rows {line, orderCode, quantity} against the company's delivered orders and prices each at today's cost
   * (never the old price); a row that cannot be reordered carries the reason (an error code). A short-lived token
   * binds the rows that can.
   */
  async bulkPreview(
    actor: UserActor,
    company: { id: bigint; publicId: string },
    rows: { line: number; orderCode: string; quantity?: number }[],
  ): Promise<BulkReorderPreviewDto> {
    const results: BulkReorderPreviewDto['rows'] = [];
    let total = new MoneyDecimal(0);
    for (const row of rows) {
      try {
        const { order, spec, proof } = await this.source(actor, '', undefined, {
          companyId: company.id,
          orderCode: row.orderCode,
        });
        const quantity = row.quantity ?? order.quantityOrdered;
        const step = await this.price(actor, spec, quantity);
        total = total.add(step.grossAmount!);
        results.push({
          line: row.line,
          orderCode: row.orderCode,
          orderId: order.publicId,
          quantity,
          status: 'ok',
          reason: null,
          unitPrice: step.unitPrice,
          grossAmount: step.grossAmount,
          proofSkipped: proof !== null,
        });
      } catch (error) {
        if (!(error instanceof DomainException)) throw error;
        results.push({
          line: row.line,
          orderCode: row.orderCode,
          orderId: null,
          quantity: row.quantity ?? null,
          status: 'refused',
          reason: error.code === 'http.not_found' ? 'orders.not_found' : error.code,
          unitPrice: null,
          grossAmount: null,
          proofSkipped: false,
        });
      }
    }
    const ok = results.filter((r) => r.status === 'ok');
    const token = randomBytes(24).toString('base64url');
    const binding: BulkBinding = {
      companyId: company.publicId,
      userId: String(actor.userId),
      rows: ok.map((r) => ({
        line: r.line,
        orderCode: r.orderCode,
        quantity: r.quantity!,
        grossAmount: r.grossAmount!,
      })),
    };
    if (ok.length) await this.redis.set(this.key(token), JSON.stringify(binding), 'EX', PREVIEW_TTL_SECONDS);
    return {
      rows: results,
      okCount: ok.length,
      refusedCount: results.length - ok.length,
      grossAmount: formatMoney(total),
      currency: 'THB',
      previewToken: ok.length ? token : null,
      previewExpiresAt: ok.length ? toBangkokIso(new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000)) : null,
    };
  }

  /**
   * Adds the rows a preview accepted to my cart as reorders (D-153). Refused as a whole when the token expired or
   * any price changed since the preview; a row the cart refuses (e.g. already in it) is reported, the others added.
   */
  async bulkAdd(
    actor: UserActor,
    company: { id: bigint; publicId: string },
    previewToken: string,
  ): Promise<BulkReorderResultDto> {
    const raw = await this.redis.get(this.key(previewToken));
    const bound = raw ? (JSON.parse(raw) as BulkBinding) : null;
    if (!bound || bound.companyId !== company.publicId || bound.userId !== String(actor.userId))
      throw new DomainException('orders.reorder_preview_expired');
    const sources = [];
    for (const row of bound.rows) {
      const source = await this.source(actor, '', undefined, {
        companyId: company.id,
        orderCode: row.orderCode,
      });
      const step = await this.price(actor, source.spec, row.quantity);
      if (step.grossAmount !== row.grossAmount)
        throw new DomainException('orders.reorder_repriced', { params: { grossAmount: step.grossAmount! } });
      sources.push({ row, ...source });
    }
    const result: BulkReorderResultDto = { added: [], failed: [] };
    for (const { row, order, spec, proof } of sources) {
      try {
        const { cartItemId } = await this.add(actor, order, spec, proof, row.quantity);
        result.added.push({ line: row.line, orderCode: row.orderCode, cartItemId });
      } catch (error) {
        if (!(error instanceof DomainException)) throw error;
        result.failed.push({ line: row.line, orderCode: row.orderCode, code: error.code });
      }
    }
    await this.redis.del(this.key(previewToken));
    return result;
  }

  /**
   * My delivered order with an instant specification (or, for a company bulk reorder, the company's order by its
   * code), and the approved proof a reorder reuses.
   */
  private async source(
    actor: UserActor,
    orderPublicId: string,
    reuseArtwork: boolean | undefined,
    company?: { companyId: bigint; orderCode: string },
  ) {
    const order = await this.prisma.order.findFirst({
      where: company
        ? { orderCode: company.orderCode, orderGroup: { companyId: company.companyId } }
        : { publicId: orderPublicId, customerUserId: actor.userId },
      include: {
        quote: true,
        catalogProduct: { select: { quantityMin: true, quantityMax: true } },
        proofs: { where: { status: 'approved' }, orderBy: { versionNo: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new DomainException('http.not_found');
    if (!order.deliveredAt)
      throw new DomainException('orders.reorder_unavailable', { params: { reason: 'not delivered yet' } });
    const original = order.quote.input as {
      productTypeCode?: string;
      configuration?: FoldingConfiguration;
      deliveryPostcode?: string | null;
    };
    if (!original.productTypeCode || !original.configuration)
      throw new DomainException('orders.reorder_unavailable', {
        params: { reason: 'no instant specification' },
      });
    const spec = {
      productTypeCode: original.productTypeCode,
      configuration: original.configuration,
      ...(original.deliveryPostcode && { deliveryPostcode: original.deliveryPostcode }),
    };
    const proof = reuseArtwork === false ? null : (order.proofs[0] ?? null);
    return { order, spec, proof };
  }

  /** The same specification at `quantity`, priced as saving the quote would (never the old price). */
  private async price(
    actor: UserActor,
    spec: { productTypeCode: string; configuration: FoldingConfiguration; deliveryPostcode?: string },
    quantity: number,
  ) {
    const view = await this.quotes.preview({ kind: 'customer', userId: actor.userId }, 'web', {
      ...spec,
      configuration: { ...spec.configuration, quantities: [quantity] },
    });
    const step = view.steps[0];
    if (!step?.instant || step.grossAmount === null) throw new DomainException('pricing.not_instant');
    return step;
  }

  private key(token: string): string {
    return `reorder:preview:${Buffer.from(sha256(token)).toString('hex')}`;
  }

  /** The new order of a reorder with unchanged artwork gets the approved proof and skips the artwork step. */
  @OnDomainEvent('order_group.placed', { consumer: 'reorders.artwork' })
  async onPlaced(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const orderIds = (event.payload['orderIds'] as string[] | undefined) ?? [];
    const orders = await tx.order.findMany({
      where: { publicId: { in: orderIds }, reuseArtworkProofId: { not: null }, artworkApprovedAt: null },
      include: { reuseArtworkProof: true, proofs: { select: { id: true } } },
    });
    const actor = systemActor('reorders.artwork');
    for (const order of orders) {
      const source = order.reuseArtworkProof!;
      if (order.proofs.length > 0 || source.status !== 'approved') continue;
      const at = new Date();
      const proof = await tx.proof.create({
        data: {
          orderId: order.id,
          versionNo: 1,
          proofFileId: source.proofFileId,
          dielineFileId: source.dielineFileId,
          preparedById: source.preparedById,
          status: 'approved',
          sentAt: at,
          decidedAt: at,
          // The customer chose the unchanged artwork when reordering (D-153).
          decidedByUserId: order.customerUserId,
          decisionChannel: 'web',
          decisionComment: 'reorder with unchanged artwork (D-153)',
          approvedFileId: source.approvedFileId,
          approvedFileSha256: source.approvedFileSha256,
          reusedFromProofId: source.id,
        },
      });
      await this.orders.applyFact(tx, order.id, { kind: 'artwork_approved' }, actor, at);
      await this.record(tx, order.publicId, order.entityId, proof.publicId, source.publicId, actor);
    }
  }

  private async record(
    tx: Tx,
    orderPublicId: string,
    entityId: bigint,
    proofId: string,
    reusedFromProofId: string,
    actor: Actor,
  ) {
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: orderPublicId,
      action: 'artwork.reused',
      messageKey: 'activity.artwork.reused',
      messageParams: { proofId, reusedFromProofId },
      visibility: ['internal', 'customer'],
      entityId,
      actor,
    });
  }
}
