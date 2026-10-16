import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type StyleImportKind } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { type ParsedBundle, parseRecipeBundle } from './recipe-bundle';
import {
  baseSha256,
  codeSuffix,
  type MasterBase,
  type ParsedMaster,
  parseMaster,
  variantsOf,
} from './style-master';
import { StylePublishingService } from './style-publishing.service';

/** D-242: the approval policy for changes to published style-library rows. */
export const STYLE_CHANGE_POLICY = 'style_library_change';
export const STYLE_IMPORT_SUBJECT = 'style_import_run';
/** A full master import creates ~1 000 rows and recomputes them: a bulk transaction (like catalogue imports). */
const BULK = { timeout: 120_000 };

/**
 * Master product types → the getpack product type they are sold as (catalogue codes, D-100). Courier and bubble
 * mailers are flexible packaging, a shrink sleeve is a label (D-407; finding S2 closed).
 */
export const PRODUCT_TYPE_OF: Record<string, string> = {
  folding: 'folding_carton',
  corrugate: 'corrugated',
  label: 'label_sticker',
  tag_sleeve: 'tag_sleeve',
  pouch: 'flexible_pouch',
  rigid: 'rigid_box',
  paper_bag: 'paper_bag',
  mailer: 'flexible_pouch',
  shrink_sleeve: 'label_sticker',
};

/** Fields a base takes from the master file (the diff compares these). */
const BASE_FIELDS = [
  'family',
  'category',
  'sourceProductType',
  'nameTh',
  'nameEn',
  'construction',
  'materialClass',
  'variantAxes',
  'wave',
  'complexity',
  'referenceCode',
  'pricingPathAtLaunch',
] as const;
type BaseFields = Record<(typeof BASE_FIELDS)[number], unknown>;

/** One change of a plan; JSON so that held changes can wait in `style_import_runs.pending_changes`. */
export type StyleChange =
  | {
      op: 'base.create';
      code: string;
      fields: BaseFields;
      productTypeCode: string | null;
      sourceSha256: string;
      variants: { optionKey: string; options: Record<string, unknown> }[];
      synonyms: { locale: 'th' | 'en'; term: string }[];
      useCases: string[];
    }
  | {
      op: 'base.update';
      code: string;
      fields: Partial<BaseFields>;
      sourceSha256: string;
      addVariants: { optionKey: string; options: Record<string, unknown> }[];
      retireVariants: string[];
      reviveVariants: string[];
      synonyms: { locale: 'th' | 'en'; term: string }[] | null;
      useCases: string[] | null;
    }
  | { op: 'base.retire'; code: string }
  | {
      op: 'recipe.create';
      code: string;
      schemaVersion: string;
      recipe: Record<string, unknown>;
      processes: string[];
      sizeRanges: Record<string, unknown> | null;
      checksum: string;
    };

export interface StyleImportPlan {
  kind: StyleImportKind;
  fileName: string;
  checksum: string;
  /** Same input already imported, or nothing would change. */
  noop: boolean;
  noopReason: 'same_checksum' | 'no_changes' | null;
  direct: StyleChange[];
  /** Changes to published rows, held for `style_library_change` (D-242). */
  pending: StyleChange[];
  summary: Record<string, number>;
  axes: Record<string, string[]> | null;
}

/**
 * Style imports (U3.B1, D-241, D-242): a master file or a recipe bundle is planned into a diff — nothing is written
 * on a dry run — then, on confirm, one versioned run applies the changes to unpublished rows at once and holds the
 * changes to published rows for the approval policy `style_library_change` (Prepress, then Marketing). The same
 * checksum, or an input that changes nothing, is a no-op. Nothing is deleted: rows missing from a new file retire.
 */
@Injectable()
export class StyleImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly publishing: StylePublishingService,
  ) {}

  async plan(kind: StyleImportKind, fileName: string, content: string): Promise<StyleImportPlan> {
    const raw = JSON.parse(content) as unknown;
    const checksum = createHash('sha256').update(content).digest();
    const live = await this.prisma.styleImportRun.findFirst({
      where: { kind, checksum, status: { not: 'rejected' } },
      select: { id: true },
    });
    const head = { kind, fileName, checksum: checksum.toString('hex') };
    if (live) {
      return {
        ...head,
        noop: true,
        noopReason: 'same_checksum',
        direct: [],
        pending: [],
        summary: {},
        axes: null,
      };
    }
    const result =
      kind === 'master'
        ? await this.planMaster(parseMaster(raw))
        : await this.planRecipes(parseRecipeBundle(raw));
    const changes = result.direct.length + result.pending.length;
    return {
      ...head,
      noop: changes === 0,
      noopReason: changes === 0 ? 'no_changes' : null,
      ...result,
    };
  }

  /** Applies a plan as one run (D-242); returns the run, or null for a no-op. */
  async apply(actor: UserActor, plan: StyleImportPlan) {
    if (plan.noop) return null;
    return this.prisma.withTx(async (tx) => {
      const run = await tx.styleImportRun.create({
        data: {
          kind: plan.kind,
          fileName: plan.fileName,
          checksum: Buffer.from(plan.checksum, 'hex'),
          status: plan.pending.length > 0 ? 'pending_approval' : 'applied',
          diff: {
            summary: plan.summary,
            direct: plan.direct.map(brief),
            pending: plan.pending.map(brief),
          } as unknown as Prisma.InputJsonValue,
          pendingChanges:
            plan.pending.length > 0 ? (plan.pending as unknown as Prisma.InputJsonValue) : undefined,
          axes: plan.axes ? (plan.axes as Prisma.InputJsonValue) : undefined,
          createdById: actor.userId,
          decidedAt: plan.pending.length > 0 ? null : new Date(),
        },
      });
      const touched = await this.applyChanges(tx, run.id, plan.direct, actor.userId);
      if (plan.pending.length > 0) {
        const request = await this.approvals.create(tx, {
          policyKey: STYLE_CHANGE_POLICY,
          subject: { type: STYLE_IMPORT_SUBJECT, id: run.id, publicId: run.publicId },
          requester: actor,
          payload: {
            kind: plan.kind,
            fileName: plan.fileName,
            changes: plan.pending.map(brief),
          },
        });
        await tx.styleImportRun.update({ where: { id: run.id }, data: { approvalRequestId: request.id } });
      }
      await this.publishing.recompute(tx, touched);
      await this.audit.record(tx, {
        category: 'config',
        action: 'style_import.recorded',
        resourceType: 'style_import_run',
        resourcePublicId: run.publicId,
        data: {
          kind: plan.kind,
          fileName: plan.fileName,
          summary: plan.summary,
          pending: plan.pending.length,
        },
      });
      await this.events.record(tx, {
        type: plan.pending.length > 0 ? 'style_import.pending_approval' : 'style_import.applied',
        aggregateType: 'style_import_run',
        aggregateId: run.publicId,
        payload: {
          runId: run.publicId,
          kind: plan.kind,
          summary: plan.summary,
          pending: plan.pending.length,
        },
      });
      return tx.styleImportRun.findUniqueOrThrow({ where: { id: run.id } });
    }, BULK);
  }

  /** D-242: an approved run applies its held changes; a rejected, withdrawn or expired one drops them. */
  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'styles.apply-approval',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['subjectType'] !== STYLE_IMPORT_SUBJECT) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const run = await tx.styleImportRun.findFirst({ where: { approvalRequestId: request.id } });
    if (!run || run.status !== 'pending_approval') return; // idempotent
    const approved = event.type === 'approval.approved';
    if (approved) {
      const touched = await this.applyChanges(
        tx,
        run.id,
        (run.pendingChanges ?? []) as unknown as StyleChange[],
        request.requesterUserId,
      );
      await this.publishing.recompute(tx, touched);
    }
    await tx.styleImportRun.update({
      where: { id: run.id },
      data: { status: approved ? 'applied' : 'rejected', decidedAt: new Date() },
    });
    await this.events.record(tx, {
      type: approved ? 'style_import.applied' : 'style_import.rejected',
      aggregateType: 'style_import_run',
      aggregateId: run.publicId,
      payload: { runId: run.publicId, kind: run.kind, approvalOutcome: event.type },
    });
  }

  // --- Planning

  private async planMaster(master: ParsedMaster) {
    const existing = await this.prisma.styleBase.findMany({
      include: {
        variants: { select: { optionKey: true, status: true } },
        synonyms: { select: { locale: true, term: true } },
        useCases: { select: { code: true } },
      },
    });
    const byCode = new Map(existing.map((b) => [b.code, b]));
    const direct: StyleChange[] = [];
    const pending: StyleChange[] = [];
    const summary = {
      basesCreated: 0,
      basesUpdated: 0,
      basesRetired: 0,
      basesUnchanged: 0,
      variantsCreated: 0,
      variantsRetired: 0,
      variantsRevived: 0,
    };
    for (const base of master.bases) {
      const variants = variantsOf(base, master);
      const fields = fieldsOf(base);
      const sha = baseSha256(base).toString('hex');
      const current = byCode.get(base.code);
      if (!current) {
        direct.push({
          op: 'base.create',
          code: base.code,
          fields,
          productTypeCode: PRODUCT_TYPE_OF[base.productType] ?? null,
          sourceSha256: sha,
          variants,
          synonyms: base.synonyms ?? [],
          useCases: base.useCases ?? [],
        });
        summary.basesCreated++;
        summary.variantsCreated += variants.length;
        continue;
      }
      const changed: Partial<BaseFields> = {};
      for (const f of BASE_FIELDS) {
        if (JSON.stringify(current[f] ?? null) !== JSON.stringify(fields[f] ?? null)) changed[f] = fields[f];
      }
      const keys = new Set(variants.map((v) => v.optionKey));
      const known = new Map(current.variants.map((v) => [v.optionKey, v.status]));
      const addVariants = variants.filter((v) => !known.has(v.optionKey));
      const retireVariants = [...known].filter(([k, s]) => s === 'active' && !keys.has(k)).map(([k]) => k);
      const reviveVariants = [...known].filter(([k, s]) => s === 'retired' && keys.has(k)).map(([k]) => k);
      // The file's synonyms / use cases replace the curated ones only when it carries them (D-246).
      const synonymsNow = current.synonyms.map((x) => `${x.locale}:${x.term}`).sort();
      const synonyms =
        base.synonyms &&
        JSON.stringify(synonymsNow) !==
          JSON.stringify(base.synonyms.map((x) => `${x.locale}:${x.term}`).sort())
          ? base.synonyms
          : null;
      const useCasesNow = current.useCases.map((u) => u.code).sort();
      const useCases =
        base.useCases && JSON.stringify(useCasesNow) !== JSON.stringify(base.useCases) ? base.useCases : null;
      const revive = current.status === 'retired';
      if (
        Object.keys(changed).length === 0 &&
        !addVariants.length &&
        !retireVariants.length &&
        !reviveVariants.length &&
        !synonyms &&
        !useCases &&
        !revive
      ) {
        summary.basesUnchanged++;
        continue;
      }
      const change: StyleChange = {
        op: 'base.update',
        code: base.code,
        fields: changed,
        sourceSha256: sha,
        addVariants,
        retireVariants,
        reviveVariants,
        synonyms,
        useCases,
      };
      (current.publishedAt ? pending : direct).push(change);
      summary.basesUpdated++;
      summary.variantsCreated += addVariants.length;
      summary.variantsRetired += retireVariants.length;
      summary.variantsRevived += reviveVariants.length;
    }
    const inFile = new Set(master.bases.map((b) => b.code));
    for (const current of existing) {
      if (current.status === 'active' && !inFile.has(current.code)) {
        (current.publishedAt ? pending : direct).push({ op: 'base.retire', code: current.code });
        summary.basesRetired++;
      }
    }
    return { direct, pending, summary, axes: master.axes };
  }

  private async planRecipes(bundle: ParsedBundle) {
    const bases = await this.prisma.styleBase.findMany({
      where: { code: { in: bundle.recipes.map((r) => r.baseCode) } },
      include: { recipes: { orderBy: { version: 'desc' }, take: 1, select: { checksum: true } } },
    });
    const byCode = new Map(bases.map((b) => [b.code, b]));
    const missing = bundle.recipes.filter((r) => !byCode.has(r.baseCode)).map((r) => r.baseCode);
    if (missing.length > 0) {
      throw new Error(
        `recipe bundle: unknown base codes ${missing.slice(0, 5).join(', ')} (import the master first)`,
      );
    }
    const direct: StyleChange[] = [];
    const pending: StyleChange[] = [];
    const summary = { recipesCreated: 0, recipesUnchanged: 0 };
    for (const r of bundle.recipes) {
      const base = byCode.get(r.baseCode)!;
      const last = base.recipes[0];
      if (last && Buffer.compare(Buffer.from(last.checksum), r.checksum) === 0) {
        summary.recipesUnchanged++;
        continue;
      }
      (base.publishedAt ? pending : direct).push({
        op: 'recipe.create',
        code: r.baseCode,
        schemaVersion: bundle.schemaVersion,
        recipe: r.recipe,
        processes: r.processes,
        sizeRanges: r.sizeRanges,
        checksum: r.checksum.toString('hex'),
      });
      summary.recipesCreated++;
    }
    return { direct, pending, summary, axes: null };
  }

  // --- Applying

  /** Applies changes in order; returns the ids of the bases touched (for the publishability recompute). */
  private async applyChanges(
    tx: Tx,
    runId: bigint,
    changes: StyleChange[],
    actorId: bigint | null,
  ): Promise<bigint[]> {
    const touched: bigint[] = [];
    const productTypes = new Map(
      (await tx.productType.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
    );
    for (const change of changes) {
      if (change.op === 'base.create') {
        const exists = await tx.styleBase.findUnique({ where: { code: change.code }, select: { id: true } });
        if (exists) continue; // applied by an earlier run (held changes are idempotent)
        const pattern = await tx.pattern.findFirst({
          where: { styleCode: change.code, styleBase: null },
          select: { id: true },
        });
        const f = change.fields;
        const base = await tx.styleBase.create({
          data: {
            code: change.code,
            family: f.family as string,
            category: f.category as string,
            sourceProductType: f.sourceProductType as string,
            nameTh: f.nameTh as string,
            nameEn: f.nameEn as string,
            construction: f.construction as string,
            materialClass: f.materialClass as string,
            variantAxes: f.variantAxes as string[],
            wave: f.wave as number,
            complexity: f.complexity as string | null,
            referenceCode: f.referenceCode as string | null,
            pricingPathAtLaunch: f.pricingPathAtLaunch as string | null,
            productTypeId: change.productTypeCode ? (productTypes.get(change.productTypeCode) ?? null) : null,
            patternId: pattern?.id ?? null,
            sourceSha256: Buffer.from(change.sourceSha256, 'hex'),
            lastImportRunId: runId,
            updatedById: actorId,
            synonyms: { create: change.synonyms },
            useCases: { create: change.useCases.map((code) => ({ code })) },
          },
        });
        await this.createVariants(tx, base.id, change.code, change.variants);
        touched.push(base.id);
      } else if (change.op === 'base.update') {
        const base = await tx.styleBase.findUnique({ where: { code: change.code } });
        if (!base) continue;
        const renamed = 'nameTh' in change.fields || 'nameEn' in change.fields;
        const referenceChanged = 'referenceCode' in change.fields;
        await tx.styleBase.update({
          where: { id: base.id },
          data: {
            ...(change.fields as Prisma.StyleBaseUncheckedUpdateInput),
            status: 'active',
            sourceSha256: Buffer.from(change.sourceSha256, 'hex'),
            lastImportRunId: runId,
            updatedById: actorId,
            rowVersion: { increment: 1 },
            // D-212 / D-211: a new name needs new approvals; a new reference a new verification.
            ...(renamed && {
              namesApprovedMarketingAt: null,
              namesApprovedMarketingBy: null,
              namesApprovedPrepressAt: null,
              namesApprovedPrepressBy: null,
            }),
            ...(referenceChanged && { referenceVerifiedAt: null, referenceVerifiedById: null }),
          },
        });
        await this.createVariants(tx, base.id, base.code, change.addVariants);
        if (change.retireVariants.length)
          await tx.styleVariant.updateMany({
            where: { baseId: base.id, optionKey: { in: change.retireVariants } },
            data: { status: 'retired', publishable: false, reasons: ['retired'] },
          });
        if (change.reviveVariants.length)
          await tx.styleVariant.updateMany({
            where: { baseId: base.id, optionKey: { in: change.reviveVariants } },
            data: { status: 'active' },
          });
        if (change.synonyms) {
          await tx.styleSynonym.deleteMany({ where: { baseId: base.id } });
          await tx.styleSynonym.createMany({ data: change.synonyms.map((s) => ({ ...s, baseId: base.id })) });
        }
        if (change.useCases) {
          await tx.styleUseCase.deleteMany({ where: { baseId: base.id } });
          await tx.styleUseCase.createMany({
            data: change.useCases.map((code) => ({ code, baseId: base.id })),
          });
        }
        touched.push(base.id);
      } else if (change.op === 'base.retire') {
        const base = await tx.styleBase.findUnique({ where: { code: change.code } });
        if (!base || base.status === 'retired') continue;
        await tx.styleBase.update({
          where: { id: base.id },
          data: {
            status: 'retired',
            lastImportRunId: runId,
            updatedById: actorId,
            rowVersion: { increment: 1 },
          },
        });
        await tx.styleVariant.updateMany({
          where: { baseId: base.id },
          data: { status: 'retired', publishable: false, reasons: ['retired'] },
        });
        touched.push(base.id);
      } else {
        const base = await tx.styleBase.findUnique({
          where: { code: change.code },
          include: {
            recipes: { orderBy: { version: 'desc' }, take: 1, select: { version: true, checksum: true } },
          },
        });
        if (!base) continue;
        const last = base.recipes[0];
        if (last && Buffer.from(last.checksum).toString('hex') === change.checksum) continue;
        await tx.styleRecipe.create({
          data: {
            baseId: base.id,
            version: (last?.version ?? 0) + 1,
            schemaVersion: change.schemaVersion,
            recipe: change.recipe as Prisma.InputJsonValue,
            checksum: Buffer.from(change.checksum, 'hex'),
            processes: change.processes,
            sizeRanges: change.sizeRanges ? (change.sizeRanges as Prisma.InputJsonValue) : undefined,
            importRunId: runId,
          },
        });
        touched.push(base.id);
      }
    }
    return [...new Set(touched)];
  }

  /** New variants get a suffix not yet used on the base: 4 characters, longer on a collision (D-241). */
  private async createVariants(
    tx: Tx,
    baseId: bigint,
    baseCode: string,
    variants: { optionKey: string; options: Record<string, unknown> }[],
  ): Promise<void> {
    if (variants.length === 0) return;
    const used = new Set(
      (await tx.styleVariant.findMany({ where: { baseId }, select: { codeSuffix: true } })).map(
        (v) => v.codeSuffix,
      ),
    );
    const rows = variants.map((v) => {
      let length = 4;
      let suffix = codeSuffix(baseCode, v.optionKey, length);
      while (used.has(suffix)) suffix = codeSuffix(baseCode, v.optionKey, ++length);
      used.add(suffix);
      return {
        baseId,
        code: `${baseCode}-${suffix}`,
        codeSuffix: suffix,
        optionKey: v.optionKey,
        options: v.options as Prisma.InputJsonValue,
        reasons: ['not_evaluated'],
      };
    });
    await tx.styleVariant.createMany({ data: rows, skipDuplicates: true });
  }
}

function fieldsOf(base: MasterBase): BaseFields {
  return {
    family: base.family,
    category: base.category,
    sourceProductType: base.productType,
    nameTh: base.nameTh,
    nameEn: base.nameEn,
    construction: base.construction,
    materialClass: base.materialClass,
    variantAxes: base.variantAxes,
    wave: base.wave,
    complexity: base.complexity,
    referenceCode: base.referenceCode,
    pricingPathAtLaunch: base.pricingPathAtLaunch,
  };
}

/** The summary of a change kept in the run's diff and the approval payload (no recipe bodies). */
/** A change as a run records it in its diff. */
export function brief(change: StyleChange): Record<string, unknown> {
  switch (change.op) {
    case 'base.create':
      return { op: change.op, code: change.code, variants: change.variants.length };
    case 'base.update':
      return {
        op: change.op,
        code: change.code,
        fields: Object.keys(change.fields),
        addVariants: change.addVariants.length,
        retireVariants: change.retireVariants.length,
        reviveVariants: change.reviveVariants.length,
        synonyms: change.synonyms !== null,
        useCases: change.useCases !== null,
      };
    case 'base.retire':
      return { op: change.op, code: change.code };
    case 'recipe.create':
      return { op: change.op, code: change.code, checksum: change.checksum, processes: change.processes };
  }
}
