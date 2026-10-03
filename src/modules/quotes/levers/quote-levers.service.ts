import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type QuoteLever } from '@generated/prisma/client';
import { assertStoreRules, validateConfiguration } from '@modules/pricing/quotes/configurations';
import { QuoteEngineService, type QuoteStepView } from '@modules/pricing/quotes/quote-engine.service';
import { targetGap } from '@modules/pricing/quotes/target-price';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type QuoteOwner, type QuoteRow, SavedQuotesService } from '../saved-quotes.service';
import { type LeverCandidate, leverCandidates } from './lever-candidates';

/** D-248: levers shown at most (largest saving first) — a technical cap. */
export const MAX_LEVERS_SHOWN = 5;

export interface LeverStep {
  quantity: number;
  unitPrice: string;
  grossAmount: string;
  leadTimeDays: number | null;
  gapPerUnit: string;
  gapPct: string;
  meetsTarget: boolean;
}

export interface LeverSet {
  quote: QuoteRow;
  /** `computed`: levers below; `meets_target`: no quantity is above the target; `not_instant`: an RFQ quotation. */
  status: 'computed' | 'meets_target' | 'not_instant';
  levers: (QuoteLever & { takenBy: { publicId: string } | null })[];
}

const LIVE = ['saved', 'shared'];

/**
 * D-248 / D-249 levers: alternatives to a saved quotation above its target, priced by the real engine (no calculate
 * log) exactly like a store calculation — store rules apply, a candidate the engine refuses or that is not cheaper is
 * dropped — computed once on the first request, stored write-once and valid until the quotation's `valid_until`.
 * Taking a lever saves a new quotation from its configuration that supersedes the original (outcome `revised`).
 */
@Injectable()
export class QuoteLeversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly settings: SettingsService,
    private readonly quotes: SavedQuotesService,
    private readonly events: DomainEvents,
  ) {}

  /** `compute: false` (staff) reads what was computed for the customer without computing (levers shown, D-250). */
  async levers(
    owner: QuoteOwner,
    quotePublicId: string,
    now = new Date(),
    compute = true,
  ): Promise<LeverSet> {
    const quote = await this.quotes.get(owner, quotePublicId);
    if (!quote.targetPricePerUnit) throw new DomainException('quotes.no_target');
    if (quote.source !== 'instant') return { quote, status: 'not_instant', levers: [] };
    if (!quote.leversComputedAt && compute) {
      if (!LIVE.includes(quote.status) || quote.validUntil <= now)
        throw new DomainException('quotes.not_live');
      await this.compute(quote, now);
    }
    const levers = await this.prisma.quoteLever.findMany({
      where: { quoteId: quote.id },
      orderBy: { rank: 'asc' },
      include: { takenBy: { select: { publicId: true } } },
    });
    const above = quote.options.some((o) => !targetGap(o.unitPrice, quote.targetPricePerUnit)!.meetsTarget);
    return { quote, status: above ? 'computed' : 'meets_target', levers };
  }

  /** D-249: saves a new quotation from the lever; the original is superseded with outcome `revised`. */
  async apply(
    owner: QuoteOwner,
    quotePublicId: string,
    leverPublicId: string,
    now = new Date(),
  ): Promise<QuoteRow> {
    const quote = await this.quotes.get(owner, quotePublicId);
    const lever = await this.prisma.quoteLever.findUnique({
      where: { publicId: leverPublicId },
      include: { takenBy: { select: { id: true } } },
    });
    if (!lever || lever.quoteId !== quote.id) throw new DomainException('http.not_found');
    if (!LIVE.includes(quote.status) || quote.validUntil <= now || lever.validUntil <= now || lever.takenBy) {
      throw new DomainException('quotes.not_live');
    }
    const input = quote.input as { productTypeCode: string; deliveryPostcode: string | null };
    return this.quotes.save(
      owner,
      quote.channel,
      {
        productTypeCode: input.productTypeCode,
        configuration: lever.configuration as Record<string, unknown>,
        deliveryPostcode: input.deliveryPostcode ?? undefined,
        anonymousId: quote.anonymousId ?? undefined,
        targetPricePerUnit: quote.targetPricePerUnit!.toFixed(2),
      },
      { customerUserId: quote.customerUserId ?? undefined, supersedes: quote.id, fromLeverId: lever.id },
    );
  }

  private async compute(quote: QuoteRow, now: Date): Promise<void> {
    const target = quote.targetPricePerUnit!;
    const above = quote.options.some((o) => !targetGap(o.unitPrice, target)!.meetsTarget);
    const rows: Omit<Prisma.QuoteLeverCreateManyInput, 'quoteId'>[] = [];
    if (above) {
      const priced = await this.priceCandidates(quote, now);
      priced
        .sort((a, b) => b.saving.comparedTo(a.saving) || a.order - b.order)
        .slice(0, MAX_LEVERS_SHOWN)
        .forEach((p, i) =>
          rows.push({
            rank: i + 1,
            kind: p.candidate.kind,
            changes: p.candidate.changes as unknown as Prisma.InputJsonValue,
            configuration: p.candidate.configuration as Prisma.InputJsonValue,
            steps: p.steps as unknown as Prisma.InputJsonValue,
            reasonCodes: p.candidate.reasonCodes,
            bestSavingPct: p.saving.toDecimalPlaces(4).toFixed(4),
            validUntil: quote.validUntil,
          }),
        );
    }
    await this.prisma.withTx(async (tx) => {
      // The first request computes; a concurrent one waits on this row and then finds the levers stored.
      const { count } = await tx.quote.updateMany({
        where: { id: quote.id, leversComputedAt: null },
        data: { leversComputedAt: now },
      });
      if (count === 0) return;
      if (rows.length > 0)
        await tx.quoteLever.createMany({ data: rows.map((r) => ({ ...r, quoteId: quote.id })) });
      await this.events.record(tx, {
        type: 'quote.levers_computed',
        aggregateType: 'quote',
        aggregateId: quote.publicId,
        payload: { quoteId: quote.publicId, levers: rows.length, kinds: rows.map((r) => r.kind) },
      });
    });
  }

  private async priceCandidates(quote: QuoteRow, now: Date) {
    const input = quote.input as {
      productTypeCode: string;
      configuration: Record<string, unknown>;
      deliveryPostcode: string | null;
    };
    const type = await this.prisma.productType.findUniqueOrThrow({ where: { id: quote.productTypeId } });
    const key = type.calculatorKey;
    if (!key || !this.engine.hasCalculator(key)) return [];
    const product = quote.catalogProductId
      ? await this.prisma.catalogProduct.findUnique({
          where: { id: quote.catalogProductId },
          select: {
            quantityPresets: true,
            options: { where: { optionKind: 'material' }, select: { optionId: true } },
          },
        })
      : null;
    const materials = product?.options.length
      ? await this.prisma.material.findMany({
          where: { id: { in: product.options.map((o) => o.optionId) }, status: 'active' },
          select: { publicId: true },
          orderBy: { code: 'asc' },
        })
      : [];
    const multipliers = (await this.settings.at('quotes.lever_quantity_multipliers', { at: now })).value;
    const candidates = leverCandidates(input.configuration, {
      materialIds: materials.map((m) => m.publicId),
      quantityPresets: product?.quantityPresets ?? [],
      quantityMultipliers: multipliers,
    });
    const target = quote.targetPricePerUnit!;
    const byQuantity = new Map(quote.options.map((o) => [o.quantity, o.unitPrice]));
    const largest = quote.options.at(-1)!;
    const out: {
      candidate: LeverCandidate;
      steps: LeverStep[];
      saving: InstanceType<typeof MoneyDecimal>;
      order: number;
    }[] = [];
    for (const [order, candidate] of candidates.entries()) {
      let steps: QuoteStepView[];
      try {
        const configuration = await validateConfiguration(key, candidate.configuration, { staff: false });
        await assertStoreRules(this.prisma, key, configuration);
        const view = await this.engine.price(key, configuration, {
          channel: quote.channel,
          at: now,
          log: false,
          deliveryPostcode: input.deliveryPostcode ?? undefined,
        });
        steps = view.steps.filter((s) => s.instant && s.unitPrice !== null);
      } catch (error) {
        // A candidate the engine or the store rules refuse is not a lever.
        if (error instanceof DomainException) continue;
        throw error;
      }
      // Saving against the quotation at the same quantity; a quantity lever against its largest quantity.
      let saving = new MoneyDecimal(0);
      for (const s of steps) {
        const base = candidate.kind === 'quantity' ? largest.unitPrice : byQuantity.get(s.quantity);
        if (!base || base.lte(0)) continue;
        const pct = new MoneyDecimal(base.toString()).minus(s.unitPrice!).div(base.toString()).times(100);
        if (pct.gt(saving)) saving = pct;
      }
      if (saving.toDecimalPlaces(4).lte(0)) continue;
      out.push({
        candidate,
        order,
        saving,
        steps: steps.map((s) => {
          const gap = targetGap(s.unitPrice, target)!;
          return {
            quantity: s.quantity,
            unitPrice: s.unitPrice!,
            grossAmount: s.grossAmount!,
            leadTimeDays: s.leadTimeDays,
            ...gap,
          };
        }),
      });
    }
    return out;
  }
}
