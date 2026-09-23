import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SUPPORTED_LANGUAGES } from '../i18n/language';
import { codeForStatus, ERROR_CODES } from './error-codes';

type Catalogue = Record<string, Record<string, { title?: string; detail?: string }>>;

describe('error catalogue', () => {
  it.each(SUPPORTED_LANGUAGES)('has a title and detail for every code in %s', (lang) => {
    const catalogue = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'i18n', lang, 'errors.json'), 'utf8'),
    ) as Catalogue;
    for (const code of Object.keys(ERROR_CODES)) {
      const [group = '', name = ''] = code.split('.');
      const entry = catalogue[group]?.[name];
      expect({ code, title: Boolean(entry?.title), detail: Boolean(entry?.detail) }).toEqual({
        code,
        title: true,
        detail: true,
      });
    }
  });

  it('maps bare HTTP statuses to known codes', () => {
    expect(codeForStatus(404)).toBe('http.not_found');
    expect(codeForStatus(418)).toBe('http.error');
    expect(codeForStatus(502)).toBe('internal.unexpected');
  });
});
