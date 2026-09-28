import { PrismaService } from '@database/prisma.service';
import { ScopeDirectory, type ScopeResolver } from '@modules/iam/scope-directory';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RecipientDirectory } from '@platform/notifications/recipients';

/**
 * Maps factory ids ↔ public ids for `factory:<uuid>` token scopes (schema-design §2.5). Registering it
 * turns on partner sign-in and client credentials, which B1.3 refused until factories existed.
 * Offboarded factories do not resolve: their users and clients can no longer obtain tokens.
 */
@Injectable()
export class FactoryScopeResolver implements ScopeResolver, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: ScopeDirectory,
    private readonly recipients: RecipientDirectory,
  ) {}

  onModuleInit(): void {
    this.directory.register('factory', this);
    // D-143 "factory: partner-zone push + LINE + email": the active users holding a role in that factory.
    this.recipients.register('factory', async (event, _route, tx) => {
      const factoryId = event.payload['factoryId'];
      if (typeof factoryId !== 'string') return [];
      const now = new Date();
      const grants = await tx.userRole.findMany({
        where: {
          scopeType: 'factory',
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
          user: { kind: 'partner', status: 'active', anonymisedAt: null },
          scopeId:
            (await tx.factory.findUnique({ where: { publicId: factoryId }, select: { id: true } }))?.id ??
            -1n,
        },
        include: { user: true },
      });
      const users = new Map(grants.map((g) => [g.user.id, g.user]));
      return [...users.values()].map((u) => ({ userId: u.id, locale: u.locale, displayName: u.displayName }));
    });
  }

  async publicIds(ids: readonly bigint[]): Promise<Map<bigint, string>> {
    const rows = await this.prisma.factory.findMany({
      where: { id: { in: [...ids] }, status: { not: 'offboarded' } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.id, r.publicId]));
  }

  async internalIds(publicIds: readonly string[]): Promise<Map<string, bigint>> {
    const rows = await this.prisma.factory.findMany({
      where: { publicId: { in: [...publicIds] }, status: { not: 'offboarded' } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.publicId, r.id]));
  }
}
