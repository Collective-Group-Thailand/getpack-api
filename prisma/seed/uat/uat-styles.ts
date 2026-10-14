/**
 * UAT only — publishes the style library on a rehearsal database (packio-web close-out, 2026-10-09; D-407), through the
 * same services the back office calls, each gate passed by the UAT fixture account that owns it (maker ≠ checker
 * holds at every step):
 *
 *   0. the style master file (`docs/design-tool/style-library-master.json`), imported by Admin (`styles.import`);
 *   1. the engine's recipe bundle (`styles:recipes-from-engine`), imported by Admin; a change either makes to a
 *      published base waits for the `style_library_change` approval (D-242), given here by Prepress then Marketing;
 *   2. each of those recipes approved by Prepress;
 *   3. each base's names approved by Marketing and by Prepress, and a product type mapped where the master's was
 *      only added later (`PRODUCT_TYPE_OF`, D-407);
 *   4. the processes the recipes need, per material class, proposed for the UAT factory F9001 by Admin and verified by
 *      the Partner Manager against F9001's passing site visit — what makes a variant orderable instantly;
 *   5. publishability recomputed: since D-407 every drawn, named variant is shown and designable; the ones F9001
 *      cannot make are offered as a quotation request.
 *
 * Bases without an engine recipe stay unpublished: they would have no drawing. Real styles come from the catalogue
 * owner and Prepress; nothing here is a launch decision. Every step is skipped when already done.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type INestApplicationContext } from '@nestjs/common';

import { type UserActor } from '../../../src/common/context/actor';
import { etagOf } from '../../../src/common/etag/etag';
import { PrismaService } from '../../../src/database/prisma.service';
import { PackioDielineEngine } from '../../../src/integrations/dieline/packio-dieline.engine';
import { engineBundle } from '../../../src/modules/styles/engine-recipes';
import { ProcessCapabilitiesService } from '../../../src/modules/styles/process-capabilities.service';
import { PRODUCT_TYPE_OF, StyleImportService } from '../../../src/modules/styles/style-import.service';
import { StylePublishingService } from '../../../src/modules/styles/style-publishing.service';
import { StylesAdminService } from '../../../src/modules/styles/styles-admin.service';
import { ApprovalsService } from '../../../src/platform/approvals/approvals.service';
import { envelopeFromRow } from '../../../src/platform/domain-events/domain-event';

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

export interface UatStylesResult {
  bases: number;
  variants: number;
  publishable: number;
  instant: number;
  log: string[];
}

export async function publishUatStyles(
  app: INestApplicationContext,
  options: { confirm: boolean; masterPath?: string } = { confirm: true },
): Promise<UatStylesResult> {
  const log: string[] = [];
  const prisma = app.get(PrismaService);
  const actorOf = async (email: string): Promise<UserActor> => {
    const user = await prisma.user.findFirst({ where: { email, kind: 'staff', status: 'active' } });
    if (!user) throw new Error(`no active UAT staff user ${email}`);
    return { type: 'user', userId: user.id, publicId: user.publicId, audience: 'staff', scopes: [] };
  };
  const imports = app.get(StyleImportService);
  const importer = await actorOf(ACCOUNTS.importer);
  /**
   * A run whose changes to published bases are held (D-242): Prepress, then Marketing approve it, and the
   * subscriber that applies held changes (`styles.apply-approval`) is called here — the fixture has no worker.
   */
  const settle = async (run: { id: bigint } | null) => {
    if (!run) return;
    const held = await prisma.styleImportRun.findUniqueOrThrow({ where: { id: run.id } });
    if (held.status !== 'pending_approval' || held.approvalRequestId === null) return;
    const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: held.approvalRequestId } });
    const approvals = app.get(ApprovalsService);
    // Each step once: a run settled half-way before (an interrupted fixture) continues where it stopped.
    for (const email of [ACCOUNTS.prepress, ACCOUNTS.marketing]) {
      const now = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
      if (now.status !== 'pending') break;
      await approvals.approve(await actorOf(email), request.publicId, 'UAT fixture (uat:styles)');
    }
    // The subscriber is idempotent (a run no longer held is skipped), so the worker meeting the event later is harmless.
    for (const event of await prisma.domainEvent.findMany({
      where: { type: 'approval.approved', aggregateId: request.publicId },
    }))
      await prisma.withTx((tx) => imports.onApprovalOutcome(envelopeFromRow(event), tx));
    const after = await prisma.styleImportRun.findUniqueOrThrow({ where: { id: run.id } });
    log.push(`${held.kind} run held for approval: ${after.status}`);
  };

  // 0 — the master: every base and variant (a no-op when this file was imported before).
  const masterPath = options.masterPath ?? join(process.cwd(), 'docs/design-tool/style-library-master.json');
  const master = await imports.plan('master', 'style-library-master.json', readFileSync(masterPath, 'utf8'));
  log.push(`master: ${master.noop ? `nothing to import (${master.noopReason})` : JSON.stringify(master.summary)}`);
  if (options.confirm && !master.noop) await settle(await imports.apply(importer, master));
  // A run imported before but still held (the same file, waiting for its approval) is settled too.
  if (options.confirm)
    for (const run of await prisma.styleImportRun.findMany({ where: { status: 'pending_approval' }, orderBy: { id: 'asc' } }))
      await settle(run);

  // 1 — the engine's recipes.
  const engine = new PackioDielineEngine();
  if (!(await engine.available())) throw new Error('the vendored @packio/dieline bundle is missing (ADR-0010)');
  const bundle = await engineBundle(engine);
  const codes = bundle.recipes.map((r) => r.baseCode);
  const plan = await imports.plan('recipes', 'uat-engine-recipes.json', JSON.stringify(bundle));
  log.push(`engine recipes for ${codes.length} bases`);
  log.push(`recipes: ${plan.noop ? `nothing to import (${plan.noopReason})` : JSON.stringify(plan.summary)}`);
  if (!options.confirm) return { bases: 0, variants: 0, publishable: 0, instant: 0, log: [...log, 'dry run'] };
  if (!plan.noop) await settle(await imports.apply(importer, plan));

  const bases = await prisma.styleBase.findMany({
    where: { code: { in: codes } },
    include: { recipes: { orderBy: { version: 'desc' }, take: 1 }, productType: { select: { code: true } } },
    orderBy: { code: 'asc' },
  });
  const admin = app.get(StylesAdminService);
  const prepress = await actorOf(ACCOUNTS.prepress);
  const marketing = await actorOf(ACCOUNTS.marketing);

  // 2, 3 — Prepress approves the recipe; Marketing and Prepress approve the names; a late product type is mapped.
  for (const base of bases) {
    const recipe = base.recipes[0];
    if (recipe && !recipe.approvedAt) await admin.approveRecipe(prepress, base.publicId, recipe.publicId);
    if (!base.namesApprovedMarketingAt) await admin.approveNames(marketing, base.publicId, 'marketing');
    if (!base.namesApprovedPrepressAt) await admin.approveNames(prepress, base.publicId, 'prepress');
    const mapped = PRODUCT_TYPE_OF[base.sourceProductType];
    if (!base.productType && mapped) {
      const fresh = await prisma.styleBase.findUniqueOrThrow({ where: { id: base.id } });
      await admin.update(importer, base.publicId, etagOf(fresh.publicId, fresh.rowVersion), {
        productTypeCode: mapped,
      });
    }
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
  const skipped = new Set<string>();
  let verified = 0;
  for (const key of [...needed].sort()) {
    const [processCode, materialClass] = key.split('|') as [string, string];
    const held = await prisma.factoryProcessCapability.findFirst({
      where: { factoryId: factory.id, materialClass, processType: { code: processCode }, status: 'verified' },
    });
    if (held) continue;
    // A process the engine names but the D-244 taxonomy lacks cannot be proposed: report it and go on.
    if (!(await prisma.processType.findFirst({ where: { code: processCode } }))) {
      skipped.add(processCode);
      continue;
    }
    const proposed = await capabilities.propose(proposer, factory.publicId, {
      processCode,
      materialClass,
      leadTimeMinDays: LEAD_TIME.min,
      leadTimeMaxDays: LEAD_TIME.max,
      note: 'UAT fixture (uat:styles) — not a site-visit finding',
    });
    await capabilities.verify(verifier, factory.publicId, proposed.id, visit.publicId);
    verified++;
  }
  log.push(`verified ${verified} capabilities for ${FACTORY}`);
  if (skipped.size > 0) log.push(`not in the process taxonomy (D-244): ${[...skipped].sort().join(' ')}`);

  // 5 — publishability recomputed for every base (the master's bases without a recipe stay hidden).
  const result = await prisma.withTx((tx) => app.get(StylePublishingService).recompute(tx));
  const instant = await prisma.styleVariant.count({ where: { publishable: true, pricePath: 'instant' } });
  log.push(`publishability: ${result.publishable} of ${result.variants} variants shown, ${instant} instant`);
  return { bases: result.bases, variants: result.variants, publishable: result.publishable, instant, log };
}
