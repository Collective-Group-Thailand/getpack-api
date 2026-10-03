import { ApiAuthErrors, ApiPublic } from '@common/openapi/decorators';
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

/** API surfaces and their URL prefixes (contract §2). `webhooks` is unversioned; the rest live under `/v1`. */
export const SURFACES = {
  auth: 'auth',
  store: 'store',
  admin: 'admin',
  partner: 'partner',
  b2b: 'b2b',
  webhooks: 'webhooks',
} as const;
export type Surface = keyof typeof SURFACES;

/** Token audiences and their OpenAPI security schemes (ADR-0004). */
/** `b2b`: company machine clients (client credentials, D-291) on `/v1/b2b/*`. */
export const AUDIENCES = ['customer', 'staff', 'partner', 'b2b'] as const;
export type Audience = (typeof AUDIENCES)[number];

const SURFACE_AUDIENCE: Partial<Record<Surface, Audience>> = {
  store: 'customer',
  admin: 'staff',
  partner: 'partner',
  b2b: 'b2b',
};

/**
 * Controller-level: tag prefixed by surface (`store.orders`), the surface's bearer scheme and its
 * 401/403 problems. `auth` and `webhooks` are public (`security: []`; webhooks verify signatures).
 * The tag must be registered in `src/common/openapi/tags.ts`.
 */
export function ApiSurface(surface: Surface, resource: string) {
  const audience = SURFACE_AUDIENCE[surface];
  const decorators = [ApiTags(`${surface}.${resource}`)];
  if (audience) decorators.push(ApiBearerAuth(audience), ApiAuthErrors());
  else decorators.push(ApiPublic());
  return applyDecorators(...decorators);
}
