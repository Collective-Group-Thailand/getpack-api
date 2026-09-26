import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/** Zone lookups inside one scheme (zones are maintained through the B2.2 zone admin, D-013). */
@Injectable()
export class ZoneRefs {
  constructor(private readonly prisma: PrismaService) {}

  async scheme(code: string, db: Tx = this.prisma) {
    const scheme = await db.zoneScheme.findUnique({ where: { code } });
    // Seeded by the reference seed; missing only in a database that was never seeded.
    if (!scheme) throw new DomainException('service.unavailable');
    return scheme;
  }

  /** public id → internal id, for the zones of `schemeId` among `publicIds`. */
  async byPublicIds(
    schemeId: bigint,
    publicIds: string[],
    db: Tx = this.prisma,
  ): Promise<Map<string, bigint>> {
    const rows = await db.zone.findMany({
      where: { schemeId, publicId: { in: [...new Set(publicIds)] } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((z) => [z.publicId, z.id]));
  }

  /** code → internal id, for the zones of `schemeId` among `codes`. */
  async byCodes(schemeId: bigint, codes: string[], db: Tx = this.prisma): Promise<Map<string, bigint>> {
    const rows = await db.zone.findMany({
      where: { schemeId, code: { in: [...new Set(codes)] } },
      select: { id: true, code: true },
    });
    return new Map(rows.map((z) => [z.code, z.id]));
  }

  /** postcode → zone id in `schemeId`, for the postcodes that are mapped. */
  async postcodeZones(
    schemeId: bigint,
    postcodes: string[],
    db: Tx = this.prisma,
  ): Promise<Map<string, bigint>> {
    if (postcodes.length === 0) return new Map();
    const rows = await db.zonePostcode.findMany({
      where: { schemeId, postcode: { in: [...new Set(postcodes)] } },
      select: { postcode: true, zoneId: true },
    });
    return new Map(rows.map((p) => [p.postcode, p.zoneId]));
  }

  /** The zone of `postcode` in `schemeId`, or null when unmapped. */
  async zoneOf(schemeId: bigint, postcode: string, db: Tx = this.prisma) {
    const row = await db.zonePostcode.findUnique({
      where: { schemeId_postcode: { schemeId, postcode } },
      select: { zone: { select: { id: true, publicId: true, code: true } } },
    });
    return row?.zone ?? null;
  }
}
