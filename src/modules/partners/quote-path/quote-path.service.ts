import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { PriceComponentRegistry } from '../pricing/price-component.registry';
import { type ProductTypeCoverageDto, type QuotePathDto, type QuotePathReason } from './quote-path.dto';

interface Candidate {
  factoryId: bigint;
  factoryPublicId: string;
  factoryCode: string;
  factoryStatus: string;
  capabilityStatus: 'active' | 'inactive';
  tier: 'A' | 'B' | 'C' | null;
  version: { id: bigint; versionNo: number } | null;
  capacity: { weeklyCapacity: string; capacityUnit: string } | null;
}

/**
 * Quote-path resolution (D-043, D-100): a configuration has an instant price only when the type is
 * quoted instantly, and an active factory with an active capability either holds tier A with a price
 * list in force, or tier B with a price list whose registered envelope matchers cover the
 * configuration. Everything else routes to RFQ. No factory data leaves the store answer (D-050).
 */
@Injectable()
export class QuotePathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PriceComponentRegistry,
  ) {}

  async resolveByCode(
    code: string,
    configuration: Record<string, unknown>,
    at = new Date(),
  ): Promise<QuotePathDto> {
    const type = await this.prisma.productType.findFirst({ where: { code, status: 'active' } });
    if (!type) throw new DomainException('http.not_found');
    const reason = await this.resolve(type, configuration, at);
    return { productTypeCode: type.code, mode: reason === 'instant_available' ? 'instant' : 'rfq', reason };
  }

  async resolve(
    type: { id: bigint; quoteMode: string },
    configuration: Record<string, unknown> | null,
    at = new Date(),
    db: Tx = this.prisma,
  ): Promise<QuotePathReason> {
    const candidates = (await this.candidates(db, type.id, at)).filter(
      (c) => c.factoryStatus === 'active' && c.capabilityStatus === 'active',
    );
    if (type.quoteMode !== 'instant') return 'type_rfq_only';
    if (candidates.length === 0) return 'no_active_factory';
    const priced = candidates.filter((c) => (c.tier === 'A' || c.tier === 'B') && c.version);
    if (priced.length === 0) return 'no_price_list';
    if (priced.some((c) => c.tier === 'A')) return 'instant_available';
    if (configuration === null) return 'envelope_not_covered';
    for (const c of priced) {
      for (const d of this.registry.all()) {
        if (d.coversConfiguration && (await d.coversConfiguration(c.version!.id, configuration, db))) {
          return 'instant_available';
        }
      }
    }
    return 'envelope_not_covered';
  }

  /** Coverage map for admins (D-043): per type, which factories cover it with tier, version and capacity. */
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
        instantPath: await this.resolve(type, null, at),
        factories: candidates.map((c) => ({
          factoryId: c.factoryPublicId,
          factoryCode: c.factoryCode,
          factoryStatus: c.factoryStatus,
          capabilityStatus: c.capabilityStatus,
          tier: c.tier,
          priceListVersionNo: c.version?.versionNo ?? null,
          weeklyCapacity: c.capacity?.weeklyCapacity ?? null,
          capacityUnit: c.capacity?.capacityUnit ?? null,
        })),
      });
    }
    return result;
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
              select: { versions: { where: inForce, orderBy: latest, take: 1, select: { tier: true } } },
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
      byFactory.set(f.id, {
        factoryId: f.id,
        factoryPublicId: f.publicId,
        factoryCode: f.code,
        factoryStatus: f.status,
        capabilityStatus: cap.status,
        tier: f.participations[0]?.versions[0]?.tier ?? null,
        version: f.priceLists[0]?.versions[0] ?? null,
        capacity: capacity
          ? { weeklyCapacity: capacity.weeklyCapacity.toFixed(3), capacityUnit: capacity.capacityUnit }
          : null,
      });
    }
    return [...byFactory.values()];
  }
}
