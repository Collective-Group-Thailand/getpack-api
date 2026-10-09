/** The database name of a Postgres URL; null when there is none. */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/** UAT-only scripts run against a database whose name says UAT, never in production. */
export const isUatDatabase = (url: string | undefined, env: string | undefined = process.env.NODE_ENV) =>
  env !== 'production' && /uat/i.test(databaseName(url) ?? '');
