/**
 * `pnpm styles:import <file> [--recipes] [--confirm] [--as <staff e-mail>]` (U3.B1, D-242) — imports the style master
 * file (`docs/design-tool/style-library-master.json`) or, with `--recipes`, a `@getpack/dieline` recipe bundle. Prints
 * the diff and writes nothing unless `--confirm`; the same file twice is a no-op. Changes to published bases or
 * variants are held for the `style_library_change` approval (Prepress, then Marketing). `--as` names the staff
 * member recorded as the requester; they need `styles.import`.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { type UserActor } from '../src/common/context/actor';
import { PrismaService } from '../src/database/prisma.service';
import { PermissionResolver } from '../src/modules/iam/permission-resolver.service';
import { StyleImportService } from '../src/modules/styles/style-import.service';
import { WorkerModule } from '../src/worker.module';

config({ quiet: true });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--as');
  const as = args[args.indexOf('--as') + 1];
  if (!file || (args.includes('--confirm') && (!args.includes('--as') || !as))) {
    console.error('usage: styles:import <file> [--recipes] [--confirm --as <staff e-mail>]');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const imports = app.get(StyleImportService);
    const plan = await imports.plan(
      args.includes('--recipes') ? 'recipes' : 'master',
      basename(file),
      readFileSync(file, 'utf8'),
    );
    console.log(
      JSON.stringify(
        { noop: plan.noop, noopReason: plan.noopReason, summary: plan.summary, pending: plan.pending.length },
        null,
        2,
      ),
    );
    if (!args.includes('--confirm') || plan.noop) {
      console.log(plan.noop ? 'nothing to import' : 'dry run: nothing written (add --confirm --as <e-mail>)');
      return;
    }
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email: as, kind: 'staff', status: 'active' } });
    if (!user) throw new Error(`no active staff user ${as}`);
    const granted = (await app.get(PermissionResolver).forUser(user.id)).permissions;
    if (!granted.has('styles.import')) throw new Error(`${as} lacks styles.import`);
    const actor: UserActor = {
      type: 'user',
      userId: user.id,
      publicId: user.publicId,
      audience: 'staff',
      scopes: [],
    };
    const run = await imports.apply(actor, plan);
    console.log(`run ${run?.publicId} ${run?.status}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
