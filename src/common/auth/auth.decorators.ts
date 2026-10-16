import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { ApiOptionalAuth, ApiPublic } from '@common/openapi/decorators';
import { applyDecorators, createParamDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'getpack:public';
export const OPTIONAL_AUTH = 'getpack:optional-auth';

/** No token required on a protected surface (documented as `security: []`). */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC, true), ApiPublic());

/**
 * On `/v1/auth` routes: authenticate a bearer token of this audience when one is sent (e.g. to link
 * a LINE or Google identity to the signed-in customer), but do not require it.
 */
export const OptionalAuth = (audience: 'customer' | 'staff' | 'partner') =>
  applyDecorators(SetMetadata(OPTIONAL_AUTH, audience), ApiOptionalAuth(audience));

/** The authenticated actor; 401 when the route is reached without one. */
export const CurrentActor = createParamDecorator((_data: unknown): Actor => {
  const actor = RequestContext.actor();
  if (!actor) throw new DomainException('auth.unauthenticated');
  return actor;
});

/** The authenticated actor or `undefined` (routes with `@OptionalAuth`). */
export const OptionalActor = createParamDecorator((_data: unknown): Actor | undefined =>
  RequestContext.actor(),
);
