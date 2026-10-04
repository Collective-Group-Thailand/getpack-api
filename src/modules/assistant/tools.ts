import { type ToolSpec } from './model.port';

/** D-304 the only operations the assistant may run — each an existing, permission-checked one, as the customer. */
export const TOOL_NAMES = [
  'search_styles',
  'recommend_structure',
  'get_quote',
  'get_order_status',
  'lookup_glossary',
  'search_help',
  'create_handoff',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
/** Tools whose results may support a policy statement (D-304). */
export const POLICY_TOOLS: readonly ToolName[] = ['search_help', 'lookup_glossary'];

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'search_styles',
    description:
      'Search Packio’s published box styles by words (Thai or English); returns codes, names and starting prices.',
    inputSchema: obj({ query: { type: 'string', minLength: 1, maxLength: 100 } }, ['query']),
  },
  {
    name: 'recommend_structure',
    description:
      'The Structure Advisor: recommends a board for a product type, configuration and load (weight, units per box, ' +
      'stacking, fragility, transport). Returns the recommended material and its strength margin.',
    inputSchema: obj(
      {
        productTypeCode: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
        configuration: { type: 'object' },
        load: { type: 'object' },
      },
      ['productTypeCode', 'configuration', 'load'],
    ),
  },
  {
    name: 'get_quote',
    description:
      'Starting price per piece of a catalogue product (or of every product of a type) with the quantity and spec it ' +
      'assumes and the lead time. An exact price for other sizes needs the configurator.',
    inputSchema: obj(
      {
        productSlug: { type: 'string', pattern: '^[a-z0-9-]{1,120}$' },
        productTypeCode: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
      },
      [],
    ),
  },
  {
    name: 'get_order_status',
    description:
      'Status of one of the signed-in customer’s own orders by its order code; any other code is not found.',
    inputSchema: obj({ orderCode: { type: 'string', minLength: 3, maxLength: 40 } }, ['orderCode']),
  },
  {
    name: 'lookup_glossary',
    description: 'Packio’s glossary: the meaning of a packaging term (Thai or English).',
    inputSchema: obj({ term: { type: 'string', minLength: 1, maxLength: 80 } }, ['term']),
  },
  {
    name: 'search_help',
    description: 'Search Packio’s own help articles and FAQs (policies, how-to); returns the best passages.',
    inputSchema: obj({ query: { type: 'string', minLength: 1, maxLength: 200 } }, ['query']),
  },
  {
    name: 'create_handoff',
    description:
      'Hand the conversation to Packio customer service (opens a ticket answered within the D-221 target).',
    inputSchema: obj({ note: { type: 'string', maxLength: 1000 } }, []),
  },
];

/** What a tool returns to the model: JSON-serialisable data, or a refusal / not-found the model must relay. */
export interface ToolOutcome {
  ok: boolean;
  data: Record<string, unknown>;
}

/** Runs the tools for one customer (live) or from fixtures (evaluation). */
export interface ToolExecutor {
  run(name: ToolName, input: Record<string, unknown>): Promise<ToolOutcome>;
}
