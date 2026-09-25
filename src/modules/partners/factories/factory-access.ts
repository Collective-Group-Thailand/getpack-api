import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type Factory, type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable } from '@nestjs/common';

/**
 * Factory-scoped access (schema-design §2.5, D-044): staff see every factory; a partner principal
 * only the factories of its `factory:<uuid>` scopes. Anything else is "not found" (contract §5).
 */
@Injectable()
export class FactoryAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoping: ScopingService,
  ) {}

  /** `where` fragment on `factories` for this actor. */
  async where(actor: Actor): Promise<Prisma.FactoryWhereInput> {
    return await this.scoping.where(actor, 'factory', 'id');
  }

  async factory(actor: Actor, publicId: string): Promise<Factory> {
    const factory = await this.prisma.factory.findUnique({ where: { publicId } });
    if (!factory) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', factory.id);
    return factory;
  }
}
