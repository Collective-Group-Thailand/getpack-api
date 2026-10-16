import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Price-data protection (D-044, D-190, D-142; U1 §U-B3 item 5): nothing a factory can read — any
 * `partner.*` response, at any depth — carries price suggestions, peer benchmarks or percentiles, getpack's
 * margin or sell prices, or a customer's target price. A factory sees only its own prices (IDOR is
 * covered by the e2e suites).
 */
const FORBIDDEN =
  /suggest|benchmark|peer|percentile|^p(25|50|75)$|median|margin|sell(Price|Net|Gross|Amount|Unit|Total)|targetPrice|customerPrice|otherFactor/i;

type Node = Record<string, unknown>;
const contract = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, Node & { operationId?: string; responses?: Record<string, Node> }>>;
  components: { schemas: Record<string, Node> };
};

/** Every property name reachable from a schema, with the schema that declares it. */
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
  for (const key of Object.keys(record.properties ?? {})) out.push(`${owner}.${key}`);
  for (const [key, child] of Object.entries(record))
    if (key !== 'example' && key !== 'examples') fieldsOf(child, seen, out, owner);
  return out;
}

describe('partner responses never carry protected price data (D-044)', () => {
  const partnerOperations = Object.values(contract.paths)
    .flatMap((item) => Object.values(item))
    .filter((operation) => operation.operationId?.startsWith('partner.'));

  it('covers the partner surface', () => {
    expect(partnerOperations.length).toBeGreaterThan(100);
  });

  it('has no suggestion, benchmark, margin, sell or target price field', () => {
    const leaks: string[] = [];
    for (const operation of partnerOperations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        for (const field of fieldsOf(response.content)) {
          if (FORBIDDEN.test(field.split('.').pop()!))
            leaks.push(`${operation.operationId} ${status}: ${field}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });
});
