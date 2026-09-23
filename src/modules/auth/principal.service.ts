import { InvalidationBus } from '@common/cache/invalidation-bus';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { IAM_CACHE_TOPIC } from '@modules/iam/permission-resolver.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type AccessTokenClaims } from './tokens/token.service';

const CACHE_TTL_MS = 30_000;

interface CachedPrincipal {
  id: bigint;
  active: boolean;
  loadedAt: number;
}

/**
 * Turns verified token claims into an `Actor`. Internal ids are looked up by public id and cached
 * briefly; suspensions also revoke sessions (Redis marker), so the cache never outlives a revocation.
 */
@Injectable()
export class PrincipalService implements OnModuleInit {
  private readonly users = new Map<string, CachedPrincipal>();
  private readonly clients = new Map<string, CachedPrincipal>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: InvalidationBus,
  ) {}

  onModuleInit(): void {
    // The IAM topic carries internal ids; a status change clears the whole (small) map.
    this.bus.on(IAM_CACHE_TOPIC, () => this.users.clear());
  }

  async actorFor(claims: AccessTokenClaims): Promise<Actor> {
    if (claims.pty === 'client') {
      const client = await this.lookup(this.clients, claims.sub, async () => {
        const row = await this.prisma.apiClient.findUnique({ where: { publicId: claims.sub } });
        return (
          row && {
            id: row.id,
            active: row.status === 'active' && (!row.expiresAt || row.expiresAt > new Date()),
          }
        );
      });
      if (!client?.active || claims.aud !== 'partner') throw new DomainException('auth.session_revoked');
      return {
        type: 'api_client',
        apiClientId: client.id,
        publicId: claims.sub,
        audience: 'partner',
        scopes: claims.scp,
      };
    }
    const user = await this.lookup(this.users, `${claims.aud}:${claims.sub}`, async () => {
      const row = await this.prisma.user.findFirst({ where: { publicId: claims.sub, kind: claims.aud } });
      return row && { id: row.id, active: row.status === 'active' && row.anonymisedAt === null };
    });
    if (!user) throw new DomainException('auth.unauthenticated');
    if (!user.active) throw new DomainException('auth.account_inactive');
    return {
      type: 'user',
      userId: user.id,
      publicId: claims.sub,
      audience: claims.aud,
      scopes: claims.scp,
      ...(claims.sid && { sessionId: claims.sid }),
    };
  }

  private async lookup(
    cache: Map<string, CachedPrincipal>,
    key: string,
    load: () => Promise<{ id: bigint; active: boolean } | null>,
  ): Promise<CachedPrincipal | null> {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;
    const loaded = await load();
    if (!loaded) return null;
    const entry = { ...loaded, loadedAt: Date.now() };
    cache.set(key, entry);
    return entry;
  }
}
