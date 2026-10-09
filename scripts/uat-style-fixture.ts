/**
 * `pnpm uat:styles [--confirm]` — **UAT only**: publishes the style bases the vendored `@packio/dieline` engine can
 * draw, so the storefront's template gallery has something real to show on a UAT stack (packio-web close-out,
 * 2026-10-09). It stands in for the gates D-243 / D-212 / D-244 keep for people, each passed by the UAT fixture
 * account that owns it, through the same services the back office calls (maker ≠ checker holds at every step):
 *
 *   1. the engine's recipe bundle (`styles:recipes-from-engine`), imported by Admin (`styles.import`);
 *   2. each of those recipes approved by Prepress;
 *   3. each base's names approved by Marketing and by Prepress;
 *   4. the processes the recipes need, per material class, proposed for the UAT factory F9001 by Admin and verified by
 *      the Partner Manager against F9001's passing site visit;
 *   5. publishability recomputed — a variant that passes every gate is published (`StylePublishingService`).
 *
 * Bases without an engine recipe (e.g. PK-CT-02, PK-PG-02) stay unpublished: they would have no drawing. Real styles
 * come from the catalogue owner and Prepress; nothing here is a launch decision. Refuses a database whose name does
 * not contain `uat`, and writes nothing without `--confirm`. Every step is skipped when already done, so a second run
 * changes nothing.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { type UserActor } from '../src/common/context/actor';
import { PrismaService } from '../src/database/prisma.service';
import { PackioDielineEngine } from '../src/integrations/dieline/packio-dieline.engine';
import { engineBundle } from '../src/modules/styles/engine-recipes';
import { ProcessCapabilitiesService } from '../src/modules/styles/process-capabilities.service';
import { StyleImportService } from '../src/modules/styles/style-import.service';
import { StylePublishingService } from '../src/modules/styles/style-publishing.service';
import { StylesAdminService } from '../src/modules/styles/styles-admin.service';
import { databaseName, isUatDatabase } from './uat-guard';

/** The UAT fixture accounts (`prisma/seed/uat`) and the UAT launch factory with its passing site visit. */
const ACCOUNTS = {
  importer: 'admin@example.invalid',
  prepress: 'prepress@example.invalid',
  marketing: 'marketing@example.invalid',
  partnerManager: 'partner-manager@example.invalid',
  proposer: 'admin@example.invalid',
} as const;
const FACTORY = 'F9001';
/** The lead-time band the UAT factory states for a verified process (working days). */
const LEAD_TIME = { min: 5, max: 10 };

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  if (!isUatDatabase(process.env.DATABASE_URL)) {
    console.error(
      `uat:styles: refused — not a UAT database (${databaseName(process.env.DATABASE_URL) ?? 'none'})`,
    );
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const actorOf = async (email: string): Promise<UserActor> => {
      const user = await prisma.user.findFirst({ where: { email, kind: 'staff', status: 'active' } });
      if (!user) throw new Error(`no active UAT staff user ${email}`);
      return { type: 'user', userId: user.id, publicId: user.publicId, audience: 'staff', scopes: [] };
    };

    // 1 — the engine's recipes, imported (a no-op when this bundle was imported before).
    const engine = new PackioDielineEngine();
    if (!(await engine.available()))
      throw new Error('the vendored @packio/dieline bundle is missing (ADR-0010)');
    const bundle = await engineBundle(engine);
    const codes = bundle.recipes.map((r) => r.baseCode);
    const imports = app.get(StyleImportService);
    const plan = await imports.plan('recipes', 'uat-engine-recipes.json', JSON.stringify(bundle));
    console.log(`engine recipes for ${codes.length} bases: ${codes.join(' ')}`);
    console.log(
      `import: ${plan.noop ? `nothing to import (${plan.noopReason})` : JSON.stringify(plan.summary)}`,
    );
    if (!confirm) {
      console.log('dry run: nothing written (add --confirm)');
      return;
    }
    if (!plan.noop) await imports.apply(await actorOf(ACCOUNTS.importer), plan);

    const bases = await prisma.styleBase.findMany({
      where: { code: { in: codes } },
      include: { recipes: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });
    const admin = app.get(StylesAdminService);
    const prepress = await actorOf(ACCOUNTS.prepress);
    const marketing = await actorOf(ACCOUNTS.marketing);

    // 2, 3 — Prepress approves the recipe; Marketing and Prepress approve the names.
    for (const base of bases) {
      const recipe = base.recipes[0];
      if (recipe && !recipe.approvedAt) await admin.approveRecipe(prepress, base.publicId, recipe.publicId);
      if (!base.namesApprovedMarketingAt) await admin.approveNames(marketing, base.publicId, 'marketing');
      if (!base.namesApprovedPrepressAt) await admin.approveNames(prepress, base.publicId, 'prepress');
    }

    // 4 — F9001 holds a verified capability for every process the recipes need, in each base's material class.
    const factory = await prisma.factory.findFirst({ where: { code: FACTORY, status: 'active' } });
    if (!factory) throw new Error(`no active UAT factory ${FACTORY}`);
    const visit = await prisma.siteVisit.findFirst({
      where: { factoryId: factory.id, result: 'pass' },
      orderBy: { id: 'desc' },
    });
    if (!visit) throw new Error(`${FACTORY} has no passing site visit`);
    const needed = new Set<string>();
    for (const base of bases)
      for (const process of base.recipes[0]?.processes ?? []) needed.add(`${process}|${base.materialClass}`);
    const capabilities = app.get(ProcessCapabilitiesService);
    const proposer = await actorOf(ACCOUNTS.proposer);
    const verifier = await actorOf(ACCOUNTS.partnerManager);
    for (const key of [...needed].sort()) {
      const [processCode, materialClass] = key.split('|') as [string, string];
      const held = await prisma.factoryProcessCapability.findFirst({
        where: {
          factoryId: factory.id,
          materialClass,
          processType: { code: processCode },
          status: 'verified',
        },
      });
      if (held) continue;
      const proposed = await capabilities.propose(proposer, factory.publicId, {
        processCode,
        materialClass,
        leadTimeMinDays: LEAD_TIME.min,
        leadTimeMaxDays: LEAD_TIME.max,
        note: 'UAT fixture (pnpm uat:styles) — not a site-visit finding',
      });
      await capabilities.verify(verifier, factory.publicId, proposed.id, visit.publicId);
      console.log(`verified ${FACTORY} ${processCode} / ${materialClass}`);
    }

    // 5 — publishability recomputed; a variant passing every gate is published.
    const result = await prisma.withTx((tx) =>
      app.get(StylePublishingService).recompute(
        tx,
        bases.map((b) => b.id),
      ),
    );
    const published = await prisma.styleBase.findMany({
      where: { id: { in: bases.map((b) => b.id) }, publishedAt: { not: null } },
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    console.log(
      `publishability: ${result.publishable} publishable of ${result.variants} variants; ` +
        `${published.length} bases published: ${published.map((b) => b.code).join(' ')}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
