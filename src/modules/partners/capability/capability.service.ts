import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CatalogOptionKind, Prisma } from '@generated/prisma/client';
import { compact } from '@modules/catalog/crud/compact';
import { RefResolver } from '@modules/catalog/crud/ref-resolver';
import { optionTable } from '@modules/catalog/product-structure/option-refs';
import { Injectable } from '@nestjs/common';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';
import {
  type CapabilityDto,
  type CapabilityItemsDto,
  type CreateCapabilityDto,
  type CreateMachineDto,
  type DeliveryZoneDto,
  type MachineDto,
  type ReplaceCapabilityItemsDto,
  type ReplaceDeliveryZonesDto,
  type UpdateCapabilityDto,
  type UpdateMachineDto,
} from './capability.dto';

const num = (d: Prisma.Decimal | null) => (d ? d.toNumber() : null);
const CAPABILITY_INCLUDE = {
  productType: { select: { publicId: true, code: true } },
  printType: { select: { publicId: true } },
} satisfies Prisma.FactoryCapabilityInclude;

/**
 * The capability matrix of a factory (D-011, D-043): product types (per print type) with sheet and
 * order limits, the catalogue items it can make per type, machines and the delivery zones its own
 * fleet serves (D-013; others fall back to carriers, D-114). Maintained by the Partner team; the
 * factory reads it. Each change is audited and published.
 */
@Injectable()
export class CapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
  ) {}

  async capabilities(actor: Actor, factoryPublicId: string): Promise<CapabilityDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.factoryCapability.findMany({
      where: { factoryId: factory.id },
      include: CAPABILITY_INCLUDE,
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.capabilityDto(r));
  }

  async addCapability(
    actor: UserActor,
    factoryPublicId: string,
    input: CreateCapabilityDto,
  ): Promise<CapabilityDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    this.assertOrderRange(input.minOrderQty, input.maxOrderQty);
    try {
      return await this.prisma.withTx(async (tx) => {
        const refs = new RefResolver(tx);
        const row = await tx.factoryCapability.create({
          data: {
            factoryId: factory.id,
            productTypeId: await refs.id('productType', input.productTypeId, 'productTypeId'),
            printTypeId: await refs.optional('printType', input.printTypeId, 'printTypeId'),
            maxSheetWidthMm: input.maxSheetWidthMm ?? null,
            maxSheetLengthMm: input.maxSheetLengthMm ?? null,
            minOrderQty: input.minOrderQty ?? null,
            maxOrderQty: input.maxOrderQty ?? null,
            status: input.status,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include: CAPABILITY_INCLUDE,
        });
        await this.factories.markStep(tx, factory.id, 'capability', 'submitted', actor.userId);
        await this.factories.record(tx, factory.publicId, 'factory.capability_added', {
          capabilityId: row.publicId,
        });
        return this.capabilityDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException('http.conflict', { cause: error });
      }
      throw error;
    }
  }

  async updateCapability(
    actor: UserActor,
    factoryPublicId: string,
    capabilityId: string,
    input: UpdateCapabilityDto,
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const current = await tx.factoryCapability.findFirst({
        where: { publicId: capabilityId, factoryId: factory.id },
      });
      if (!current) throw new DomainException('http.not_found');
      this.assertOrderRange(
        input.minOrderQty === undefined ? current.minOrderQty : input.minOrderQty,
        input.maxOrderQty === undefined ? current.maxOrderQty : input.maxOrderQty,
      );
      const row = await tx.factoryCapability.update({
        where: { id: current.id },
        data: { ...compact({ ...input }), updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: CAPABILITY_INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.capability_updated', {
        capabilityId: row.publicId,
      });
      return this.capabilityDto(row);
    });
  }

  async items(
    actor: Actor,
    factoryPublicId: string,
    productTypePublicId: string,
  ): Promise<CapabilityItemsDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const type = await this.prisma.productType.findUnique({ where: { publicId: productTypePublicId } });
    if (!type) throw new DomainException('http.not_found');
    const rows = await this.prisma.factoryCapabilityItem.findMany({
      where: { factoryId: factory.id, productTypeId: type.id },
      orderBy: [{ itemKind: 'asc' }, { itemId: 'asc' }],
    });
    return { productTypeId: type.publicId, items: await this.describe(this.prisma, rows) };
  }

  /** Replaces what the factory can make for one product type (legacy `factory_match_*`). */
  async replaceItems(
    actor: UserActor,
    factoryPublicId: string,
    productTypePublicId: string,
    input: ReplaceCapabilityItemsDto,
  ): Promise<CapabilityItemsDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const type = await tx.productType.findUnique({ where: { publicId: productTypePublicId } });
      if (!type) throw new DomainException('http.not_found');
      const resolved: { itemKind: CatalogOptionKind; itemId: bigint }[] = [];
      for (const [index, item] of input.items.entries()) {
        const table = optionTable(tx, item.kind);
        const [row] = table
          ? await table.findMany({
              where: { publicId: { in: [item.itemId] } },
              select: { id: true, publicId: true },
            })
          : [];
        if (!row) {
          throw new DomainException('validation.failed', {
            errors: [
              { path: `items[${index}].itemId`, code: 'exists', message: `no ${item.kind} with this id` },
            ],
          });
        }
        resolved.push({ itemKind: item.kind, itemId: row.id });
      }
      if (new Set(resolved.map((r) => `${r.itemKind}:${r.itemId}`)).size !== resolved.length) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'items', code: 'unique', message: 'items lists the same item twice' }],
        });
      }
      await tx.factoryCapabilityItem.deleteMany({ where: { factoryId: factory.id, productTypeId: type.id } });
      await tx.factoryCapabilityItem.createMany({
        data: resolved.map((r) => ({
          ...r,
          factoryId: factory.id,
          productTypeId: type.id,
          createdById: actor.userId,
        })),
      });
      await this.factories.record(tx, factory.publicId, 'factory.capability_items_replaced', {
        productTypeId: type.publicId,
        count: resolved.length,
      });
      const rows = await tx.factoryCapabilityItem.findMany({
        where: { factoryId: factory.id, productTypeId: type.id },
        orderBy: [{ itemKind: 'asc' }, { itemId: 'asc' }],
      });
      return { productTypeId: type.publicId, items: await this.describe(tx, rows) };
    });
  }

  async machines(actor: Actor, factoryPublicId: string): Promise<MachineDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.factoryMachine.findMany({
      where: { factoryId: factory.id },
      include: { printType: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((m) => this.machineDto(m));
  }

  async saveMachine(
    actor: UserActor,
    factoryPublicId: string,
    input: CreateMachineDto | UpdateMachineDto,
    machineId?: string,
  ): Promise<MachineDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const printTypeId = await new RefResolver(tx).optional('printType', input.printTypeId, 'printTypeId');
      const data = compact({ ...input, printTypeId });
      const include = { printType: { select: { publicId: true } } };
      let row;
      if (machineId) {
        const current = await tx.factoryMachine.findFirst({
          where: { publicId: machineId, factoryId: factory.id },
        });
        if (!current) throw new DomainException('http.not_found');
        row = await tx.factoryMachine.update({
          where: { id: current.id },
          data: { ...data, updatedById: actor.userId, rowVersion: { increment: 1 } },
          include,
        });
      } else {
        row = await tx.factoryMachine.create({
          data: {
            ...(data as CreateMachineDto & { printTypeId?: bigint | null }),
            factoryId: factory.id,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include,
        });
      }
      await this.factories.record(
        tx,
        factory.publicId,
        machineId ? 'factory.machine_updated' : 'factory.machine_added',
        {
          machineId: row.publicId,
        },
      );
      return this.machineDto(row);
    });
  }

  async deliveryZones(actor: Actor, factoryPublicId: string): Promise<DeliveryZoneDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.zoneDtos(this.prisma, factory.id);
  }

  async replaceDeliveryZones(
    actor: UserActor,
    factoryPublicId: string,
    input: ReplaceDeliveryZonesDto,
  ): Promise<DeliveryZoneDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const refs = new RefResolver(tx);
      const rows = [];
      for (const [index, zone] of input.zones.entries()) {
        rows.push({
          factoryId: factory.id,
          zoneId: await refs.id('zone', zone.zoneId, `zones[${index}].zoneId`),
          serves: zone.serves ?? true,
          extraLeadDays: zone.extraLeadDays ?? 0,
          createdById: actor.userId,
          updatedById: actor.userId,
        });
      }
      if (new Set(rows.map((r) => String(r.zoneId))).size !== rows.length) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'zones', code: 'unique', message: 'zones lists the same zone twice' }],
        });
      }
      await tx.factoryDeliveryZone.deleteMany({ where: { factoryId: factory.id } });
      await tx.factoryDeliveryZone.createMany({ data: rows });
      await this.factories.markStep(
        tx,
        factory.id,
        'delivery_zones',
        rows.length ? 'approved' : 'pending',
        actor.userId,
      );
      await this.factories.record(tx, factory.publicId, 'factory.delivery_zones_replaced', {
        count: rows.length,
      });
      return this.zoneDtos(tx, factory.id);
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private async zoneDtos(db: Tx, factoryId: bigint): Promise<DeliveryZoneDto[]> {
    const rows = await db.factoryDeliveryZone.findMany({
      where: { factoryId },
      include: { zone: { include: { scheme: { select: { code: true } } } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({
      zoneId: r.zone.publicId,
      zoneCode: r.zone.code,
      schemeCode: r.zone.scheme.code,
      serves: r.serves,
      extraLeadDays: r.extraLeadDays,
    }));
  }

  private async describe(db: Tx, rows: { itemKind: CatalogOptionKind; itemId: bigint }[]) {
    const out = [];
    for (const row of rows) {
      const table = optionTable(db, row.itemKind) as unknown as {
        findFirst(args: object): Promise<{ publicId: string; code: string } | null>;
      } | null;
      const found = table
        ? await table.findFirst({ where: { id: row.itemId }, select: { publicId: true, code: true } })
        : null;
      if (found) out.push({ kind: row.itemKind, itemId: found.publicId, code: found.code });
    }
    return out;
  }

  private assertOrderRange(min: number | null | undefined, max: number | null | undefined): void {
    if (min != null && max != null && min > max) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'maxOrderQty', code: 'min', message: 'maxOrderQty must be ≥ minOrderQty' }],
      });
    }
  }

  private capabilityDto(
    r: Prisma.FactoryCapabilityGetPayload<{ include: typeof CAPABILITY_INCLUDE }>,
  ): CapabilityDto {
    return {
      id: r.publicId,
      productTypeId: r.productType.publicId,
      productTypeCode: r.productType.code,
      printTypeId: r.printType?.publicId ?? null,
      maxSheetWidthMm: num(r.maxSheetWidthMm),
      maxSheetLengthMm: num(r.maxSheetLengthMm),
      minOrderQty: r.minOrderQty,
      maxOrderQty: r.maxOrderQty,
      status: r.status,
    };
  }

  private machineDto(
    m: Prisma.FactoryMachineGetPayload<{ include: { printType: { select: { publicId: true } } } }>,
  ): MachineDto {
    return {
      id: m.publicId,
      name: m.name,
      printTypeId: m.printType?.publicId ?? null,
      maxWidthMm: num(m.maxWidthMm),
      maxLengthMm: num(m.maxLengthMm),
      details: m.details,
      status: m.status,
    };
  }
}
