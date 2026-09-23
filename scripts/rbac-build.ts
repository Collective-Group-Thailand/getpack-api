/** `pnpm rbac:build` — writes docs/rbac.md from the IAM catalogues (B1.3). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderRbacDoc } from '../src/modules/iam/rbac-doc';

writeFileSync(join(__dirname, '..', '..', 'docs', 'rbac.md'), renderRbacDoc());
console.log('docs/rbac.md written');
