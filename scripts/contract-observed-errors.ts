/**
 * `pnpm contract:observed-errors` (U-B2, contract §5 "the codes that operation can actually return"):
 * reads the problems the e2e run answered (`.e2e-observed-errors/*.jsonl`, written by the problem
 * filter) and fails when an operation returned a code its documentation does not list.
 * Plain Node (no build): run after `pnpm test:e2e`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dir = join(root, '.e2e-observed-errors');
const contract = JSON.parse(readFileSync(join(root, 'contract', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, ResponseDoc> }>>;
};
interface ResponseDoc {
  content?: Record<string, { examples?: Record<string, unknown> }>;
}

// `get /v1/admin/orders/{orderId}` → operation id and the problem codes it documents.
const documented = new Map<string, { operationId: string; codes: Set<string> }>();
for (const [path, item] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!operation.operationId) continue;
    const codes = new Set<string>();
    for (const response of Object.values(operation.responses ?? {}))
      for (const code of Object.keys(response.content?.['application/problem+json']?.examples ?? {}))
        codes.add(code);
    documented.set(`${method} ${path}`, { operationId: operation.operationId, codes });
  }
}
/** Express pattern (`/:orderId`, `/*path`) → OpenAPI path (`/{orderId}`). */
const toOpenApi = (route: string) => route.replace(/[:*]([A-Za-z0-9_]+)/g, '{$1}');

if (!existsSync(dir)) {
  console.error(`No ${dir}: run pnpm test:e2e first.`);
  process.exit(1);
}
const observed = new Map<string, Set<string>>();
let lines = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (!line) continue;
    lines += 1;
    const { method, route, code } = JSON.parse(line) as { method: string; route: string; code: string };
    const key = `${method} ${toOpenApi(route)}`;
    if (!observed.has(key)) observed.set(key, new Set());
    observed.get(key)!.add(code);
  }
}

const gaps: string[] = [];
for (const [key, codes] of [...observed].sort(([a], [b]) => a.localeCompare(b))) {
  const operation = documented.get(key);
  if (!operation) {
    // Routes outside the contract (health, docs) are not documented operations.
    continue;
  }
  for (const code of [...codes].sort())
    if (!operation.codes.has(code)) gaps.push(`${operation.operationId}: returns ${code}, not documented`);
}
console.log(`${lines} problems observed across ${observed.size} operations.`);
if (gaps.length > 0) {
  console.error(gaps.join('\n'));
  console.error(
    `\n${gaps.length} undocumented problem code(s): add them to the operation's @ApiStandardErrors.`,
  );
  process.exit(1);
}
console.log('Every observed problem code is documented.');
