import { PrismaService } from '@database/prisma.service';
import { ScopeDirectory, type ScopeResolver } from '@modules/iam/scope-directory';
import { Injectable, type OnModuleInit } from '@nestjs/common';

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
  ) {}

  onModuleInit(): void {
    this.directory.register('factory', this);
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
