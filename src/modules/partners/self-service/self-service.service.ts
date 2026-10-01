import { type Actor } from '@common/context/actor';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { NATIONAL_CALENDAR_CODE } from '@platform/calendar/business-calendar.service';

import { CapacityService } from '../capacity/capacity.service';
import { FactoryAccess } from '../factories/factory-access';
import { columnOf, PriceComponentRegistry } from '../pricing/price-component.registry';
import {
  type CalendarClosureDto,
  type CapacityCalendarDto,
  type CatalogueReferenceDto,
  type PartnerSiteVisitDto,
  type PriceReferencesDto,
} from './self-service.dto';

/** Name columns of the catalogue tables price lines refer to; a table not listed shows its id only. */
const NAMES: Record<string, { code: string | null; th: string; en: string | null }> = {
  assemblies: { code: 'code', th: 'name_th', en: 'name_en' },
  diecut_types: { code: 'code', th: 'name_th', en: 'name_en' },
  difficulty_levels: { code: 'code', th: 'name_th', en: 'name_en' },
  factory_machines: { code: null, th: 'name', en: null },
  finishes: { code: 'code', th: 'name_th', en: 'name_en' },
  flute_types: { code: 'code', th: 'name', en: null },
  ink_colours: { code: 'code', th: 'name', en: null },
  materials: { code: 'code', th: 'name_th', en: 'name_en' },
  patterns: { code: 'code', th: 'name', en: null },
  print_types: { code: 'code', th: 'name_th', en: 'name_en' },
  sub_patterns: { code: null, th: 'name', en: null },
};
/** Capability item kinds that are catalogue rows a price line can refer to. */
const CAPABILITY_TABLES: Record<string, string> = {
  material: 'materials',
  finish: 'finishes',
  ink_colour: 'ink_colours',
  diecut: 'diecut_types',
  assembly: 'assemblies',
  print_type: 'print_types',
  pattern: 'patterns',
};

/**
 * The factory's own reads for self-service (U-B0.3): catalogue names behind its price lines, its site visits and
 * a capacity calendar. Own factory only (D-044); never a price.
 */
@Injectable()
export class FactorySelfServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly registry: PriceComponentRegistry,
    private readonly capacity: CapacityService,
  ) {}

  /**
   * Product types and catalogue rows the factory's own price lines (sent and approved versions) and capabilities
   * refer to, with their names (D-040, D-044).
   */
  async references(actor: Actor, factoryPublicId: string): Promise<PriceReferencesDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const [versions, capabilities, items] = await Promise.all([
      this.prisma.priceListVersion.findMany({
        where: { priceList: { factoryId: factory.id }, status: { not: 'draft' } },
        select: { id: true },
      }),
      this.prisma.factoryCapability.findMany({
        where: { factoryId: factory.id },
        select: { productTypeId: true, printTypeId: true },
      }),
      this.prisma.factoryCapabilityItem.findMany({
        where: { factoryId: factory.id },
        select: { productTypeId: true, itemKind: true, itemId: true },
      }),
    ]);
    const lists = await this.prisma.priceList.findMany({
      where: { factoryId: factory.id },
      select: { productTypeId: true },
    });
    const typeIds = [...new Set([...lists, ...capabilities, ...items].map((r) => r.productTypeId))];
    const productTypes = await this.prisma.productType.findMany({
      where: { id: { in: typeIds } },
      orderBy: { code: 'asc' },
    });

    // Internal ids by catalogue table, from the price lines and the capabilities.
    const ids = new Map<string, Set<bigint>>();
    const add = (table: string, id: bigint | null) => {
      if (id === null) return;
      ids.set(table, (ids.get(table) ?? new Set()).add(id));
    };
    const versionIds = versions.map((v) => v.id);
    if (versionIds.length)
      for (const d of this.registry.all())
        for (const c of [...d.dimensions, ...d.values].filter((x) => x.type === 'ref' && x.ref)) {
          const rows = await this.prisma.$queryRawUnsafe<{ id: bigint | null }[]>(
            `SELECT DISTINCT t.${columnOf(c)} AS id FROM ${d.table} t WHERE t.price_list_version_id = ANY($1::bigint[])`,
            versionIds,
          );
          for (const r of rows) add(c.ref!, r.id);
        }
    for (const c of capabilities) add('print_types', c.printTypeId);
    for (const i of items) if (CAPABILITY_TABLES[i.itemKind]) add(CAPABILITY_TABLES[i.itemKind]!, i.itemId);

    const out: CatalogueReferenceDto[] = [];
    for (const [table, set] of [...ids.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const n = NAMES[table];
      // Identifiers come from the code-defined registry and the table above (checked identifiers).
      const rows = await this.prisma.$queryRawUnsafe<
        { id: string; code: string | null; name_th: string | null; name_en: string | null }[]
      >(
        `SELECT public_id::text AS id, ${n?.code ?? 'NULL'}::text AS code, ${n?.th ?? 'NULL'}::text AS name_th, ` +
          `${n?.en ?? 'NULL'}::text AS name_en FROM ${table} WHERE id = ANY($1::bigint[]) ORDER BY 2, 3, 1`,
        [...set],
      );
      for (const r of rows)
        out.push({ catalogue: table, id: r.id, code: r.code, nameTh: r.name_th, nameEn: r.name_en });
    }
    return {
      productTypes: productTypes.map((t) => ({
        id: t.publicId,
        code: t.code,
        nameTh: t.nameTh,
        nameEn: t.nameEn,
      })),
      items: out,
    };
  }

  /** The factory's own site visits: date and result only (D-041). */
  async siteVisits(actor: Actor, factoryPublicId: string): Promise<PartnerSiteVisitDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const visits = await this.prisma.siteVisit.findMany({
      where: { factoryId: factory.id },
      orderBy: [{ visitedOn: 'desc' }, { id: 'desc' }],
    });
    return visits.map((v) => ({
      id: v.publicId,
      visitedOn: v.visitedOn.toISOString().slice(0, 10),
      result: v.result,
      createdAt: toBangkokIso(v.createdAt),
    }));
  }

  /**
   * Weeks × the factory's product types (capacity, booked, free — D-101) with the days that change its working
   * days in the range: national holidays observed by all (D-161) and its own closures / extra working days (D-209).
   */
  async capacityCalendar(
    actor: Actor,
    factoryPublicId: string,
    fromDay = bangkokDate(new Date()),
    count = 8,
  ): Promise<CapacityCalendarDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const capacities = await this.prisma.factoryCapacity.findMany({
      where: { factoryId: factory.id },
      include: {
        productType: true,
        versions: {
          where: { status: 'approved' },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
          select: { capacityUnit: true },
        },
      },
    });
    const rows = [];
    for (const c of capacities.sort((a, b) => a.productType.code.localeCompare(b.productType.code))) {
      const weeks = await this.capacity.weeks(factory.id, c.productTypeId, fromDay, count);
      rows.push({
        productTypeId: c.productType.publicId,
        productTypeCode: c.productType.code,
        productTypeNameTh: c.productType.nameTh,
        unit: c.versions[0]?.capacityUnit ?? null,
        weeks: weeks.map((w) => ({
          weekStart: w.weekStart,
          capacity: w.capacity.toFixed(3),
          booked: w.booked.toFixed(3),
          free: w.free.toFixed(3),
          source: w.source,
        })),
      });
    }
    const dow = new Date(`${fromDay}T00:00:00Z`).getUTCDay();
    const from = addCalendarDays(fromDay, -((dow + 6) % 7));
    const to = addCalendarDays(from, count * 7 - 1);
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
    const days = await this.prisma.businessCalendarDay.findMany({
      where: {
        day: range,
        OR: [
          { calendar: { code: NATIONAL_CALENDAR_CODE }, kind: 'holiday', observance: 'all' },
          ...(factory.calendarId !== null ? [{ calendarId: factory.calendarId }] : []),
        ],
      },
      include: { calendar: { select: { code: true } } },
      orderBy: [{ day: 'asc' }, { id: 'asc' }],
    });
    const out: CalendarClosureDto[] = days.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      kind: d.kind,
      source: d.calendar.code === NATIONAL_CALENDAR_CODE ? 'national' : 'factory',
      nameTh: d.nameTh,
      nameEn: d.nameEn,
    }));
    return { from, to, productTypes: rows, days: out };
  }
}
