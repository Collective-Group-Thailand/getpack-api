// Operations under a surface prefix must use that surface's audience scheme (contract §2, ADR-0004).
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
      const security = operation.security ?? [];
      const ok =
        security.length > 0 && security.every((req) => Object.keys(req).length === 1 && scheme in req);
      if (!ok) {
        results.push({
          message: `${method.toUpperCase()} ${route} must require only the "${scheme}" bearer scheme`,
          path: [...context.path, route, method, 'security'],
        });
      }
    }
  }
  return results;
}
