import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Factory confidentiality on the storefront (D-435, GLOBAL-RULES §1, D-050): no `/v1/store/*` response — public,
 * customer or sales agent — carries a field about the factories that make getpack orders: their ids, names, codes,
 * locations, counts, coverage, capacity or machines. Checked on the committed contract at any depth, in schemas and
 * in their examples, so a new field fails CI before it reaches a browser. Runtime shapes are covered by the e2e
 * suites (`call-offs`, `agents`, `logistics`, `timeline`, `style-network`, `phase4-contract`, `claims`).
 */
const FORBIDDEN = /factory|factories|partner|machine|plant|minFactories|coverage/i;

/**
 * Field names that match the pattern but say nothing about any existing factory — each with its reason. Keep this
 * list short; adding to it needs a decision.
 */
const ALLOWED = new Set<string>([
  // The agent programme's own terms (D-419): the bounty an agent earns for bringing a new factory. A rule of the
  // programme, not an identity, count or location of any partner.
  'AgentPlanTermsDto.factoryBountyAmount',
  'AgentPlanTermsDto.factoryQualifyJobs',
  'AgentPlanTermsDto.factoryQualifyDays',
]);

/** Operations removed by D-435; they must not come back. */
const REMOVED_PATHS = ['/v1/store/network/stats'];

type Node = Record<string, unknown>;
interface Operation extends Node {
  operationId?: string;
  responses?: Record<string, Node>;
}
const contract = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Node> };
};

/** Every property name reachable from a schema (`Owner.field`), following `$ref`s once each. */
function fieldsOf(node: unknown, seen = new Set<string>(), out: string[] = [], owner = ''): string[] {
  if (Array.isArray(node)) {
    for (const child of node) fieldsOf(child, seen, out, owner);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  if (typeof record.$ref === 'string') {
    const name = record.$ref.split('/').pop()!;
    if (!seen.has(name)) {
      seen.add(name);
      fieldsOf(contract.components.schemas[name], seen, out, name);
    }
    return out;
  }
  for (const key of Object.keys((record.properties as Node | undefined) ?? {})) out.push(`${owner}.${key}`);
  for (const [key, child] of Object.entries(record))
    if (key !== 'example' && key !== 'examples') fieldsOf(child, seen, out, owner);
  return out;
}

/** Every object key inside the examples reachable from a response (inline and on the referenced schemas). */
function exampleKeysOf(
  node: unknown,
  seen = new Set<string>(),
  out: string[] = [],
  inExample = false,
): string[] {
  if (Array.isArray(node)) {
    for (const child of node) exampleKeysOf(child, seen, out, inExample);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  if (!inExample && typeof record.$ref === 'string') {
    const name = record.$ref.split('/').pop()!;
    if (!seen.has(name)) {
      seen.add(name);
      exampleKeysOf(contract.components.schemas[name], seen, out);
    }
    return out;
  }
  for (const [key, child] of Object.entries(record)) {
    if (inExample) out.push(key);
    exampleKeysOf(child, seen, out, inExample || key === 'example' || key === 'examples');
  }
  return out;
}

const storeOperations = Object.entries(contract.paths)
  .filter(([path]) => path.startsWith('/v1/store/'))
  .flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, operation]) => operation && typeof operation === 'object' && 'responses' in operation)
      .map(([method, operation]) => ({ path, method, operation })),
  );

describe('storefront responses never carry factory data (D-435, GLOBAL-RULES §1)', () => {
  it('covers the store surface', () => {
    expect(storeOperations.length).toBeGreaterThan(200);
  });

  it('has no factory, partner, machine, plant or coverage field in any store response schema', () => {
    const leaks: string[] = [];
    for (const { operation } of storeOperations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        for (const field of fieldsOf(response)) {
          if (FORBIDDEN.test(field.split('.').pop()!) && !ALLOWED.has(field))
            leaks.push(`${operation.operationId} ${status}: ${field}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('has no such key in any successful store response example', () => {
    const allowedKeys = new Set([...ALLOWED].map((f) => f.split('.').pop()!));
    const leaks: string[] = [];
    for (const { operation } of storeOperations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        // Error examples are keyed by their problem `code` (e.g. `agents.lead_existing_factory`), not payload keys.
        if (!status.startsWith('2')) continue;
        for (const key of exampleKeysOf(response)) {
          if (FORBIDDEN.test(key) && !allowedKeys.has(key))
            leaks.push(`${operation.operationId} ${status}: ${key}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('no longer publishes network statistics', () => {
    for (const path of REMOVED_PATHS) expect(contract.paths[path]).toBeUndefined();
    expect(Object.keys(contract.paths).filter((p) => p.startsWith('/v1/store/network'))).toEqual([]);
  });

  it('flags a factory field if one is added (self-test of the walker)', () => {
    const probe = { properties: { factoryName: { type: 'string' } } };
    expect(fieldsOf(probe, new Set(), [], 'Probe').some((f) => FORBIDDEN.test(f.split('.').pop()!))).toBe(
      true,
    );
    expect(exampleKeysOf({ example: { partnersCount: 3 } })).toContain('partnersCount');
  });
});
