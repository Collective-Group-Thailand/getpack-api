/** The database name of a Postgres URL; null when there is none. */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/**
 * UAT-only scripts run against a database whose name says UAT, never in production — or, on the hosted UAT stack
 * (NODE_ENV=production, one `getpack` database per box), with the explicit opt-in `UAT_TARGET_CONFIRM=uat-only`,
 * the same kind of guard as `UAT_SEED_CONFIRM`.
 */
export const isUatDatabase = (
  url: string | undefined,
  env: string | undefined = process.env.NODE_ENV,
  confirm: string | undefined = process.env.UAT_TARGET_CONFIRM,
) => confirm === 'uat-only' || (env !== 'production' && /uat/i.test(databaseName(url) ?? ''));
