/**
 * Real-user monitoring (U-B0.3): Core Web Vitals sampled in the browser, posted per zone. Only a route pattern
 * is kept (`/orders/[orderId]`), never a real path — a path could carry an order code or a tracking token
 * (PDPA, D-144) and would make every visit its own bucket.
 */
export const WEB_VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
export const VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export const RUM_ZONES = ['store', 'admin', 'partner'] as const;
export type RumZone = (typeof RUM_ZONES)[number];

const SEGMENT = /^(\[[A-Za-z][A-Za-z0-9]*\]|[a-z][a-z0-9-]{0,39}|\([a-z][a-z0-9-]*\))$/;

/** True for a Next.js route pattern: lower-case static segments and `[param]` placeholders only. */
export function isRoutePattern(route: string): boolean {
  if (route === '/') return true;
  if (!route.startsWith('/') || route.length > 200 || route.endsWith('/')) return false;
  return route
    .slice(1)
    .split('/')
    .every((segment) => SEGMENT.test(segment) && !/\d{3}/.test(segment));
}
