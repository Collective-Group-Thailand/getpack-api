import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type PriceComponent, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { FactoryAccess } from '../factories/factory-access';
import { PriceComponentRegistry } from './price-component.registry';
import { PriceListBuilder } from './price-list-builder';
import { PriceProposalRecorder } from './price-proposal-recorder';
import {
  type PriceComponentDto,
  type PriceListDto,
  type PriceListVersionDto,
  type PriceRowDto,
  type PriceRowsQuery,
} from './pricing.dto';

export const VERSION_INCLUDE = {
  basedOn: { select: { versionNo: true } },
  proposal: { select: { publicId: true } },
} satisfies Prisma.PriceListVersionInclude;
type VersionRow = Prisma.PriceListVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

export const versionDto = (v: VersionRow): PriceListVersionDto => ({
  id: v.publicId,
  versionNo: v.versionNo,
  status: v.status,
  origin: v.origin,
  effectiveFrom: toBangkokIso(v.effectiveFrom),
  basedOnVersionNo: v.basedOn?.versionNo ?? null,
  lineCount: v.lineCount,
  contentSha256: v.contentSha256 ? Buffer.from(v.contentSha256).toString('hex') : null,
  reason: v.reason,
  proposalId: v.proposal?.publicId ?? null,
  factoryAcceptedAt: v.factoryAcceptedAt && toBangkokIso(v.factoryAcceptedAt),
  factorySignedOffAt: v.factorySignedOffAt && toBangkokIso(v.factorySignedOffAt),
  createdAt: toBangkokIso(v.createdAt),
});

/**
 * Factory price lists (schema-design §3.4, D-040…D-044): one list per factory × product type, each
 * approved version a complete immutable set of component rows. A factory reads only its own lists
 * (scoping → 404); every staff read of price lines is audited as `price.read_other_factory` (D-044).
 */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly registry: PriceComponentRegistry,
    private readonly builder: PriceListBuilder,
    private readonly audit: AuditService,
    private readonly recorder: PriceProposalRecorder,
  ) {}

  components(): PriceComponentDto[] {
    const column = (c: {
      key: string;
      type: PriceComponentDto['values'][number]['type'];
      nullable?: boolean;
      scale?: number;
    }) => ({
      key: c.key,
      type: c.type,
      nullable: c.nullable ?? false,
      scale: c.type === 'decimal' ? (c.scale ?? 6) : null,
    });
    return this.registry.all().map((d) => ({
      component: d.component,
      group: d.group,
      dimensions: d.dimensions.map(column),
      values: d.values.map(column),
    }));
  }

  async lists(actor: Actor, factoryPublicId: string): Promise<PriceListDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const lists = await this.prisma.priceList.findMany({
      where: { factoryId: factory.id },
      include: {
        productType: { select: { publicId: true, code: true } },
        versions: { where: { status: { in: ['approved', 'pending_acceptance'] } }, include: VERSION_INCLUDE },
      },
      orderBy: { id: 'asc' },
    });
    const now = Date.now();
    return lists.map((list) => {
      const approved = list.versions
        .filter((v) => v.status === 'approved')
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo);
      const current = approved.find((v) => v.effectiveFrom.getTime() <= now) ?? null;
      const upcoming = list.versions
        .filter(
          (v) =>
            v.status === 'pending_acceptance' || (v.status === 'approved' && v.effectiveFrom.getTime() > now),
        )
        .sort((a, b) => a.versionNo - b.versionNo);
      return {
        id: list.publicId,
        productTypeId: list.productType.publicId,
        productTypeCode: list.productType.code,
        current: current && versionDto(current),
        upcoming: upcoming.map(versionDto),
      };
    });
  }

  /**
   * Rows of one component of a version. `factoryPublicId` is the partner path (own factory only);
   * without it the caller is staff and the read is audited (D-044).
   */
  async lines(
    actor: Actor,
    versionPublicId: string,
    query: PriceRowsQuery,
    factoryPublicId?: string,
  ): Promise<{ rows: PriceRowDto[]; total: number }> {
    const version = await this.prisma.priceListVersion.findUnique({
      where: { publicId: versionPublicId },
      include: { priceList: { include: { factory: { select: { id: true, publicId: true, code: true } } } } },
    });
    if (!version) throw new DomainException('http.not_found');
    const factory = version.priceList.factory;
    if (factoryPublicId !== undefined) {
      if (factory.publicId !== factoryPublicId) throw new DomainException('http.not_found');
      await this.access.factory(actor, factoryPublicId);
      // A factory never sees Packio's drafts of its own rate card before they are sent (D-042).
      if (version.status === 'draft') throw new DomainException('http.not_found');
    }
    const component = query.component as PriceComponent;
    if (!this.registry.get(component)) return { rows: [], total: 0 };
    const { rows, total } = await this.builder.rows(this.prisma, version.id, component, {
      limit: query.perPage,
      offset: (query.page - 1) * query.perPage,
    });
    if (factoryPublicId === undefined) {
      await this.audit.record(this.prisma, {
        category: 'data_access',
        action: 'price.read_other_factory',
        resourceType: 'price_list_version',
        resourcePublicId: version.publicId,
        data: { factory: factory.code, component, page: query.page, rows: rows.length },
      });
    }
    return { rows: rows.map((r) => ({ component, lineKey: r.lineKey, values: r.values })), total };
  }

  /**
   * Assisted entry (D-100 note): the factory signs off the version Packio staff entered for it; only
   * then does it apply (DB check `ck_price_list_versions__assisted_signed_off`).
   */
  async signOff(actor: UserActor, factoryPublicId: string, versionPublicId: string) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const version = await tx.priceListVersion.findFirst({
        where: { publicId: versionPublicId, priceList: { factoryId: factory.id } },
        include: { priceList: { include: { productType: { select: { code: true } } } } },
      });
      if (!version) throw new DomainException('http.not_found');
      if (version.origin !== 'assisted_entry' || version.status !== 'pending_acceptance') {
        throw new DomainException('partners.version_not_awaiting');
      }
      const now = new Date();
      const updated = await tx.priceListVersion.update({
        where: { id: version.id },
        data: {
          status: 'approved',
          factorySignedOffById: actor.userId,
          factorySignedOffAt: now,
          // Never back-dated: it applies from the later of the planned date and now (ADR-0005).
          effectiveFrom: version.effectiveFrom > now ? version.effectiveFrom : now,
          decidedAt: now,
        },
        include: VERSION_INCLUDE,
      });
      await this.recorder.versionApproved(tx, factory, updated, version.priceList.productType.code);
      return versionDto(updated);
    });
  }

  /** Version to price with and snapshot (quotes, jobs, POs): approved and in force at `at`. */
  async versionAt(factoryId: bigint, productTypeId: bigint, at = new Date(), db: Tx = this.prisma) {
    return db.priceListVersion.findFirst({
      where: { priceList: { factoryId, productTypeId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true, publicId: true, versionNo: true, contentSha256: true },
    });
  }
}
