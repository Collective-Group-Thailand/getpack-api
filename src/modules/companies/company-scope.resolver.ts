import { PrismaService } from '@database/prisma.service';
import { ScopeDirectory, type ScopeResolver } from '@modules/iam/scope-directory';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RecipientDirectory } from '@platform/notifications/recipients';

/**
 * Maps company ids ↔ public ids for `company:<uuid>` token scopes (schema-design §2.5) and resolves the
 * `company_member` notification audience (D-143): the active members of `payload.companyId`. Closed
 * companies do not resolve, so their members' tokens lose the scope.
 */
@Injectable()
export class CompanyScopeResolver implements ScopeResolver, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: ScopeDirectory,
    private readonly recipients: RecipientDirectory,
  ) {}

  onModuleInit(): void {
    this.directory.register('company', this);
    this.recipients.register('company_member', async (event, _route, tx) => {
      const companyId = event.payload['companyId'];
      if (typeof companyId !== 'string') return [];
      const members = await tx.companyMember.findMany({
        where: {
          company: { publicId: companyId },
          status: 'active',
          user: { status: 'active', anonymisedAt: null },
        },
        include: { user: true },
      });
      return members.map((m) => ({
        userId: m.userId,
        locale: m.user.locale,
        displayName: m.user.displayName,
      }));
    });
  }

  async publicIds(ids: readonly bigint[]): Promise<Map<bigint, string>> {
    const rows = await this.prisma.company.findMany({
      where: { id: { in: [...ids] }, status: { not: 'closed' } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.id, r.publicId]));
  }

  async internalIds(publicIds: readonly string[]): Promise<Map<string, bigint>> {
    const rows = await this.prisma.company.findMany({
      where: { publicId: { in: [...publicIds] }, status: { not: 'closed' } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.publicId, r.id]));
  }
}
