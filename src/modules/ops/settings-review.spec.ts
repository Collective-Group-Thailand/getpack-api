import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SETTINGS } from '../../../prisma/seed/data/settings';
import { renderSettingsReview } from './settings-review';

describe('docs/launch/SETTINGS-REVIEW.md (B6.3)', () => {
  it('matches the seed data (run `pnpm launch:settings` after changing settings, policies or flags)', () => {
    const committed = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'launch', 'SETTINGS-REVIEW.md'),
      'utf8',
    );
    expect(committed).toBe(renderSettingsReview());
  });

  it('lists every setting with its decisions and an owner', () => {
    const doc = renderSettingsReview();
    for (const s of SETTINGS) {
      expect(s.decisions.length).toBeGreaterThan(0);
      expect(doc).toContain(`| \`${s.key}\` |`);
    }
  });
});
