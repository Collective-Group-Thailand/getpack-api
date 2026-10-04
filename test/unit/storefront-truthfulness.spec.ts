import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Schema = {
  $ref?: string;
  properties?: Record<string, Schema & { description?: string }>;
  required?: string[];
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  additionalProperties?: Schema | boolean;
};
interface Doc {
  paths: Record<
    string,
    Record<
      string,
      { operationId?: string; responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
    >
  >;
  components: { schemas: Record<string, Schema> };
}

const doc = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.json'), 'utf8')) as Doc;

/** Every named schema a `store.*` operation's responses reach. */
function storeSchemas(): Map<string, Schema> {
  const seen = new Map<string, Schema>();
  const walk = (s: Schema | boolean | undefined) => {
    if (!s || typeof s === 'boolean') return;
    if (s.$ref) {
      const name = s.$ref.split('/').pop()!;
      if (seen.has(name)) return;
      const target = doc.components.schemas[name]!;
      seen.set(name, target);
      walk(target);
      return;
    }
    for (const p of Object.values(s.properties ?? {})) walk(p);
    walk(s.items);
    walk(s.additionalProperties);
    for (const x of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) walk(x);
  };
  for (const methods of Object.values(doc.paths))
    for (const op of Object.values(methods))
      if (op.operationId?.startsWith('store.'))
        for (const r of Object.values(op.responses ?? {}))
          for (const c of Object.values(r.content ?? {})) walk(c.schema);
  return seen;
}

const COMPARE_AT =
  /(compare.?at|reference|original|regular|retail|msrp|was|old|before|strike|list).*price|price.*(before|was|old|original)/i;
const URGENCY = /countdown|(units|items|stock|quantity|qty)(Left|Remaining)|onlyLeft|remainingStock|hurry/i;

/** U-B4 / D-181 / D-307: no manufactured urgency and no compare-at price outside a live promotion. */
describe('storefront truthfulness guard (D-181, D-307)', () => {
  const schemas = storeSchemas();

  it('reaches the store card schemas', () => {
    expect(schemas.has('StoreProductCardDto')).toBe(true);
    expect(schemas.has('StoreProductTypeDto')).toBe(true);
  });

  it('allows a struck-through price only as an optional referencePrice tied to a campaign badge', () => {
    const offenders: string[] = [];
    for (const [name, s] of schemas)
      for (const [prop, p] of Object.entries(s.properties ?? {})) {
        if (!COMPARE_AT.test(prop)) continue;
        const tied =
          prop === 'referencePrice' &&
          !(s.required ?? []).includes(prop) &&
          'campaignBadge' in (s.properties ?? {}) &&
          /promotion/i.test(p.description ?? '');
        if (!tied) offenders.push(`${name}.${prop}`);
      }
    expect(offenders).toEqual([]);
  });

  it('carries no countdown or "only N left" field, and an end date only inside the campaign badge', () => {
    const offenders: string[] = [];
    for (const [name, s] of schemas)
      for (const prop of Object.keys(s.properties ?? {})) {
        if (URGENCY.test(prop)) offenders.push(`${name}.${prop}`);
        if (prop === 'endsAt' && 'startingPricePerPiece' in (s.properties ?? {}))
          offenders.push(`${name}.${prop}`);
      }
    expect(offenders).toEqual([]);
  });
});
