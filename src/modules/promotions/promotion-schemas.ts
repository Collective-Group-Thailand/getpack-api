import { DomainException } from '@common/errors/domain.exception';
import { Ajv } from 'ajv';

/**
 * JSON schemas (v1) of promotion conditions and benefits (D-053); stored with their schema version on
 * each promotion. The engine (`promotion-engine.ts`) reads exactly these shapes.
 */
const MONEY = { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,2})?$' };
const PCT = { type: 'string', pattern: '^(100(\\.0{1,4})?|\\d{1,2}(\\.\\d{1,4})?)$' };
const CODES = {
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength: 64 },
  minItems: 1,
  uniqueItems: true,
};

export const CONDITIONS_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    channels: {
      type: 'array',
      items: { enum: ['web', 'cs', 'line', 'b2b'] },
      minItems: 1,
      uniqueItems: true,
    },
    segments: { type: 'array', items: { enum: ['new', 'returning', 'b2b'] }, minItems: 1, uniqueItems: true },
    productTypeCodes: CODES,
    categoryCodes: CODES,
    catalogProductIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      minItems: 1,
      uniqueItems: true,
    },
    minQuantity: { type: 'integer', minimum: 1 },
    minOrderValue: MONEY,
    firstOrderOnly: { type: 'boolean' },
    paymentMethods: {
      type: 'array',
      items: {
        enum: ['scb_qr', 'scb_qr_cross_bank', 'card_2c2p', 'online_banking_2c2p', 'bank_transfer_slip'],
      },
      minItems: 1,
      uniqueItems: true,
    },
    zoneCodes: CODES,
  },
} as const;

export const BENEFIT_SCHEMA_V1 = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'pct'],
      properties: { type: { const: 'percent' }, pct: PCT, maxAmount: MONEY },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'amount'],
      properties: { type: { const: 'fixed' }, amount: MONEY },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'basis', 'tiers'],
      properties: {
        type: { const: 'tiered' },
        basis: { enum: ['quantity', 'value'] },
        maxAmount: MONEY,
        tiers: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['min'],
            properties: { min: MONEY, pct: PCT, amount: MONEY },
            oneOf: [{ required: ['pct'] }, { required: ['amount'] }],
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'unitPrice'],
      properties: {
        type: { const: 'unit_price_override' },
        unitPrice: { type: 'string', pattern: '^\\d{1,9}(\\.\\d{1,6})?$' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'rounds'],
      properties: {
        type: { const: 'free_revision_rounds' },
        rounds: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'multiplier'],
      properties: {
        type: { const: 'points_multiplier' },
        multiplier: { type: 'string', pattern: '^\\d{1,2}(\\.\\d{1,2})?$' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'points'],
      properties: {
        type: { const: 'bonus_points' },
        points: { type: 'integer', minimum: 1, maximum: 1_000_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: { enum: ['free_shipping', 'free_design', 'free_mockup'] } },
    },
  ],
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const validateConditions = ajv.compile(CONDITIONS_SCHEMA_V1);
const validateBenefit = ajv.compile(BENEFIT_SCHEMA_V1);

/** Refuses conditions or a benefit that do not match the v1 schemas (422 with field paths). */
export function assertPromotionShape(conditions: unknown, benefit: unknown): void {
  const errors: { path: string; code: string; message: string }[] = [];
  if (!validateConditions(conditions))
    for (const e of validateConditions.errors ?? [])
      errors.push({
        path: `conditions${e.instancePath.replace(/\//g, '.')}`,
        code: e.keyword,
        message: e.message ?? 'invalid',
      });
  if (!validateBenefit(benefit))
    errors.push({ path: 'benefit', code: 'schema', message: 'not a known benefit (D-053)' });
  if (errors.length) throw new DomainException('validation.failed', { errors });
}
