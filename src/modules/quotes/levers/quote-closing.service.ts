import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type MeasurementBasis } from '@generated/prisma/client';
import { RfqsService } from '@modules/rfq/rfqs.service';
import { Injectable } from '@nestjs/common';

import { type QuoteOwner, type QuoteRow, SavedQuotesService } from '../saved-quotes.service';
import { QuoteOutcomesService } from './quote-outcomes.service';

const LIVE = ['saved', 'shared'] as const;

/**
 * Ending a quotation by the customer (D-250, D-251): declined with an optional loss reason (outcome `lost`), or sent
 * to CS as a pre-filled RFQ (outcome `converted_to_rfq`). Only a live quotation (saved or shared, within its
 * validity) can end this way; each ends once.
 */
@Injectable()
export class QuoteClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: SavedQuotesService,
    private readonly outcomes: QuoteOutcomesService,
    private readonly rfqs: RfqsService,
  ) {}

  async decline(
    owner: QuoteOwner,
    publicId: string,
    input: { reasonCode?: string; note?: string },
  ): Promise<QuoteRow> {
    const reason = input.reasonCode
      ? await this.prisma.quoteLossReason.findFirst({ where: { code: input.reasonCode, active: true } })
      : null;
    if (input.reasonCode && !reason) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reasonCode', code: 'exists', message: 'unknown loss reason' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const quote = await this.quotes.get(owner, publicId, tx);
      await this.close(tx, quote, 'declined');
      await this.outcomes.record(tx, quote.id, 'lost', {
        lossReasonId: reason?.id ?? null,
        lossNote: input.note ?? null,
      });
      await this.quotes.record(tx, quote.publicId, 'quote.declined', { reasonCode: reason?.code ?? null });
      return this.quotes.get(owner, publicId, tx);
    });
  }

  /** D-251: the quotation becomes an RFQ pre-filled from its configuration, routed from it. */
  async sendToCs(
    owner: QuoteOwner,
    publicId: string,
    input: { deliveryPostcode?: string; spec?: Record<string, unknown>; notes?: string },
  ) {
    if (owner.kind !== 'customer') throw new DomainException('auth.forbidden');
    const quote = await this.quotes.get(owner, publicId);
    this.assertLive(quote);
    const deliveryPostcode = input.deliveryPostcode ?? quote.deliveryPostcode;
    if (!deliveryPostcode) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'deliveryPostcode', code: 'required', message: 'give the delivery postcode' }],
      });
    }
    const stored = quote.input as {
      productTypeCode: string;
      configuration?: Record<string, unknown>;
      dimensions?: { basis?: MeasurementBasis; entered?: { l?: number; w?: number; d?: number } };
    };
    const cfg = stored.configuration ?? {};
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    const entered = stored.dimensions?.entered;
    const basis = (stored.dimensions?.basis ??
      (typeof cfg['basis'] === 'string' ? cfg['basis'] : undefined)) as MeasurementBasis | undefined;
    const rfq = await this.rfqs.submit(
      owner.userId,
      quote.channel,
      {
        productTypeCode: stored.productTypeCode,
        spec: input.spec ?? {},
        lengthMm: num(entered?.l ?? cfg['l']),
        widthMm: num(entered?.w ?? cfg['w']),
        heightMm: num(entered?.d ?? cfg['d']),
        ...(basis && { measurementBasis: basis }),
        quantities: quote.options.map((o) => o.quantity),
        deliveryPostcode,
        notes: input.notes,
        targetPricePerUnit: quote.targetPricePerUnit?.toFixed(2) ?? null,
        // D-269: the style travels to CS with the request.
        styleVariantCode: typeof cfg['styleVariantCode'] === 'string' ? cfg['styleVariantCode'] : null,
      },
      undefined,
      {
        routedFromQuoteId: quote.id,
        inTx: async (tx, created) => {
          const fresh = await this.quotes.get(owner, publicId, tx);
          await this.close(tx, fresh, 'routed_to_rfq');
          await this.outcomes.record(tx, quote.id, 'converted_to_rfq', { rfqId: created.id });
          await this.quotes.record(tx, quote.publicId, 'quote.routed_to_rfq', { rfqId: created.publicId });
        },
      },
    );
    return { rfqId: rfq.publicId, rfqCode: rfq.rfqCode, quoteStatus: 'routed_to_rfq' as const };
  }

  private assertLive(quote: QuoteRow) {
    if (!(LIVE as readonly string[]).includes(quote.status) || quote.validUntil <= new Date())
      throw new DomainException('quotes.not_live');
  }

  /** A live quotation ends with `status`; a concurrent change makes it not live (409). */
  private async close(tx: Tx, quote: QuoteRow, status: 'declined' | 'routed_to_rfq') {
    this.assertLive(quote);
    const { count } = await tx.quote.updateMany({
      where: { id: quote.id, status: { in: [...LIVE] }, validUntil: { gt: new Date() } },
      data: { status, rowVersion: { increment: 1 } },
    });
    if (count !== 1) throw new DomainException('quotes.not_live');
  }
}
