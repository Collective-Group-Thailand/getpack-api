import { type Actor } from '@common/context/actor';

import { type PermissionResolver } from './permission-resolver.service';

/** The permissions a signed-in person holds (cached by the resolver); none for machines and the system. */
export async function permissionsOf(
  resolver: PermissionResolver,
  actor: Actor,
): Promise<ReadonlySet<string>> {
  return actor.type === 'user' ? (await resolver.forUser(actor.userId)).permissions : new Set<string>();
}
