import { quantityBand } from '@modules/rfq/rfq-spec';
import { Ajv, type ValidateFunction } from 'ajv';

/**
 * Frontend analytics events posted through the BFF (B6.1, D-102). Each event name has a closed property
 * schema — nothing else is stored, so no free text (and no personal data) can ride along; exact quantities
 * are banded before they are stored (PDPA). Page paths lose their query string and any segment that looks
 * like an identifier.
 */
export const ANALYTICS_EVENT_NAMES = [
  'page_view',
  'configurator_step',
  'quote_shown',
  'add_to_cart',
  'checkout_step',
  // D-286 the studio funnel (spec §1): started, box confirmed, first artwork, checks clean, added to cart, ordered.
  'studio_started',
  'studio_box_confirmed',
  'studio_first_artwork',
  'studio_checks_clean',
  'studio_add_to_cart',
  'studio_ordered',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'other'] as const;
export const PAGE_TYPES = [
  'home',
  'category',
  'product',
  'configurator',
  'cart',
  'checkout',
  'account',
  'content',
  'other',
] as const;
export const CHECKOUT_STEPS = ['started', 'address', 'payment', 'review', 'placed'] as const;

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const DECIMAL = '^\\d{1,12}(\\.\\d{1,6})?$';

/** D-286: what a studio event may carry — the print method and the style family, nothing that identifies. */
const STUDIO_PROPERTIES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    printMethod: { enum: ['digital', 'offset', 'flexo', 'none'] },
    styleFamily: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,59}$' },
  },
};

const SCHEMAS: Record<AnalyticsEventName, object> = {
  studio_started: STUDIO_PROPERTIES,
  studio_box_confirmed: STUDIO_PROPERTIES,
  studio_first_artwork: STUDIO_PROPERTIES,
  studio_checks_clean: STUDIO_PROPERTIES,
  studio_add_to_cart: {
    type: 'object',
    additionalProperties: false,
    required: ['quantity'],
    properties: {
      ...STUDIO_PROPERTIES.properties,
      quantity: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    },
  },
  studio_ordered: STUDIO_PROPERTIES,
  page_view: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pageType: { enum: PAGE_TYPES },
      referrerHost: { type: 'string', pattern: '^[a-z0-9.-]{1,253}$' },
    },
  },
  configurator_step: {
    type: 'object',
    additionalProperties: false,
    required: ['step'],
    properties: {
      step: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
      stepIndex: { type: 'integer', minimum: 0, maximum: 50 },
    },
  },
  quote_shown: {
    type: 'object',
    additionalProperties: false,
    required: ['quantity', 'instant'],
    properties: {
      quantity: { type: 'integer', minimum: 1, maximum: 100_000_000 },
      instant: { type: 'boolean' },
      leadTimeDays: { type: ['integer', 'null'], minimum: 0, maximum: 365 },
      unitPrice: { type: ['string', 'null'], pattern: DECIMAL },
    },
  },
  add_to_cart: {
    type: 'object',
    additionalProperties: false,
    required: ['quantity'],
    properties: { quantity: { type: 'integer', minimum: 1, maximum: 100_000_000 } },
  },
  checkout_step: {
    type: 'object',
    additionalProperties: false,
    required: ['step'],
    properties: {
      step: { enum: CHECKOUT_STEPS },
      orderGroupId: { type: 'string', pattern: UUID },
    },
    // The placed order group links the session to its payment (funnel "paid"); only on `placed`.
    if: { properties: { step: { const: 'placed' } } },
    then: { required: ['orderGroupId'] },
    else: { not: { required: ['orderGroupId'] } },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<AnalyticsEventName, ValidateFunction>(
  ANALYTICS_EVENT_NAMES.map((name) => [name, ajv.compile(SCHEMAS[name])]),
);

export interface PropertyError {
  path: string;
  code: string;
  message: string;
}

/** Validates and normalises the properties of one event; exact quantities become bands. */
export function normaliseProperties(
  name: AnalyticsEventName,
  properties: unknown,
  path: string,
): { value: Record<string, unknown>; errors: PropertyError[] } {
  const input = properties ?? {};
  const validate = validators.get(name)!;
  if (!validate(input)) {
    return {
      value: {},
      errors: (validate.errors ?? []).slice(0, 20).map((e) => ({
        path: `${path}${e.instancePath.replace(/\//g, '.')}`,
        code: e.keyword,
        message: e.message ?? 'invalid',
      })),
    };
  }
  const value = { ...(input as Record<string, unknown>) };
  if (typeof value['quantity'] === 'number') {
    value['quantityBand'] = quantityBand(value['quantity']);
    delete value['quantity'];
  }
  return { value, errors: [] };
}

const IDENTIFIER_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /\d{5,}/, // order / phone / tracking numbers
  /@/, // e-mail
  /^[A-Za-z0-9_-]{24,}$/, // tokens
];

/**
 * Path only (no scheme, host, query or fragment), with identifier-like segments replaced by `:id`
 * (share tokens, order codes, e-mails in a path must never reach analytics).
 */
export function sanitisePagePath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let path = raw.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  path = path.split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/')) return null;
  const segments = path.split('/').map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':id';
    }
    return IDENTIFIER_SEGMENT.some((re) => re.test(decoded)) ? ':id' : segment;
  });
  return segments.join('/').slice(0, 300) || '/';
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/** Campaign parameters only; a value that could carry personal data (e-mail, long digit runs) is dropped. */
export function sanitiseUtm(
  utm: Partial<Record<(typeof UTM_KEYS)[number], string>> | undefined | null,
): Record<string, string> | null {
  if (!utm) return null;
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = utm[key]?.trim().toLowerCase();
    if (!value || value.length > 100 || /@/.test(value) || /\d{9,}/.test(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}
