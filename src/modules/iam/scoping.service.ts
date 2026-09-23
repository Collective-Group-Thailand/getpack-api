import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Injectable } from '@nestjs/common';

import { parseScopeClaim, ScopeDirectory, type ScopedType } from './scope-directory';

/** `all` = platform staff (no scope restriction); otherwise the internal ids the actor may see. */
export type ScopeSet = 'all' | readonly bigint[];

/**
 * Repository-level scoping (schema-design §2.5, B1.3 "FactoryScoped / CompanyScoped"). Staff act on
 * the platform; partner principals only inside their `factory:<uuid>` scopes; B2B company members
 * only inside their `company:<uuid>` scopes. Anything out of scope is reported as not found
 * (contract §5: 404 = "not found or not visible to this actor"), so ids from other scopes leak nothing.
 */
@Injectable()
export class ScopingService {
  constructor(private readonly directory: ScopeDirectory) {}

  /** Scope set of `type` for this actor. Customers without company scopes get an empty set. */
  async scopeOf(actor: Actor, type: ScopedType): Promise<ScopeSet> {
    if (actor.type === 'system') return 'all';
    if (actor.type === 'user' && actor.audience === 'staff') return 'all';
    if (actor.type === 'webhook') return [];
    const publicIds = actor.scopes
      .map(parseScopeClaim)
      .filter((s): s is NonNullable<typeof s> => s !== null && s.type === type)
      .map((s) => s.publicId);
    const ids = await this.directory.internalIds(type, publicIds);
    return [...ids.values()];
  }

  /** Prisma `where` fragment: `{}` for platform actors, `{ [column]: { in: ids } }` otherwise. */
  async where<C extends string>(
    actor: Actor,
    type: ScopedType,
    column: C,
  ): Promise<Record<C, { in: bigint[] }> | object> {
    const scope = await this.scopeOf(actor, type);
    return scope === 'all' ? {} : { [column]: { in: [...scope] } };
  }

  /** Throws 404 when the row's scope id is outside the actor's scope (ids in URLs, file keys…). */
  async assertInScope(actor: Actor, type: ScopedType, scopeId: bigint | null | undefined): Promise<void> {
    const scope = await this.scopeOf(actor, type);
    if (scope === 'all') return;
    if (scopeId === null || scopeId === undefined || !scope.includes(scopeId)) {
      throw new DomainException('http.not_found');
    }
  }

  /** Keeps only rows inside the actor's scope (exports and batch reads). */
  async filterRows<T>(
    actor: Actor,
    type: ScopedType,
    rows: readonly T[],
    scopeIdOf: (row: T) => bigint | null,
  ): Promise<T[]> {
    const scope = await this.scopeOf(actor, type);
    if (scope === 'all') return [...rows];
    return rows.filter((row) => {
      const id = scopeIdOf(row);
      return id !== null && scope.includes(id);
    });
  }
}
