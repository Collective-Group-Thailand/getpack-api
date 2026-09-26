import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type QuoteOwner, SavedQuotesService } from './saved-quotes.service';

export interface CartItemSnapshot {
  quoteId: bigint;
  quotePublicId: string;
  quoteOptionId: bigint;
  quoteOptionPublicId: string;
  quantity: number;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  shippingAmount: string | null;
  unitPrice: string;
  /** The price lock (D-051): the cart re-prices after this instant with a confirmed diff (B3.1). */
  priceLockedUntil: Date;
  configRefs: Prisma.JsonValue;
  snapshotSha256: Buffer;
}

/**
 * Quote → cart item (B2.5; the cart itself is B3.1): a live quote's option is handed over with its
 * snapshot and price lock, then the quote is marked `converted` in the cart's transaction.
 */
@Injectable()
export class QuoteConversionService {
  constructor(private readonly quotes: SavedQuotesService) {}

  /** The option to put in a cart; refuses a quote that is not live (expired quotes are re-priced first). */
  async cartItem(
    tx: Tx,
    owner: QuoteOwner,
    quotePublicId: string,
    optionPublicId: string,
  ): Promise<CartItemSnapshot> {
    const quote = await this.quotes.get(owner, quotePublicId, tx);
    if (!['saved', 'shared', 'converted'].includes(quote.status) || quote.validUntil <= new Date()) {
      throw new DomainException('quotes.not_live');
    }
    const option = quote.options.find((o) => o.publicId === optionPublicId);
    if (!option) throw new DomainException('http.not_found');
    return {
      quoteId: quote.id,
      quotePublicId: quote.publicId,
      quoteOptionId: option.id,
      quoteOptionPublicId: option.publicId,
      quantity: option.quantity,
      netAmount: option.netAmount.toFixed(2),
      vatAmount: option.vatAmount.toFixed(2),
      grossAmount: option.grossAmount.toFixed(2),
      shippingAmount: option.shippingAmount?.toFixed(2) ?? null,
      unitPrice: option.unitPrice.toFixed(6),
      priceLockedUntil: quote.validUntil,
      configRefs: quote.configRefs,
      snapshotSha256: Buffer.from(quote.snapshotSha256),
    };
  }

  /** Marks the quote converted (idempotent) in the caller's transaction. */
  async markConverted(tx: Tx, quoteId: bigint): Promise<void> {
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    if (quote.status === 'converted') return;
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'converted', convertedAt: new Date(), rowVersion: { increment: 1 } },
    });
    await this.quotes.record(tx, quote.publicId, 'quote.converted', {});
  }
}
