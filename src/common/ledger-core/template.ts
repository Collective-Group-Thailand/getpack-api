import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { evaluateCondition } from '@platform/approvals/conditions';

import { assertExpression, evaluate, ExpressionError, readPath, type Scope } from './expression';

/**
 * Posting-rule templates (ADR-0007). A rule version holds `conditions` (approval-engine shape over
 * `payload.<path>`) and a `template`; the engine renders the template against the event payload into
 * journal lines. Everything a Finance user may change — accounts, sides, amounts, dimensions, tax
 * tagging — is data here, so ⚖ positions of accounting-design §2 are configuration, not code.
 */

export const TAX_CODES = [
  'output_vat',
  'output_vat_not_due',
  'input_vat',
  'input_vat_pending',
  'wht_receivable',
  'wht_pnd3',
  'wht_pnd53',
  'wht_pnd1',
] as const;
export type TaxCodeValue = (typeof TAX_CODES)[number];

/** Dimension keys of a template → the journal-line column they fill (accounting-design §3). */
export const DIMENSION_KEYS = [
  'order',
  'orderGroup',
  'customer',
  'company',
  'factory',
  'vendor',
  'productType',
  'channel',
  'campaign',
  'promotion',
  'costCentre',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];
/** Template dimension → payload path (public ids; `channel` a sales channel; `costCentre` a code). */
export type DimensionMap = Partial<Record<string, string>>;

/**
 * `"1131"` (an account code), `{ path }` (a code carried by the event, e.g. a bank's GL account) or
 * `{ switch, cases, default }` on a payload value (e.g. the payment provider → its clearing account).
 */
export type AccountSelector =
  | string
  | { path: string }
  | { switch: string; cases: Record<string, AccountSelector>; default?: AccountSelector };

/** A tax code, or `{ switch, cases, default }` like an account. */
export type TaxCodeSelector =
  TaxCodeValue | { switch: string; cases: Record<string, TaxCodeValue>; default?: TaxCodeValue };

export interface TemplateLine {
  /** Repeats the line for every element of this payload array; the element is `item`. */
  forEach?: string;
  /** Line condition (approval-engine shape; `payload.<path>` and, inside `forEach`, `payload.item.<path>`). */
  when?: unknown;
  account: AccountSelector;
  side: 'debit' | 'credit';
  /** Amount expression; a negative result posts on the other side, zero posts nothing. */
  amount: string;
  description?: string;
  dimensions?: DimensionMap;
  taxCode?: TaxCodeSelector;
  /** Tax base expression (tax-report line, B5.4). */
  taxBase?: string;
}

export interface PostingTemplate {
  /** Entry description; `{path}` placeholders read the payload. */
  description: string;
  /** Payload path of the document date (`YYYY-MM-DD` or ISO instant); default: the event time. */
  documentDate?: string;
  source?: { type: string; id: string; number?: string };
  /** Defaults for every line (a line's own dimensions win). */
  dimensions?: DimensionMap;
  /** A memo rule (P13, P24) has no lines: commitments stay outside the GL. */
  lines: TemplateLine[];
}

export interface RenderedLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: MoneyValue;
  description: string | null;
  /** Dimension key → raw payload value (resolved to ids by the engine). */
  dimensions: Partial<Record<string, string>>;
  taxCode: TaxCodeValue | null;
  taxBase: MoneyValue | null;
}

export interface RenderedJournal {
  description: string;
  documentDate: string | null;
  source: { type: string; publicId: string; number: string | null } | null;
  lines: RenderedLine[];
  totalDebit: MoneyValue;
  totalCredit: MoneyValue;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Whether the rule version applies to the payload (`null` conditions = always). */
export function ruleApplies(conditions: unknown, payload: Scope): boolean {
  return evaluateCondition(conditions ?? null, { payload });
}

function selectAccount(selector: AccountSelector, scope: Scope): string {
  if (typeof selector === 'string') return selector;
  if ('path' in selector) {
    const code = readPath(scope, selector.path);
    if (typeof code !== 'string' || code === '')
      throw new TemplateError(`no account code at "${selector.path}"`);
    return code;
  }
  const key = readPath(scope, selector.switch);
  const next = selector.cases[String(key)] ?? selector.default;
  if (next === undefined) throw new TemplateError(`no account for ${selector.switch} = ${String(key)}`);
  return selectAccount(next, scope);
}

function selectTaxCode(selector: TaxCodeSelector | undefined, scope: Scope): TaxCodeValue | null {
  if (selector === undefined) return null;
  if (typeof selector === 'string') return selector;
  const key = readPath(scope, selector.switch);
  return selector.cases[String(key)] ?? selector.default ?? null;
}

function interpolate(text: string, scope: Scope): string {
  return text.replace(/\{([A-Za-z0-9_.]+)\}/g, (_, path: string) => {
    const value = readPath(scope, path);
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  });
}

function dimensionsOf(map: DimensionMap | undefined, scope: Scope): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const [key, path] of Object.entries(map ?? {})) {
    if (!path) continue;
    const value = readPath(scope, path);
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/**
 * Renders the template for one event payload. Lines are rounded half-up to 2 decimals; zero lines are
 * dropped; a negative amount posts on the opposite side. The result may be unbalanced — the engine
 * refuses to post it (`ledger.unbalanced`), it never plugs a difference.
 */
export function renderJournal(template: PostingTemplate, payload: Scope): RenderedJournal {
  const lines: RenderedLine[] = [];
  for (const line of template.lines) {
    const scopes: Scope[] = line.forEach
      ? ((readPath(payload, line.forEach) as unknown[] | undefined) ?? []).map((item) => ({
          ...payload,
          item,
        }))
      : [payload];
    for (const scope of scopes) {
      if (line.when !== undefined && !evaluateCondition(line.when, { payload: scope })) continue;
      let amount: MoneyValue;
      try {
        amount = evaluate(line.amount, scope).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
      } catch (error) {
        if (error instanceof ExpressionError) throw new TemplateError(error.message);
        throw error;
      }
      if (amount.isZero()) continue;
      const side = amount.isNegative() ? (line.side === 'debit' ? 'credit' : 'debit') : line.side;
      const taxBase = line.taxBase
        ? evaluate(line.taxBase, scope).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).abs()
        : null;
      lines.push({
        accountCode: selectAccount(line.account, scope),
        side,
        amount: amount.abs(),
        description: line.description ? interpolate(line.description, scope) : null,
        dimensions: { ...dimensionsOf(template.dimensions, scope), ...dimensionsOf(line.dimensions, scope) },
        taxCode: selectTaxCode(line.taxCode, scope),
        taxBase,
      });
    }
  }
  const total = (side: 'debit' | 'credit') =>
    lines.filter((l) => l.side === side).reduce((a, l) => a.add(l.amount), new MoneyDecimal(0));
  const date = template.documentDate ? readPath(payload, template.documentDate) : null;
  const sourceId = template.source ? readPath(payload, template.source.id) : null;
  const sourceNo = template.source?.number ? readPath(payload, template.source.number) : null;
  return {
    description: interpolate(template.description, payload).slice(0, 500),
    documentDate: typeof date === 'string' && date !== '' ? date : null,
    source:
      template.source && typeof sourceId === 'string'
        ? {
            type: template.source.type,
            publicId: sourceId,
            number: typeof sourceNo === 'string' ? sourceNo : null,
          }
        : null,
    lines,
    totalDebit: total('debit'),
    totalCredit: total('credit'),
  };
}

const ACCOUNT_CODE = /^[0-9A-Z][0-9A-Z.-]*$/;

function checkAccountSelector(selector: unknown, at: string, errors: string[]): void {
  if (typeof selector === 'string') {
    if (!ACCOUNT_CODE.test(selector)) errors.push(`${at}: "${selector}" is not an account code`);
    return;
  }
  if (!selector || typeof selector !== 'object') {
    errors.push(`${at}: account selector required`);
    return;
  }
  const s = selector as Record<string, unknown>;
  if (typeof s['path'] === 'string') return;
  if (typeof s['switch'] !== 'string' || !s['cases'] || typeof s['cases'] !== 'object') {
    errors.push(`${at}: account selector needs a code, { path } or { switch, cases }`);
    return;
  }
  for (const [k, v] of Object.entries(s['cases'] as Record<string, unknown>))
    checkAccountSelector(v, `${at}.cases.${k}`, errors);
  if (s['default'] !== undefined) checkAccountSelector(s['default'], `${at}.default`, errors);
}

function checkTaxCode(selector: unknown, at: string, errors: string[]): void {
  if (selector === undefined) return;
  const ok = (v: unknown) => (TAX_CODES as readonly unknown[]).includes(v);
  if (typeof selector === 'string') {
    if (!ok(selector)) errors.push(`${at}: unknown tax code "${selector}"`);
    return;
  }
  const s = selector as Record<string, unknown>;
  if (typeof s?.['switch'] !== 'string' || !s['cases'] || typeof s['cases'] !== 'object') {
    errors.push(`${at}: tax code needs a code or { switch, cases }`);
    return;
  }
  for (const [k, v] of Object.entries(s['cases'] as Record<string, unknown>))
    if (!ok(v)) errors.push(`${at}.cases.${k}: unknown tax code`);
  if (s['default'] !== undefined && !ok(s['default'])) errors.push(`${at}.default: unknown tax code`);
}

function checkDimensions(map: unknown, at: string, errors: string[], keys: readonly string[]): void {
  if (map === undefined) return;
  if (!map || typeof map !== 'object') {
    errors.push(`${at}: dimensions must be an object`);
    return;
  }
  for (const [k, v] of Object.entries(map)) {
    if (!keys.includes(k)) errors.push(`${at}.${k}: unknown dimension`);
    if (typeof v !== 'string') errors.push(`${at}.${k}: must be a payload path`);
  }
}

/**
 * Structural validation of a template before a version is proposed; returns the problems found. `dimensionKeys`
 * are the dimensions the ledger knows (getpack's by default; the factory ledger passes its own, E6).
 */
export function validateTemplate(
  template: unknown,
  dimensionKeys: readonly string[] = DIMENSION_KEYS,
): string[] {
  const errors: string[] = [];
  if (!template || typeof template !== 'object') return ['template must be an object'];
  const t = template as Record<string, unknown>;
  if (typeof t['description'] !== 'string' || t['description'].trim() === '')
    errors.push('description required');
  if (t['documentDate'] !== undefined && typeof t['documentDate'] !== 'string')
    errors.push('documentDate must be a path');
  checkDimensions(t['dimensions'], 'dimensions', errors, dimensionKeys);
  if (!Array.isArray(t['lines'])) return [...errors, 'lines must be an array'];
  t['lines'].forEach((raw: unknown, i: number) => {
    const at = `lines[${i}]`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${at}: must be an object`);
      return;
    }
    const line = raw as Record<string, unknown>;
    checkAccountSelector(line['account'], `${at}.account`, errors);
    if (line['side'] !== 'debit' && line['side'] !== 'credit') errors.push(`${at}.side: debit or credit`);
    for (const key of ['amount', 'taxBase'] as const) {
      if (key === 'taxBase' && line[key] === undefined) continue;
      if (typeof line[key] !== 'string') {
        errors.push(`${at}.${key}: expression required`);
        continue;
      }
      try {
        assertExpression(line[key]);
      } catch (error) {
        errors.push(`${at}.${key}: ${(error as Error).message}`);
      }
    }
    if (line['forEach'] !== undefined && typeof line['forEach'] !== 'string')
      errors.push(`${at}.forEach: must be a path`);
    checkTaxCode(line['taxCode'], `${at}.taxCode`, errors);
    checkDimensions(line['dimensions'], `${at}.dimensions`, errors, dimensionKeys);
  });
  return errors;
}

/** Every literal account code a template can post to (checked against the chart of accounts). */
export function accountCodesOf(template: PostingTemplate): string[] {
  const codes = new Set<string>();
  const walk = (s: AccountSelector) => {
    if (typeof s === 'string') codes.add(s);
    else if ('switch' in s) {
      Object.values(s.cases).forEach(walk);
      if (s.default) walk(s.default);
    }
  };
  template.lines.forEach((l) => walk(l.account));
  return [...codes].sort();
}
