/** `pnpm launch:settings` — writes docs/launch/SETTINGS-REVIEW.md from the seed data (B6.3). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderSettingsReview } from '../src/modules/ops/settings-review';

const dir = join(__dirname, '..', '..', 'docs', 'launch');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'SETTINGS-REVIEW.md'), renderSettingsReview());
console.log('docs/launch/SETTINGS-REVIEW.md written');
