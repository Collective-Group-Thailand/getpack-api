import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { activeRules, evaluateDocument, type PrintRule } from './print-rules';
import { StudioCatalogService } from './studio-catalog.service';

/** D-215: what every soft proof says about itself. */
export const SOFT_PROOF_LABEL = {
  th: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่แบบตัวอย่างสำหรับอนุมัติพิมพ์',
  en: 'Preview, not a contract proof',
};

const RUN_INCLUDE = {
  findings: { orderBy: { id: 'asc' } },
  version: { select: { versionNo: true } },
  rulesVersion: { select: { versionNo: true } },
} satisfies Prisma.DesignCheckRunInclude;
type RunRow = Prisma.DesignCheckRunGetPayload<{ include: typeof RUN_INCLUDE }>;

export interface CheckRunView {
  versionNo: number;
  rulesVersion: number;
  source: string;
  counts: { block: number; warn: number; info: number };
  findings: {
    ruleId: string;
    severity: string;
    elementId: string | null;
    details: Record<string, unknown>;
    acknowledged: boolean;
  }[];
  /** No block, and every warning acknowledged: the version may be ordered (D-278). */
  ready: boolean;
  evaluatedAt: string;
}

/**
 * D-278 studio print checks: the rule catalogue in force is served to the web; the server evaluates a design version
 * against it (the rules it can see in the document), once per version and catalogue version, and stores the run and
 * its findings; the customer acknowledges warnings (who, when) — blocks are fixed, never acknowledged.
 */
@Injectable()
export class StudioChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly catalog: StudioCatalogService,
  ) {}

  async rules() {
    const catalogue = await this.settings.at('studio.print_rules');
    let profiles: { materialClass: string; label?: string; transform: Record<string, number | string> }[] =
      [];
    try {
      profiles = (await this.settings.at('studio.soft_proof_profiles')).value.profiles;
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    return {
      version: catalogue.versionNo,
      effectiveFrom: toBangkokIso(catalogue.effectiveFrom),
      rules: catalogue.value.rules,
      softProof: { label: SOFT_PROOF_LABEL, profiles },
    };
  }

  async run(actor: UserActor, designId: string, versionNo?: number): Promise<CheckRunView> {
    const { doc, version } = await this.version(actor, designId, versionNo);
    return this.view(await this.evaluate(doc, version, actor));
  }

  /**
   * UX r2 A4: the worker checks a design's current version right after it is saved, so the design lists can say what
   * still needs checking without the studio being open. The run is the one the studio would store (same key); no
   * `design.checked` event, which records a customer's own check.
   */
  async evaluateCurrent(designPublicId: string): Promise<void> {
    const doc = await this.prisma.designDocument.findFirst({
      where: { publicId: designPublicId, deletedAt: null },
      include: { styleVariant: { select: { base: { select: { materialClass: true } } } } },
    });
    if (!doc?.currentVersionId) return;
    const version = await this.prisma.designDocumentVersion.findUnique({
      where: { id: doc.currentVersionId },
    });
    if (version) await this.evaluate(doc, version, null);
  }

  private async evaluate(
    doc: Awaited<ReturnType<StudioChecksService['version']>>['doc'],
    version: Awaited<ReturnType<StudioChecksService['version']>>['version'],
    actor: UserActor | null,
  ): Promise<RunRow> {
    const catalogue = await this.settings.at('studio.print_rules');
    // What the evaluation depends on besides the document and the catalogue: the rights still missing (D-282).
    const undeclared = await this.undeclaredElements(version.document, doc.ownerUserId);
    const contextKey =
      undeclared.size === 0
        ? ''
        : createHash('sha256')
            .update([...undeclared].sort().join(','))
            .digest('hex');
    const runKey = {
      versionId_rulesVersionId_source_contextKey: {
        versionId: version.id,
        rulesVersionId: catalogue.versionId,
        source: 'document' as const,
        contextKey,
      },
    };
    const existing = await this.prisma.designCheckRun.findUnique({ where: runKey, include: RUN_INCLUDE });
    if (existing) return existing;
    const rules: PrintRule[] = activeRules(catalogue.value, {
      printMethod: doc.printMethod,
      materialClass: doc.styleVariant?.base.materialClass ?? null,
    });
    const assets = await this.prisma.designAsset.findMany({
      where: { documentId: doc.id },
      select: { publicId: true, fileObject: { select: { widthPx: true, heightPx: true } } },
    });
    const findings = evaluateDocument(version.document, rules, {
      assetPx: new Map(assets.map((a) => [a.publicId, a.fileObject])),
      undeclaredElements: undeclared,
    });
    const count = (s: string) => findings.filter((f) => f.severity === s).length;
    const run = await this.prisma
      .withTx(async (tx) => {
        const created = await tx.designCheckRun.create({
          data: {
            versionId: version.id,
            rulesVersionId: catalogue.versionId,
            source: 'document',
            contextKey,
            blockCount: count('block'),
            warnCount: count('warn'),
            infoCount: count('info'),
            findings: {
              create: findings.map((f) => ({
                ruleId: f.ruleId,
                severity: f.severity,
                elementId: f.elementId,
                details: f.details as Prisma.InputJsonValue,
              })),
            },
          },
          include: RUN_INCLUDE,
        });
        if (actor)
          await this.record(tx, actor, doc.publicId, 'design.checked', {
            versionNo: version.versionNo,
            rulesVersion: catalogue.versionNo,
            block: created.blockCount,
            warn: created.warnCount,
          });
        return created;
      })
      .catch(async (error: unknown) => {
        // Two runs of the same version and rules at once: the second returns the run the first stored instead of
        // failing on the unique key (create-or-return; getpack-web integration.md, U4.5).
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const stored = await this.prisma.designCheckRun.findUnique({ where: runKey, include: RUN_INCLUDE });
          if (stored) return stored;
        }
        throw error;
      });
    return run;
  }

  /** The customer accepts a warning of the version's latest run; a block cannot be acknowledged. */
  async acknowledge(
    actor: UserActor,
    designId: string,
    input: { versionNo?: number; ruleId: string; elementId?: string },
  ): Promise<CheckRunView> {
    const { doc, version } = await this.version(actor, designId, input.versionNo);
    const run = await this.latest(version.id);
    if (!run) throw new DomainException('studio.checks_not_run');
    const elementId = input.elementId ?? '';
    const finding = run.findings.find((f) => f.ruleId === input.ruleId && f.elementId === elementId);
    if (!finding)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'ruleId',
            code: 'not_found',
            message: 'no such finding in the latest check of the version',
          },
        ],
      });
    if (finding.severity === 'block') throw new DomainException('studio.block_not_acknowledgeable');
    await this.prisma.withTx(async (tx) => {
      const done = await tx.designCheckAcknowledgement.findUnique({
        where: { versionId_ruleId_elementId: { versionId: version.id, ruleId: input.ruleId, elementId } },
      });
      if (done) return;
      await tx.designCheckAcknowledgement.create({
        data: { versionId: version.id, ruleId: input.ruleId, elementId, userId: actor.userId },
      });
      await this.record(tx, actor, doc.publicId, 'design.check_acknowledged', {
        versionNo: version.versionNo,
        ruleId: input.ruleId,
        elementId: elementId || null,
      });
    });
    return this.view(run);
  }

  /** The latest stored run of a version (document source), for the order hand-off (B4). */
  async latest(versionId: bigint, db: Tx = this.prisma): Promise<RunRow | null> {
    return db.designCheckRun.findFirst({
      where: { versionId, source: 'document' },
      orderBy: { evaluatedAt: 'desc' },
      include: RUN_INCLUDE,
    });
  }

  async view(run: RunRow): Promise<CheckRunView> {
    const acks = await this.prisma.designCheckAcknowledgement.findMany({
      where: { versionId: run.versionId },
      select: { ruleId: true, elementId: true },
    });
    const acked = new Set(acks.map((a) => `${a.ruleId}\u0000${a.elementId}`));
    const findings = run.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      elementId: f.elementId || null,
      details: f.details as Record<string, unknown>,
      acknowledged: acked.has(`${f.ruleId}\u0000${f.elementId}`),
    }));
    return {
      versionNo: run.version.versionNo,
      rulesVersion: run.rulesVersion.versionNo,
      source: run.source,
      counts: { block: run.blockCount, warn: run.warnCount, info: run.infoCount },
      findings,
      ready: run.blockCount === 0 && findings.every((f) => f.severity !== 'warn' || f.acknowledged),
      evaluatedAt: toBangkokIso(run.evaluatedAt),
    };
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  /** D-282: the studio elements placed in the document that need a right the owner (or a company of theirs) lacks. */
  private async undeclaredElements(document: unknown, ownerUserId: bigint): Promise<Set<string>> {
    const elements = (document as { content?: { elements?: unknown } } | null)?.content?.elements;
    const ids = Array.isArray(elements)
      ? [
          ...new Set(
            (elements as Record<string, unknown>[])
              .map((e) => e['studioElementId'])
              .filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)),
          ),
        ]
      : [];
    if (ids.length === 0) return new Set();
    const needing = await this.prisma.studioElement.findMany({
      where: { publicId: { in: ids }, requiresRight: true },
      select: { id: true, publicId: true },
    });
    const declared = await this.catalog.declaredElementIds(ownerUserId);
    return new Set(needing.filter((e) => !declared.has(e.id)).map((e) => e.publicId));
  }

  private async version(actor: UserActor, designId: string, versionNo?: number) {
    const doc = await this.prisma.designDocument.findFirst({
      where: { publicId: designId, ownerUserId: actor.userId, deletedAt: null },
      include: { styleVariant: { select: { base: { select: { materialClass: true } } } } },
    });
    if (!doc) throw new DomainException('http.not_found');
    const version =
      versionNo !== undefined
        ? await this.prisma.designDocumentVersion.findUnique({
            where: { documentId_versionNo: { documentId: doc.id, versionNo } },
          })
        : doc.currentVersionId
          ? await this.prisma.designDocumentVersion.findUnique({ where: { id: doc.currentVersionId } })
          : null;
    if (!version)
      throw new DomainException(versionNo !== undefined ? 'http.not_found' : 'designs.version_required');
    return { doc, version };
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    designId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.events.record(
      tx,
      { type, aggregateType: 'design_document', aggregateId: designId, payload: { designId, ...data } },
      actor,
    );
  }
}
