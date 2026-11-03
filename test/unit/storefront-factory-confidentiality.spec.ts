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
  // (empty since P-03 / D-464: the factory referral bounty left the agent programme and its store terms)
]);

/**
 * D-440: values (enum members and example strings) that name a factory or production capacity. The Thai word is the
 * one customers must never read (GLOBAL-RULES §1).
 */
const FORBIDDEN_VALUE = /factory|capacity|โรงงาน/i;

/**
 * Enums whose factory value is the sales-agent programme's own term: `AgentCommissionKind.factory_bounty` stays for the
 * history of entries earned before P-03 / D-464 (no new ones). Agents register customer leads only
 * (`StoreAgentLeadKind`), so `AgentLeadKind` is staff-only now.
 */
const ALLOWED_ENUMS = new Set(['AgentCommissionKind']);

/** D-468 (Phase 3): the agent zone's pipeline, quote, discount, deal, playbook, card-scan and forecast operations. */
const P3_AGENT_OPERATIONS = [
  'store.agentLeads.check',
  'store.agentLeads.list',
  'store.agentLeads.get',
  'store.agentLeads.update',
  'store.agentLeads.changeStage',
  'store.agentLeads.addActivity',
  'store.agentLeads.listActivities',
  'store.agentLeads.export',
  'store.agentLeads.importPreview',
  'store.agentLeads.importCommit',
  'store.agentQuotes.create',
  'store.agentQuotes.list',
  'store.agentQuotes.get',
  'store.agentQuotes.resend',
  'store.agentQuotes.withdraw',
  'store.agentQuotes.requestDiscount',
  'store.agentQuotes.discountRequests',
  'store.agentQuotes.acceptOption',
  'store.agentQuotes.registerDeal',
  'store.agentPlaybook.get',
  'store.agentLeads.scanCard',
  'store.agentCommissions.forecast',
];

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
          // The retired bounty's commission kind is history (ALLOWED_ENUMS).
          if (FORBIDDEN_VALUE.test(text) && text !== 'factory_bounty')
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

/**
 * D-464 (owner 2026-11-01): no profit / margin wording anywhere an agent or a visitor can see, and no commission cap.
 * The margin alert is internal; the agent's terms say "ไม่จำกัดรายได้".
 */
describe('agent-facing responses carry no profit, margin or cap (D-464)', () => {
  const agentOperations = storeOperations.filter(({ path }) => path.startsWith('/v1/store/agent'));
  const WORDING = /margin|profit|กำไร|cap(Amount|Pct)?$|maxCommission/i;

  it('covers the agent surface', () => {
    expect(agentOperations.length).toBeGreaterThan(10);
  });

  it('covers the agent zone endpoints of D-467 (push, notification choices) with every check above', () => {
    const ids = new Set(agentOperations.map(({ operation }) => operation.operationId));
    for (const id of [
      'store.agentPush.vapidPublicKey',
      'store.agentPush.subscribe',
      'store.agentPush.unsubscribe',
      'store.agentNotificationPreferences.get',
      'store.agentNotificationPreferences.set',
    ])
      expect(ids).toContain(id);
  });

  it('covers the agent pipeline and quote endpoints of D-468 with every check above', () => {
    const ids = new Set(agentOperations.map(({ operation }) => operation.operationId));
    for (const id of P3_AGENT_OPERATIONS) expect(ids).toContain(id);
  });

  it('never gives an agent a cost, buy price, margin or internal breakdown (D-468 quote on behalf)', () => {
    // `BasisSizesDto.internal` is the inside size of a box, not a cost; the staff option (`AdminSavedQuoteOptionDto`,
    // its `internal` cost breakdown) must never be reachable.
    const COST = /cost|buyPrice|buy_price|breakdown|margin|selectedFactory|^Admin/i;
    const leaks: string[] = [];
    for (const { operation } of agentOperations)
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        for (const field of fieldsOf(response))
          if (COST.test(field.split('.').pop()!) || COST.test(field.split('.')[0]!))
            leaks.push(`${operation.operationId}: ${field}`);
        for (const key of exampleKeysOf(response))
          if (COST.test(key)) leaks.push(`${operation.operationId}: ${key}`);
      }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('has no margin, profit or cap field in any agent response schema or example', () => {
    const leaks: string[] = [];
    for (const { operation } of agentOperations)
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        for (const field of fieldsOf(response))
          if (WORDING.test(field.split('.').pop()!))
            leaks.push(`${operation.operationId} ${status}: ${field}`);
        if (!status.startsWith('2')) continue;
        for (const key of exampleKeysOf(response))
          if (WORDING.test(key)) leaks.push(`${operation.operationId} ${status}: ${key}`);
        for (const text of exampleStringsOf(response))
          if (/กำไร|profit|margin/i.test(text)) leaks.push(`${operation.operationId} ${status}: ${text}`);
      }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('accepts customer leads only (P-03)', () => {
    const op = contract.paths['/v1/store/agent/leads']?.['post'];
    expect(JSON.stringify(op)).toContain('agents.lead_kind_unsupported');
    const kinds = contract.components.schemas['StoreAgentLeadKind'] as { enum?: string[] } | undefined;
    expect(kinds?.enum).toEqual(['customer']);
  });
});

/**
 * D-469 / D-470 (Phase 4): the sales desk and the discount approval desk are staff-only. No store response may reach
 * the waterfall, the approval, the factory price lock, the waterfall access log or the inbound pool, and the desk's
 * own staff routes stay on `/v1/admin`.
 */
describe('the sales desk and its waterfall stay off the store surface (D-469, D-470)', () => {
  const DESK_SCHEMAS =
    /Waterfall|DiscountApproval|PriceLock|SalesInbound|SalesDashboard|SalesRep|DiscountSimulation|PostDeal|Negotiation/;
  const storeOps = Object.entries(contract.paths)
    .filter(([path]) => path.startsWith('/v1/store/'))
    .flatMap(([, ops]) => Object.values(ops));

  it('reaches no desk schema from any store response', () => {
    const leaks: string[] = [];
    for (const operation of storeOps)
      for (const [status, response] of Object.entries(operation.responses ?? {}))
        for (const field of fieldsOf(response))
          if (DESK_SCHEMAS.test(field.split('.')[0]!))
            leaks.push(`${operation.operationId} ${status}: ${field}`);
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('publishes every desk operation under /v1/admin only', () => {
    const desk = Object.entries(contract.paths).flatMap(([path, ops]) =>
      Object.values(ops)
        .filter((o) =>
          /^(admin|store)\.(salesLeads|salesQuotes|salesReps|salesInbound|sales|discountApprovals|salesNegotiations|salesPlaybook|salesPostDeal)\./.test(
            o.operationId ?? '',
          ),
        )
        .map((o) => ({ path, id: o.operationId })),
    );
    expect(desk.length).toBeGreaterThan(20);
    for (const { path, id } of desk) expect([id, path.startsWith('/v1/admin/sales/')]).toEqual([id, true]);
  });
});
