import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type FinalLine, PriceListBuilder } from '@modules/partners/pricing/price-list-builder';
import {
  type QuoteRepricer,
  type RepriceRequest,
  type RepriceResult,
} from '@modules/partners/pricing/quote-repricer.port';
import { type LoadedOptionBase, type ResolvedBase } from '@modules/pricing/calculators/adapter';
import { CalculatorRegistry } from '@modules/pricing/calculators/calculator';
import { Injectable, Logger } from '@nestjs/common';

/** Thrown to roll the simulation transaction back once the numbers are taken. */
class Rollback extends Error {
  constructor(readonly result: RepriceResult) {
    super('simulation rollback');
  }
}

type Json = Prisma.JsonValue;
const values = (v: Json | null) =>
  v === null ? null : (v as Record<string, string | number | boolean | null>);

/**
 * Impact simulation of a price proposal on saved quotes (D-040 note, B2.2 port implemented in B2.5):
 * the factory's instant quotes of the window are re-priced on a throw-away draft version built from
 * the proposal (base version + every line as proposed or countered), inside a transaction that is
 * always rolled back. Price and margin deltas compare the product part only (shipping unchanged).
 * Selection share is computed only while one factory serves the type (then 0); with competitors it
 * would need every factory re-ranked and is reported as null.
 */
@Injectable()
export class SavedQuotesRepricer implements QuoteRepricer {
  private readonly logger = new Logger(SavedQuotesRepricer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculators: CalculatorRegistry,
    private readonly builder: PriceListBuilder,
  ) {}

  async reprice(request: RepriceRequest): Promise<RepriceResult> {
    const options = await this.prisma.quoteOption.findMany({
      where: {
        selectedFactoryId: request.factoryId,
        quote: {
          productTypeId: request.productTypeId,
          source: 'instant',
          createdAt: { gte: request.windowFrom, lt: request.windowTo },
        },
      },
      include: { quote: { select: { id: true, input: true, createdAt: true } } },
    });
    const quoteIds = new Set(options.map((o) => o.quote.id));
    if (quoteIds.size === 0) {
      return {
        quotesInWindow: 0,
        priceChangePct: null,
        marginChangePct: null,
        selectionShareChangePct: null,
      };
    }
    const competitors = await this.prisma.quoteOption.count({
      where: {
        selectedFactoryId: { not: request.factoryId },
        quote: {
          productTypeId: request.productTypeId,
          createdAt: { gte: request.windowFrom, lt: request.windowTo },
        },
      },
    });
    try {
      await this.prisma.withTx(
        async (tx) => {
          const versionId = await this.draftFromProposal(tx, request.proposalId);
          const factory = await tx.factory.findUniqueOrThrow({ where: { id: request.factoryId } });
          const type = await tx.productType.findUniqueOrThrow({ where: { id: request.productTypeId } });
          if (!type.calculatorKey || !this.calculators.has(type.calculatorKey)) {
            throw new Error(`no calculator for product type ${type.code}`);
          }
          const adapter = this.calculators.get(type.calculatorKey);
          const priceChanges: MoneyValue[] = [];
          const marginChanges: MoneyValue[] = [];
          const byQuote = new Map<bigint, typeof options>();
          for (const o of options) byQuote.set(o.quote.id, [...(byQuote.get(o.quote.id) ?? []), o]);
          for (const quoteOptions of byQuote.values()) {
            const input = quoteOptions[0]!.quote.input as unknown as { configuration: unknown };
            const at = quoteOptions[0]!.quote.createdAt;
            try {
              const cfg = adapter.withQuantities(
                input.configuration,
                quoteOptions.map((o) => o.quantity),
              ) as unknown;
              const resolved = (await adapter.resolve(cfg, tx)) as ResolvedBase;
              const loaded = (await adapter.options(
                factory,
                versionId,
                resolved,
                at,
                tx,
              )) as LoadedOptionBase[];
              const result = adapter.calculate(resolved, loaded, { withDesign: true });
              quoteOptions.forEach((o, index) => {
                const steps = result.map((r) => r.steps[index]).filter((s) => s !== null && s !== undefined);
                const best = steps.sort((a, b) => a.buyPrice - b.buyPrice)[0];
                if (!best) return;
                const shipping = o.shippingAmount
                  ? new MoneyDecimal(o.shippingAmount.toString())
                  : new MoneyDecimal(0);
                const oldProduct = new MoneyDecimal(o.grossAmount.toString()).sub(shipping);
                if (oldProduct.isZero()) return;
                priceChanges.push(new MoneyDecimal(best.total).sub(oldProduct).div(oldProduct).mul(100));
                if (o.marginPct !== null)
                  marginChanges.push(new MoneyDecimal(best.marginPct).sub(o.marginPct.toString()));
              });
            } catch (error) {
              this.logger.warn({ err: (error as Error).message }, 'quote skipped in impact simulation');
            }
          }
          const mean = (xs: MoneyValue[]) =>
            xs.length === 0
              ? null
              : xs
                  .reduce((a, b) => a.add(b), new MoneyDecimal(0))
                  .div(xs.length)
                  .toDecimalPlaces(4)
                  .toFixed(4);
          throw new Rollback({
            quotesInWindow: quoteIds.size,
            priceChangePct: mean(priceChanges),
            marginChangePct: mean(marginChanges),
            selectionShareChangePct: competitors === 0 ? '0.0000' : null,
          });
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.result;
      throw error;
    }
    throw new Error('unreachable');
  }

  /** A draft version of the proposal's price list: base rows plus every proposal line applied. */
  private async draftFromProposal(tx: Tx, proposalId: bigint): Promise<bigint> {
    const proposal = await tx.priceProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { lines: true },
    });
    const last = await tx.priceListVersion.findFirst({
      where: { priceListId: proposal.priceListId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const version = await tx.priceListVersion.create({
      data: {
        priceListId: proposal.priceListId,
        versionNo: (last?.versionNo ?? 0) + 1,
        origin: 'factory_proposal',
        basedOnVersionId: proposal.baseVersionId,
        effectiveFrom: new Date(),
        reason: 'impact simulation (rolled back)',
      },
    });
    const lines: FinalLine[] = proposal.lines.map((l) => ({
      component: l.component,
      action: l.action,
      lineKey: l.lineKey,
      values:
        l.action === 'remove' ? null : { ...values(l.proposedValues)!, ...(values(l.counterValues) ?? {}) },
    }));
    await this.builder.populate(tx, version.id, proposal.baseVersionId, lines);
    return version.id;
  }
}
