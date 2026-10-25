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

/**
 * D-440: values (enum members and example strings) that name a factory or production capacity. The Thai word is the
 * one customers must never read (GLOBAL-RULES §1).
 */
const FORBIDDEN_VALUE = /factory|capacity|โรงงาน/i;

/**
 * Enums whose factory value is the sales-agent programme's own term (D-417, D-419): an agent registers a factory as a
 * lead and earns its bounty — a rule of the programme, never an existing partner's identity, count or location.
 */
const ALLOWED_ENUMS = new Set(['AgentLeadKind', 'AgentCommissionKind']);

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

/** Every named enum component reachable from a schema, with its values. */
function enumsOf(
  node: unknown,
  seen = new Set<string>(),
  out = new Map<string, unknown[]>(),
): Map<string, unknown[]> {
  if (Array.isArray(node)) {
    for (const child of node) enumsOf(child, seen, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  if (typeof record.$ref === 'string') {
    const name = record.$ref.split('/').pop()!;
    if (seen.has(name)) return out;
    seen.add(name);
    const schema = contract.components.schemas[name];
    if (schema && Array.isArray(schema.enum)) out.set(name, schema.enum as unknown[]);
    enumsOf(schema, seen, out);
    return out;
  }
  for (const [key, child] of Object.entries(record))
    if (key !== 'example' && key !== 'examples') enumsOf(child, seen, out);
  return out;
}

/** Every string inside the examples of a response (inline ones; component examples are shared with staff). */
function exampleStringsOf(node: unknown, out: string[] = [], inExample = false): string[] {
  if (typeof node === 'string') {
    if (inExample) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) exampleStringsOf(child, out, inExample);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const [key, child] of Object.entries(node as Node)) {
    if (!inExample && key === 'schema') continue;
    exampleStringsOf(child, out, inExample || key === 'example' || key === 'examples');
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
        // Error examples are keyed by their problem `code` (checked by the error-code test below), not payload keys.
        if (!status.startsWith('2')) continue;
        for (const key of exampleKeysOf(response)) {
          if (FORBIDDEN.test(key) && !allowedKeys.has(key))
            leaks.push(`${operation.operationId} ${status}: ${key}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('carries no factory- or capacity-named enum value in any store response (D-440)', () => {
    const leaks: string[] = [];
    for (const { operation } of storeOperations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        for (const [name, values] of enumsOf(response))
          for (const value of values)
            if (FORBIDDEN_VALUE.test(String(value)) && !ALLOWED_ENUMS.has(name))
              leaks.push(`${operation.operationId}: ${name}.${String(value)}`);
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('shows customers no factory word in any store success example (D-440)', () => {
    const leaks: string[] = [];
    for (const { operation } of storeOperations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        for (const text of exampleStringsOf(response))
          // The agent programme's lead kind `factory` is its own term (ALLOWED_ENUMS).
          if (FORBIDDEN_VALUE.test(text) && text !== 'factory' && text !== 'factory_bounty')
            leaks.push(`${operation.operationId} ${status}: ${text}`);
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('answers no store problem whose code names a factory or capacity (D-440)', () => {
    const codes = new Set<string>();
    for (const { operation } of storeOperations)
      for (const response of Object.values(operation.responses ?? {}))
        for (const text of exampleStringsOf(response))
          if (/^[a-z_]+\.[a-z_]+$/.test(text) && FORBIDDEN_VALUE.test(text))
            codes.add(`${operation.operationId}: ${text}`);
    expect([...codes]).toEqual([]);
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
    expect(exampleStringsOf({ example: { statusLabelAdminTh: 'รอโรงงานรับงาน' } })).toContain(
      'รอโรงงานรับงาน',
    );
  });
});
