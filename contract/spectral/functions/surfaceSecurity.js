// Operations under a surface prefix must use that surface's audience scheme, or be explicitly public
// or optionally authenticated (contract §2, ADR-0004).
const SURFACE_SCHEME = { '/v1/store/': 'customer', '/v1/admin/': 'staff', '/v1/partner/': 'partner' };
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

export default function surfaceSecurity(paths, _options, context) {
  const results = [];
  for (const [route, item] of Object.entries(paths ?? {})) {
    const entry = Object.entries(SURFACE_SCHEME).find(([prefix]) => route.startsWith(prefix));
    if (!entry) continue;
    const [, scheme] = entry;
    for (const method of METHODS) {
      const operation = item?.[method];
      if (!operation) continue;
      const security = operation.security;
      // `[]` = explicitly public (`@Public()`, e.g. store catalogue reads, contract §2); an empty
      // requirement object `{}` = optional authentication. Every scheme named must be the surface's.
      const ok =
        Array.isArray(security) &&
        (security.length === 0 ||
          (security.some((req) => Object.keys(req).length === 1) &&
            security.every(
              (req) => Object.keys(req).length === 0 || (Object.keys(req).length === 1 && scheme in req),
            )));
      if (!ok) {
        results.push({
          message: `${method.toUpperCase()} ${route} must require only the "${scheme}" bearer scheme (or be public)`,
          path: [...context.path, route, method, 'security'],
        });
      }
    }
  }
  return results;
}
