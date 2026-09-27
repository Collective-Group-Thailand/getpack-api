import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { SHIPMENT_INCLUDE, type ShipmentRow } from './shipment-views';

/**
 * Reads of shipments, scoped (schema-design §2.5): staff see every shipment; a factory principal only its
 * own factories' — anything else is "not found" (IDOR-safe). Labels and packing lists belong to the factory
 * (owner scope); POD photos are readable by whoever may read the shipment.
 */
@Injectable()
export class ShipmentsQueryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoping: ScopingService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.files.registerAttachmentPolicy('proof_of_delivery', async (actor, podId) => {
      const pod = await this.prisma.proofOfDelivery.findUnique({
        where: { id: podId },
        select: { shipmentId: true },
      });
      if (!pod) return false;
      // The customer sees delivery photos of shipments carrying their own orders (timeline, B4.4).
      if (actor.type === 'user' && actor.audience === 'customer')
        return (
          (await this.prisma.shipmentItem.count({
            where: { shipmentId: pod.shipmentId, order: { customerUserId: actor.userId } },
          })) > 0
        );
      const where = await this.scopeWhere(actor);
      return (await this.prisma.shipment.count({ where: { id: pod.shipmentId, ...where } })) > 0;
    });
  }

  async scopeWhere(actor: Actor): Promise<Prisma.ShipmentWhereInput> {
    if (actor.type === 'user' && actor.audience === 'customer') return { id: -1n };
    const scope = await this.scoping.scopeOf(actor, 'factory');
    return scope === 'all' ? {} : { factoryId: { in: [...scope] } };
  }

  async get(actor: Actor, publicId: string, db: Tx = this.prisma): Promise<ShipmentRow> {
    const row = await db.shipment.findFirst({
      where: { publicId, ...(await this.scopeWhere(actor)) },
      include: SHIPMENT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(actor: Actor, where: Prisma.ShipmentWhereInput, page: number, perPage: number) {
    const scoped = { AND: [where, await this.scopeWhere(actor)] };
    return Promise.all([
      this.prisma.shipment.findMany({
        where: scoped,
        include: SHIPMENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.shipment.count({ where: scoped }),
    ]);
  }

  /** Photo evidence of each shipment's proof of delivery. */
  async podPhotos(rows: ShipmentRow[]): Promise<Map<bigint, string[]>> {
    const ids = rows.flatMap((r) => (r.proofOfDelivery ? [r.proofOfDelivery.id] : []));
    const map = new Map<bigint, string[]>();
    if (ids.length === 0) return map;
    const attachments = await this.prisma.attachment.findMany({
      where: { subjectType: 'proof_of_delivery', subjectId: { in: ids } },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) {
      if (!r.proofOfDelivery) continue;
      map.set(
        r.id,
        attachments.filter((a) => a.subjectId === r.proofOfDelivery!.id).map((a) => a.fileObject.publicId),
      );
    }
    return map;
  }
}
