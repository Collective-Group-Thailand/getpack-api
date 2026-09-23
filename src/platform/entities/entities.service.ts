import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Legal entities (schema-design §2.3). One active entity at launch — Collective Group (Thailand),
 * seeded from env/settings, never hard-coded (D-092).
 */
@Injectable()
export class EntitiesService {
  private defaultId: bigint | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async defaultEntityId(): Promise<bigint> {
    if (this.defaultId !== undefined) return this.defaultId;
    const entity = await this.prisma.entity.findFirst({ where: { isDefault: true, status: 'active' } });
    if (!entity) throw new Error('No default entity — run `pnpm db:seed` (D-092)');
    this.defaultId = entity.id;
    return entity.id;
  }
}
