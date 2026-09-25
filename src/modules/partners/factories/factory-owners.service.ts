import { type UserActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { Injectable } from '@nestjs/common';

import { type CreateOwnerAccountDto, type OwnerAccountDto } from './factories.dto';
import { FactoriesService } from './factories.service';
import { FactoryAccess } from './factory-access';

/**
 * The owner's partner account (D-171): created by the Partner team with an initial password handed over
 * out of band (ADR-0004), then `factory_owner` is granted scoped to the factory. HTTP process only
 * (account administration lives with the auth services).
 */
@Injectable()
export class FactoryOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly users: UsersAdminService,
    private readonly factories: FactoriesService,
  ) {}

  async createOwnerAccount(
    actor: UserActor,
    publicId: string,
    input: CreateOwnerAccountDto,
  ): Promise<OwnerAccountDto> {
    const factory = await this.access.factory(actor, publicId);
    const user = await this.users.create(actor, {
      kind: 'partner',
      email: input.email,
      displayName: input.displayName,
      initialPassword: input.initialPassword,
    });
    await this.users.grantRole(actor, user.publicId, {
      roleKey: 'factory_owner',
      scope: { type: 'factory', id: factory.publicId },
      reason: `Owner of ${factory.code} (D-171)`,
    });
    await this.prisma.withTx((tx) =>
      this.factories.record(tx, factory.publicId, 'factory.owner_account_created', { userId: user.publicId }),
    );
    return { userId: user.publicId, email: user.email ?? input.email, role: 'factory_owner' };
  }
}
