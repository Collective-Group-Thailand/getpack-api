import { type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type Prisma } from '@generated/prisma/client';
import { type QuoteCalculationDto } from '@modules/pricing/quotes/quote.dto';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { StorePricingService } from '@modules/pricing/quotes/store-pricing.service';
import { type QuoteRow, SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { type RfqRow, RfqsService } from '@modules/rfq/rfqs.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';

import {
  changeReasons,
  type PriceChangeReason,
  specHash,
  type StudioBox,
  studioConfiguration,
  type StudioInput,
} from './studio-spec';

/** A studio quote is served again from its snapshot within this window (technical: debounced re-quotes, D-277). */
const CACHE_WINDOW_MS = 5 * 60_000;
/** Studio quotes per signed-in customer per minute (technical: the dock re-quotes on every change, debounced). */
const QUOTES_PER_MINUTE = 60;

export interface StudioQuoteInput {
  quantities: number[];
  deliveryPostcode?: string;
  versionNo?: number;
  targetPricePerUnit?: string;
  /** The hash of the quote shown before this change: the answer explains the difference. */
  previousSpecHash?: string;
}

export interface StudioQuoteResult {
  specHash: string;
  versionNo: number;
  mode: 'instant' | 'rfq';
  calculation: QuoteCalculationDto | null;
  cached: boolean;
  reasons: PriceChangeReason[];
  previousSpecHash: string | null;
  changes: { quantity: number; previousUnitPrice: string; unitPrice: string }[];
}

interface Priced {
  input: StudioInput;
  hash: string;
  versionId: bigint;
  versionNo: number;
  productTypeId: bigint;
  instant: boolean;
}

/**
 * D-277 quote from design: the studio prices a design version's spec (D-275), checked against its box, through the
 * same engine and store rules as `store.quotes.calculate`; the answer carries a `specHash` and is served again from its
 * snapshot within the cache window. Price changes are explained against the previous hash. A quotation saved from the
 * studio carries the version and the hash, so checkout charges exactly the studio price (spec §1). Non-instant types
 * go to an RFQ pre-filled with the version.
 */
@Injectable()
export class StudioQuotesService {
  private readonly logger = new Logger(StudioQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly quotes: SavedQuotesService,
    private readonly rfqs: RfqsService,
    private readonly storePricing: StorePricingService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async quote(actor: UserActor, designId: string, body: StudioQuoteInput): Promise<StudioQuoteResult> {
    await this.rateLimit(actor.userId);
    const p = await this.input(actor, designId, body.quantities, body.deliveryPostcode, body.versionNo);
    const previous = body.previousSpecHash ? await this.snapshot(body.previousSpecHash) : null;
    const base = {
      specHash: p.hash,
      versionNo: p.versionNo,
      previousSpecHash: previous ? body.previousSpecHash! : null,
    };
    if (!p.instant)
      return {
        ...base,
        mode: 'rfq',
        calculation: null,
        cached: false,
        reasons: previous ? changeReasons(previous.input, p.input) : [],
        changes: [],
      };

    const hashBytes = Buffer.from(p.hash, 'hex');
    const existing = await this.prisma.studioQuoteSnapshot.findUnique({ where: { specHash: hashBytes } });
    // A snapshot from before D-441 has no spec lines: priced again, so the dock always says which spec it priced.
    const fresh =
      existing &&
      existing.pricedAt.getTime() > Date.now() - CACHE_WINDOW_MS &&
      Array.isArray((existing.result as { specs?: unknown } | null)?.specs);
    let calculation: QuoteCalculationDto;
    if (fresh) {
      calculation = existing.result as unknown as QuoteCalculationDto;
    } else {
      calculation = await this.price(p.input, actor);
      const data = {
        productTypeId: p.productTypeId,
        input: p.input as unknown as Prisma.InputJsonValue,
        result: calculation as unknown as Prisma.InputJsonValue,
        pricedAt: new Date(),
      };
      await this.prisma.studioQuoteSnapshot.upsert({
        where: { specHash: hashBytes },
        create: { specHash: hashBytes, ...data },
        update: data,
      });
    }
    // The target gap is the caller's, never cached (D-247).
    if (body.targetPricePerUnit) calculation = await this.price(p.input, actor, body.targetPricePerUnit);

    const reasons = previous ? changeReasons(previous.input, p.input) : [];
    const before = previous ? (previous.result as unknown as QuoteCalculationDto) : null;
    const repriced = existing && !fresh ? (existing.result as unknown as QuoteCalculationDto) : null;
    // Same input, different prices: the price lists or settings moved on.
    if (repriced && differentPrices(repriced, calculation)) reasons.push('prices_changed');
    return {
      ...base,
      mode: 'instant',
      calculation,
      cached: !!fresh && !body.targetPricePerUnit,
      reasons,
      changes: before ? unitChanges(before, calculation) : [],
    };
  }

  /** Saves the quotation of the studio quote: the same input, re-priced on save as every quotation (D-051). */
  async save(
    actor: UserActor,
    designId: string,
    body: Omit<StudioQuoteInput, 'previousSpecHash'>,
  ): Promise<QuoteRow> {
    const p = await this.input(actor, designId, body.quantities, body.deliveryPostcode, body.versionNo);
    if (!p.instant) throw new DomainException('pricing.not_instant');
    return this.quotes.save(
      { kind: 'customer', userId: actor.userId },
      'web',
      {
        productTypeCode: p.input.productTypeCode,
        configuration: p.input.configuration,
        deliveryPostcode: p.input.deliveryPostcode ?? undefined,
        targetPricePerUnit: body.targetPricePerUnit ?? null,
      },
      {
        ip: RequestContext.current()?.ip,
        studio: { designDocumentVersionId: p.versionId, specHash: Buffer.from(p.hash, 'hex') },
      },
    );
  }

  /** D-277: an RFQ pre-filled with the design version, its sizes and style; the form answers are the customer's. */
  async requestQuote(
    actor: UserActor,
    designId: string,
    body: {
      quantities: number[];
      deliveryPostcode: string;
      versionNo?: number;
      spec: Record<string, unknown>;
      notes?: string;
      targetDate?: string | null;
      fileIds?: string[];
      targetPricePerUnit?: string | null;
    },
  ): Promise<RfqRow> {
    const p = await this.input(actor, designId, body.quantities, body.deliveryPostcode, body.versionNo);
    const c = p.input.configuration;
    const size = (k: string) => (typeof c[k] === 'number' ? c[k] : null);
    return this.rfqs.submit(
      actor.userId,
      'web',
      {
        productTypeCode: p.input.productTypeCode,
        spec: body.spec,
        lengthMm: size('l'),
        widthMm: size('w'),
        heightMm: size('d'),
        ...(typeof c['basis'] === 'string' && { measurementBasis: c['basis'] as 'internal' }),
        quantities: body.quantities,
        deliveryPostcode: body.deliveryPostcode,
        notes: body.notes,
        targetDate: body.targetDate ?? null,
        fileIds: body.fileIds,
        targetPricePerUnit: body.targetPricePerUnit ?? null,
        styleVariantCode: typeof c['styleVariantCode'] === 'string' ? c['styleVariantCode'] : null,
      },
      undefined,
      {
        inTx: async (tx, rfq) => {
          await tx.rfq.update({ where: { id: rfq.id }, data: { designDocumentVersionId: p.versionId } });
        },
      },
    );
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  /** The version's pricing input, checked against its box (D-275); my own designs only. */
  private async input(
    actor: UserActor,
    designId: string,
    quantities: number[],
    deliveryPostcode: string | undefined,
    versionNo: number | undefined,
  ): Promise<Priced> {
    const doc = await this.prisma.designDocument.findFirst({
      where: { publicId: designId, ownerUserId: actor.userId, deletedAt: null },
      include: {
        catalogProduct: { select: { productType: true } },
        pattern: { select: { publicId: true } },
        currentVersion: true,
      },
    });
    if (!doc) throw new DomainException('http.not_found');
    const version =
      versionNo !== undefined
        ? await this.prisma.designDocumentVersion.findUnique({
            where: { documentId_versionNo: { documentId: doc.id, versionNo } },
          })
        : doc.currentVersion;
    if (!version)
      throw new DomainException(versionNo !== undefined ? 'http.not_found' : 'designs.version_required');
    if (!version.spec) throw new DomainException('studio.spec_missing');
    const box = version.box as unknown as StudioBox;
    const { configuration, problems } = studioConfiguration(
      box,
      version.spec as Record<string, unknown>,
      doc.pattern?.publicId ?? null,
      quantities,
    );
    if (problems.length > 0)
      throw new DomainException('studio.spec_mismatch', {
        errors: problems.map((p) => ({ path: p.path, code: 'mismatch', message: p.message })),
      });
    const type = doc.catalogProduct.productType;
    const input: StudioInput = {
      productTypeCode: type.code,
      configuration,
      deliveryPostcode: deliveryPostcode ?? null,
    };
    const instant =
      type.status === 'active' &&
      type.quoteMode === 'instant' &&
      !!type.calculatorKey &&
      this.engine.hasCalculator(type.calculatorKey);
    return {
      input,
      hash: specHash(input),
      versionId: version.id,
      versionNo: version.versionNo,
      productTypeId: type.id,
      instant,
    };
  }

  /**
   * The one store pricing path (D-441): the same service as `store.quotes.calculate` and the "starting from" prices
   * (validation, store rules, engine, spec lines) — the dock shows `specLabel` with the price, e.g. an empty draft
   * reads "… · ไม่พิมพ์" (Stage A decision: an empty draft is priced unprinted).
   */
  private async price(input: StudioInput, actor: UserActor, target?: string): Promise<QuoteCalculationDto> {
    const type = await this.prisma.productType.findFirstOrThrow({ where: { code: input.productTypeCode } });
    const priced = await this.storePricing.price(
      type.calculatorKey!,
      input.configuration,
      {
        actorUserId: actor.userId,
        ip: RequestContext.current()?.ip,
        deliveryPostcode: input.deliveryPostcode ?? undefined,
      },
      target,
    );
    return priced.calculation;
  }

  private async snapshot(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const row = await this.prisma.studioQuoteSnapshot.findUnique({
      where: { specHash: Buffer.from(hash, 'hex') },
    });
    return row ? { input: row.input as unknown as StudioInput, result: row.result } : null;
  }

  /** Redis counter per user and minute; without Redis the dock is not limited (logged). */
  private async rateLimit(userId: bigint): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `studio:quotes:${userId}:${minute}`;
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 120);
    } catch (error) {
      this.logger.warn(`studio quote rate limit unavailable: ${(error as Error).message}`);
      return;
    }
    if (count > QUOTES_PER_MINUTE)
      throw new DomainException('studio.rate_limited', {
        headers: { 'Retry-After': String(60 - Math.floor((Date.now() % 60_000) / 1000)) },
      });
  }
}

function unitPrices(c: QuoteCalculationDto): Map<number, string> {
  return new Map(
    c.steps.filter((s) => s.instant && s.unitPrice !== null).map((s) => [s.quantity, s.unitPrice!] as const),
  );
}

function differentPrices(a: QuoteCalculationDto, b: QuoteCalculationDto): boolean {
  const x = unitPrices(a);
  const y = unitPrices(b);
  return [...y].some(([q, p]) => x.has(q) && x.get(q) !== p);
}

/** Per quantity in both quotes: the unit price before and now (the dock shows "+฿0.42/ชิ้น เพราะ…"). */
function unitChanges(before: QuoteCalculationDto, after: QuoteCalculationDto) {
  const x = unitPrices(before);
  return [...unitPrices(after)]
    .filter(([q, p]) => x.has(q) && x.get(q) !== p)
    .map(([quantity, unitPrice]) => ({ quantity, previousUnitPrice: x.get(quantity)!, unitPrice }));
}
