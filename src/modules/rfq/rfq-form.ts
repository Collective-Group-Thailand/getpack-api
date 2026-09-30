/**
 * The storefront RFQ form of a product type (U-B0.1 `store.rfq-forms`): `product_types.rfq_spec_schema` (a JSON
 * Schema kept by admins, B2.5) rendered as typed fields, so the storefront never interprets JSON Schema.
 * Conventions the admin schema may use (all optional): `title` / `x-title-en` (labels), `description` /
 * `x-description-en` (help), `x-unit`, `x-widget: "textarea"`, `x-options: [{ value, labelTh, labelEn }]`
 * (option labels; plain `enum` values otherwise), and at the root `x-dimensions: { asked, required, height }`.
 */
/** Quantity tiers and files one request may carry (the submit DTO validates the same limits). */
export const MAX_RFQ_TIERS = 10;
export const MAX_RFQ_FILES = 20;

export const RFQ_FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'multiselect', 'boolean'] as const;
export type RfqFieldType = (typeof RFQ_FIELD_TYPES)[number];

export interface RfqFieldOption {
  value: string;
  labelTh: string;
  labelEn: string;
}

export interface RfqField {
  key: string;
  type: RfqFieldType;
  labelTh: string;
  labelEn: string;
  helpTh: string | null;
  helpEn: string | null;
  unit: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  options: RfqFieldOption[];
}

export interface RfqDimensionsRule {
  asked: boolean;
  required: boolean;
  height: boolean;
}

type Prop = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function options(p: Prop): RfqFieldOption[] {
  const explicit = p['x-options'];
  if (Array.isArray(explicit)) {
    return explicit
      .filter((o): o is Prop => !!o && typeof o === 'object' && str((o as Prop)['value']) !== null)
      .map((o) => {
        const value = String(o['value']);
        const th = str(o['labelTh']) ?? value;
        return { value, labelTh: th, labelEn: str(o['labelEn']) ?? th };
      });
  }
  const values = Array.isArray(p['enum']) ? p['enum'] : [];
  return values.map((v) => ({ value: String(v), labelTh: String(v), labelEn: String(v) }));
}

function field(key: string, p: Prop, required: boolean): RfqField {
  const items = (p['items'] && typeof p['items'] === 'object' ? p['items'] : {}) as Prop;
  const type: RfqFieldType =
    p['type'] === 'boolean'
      ? 'boolean'
      : p['type'] === 'number' || p['type'] === 'integer'
        ? 'number'
        : p['type'] === 'array'
          ? 'multiselect'
          : Array.isArray(p['enum']) || Array.isArray(p['x-options'])
            ? 'select'
            : p['x-widget'] === 'textarea' || (num(p['maxLength']) ?? 0) > 200
              ? 'textarea'
              : 'text';
  const labelTh = str(p['title']) ?? key;
  const helpTh = str(p['description']);
  return {
    key,
    type,
    labelTh,
    labelEn: str(p['x-title-en']) ?? labelTh,
    helpTh,
    helpEn: str(p['x-description-en']) ?? helpTh,
    unit: str(p['x-unit']),
    required,
    min: type === 'number' ? num(p['minimum']) : null,
    max: type === 'number' ? num(p['maximum']) : null,
    options: type === 'select' ? options(p) : type === 'multiselect' ? options(items) : [],
  };
}

/** The fields of a schema, in property order; a type without a schema asks for no extra fields. */
export function rfqFormFields(schema: unknown): RfqField[] {
  const s = (schema && typeof schema === 'object' ? schema : {}) as Prop;
  const props = (s['properties'] && typeof s['properties'] === 'object' ? s['properties'] : {}) as Record<
    string,
    Prop
  >;
  const required = new Set(Array.isArray(s['required']) ? s['required'].map(String) : []);
  return Object.entries(props).map(([key, p]) => field(key, p ?? {}, required.has(key)));
}

/** Dimensions are asked, optional and with a height unless the schema says otherwise. */
export function rfqDimensions(schema: unknown): RfqDimensionsRule {
  const d = ((schema as Prop | null)?.['x-dimensions'] ?? {}) as Prop;
  return {
    asked: d['asked'] !== false,
    required: d['required'] === true,
    height: d['height'] !== false,
  };
}
