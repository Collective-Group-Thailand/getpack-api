import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import {
  type ConfigurationFacts,
  envelopeCovers,
  type EnvelopeFacts,
  mergeEnvelopes,
  type TierBEnvelope,
} from '../configuration/tier-b-envelope';
import {
  type ProductTypeAvailabilityDto,
  type ProductTypeCoverageDto,
  type QuotePathReason,
} from './quote-path.dto';

interface Candidate {
  factoryId: bigint;
  factoryPublicId: string;
  factoryCode: string;
  factoryStatus: string;
  capabilityStatus: 'active' | 'inactive';
  tier: 'A' | 'B' | 'C' | null;
  envelope: TierBEnvelope | null;
  envelopeNote: string | null;
  version: { id: bigint; versionNo: number } | null;
  capacity: { weeklyCapacity: string; capacityUnit: string } | null;
}

/** An instant price path of a product type (D-043): tier A, or tier B limited to its envelope (D-234). */
export interface InstantCandidate {
  factoryId: bigint;
  factoryPublicId: string;
  priceListVersionId: bigint;
  tier: 'A' | 'B';
  /** Tier B only: what the path covers; the engine prices only covered quantities and print types. */
  envelope: TierBEnvelope | null;
}

/**
 * Quote-path resolution (D-043, D-100, D-234): a configuration has an instant price only when the type is quoted
 * instantly, and an active factory with an active capability either holds tier A with a price list in force, or tier B
 * with a price list and an envelope that covers the configuration — and the factory's lines then price it (the quote
 * engine decides per quantity and print type). Everything else routes to RFQ. No factory data leaves a store answer
 * (D-050, D-044).
 */
@Injectable()
export class QuotePathService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Why a type has or has no instant path for a configuration (`facts` null: none given or not a full calculator
   * configuration, so a tier-B-only type cannot be matched). Print types are not known here, so a tier-B envelope is
   * checked on everything but its print types; the quote engine checks those per option.
   */
  async resolve(
    type: { id: bigint; quoteMode: string },
    facts: EnvelopeFacts | null,
    quantities: readonly number[] | null,
    at = new Date(),
    db: Tx = this.prisma,
  ): Promise<QuotePathReason> {
    if (type.quoteMode !== 'instant') return 'type_rfq_only';
    const candidates = (await this.candidates(db, type.id, at)).filter(
      (c) => c.factoryStatus === 'active' && c.capabilityStatus === 'active',
    );
    if (candidates.length === 0) return 'no_active_factory';
    const priced = candidates.filter(
      (c) => c.version && (c.tier === 'A' || (c.tier === 'B' && c.envelope !== null)),
    );
    if (priced.length === 0) return 'no_price_list';
    if (priced.some((c) => c.tier === 'A')) return 'instant_available';
    if (facts === null) return 'envelope_not_covered';
    const qtys = quantities?.length ? quantities : [null];
    const covered = priced.some((c) =>
      qtys.some((q) => {
        const envelope: TierBEnvelope = { ...c.envelope!, printTypeIds: undefined };
        if (q === null) delete envelope.quantity;
        return envelopeCovers(envelope, facts, q ?? 0, '');
      }),
    );
    return covered ? 'instant_available' : 'envelope_not_covered';
  }

  /**
   * A configuration's facts with public ids (envelopes store public ids, D-234), and the standard sizes it equals: an
   * active standard size of its catalogue product with the same length, width and height (height 0 when flat), as the
   * corrugate loader matches them.
   */
  async publicFacts(facts: ConfigurationFacts, db: Tx = this.prisma): Promise<EnvelopeFacts> {
    const one = async (id: bigint | null, find: (id: bigint) => Promise<{ publicId: string } | null>) =>
      id === null ? null : ((await find(id))?.publicId ?? null);
    const [patternId, catalogProductId, stockProductId, materials, standards] = await Promise.all([
      one(facts.patternId, (id) => db.pattern.findUnique({ where: { id }, select: { publicId: true } })),
      one(facts.catalogProductId, (id) =>
        db.catalogProduct.findUnique({ where: { id }, select: { publicId: true } }),
      ),
      one(facts.stockProductId, (id) =>
        db.stockProduct.findUnique({ where: { id }, select: { publicId: true } }),
      ),
      facts.materialIds.length
        ? db.material.findMany({ where: { id: { in: facts.materialIds } }, select: { publicId: true } })
        : Promise.resolve([]),
      facts.catalogProductId !== null && facts.size
        ? db.standardSize.findMany({
            where: {
              catalogProductId: facts.catalogProductId,
              status: 'active',
              lengthMm: facts.size.l,
              widthMm: facts.size.w,
              heightMm: facts.size.d ?? 0,
            },
            select: { publicId: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      patternId,
      materialIds: materials.map((m) => m.publicId),
      size: facts.size,
      standardSizeIds: standards.map((s) => s.publicId),
      stockProductId,
      catalogProductId,
    };
  }

  /** Coverage map for admins (D-043, D-234): per type, which factories cover it, their tier and envelope. */
  async coverage(productTypePublicId?: string, at = new Date()): Promise<ProductTypeCoverageDto[]> {
    const types = await this.prisma.productType.findMany({
      where: { status: 'active', ...(productTypePublicId && { publicId: productTypePublicId }) },
      orderBy: { code: 'asc' },
    });
    if (productTypePublicId && types.length === 0) throw new DomainException('http.not_found');
    const result: ProductTypeCoverageDto[] = [];
    for (const type of types) {
      const candidates = await this.candidates(this.prisma, type.id, at);
      result.push({
        productTypeId: type.publicId,
        productTypeCode: type.code,
        quoteMode: type.quoteMode,
        instantPath: await this.resolve(type, null, null, at),
        availability: this.availabilityOf(type, candidates).availability,
        factories: candidates.map((c) => ({
          factoryId: c.factoryPublicId,
          factoryCode: c.factoryCode,
          factoryStatus: c.factoryStatus,
          capabilityStatus: c.capabilityStatus,
          tier: c.tier,
          envelope: c.envelope,
          envelopeNote: c.envelopeNote,
          priceListVersionNo: c.version?.versionNo ?? null,
          weeklyCapacity: c.capacity?.weeklyCapacity ?? null,
          capacityUnit: c.capacity?.capacityUnit ?? null,
        })),
      });
    }
    return result;
  }

  /**
   * What a customer may know about a type's instant paths (D-043, D-234, D-050): `instant` (a tier-A path), `partial`
   * (tier-B paths only — instant inside their envelopes, with a summary of what they cover), or `rfq`. No factory.
   */
  async availability(productTypePublicId: string, at = new Date()): Promise<ProductTypeAvailabilityDto> {
    const type = await this.prisma.productType.findFirst({
      where: { publicId: productTypePublicId, status: 'active' },
    });
    if (!type) throw new DomainException('http.not_found');
    const { availability, envelope } = this.availabilityOf(
      type,
      await this.candidates(this.prisma, type.id, at),
    );
    return { productTypeId: type.publicId, productTypeCode: type.code, availability, envelope };
  }

  private availabilityOf(
    type: { quoteMode: string },
    candidates: Candidate[],
  ): { availability: 'instant' | 'partial' | 'rfq'; envelope: TierBEnvelope | null } {
    if (type.quoteMode !== 'instant') return { availability: 'rfq', envelope: null };
    const paths = candidates.filter(
      (c) =>
        c.factoryStatus === 'active' &&
        c.capabilityStatus === 'active' &&
        c.version &&
        (c.tier === 'A' || (c.tier === 'B' && c.envelope !== null)),
    );
    if (paths.some((c) => c.tier === 'A')) return { availability: 'instant', envelope: null };
    if (paths.length === 0) return { availability: 'rfq', envelope: null };
    return { availability: 'partial', envelope: mergeEnvelopes(paths.map((c) => c.envelope!)) };
  }

  /**
   * The instant price paths of a type at `at` (D-043, D-234): active factories with an active capability and a price
   * list in force, at tier A, or at tier B with an envelope (a tier-B version without one covers nothing).
   */
  async instantCandidates(
    productTypeId: bigint,
    at = new Date(),
    db: Tx = this.prisma,
  ): Promise<InstantCandidate[]> {
    return (await this.candidates(db, productTypeId, at))
      .filter(
        (c) =>
          c.factoryStatus === 'active' &&
          c.capabilityStatus === 'active' &&
          c.version &&
          (c.tier === 'A' || (c.tier === 'B' && c.envelope !== null)),
      )
      .map((c) => ({
        factoryId: c.factoryId,
        factoryPublicId: c.factoryPublicId,
        priceListVersionId: c.version!.id,
        tier: c.tier as 'A' | 'B',
        envelope: c.tier === 'B' ? c.envelope : null,
      }));
  }

  /** Factories with a capability for the type, with what is in force at `at`. */
  private async candidates(db: Tx, productTypeId: bigint, at: Date): Promise<Candidate[]> {
    const inForce = { status: 'approved' as const, effectiveFrom: { lte: at } };
    const latest = [{ effectiveFrom: 'desc' as const }, { versionNo: 'desc' as const }];
    const capabilities = await db.factoryCapability.findMany({
      where: { productTypeId, factory: { status: { not: 'offboarded' } } },
      include: {
        factory: {
          select: {
            id: true,
            publicId: true,
            code: true,
            status: true,
            participations: {
              where: { productTypeId },
              select: {
                versions: {
                  where: inForce,
                  orderBy: latest,
                  take: 1,
                  select: { tier: true, envelope: true, envelopeNote: true },
                },
              },
            },
            capacities: {
              where: { productTypeId },
              select: {
                versions: {
                  where: inForce,
                  orderBy: latest,
                  take: 1,
                  select: { weeklyCapacity: true, capacityUnit: true },
                },
              },
            },
            priceLists: {
              where: { productTypeId },
              select: {
                versions: { where: inForce, orderBy: latest, take: 1, select: { id: true, versionNo: true } },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    // A factory may hold several capabilities (print types) for one type: it covers it if any is active.
    const byFactory = new Map<bigint, Candidate>();
    for (const cap of capabilities) {
      const f = cap.factory;
      const existing = byFactory.get(f.id);
      if (existing) {
        if (cap.status === 'active') existing.capabilityStatus = 'active';
        continue;
      }
      const capacity = f.capacities[0]?.versions[0];
      const participation = f.participations[0]?.versions[0];
      byFactory.set(f.id, {
        factoryId: f.id,
        factoryPublicId: f.publicId,
        factoryCode: f.code,
        factoryStatus: f.status,
        capabilityStatus: cap.status,
        tier: participation?.tier ?? null,
        envelope:
          participation?.tier === 'B' ? ((participation.envelope as TierBEnvelope | null) ?? null) : null,
        envelopeNote: participation?.envelopeNote ?? null,
        version: f.priceLists[0]?.versions[0] ?? null,
        capacity: capacity
          ? { weeklyCapacity: capacity.weeklyCapacity.toFixed(3), capacityUnit: capacity.capacityUnit }
          : null,
      });
    }
    return [...byFactory.values()];
  }
}
