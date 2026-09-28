import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CartRow, CartsService } from '@modules/carts/carts.service';
import { OrdersService } from '@modules/orders/orders.service';
import { type FoldingConfiguration } from '@modules/pricing/calculators/folding/folding-snapshot.loader';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

/**
 * Reorder (D-153): from a delivered order, the same specification priced again at today's cost (a new
 * quote — never the old price), quantity editable, into the cart. With the artwork unchanged the approved
 * proof carries over: when the new order is placed it gets an approved copy of that proof (same locked
 * file and hash) and the artwork step is skipped.
 */
@Injectable()
export class ReorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: SavedQuotesService,
    private readonly carts: CartsService,
    private readonly orders: OrdersService,
    private readonly activity: ActivityLogService,
  ) {}

  async reorder(
    actor: UserActor,
    orderPublicId: string,
    input: { quantity?: number; reuseArtwork?: boolean },
  ): Promise<CartRow> {
    const order = await this.prisma.order.findFirst({
      where: { publicId: orderPublicId, customerUserId: actor.userId },
      include: {
        quote: true,
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
    const quote = await this.quotes.save(
      { kind: 'customer', userId: actor.userId },
      'web',
      {
        productTypeCode: original.productTypeCode,
        configuration: { ...original.configuration, quantities: [input.quantity ?? order.quantityOrdered] },
        ...(original.deliveryPostcode && { deliveryPostcode: original.deliveryPostcode }),
      },
      { customerUserId: actor.userId },
    );
    const proof = input.reuseArtwork === false ? null : (order.proofs[0] ?? null);
    return this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: quote.publicId,
        quoteOptionId: quote.options[0]!.publicId,
        designOption: proof ? 'own_file' : order.designOption,
      },
      { orderId: order.id, reuseArtworkProofId: proof?.id ?? null },
    );
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
