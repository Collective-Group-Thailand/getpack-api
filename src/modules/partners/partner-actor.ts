import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';

/** A signed-in person (staff or factory user); machine clients and the system cannot make these changes. */
export const staffOrPartner = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};
