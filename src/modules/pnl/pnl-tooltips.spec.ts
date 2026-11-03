import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { settingValueError } from '@platform/settings/setting-value';

import { PNL_LINE_CATALOGUE_SCHEMA, PNL_LINE_CATALOGUE_SEED, PNL_LINE_KEYS } from './pnl-lines';

const SCHEMA = PNL_LINE_CATALOGUE_SCHEMA as unknown as Record<string, unknown>;

interface Schema {
  required?: string[];
  properties?: Record<string, { $ref?: string; enum?: string[]; nullable?: boolean; type?: unknown }>;
  enum?: string[];
}

/** D-472 item 6: every line key reaches the web with its tooltip fields — in the setting and in the contract. */
describe('P&L tooltips (D-472)', () => {
  const schemas = (
    JSON.parse(readFileSync(join(__dirname, '../../../contract/openapi.json'), 'utf8')) as {
      components: { schemas: Record<string, Schema> };
    }
  ).components.schemas;

  it('publishes every line key as the PnlLineKey enum', () => {
    expect([...(schemas['PnlLineKey']?.enum ?? [])].sort()).toEqual([...PNL_LINE_KEYS].sort());
  });

  it('requires definition, formula, source, howToFill and glAccounts on every served line', () => {
    const line = schemas['PnlLineDto']!;
    for (const field of [
      'key',
      'labelTh',
      'labelEn',
      'definition',
      'formula',
      'source',
      'howToFill',
      'glAccounts',
    ])
      expect([field, line.required?.includes(field)]).toEqual([field, true]);
    expect(JSON.stringify(line.properties?.['definition'])).toContain(
      '#/components/schemas/LocalisedTextDto',
    );
  });

  it('refuses a catalogue version that drops a line or a tooltip field', () => {
    expect(settingValueError('json', PNL_LINE_CATALOGUE_SEED, SCHEMA)).toBeNull();
    const { revenue_goods: _dropped, ...rest } = PNL_LINE_CATALOGUE_SEED.lines;
    expect(settingValueError('json', { lines: rest }, SCHEMA)).not.toBeNull();
    const { formula: _formula, ...noFormula } = PNL_LINE_CATALOGUE_SEED.lines.marketing;
    expect(
      settingValueError(
        'json',
        { lines: { ...PNL_LINE_CATALOGUE_SEED.lines, marketing: noFormula } },
        SCHEMA,
      ),
    ).not.toBeNull();
  });
});
