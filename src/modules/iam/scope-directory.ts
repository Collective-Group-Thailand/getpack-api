import { Injectable } from '@nestjs/common';

/** Scope types that carry an id (roles scoped to one factory or one B2B company, D-140). */
export type ScopedType = 'factory' | 'company';

/** Maps internal ids ↔ public uuids for one scope type; implemented by the owning module. */
export interface ScopeResolver {
  publicIds(ids: readonly bigint[]): Promise<Map<bigint, string>>;
  internalIds(publicIds: readonly string[]): Promise<Map<string, bigint>>;
}

/**
 * Registry of scope resolvers. `factories` (B2.2) and `companies` (B3.5) register theirs; until then
 * factory/company scopes cannot be resolved and partner logins are refused (docs/PROGRESS.md B1.3).
 */
@Injectable()
export class ScopeDirectory {
  private readonly resolvers = new Map<ScopedType, ScopeResolver>();

  register(type: ScopedType, resolver: ScopeResolver): void {
    this.resolvers.set(type, resolver);
  }

  isAvailable(type: ScopedType): boolean {
    return this.resolvers.has(type);
  }

  async publicIds(type: ScopedType, ids: readonly bigint[]): Promise<Map<bigint, string>> {
    const resolver = this.resolvers.get(type);
    if (!resolver || ids.length === 0) return new Map();
    return resolver.publicIds(ids);
  }

  async internalIds(type: ScopedType, publicIds: readonly string[]): Promise<Map<string, bigint>> {
    const resolver = this.resolvers.get(type);
    if (!resolver || publicIds.length === 0) return new Map();
    return resolver.internalIds(publicIds);
  }
}

/** Token scope claim (`factory:<uuid>`), contract §4. */
export const scopeClaim = (type: ScopedType, publicId: string): string => `${type}:${publicId}`;

export function parseScopeClaim(claim: string): { type: ScopedType; publicId: string } | null {
  const [type, publicId] = claim.split(':');
  if ((type !== 'factory' && type !== 'company') || !publicId) return null;
  return { type, publicId };
}
