import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { type Request } from 'express';

/**
 * Documentation check (U-B2): with `GETPACK_OBSERVED_ERRORS_DIR` set (the e2e run sets it; never in
 * production), every problem answered by a matched route is appended as `{ method, route, code }` to
 * `<dir>/<pid>.jsonl`. `pnpm contract:observed-errors` maps the route to its operation in the contract
 * and fails on any code an operation really returned but does not document.
 */
export function recordObservedError(req: Request, code: string): void {
  const dir = process.env.GETPACK_OBSERVED_ERRORS_DIR;
  if (!dir || process.env.NODE_ENV === 'production') return;
  // The Express route pattern of the matched handler (`/v1/admin/orders/:orderId`); unmatched paths have none.
  const route = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof route !== 'string') return;
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ method: req.method.toLowerCase(), route, code });
  appendFileSync(join(dir, `${process.pid}.jsonl`), `${line}\n`);
}
