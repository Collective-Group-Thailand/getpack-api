import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * P4-01 / P4-D1: a partner factory never sees a getpack customer's identity. No `partner.*` response, at any
 * depth, carries a destination with the recipient's name, phone, address lines or full postcode — only the
 * destination code (`D1` …), the province and the postcode prefix. Staff (`admin.*`) keep the full contact.
 * (The factory's own ERP customers — CRM, quotations, receivables — are the factory's data, P4-03.)
 */
const HIDDEN = ['recipientName', 'phone', 'line1', 'line2', 'postcode'];
const DESTINATION_SCHEMAS = ['JobDestinationDto', 'ShipmentDestinationDto', 'ShipPlanDestinationDto'];
/** Partner schemas that describe getpack jobs and trips (not the factory's own ERP). */
const GETPACK_WORK_SCHEMAS = ['PartnerJobDto', 'PartnerShipmentDto', 'ShipPlanJobDto'];

type Node = Record<string, unknown>;
const contract = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, Node & { operationId?: string; responses?: Record<string, Node> }>>;
  components: { schemas: Record<string, Node & { properties?: Record<string, unknown> }> };
};
const schemas = contract.components.schemas;

/** Every schema name reachable from `node`. */
function reachable(node: unknown, seen = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) reachable(child, seen);
    return seen;
  }
  if (!node || typeof node !== 'object') return seen;
  const record = node as Node;
  if (typeof record.$ref === 'string') {
    const name = record.$ref.split('/').pop()!;
    if (!seen.has(name)) {
      seen.add(name);
      reachable(schemas[name], seen);
    }
    return seen;
  }
  for (const [key, child] of Object.entries(record))
    if (key !== 'example' && key !== 'examples') reachable(child, seen);
  return seen;
}

const operations = Object.values(contract.paths).flatMap((item) => Object.values(item));
const responseSchemas = (prefix: string) =>
  operations
    .filter((o) => o.operationId?.startsWith(prefix))
    .reduce((acc, o) => reachable(o.responses, acc), new Set<string>());

describe('partner responses carry no getpack customer identity (P4-01 / P4-D1)', () => {
  it('publishes destinations by code and postcode prefix only', () => {
    for (const name of DESTINATION_SCHEMAS) {
      const props = Object.keys(schemas[name]?.properties ?? {});
      expect(props).toEqual(expect.arrayContaining(['code', 'postcodePrefix']));
      expect(props.filter((p) => HIDDEN.includes(p))).toEqual([]);
    }
  });

  it('reaches no recipient field from a getpack job or trip on the partner surface', () => {
    const partner = responseSchemas('partner.');
    for (const name of [...DESTINATION_SCHEMAS, ...GETPACK_WORK_SCHEMAS]) expect(partner).toContain(name);
    const leaks = GETPACK_WORK_SCHEMAS.flatMap((root) =>
      [...reachable({ $ref: `#/components/schemas/${root}` })].flatMap((name) =>
        Object.keys(schemas[name]?.properties ?? {})
          .filter(
            (p) =>
              ['recipientName', 'line1', 'line2'].includes(p) ||
              (name.includes('Destination') && HIDDEN.includes(p)),
          )
          .map((p) => `${root} → ${name}.${p}`),
      ),
    );
    expect(leaks).toEqual([]);
  });

  it('keeps the recipient contact for staff', () => {
    const admin = responseSchemas('admin.');
    expect(admin).toContain('AdminJobDestinationDto');
    expect(admin).toContain('AdminShipmentDestinationDto');
    for (const name of ['AdminJobDestinationDto', 'AdminShipmentDestinationDto'])
      expect(Object.keys(schemas[name]?.properties ?? {})).toEqual(expect.arrayContaining(HIDDEN));
  });
});
