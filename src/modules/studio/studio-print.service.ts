import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { scrubMetadata } from '@common/files/metadata-scrub';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DesignRenderKind, type PrintSides, type Prisma } from '@generated/prisma/client';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type PrintTile,
  type RecipeBuildRequest,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { type DestinationInputDto } from '@modules/carts/carts.dto';
import { CartsService } from '@modules/carts/carts.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { constructionFamily, convertSize } from '@modules/specs/dimension-conversion';
import { StyleDielinesService } from '@modules/styles/style-dielines.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FilesService } from '@platform/files/files.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import { StudioChecksService } from './studio-checks.service';

const BATCH = 3;
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const PT_PER_MM = 72 / 25.4;
const SNAPSHOT_PX = 1024;
/** ADR-0009 preflight checks that are studio rules under another name (D-278: one id per rule). */
const PREFLIGHT_RULE: Record<string, string> = {
  missing_bleed: 'bleed',
  low_resolution: 'image_resolution',
  safe_zone: 'safe_zone',
  thin_lines: 'hairline',
  rgb_colour: 'rgb_out_of_gamut',
};

export const JOB_INCLUDE = {
  version: { select: { versionNo: true, designDocument: { select: { publicId: true } } } },
  order: { select: { publicId: true, orderCode: true } },
  cartItem: { select: { publicId: true } },
  printFile: true,
  proofFile: true,
  snapshotFile: true,
  submission: { select: { publicId: true } },
} satisfies Prisma.StudioPrintJobInclude;
export type JobRow = Prisma.StudioPrintJobGetPayload<{ include: typeof JOB_INCLUDE }>;

export interface RenderInput {
  side: 'outside' | 'inside';
  kind: DesignRenderKind;
  separation?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  fileId: string;
}

const needsOutside = (s: PrintSides | null) => s === 'outside' || s === 'both';
const needsInside = (s: PrintSides | null) => s === 'inside' || s === 'both';

/**
 * D-280 / ADR-0011 — the studio's print file. The studio uploads what it rendered for a version (300 dpi JPEG tiles,
 * finish masks); "order this version" checks the version (checks ready, renders present, a drawable style), puts it in
 * the cart pinned to that version with the studio quotation, and queues a print job. The worker assembles the print
 * PDF from the engine's vector die and the tiles, adds a separation page per finish, renders the 3D snapshot, makes the
 * digital proof, and — once the order exists — attaches them to the order line as its artwork (preflight and the
 * Prepress review run as for every submission; the proof Prepress sends is the digital proof).
 */
@Injectable()
export class StudioPrintService {
  private readonly logger = new Logger(StudioPrintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly carts: CartsService,
    private readonly artwork: ArtworkService,
    private readonly checks: StudioChecksService,
    private readonly companies: CompaniesService,
    private readonly dielines: StyleDielinesService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- renders ----------------------------------------------------------------------------------------------

  async addRender(actor: UserActor, designId: string, versionNo: number, input: RenderInput) {
    const { version } = await this.version(actor, designId, versionNo);
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const file = await this.prisma.fileObject.findUnique({ where: { publicId: input.fileId } });
    if (!file || file.ownerUserId !== actor.userId) throw invalid('fileId', 'no such file of yours');
    if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean')
      throw new DomainException('file.not_ready');
    const mime = input.kind === 'tile' ? 'image/jpeg' : 'image/png';
    if (file.mimeType !== mime) throw invalid('fileId', `a ${input.kind} is ${mime}`);
    if ((input.kind === 'finish_mask') !== !!input.separation)
      throw invalid('separation', 'a finish mask names its separation, a tile none');
    await this.prisma.withTx(async (tx) => {
      const render = await tx.designVersionRender.create({
        data: {
          versionId: version.id,
          side: input.side,
          kind: input.kind,
          separation: input.separation ?? null,
          xMm: input.xMm,
          yMm: input.yMm,
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          fileId: file.id,
        },
      });
      await this.event(tx, actor, designId, 'design.render_added', {
        versionNo,
        renderId: render.publicId,
        side: input.side,
        kind: input.kind,
      });
    });
    return this.renders(version.id);
  }

  async renders(versionId: bigint) {
    return this.prisma.designVersionRender.findMany({
      where: { versionId },
      include: { file: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
  }

  // --- order hand-off ---------------------------------------------------------------------------------------

  /** D-280: the version is checked, carted with its studio quotation and its print job queued (202). */
  async order(
    actor: UserActor,
    designId: string,
    input: {
      quoteId: string;
      quoteOptionId: string;
      versionNo?: number;
      destinations?: DestinationInputDto[];
    },
  ): Promise<JobRow> {
    const { doc, version } = await this.version(actor, designId, input.versionNo);
    const quote = await this.prisma.quote.findUnique({
      where: { publicId: input.quoteId },
      select: { id: true, designDocumentVersionId: true, customerUserId: true },
    });
    if (!quote || quote.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    if (quote.designDocumentVersionId !== version.id)
      throw new DomainException('studio.quote_not_of_version');
    const run = await this.checks.run(actor, designId, version.versionNo);
    if (!run.ready) throw new DomainException('studio.checks_not_ready');
    await this.printable(doc);
    const renders = await this.renders(version.id);
    const tiles = (side: string) => renders.some((r) => r.kind === 'tile' && r.side === side);
    if (
      (needsOutside(doc.printSides) && !tiles('outside')) ||
      (needsInside(doc.printSides) && !tiles('inside'))
    )
      throw new DomainException('studio.renders_missing');

    const cart = await this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: input.quoteId,
        quoteOptionId: input.quoteOptionId,
        destinations: input.destinations,
        designOption: 'online_designer',
        designDocumentId: designId,
        designVersionNo: version.versionNo,
      },
    );
    const item = cart.items.find((i) => i.quoteOption.publicId === input.quoteOptionId)!;
    const job = await this.prisma.withTx(async (tx) => {
      const created = await tx.studioPrintJob.create({
        data: { versionId: version.id, customerUserId: actor.userId, quoteId: quote.id, cartItemId: item.id },
        include: JOB_INCLUDE,
      });
      await this.event(tx, actor, designId, 'studio.print_requested', {
        jobId: created.publicId,
        versionNo: version.versionNo,
      });
      return created;
    });
    return job;
  }

  /** D-286: the version to the design service — its studio quotation with the design fee, in the cart. */
  async handOff(
    actor: UserActor,
    designId: string,
    input: {
      quoteId: string;
      quoteOptionId: string;
      versionNo?: number;
      destinations?: DestinationInputDto[];
    },
  ): Promise<{ cartItemId: string; designVersionNo: number }> {
    const { version } = await this.version(actor, designId, input.versionNo);
    const quote = await this.prisma.quote.findUnique({
      where: { publicId: input.quoteId },
      select: { designDocumentVersionId: true, customerUserId: true },
    });
    if (!quote || quote.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    if (quote.designDocumentVersionId !== version.id)
      throw new DomainException('studio.quote_not_of_version');
    const cart = await this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: input.quoteId,
        quoteOptionId: input.quoteOptionId,
        destinations: input.destinations,
        designOption: 'hired_design',
        designDocumentId: designId,
        designVersionNo: version.versionNo,
      },
    );
    const item = cart.items.find((i) => i.quoteOption.publicId === input.quoteOptionId)!;
    return { cartItemId: item.publicId, designVersionNo: version.versionNo };
  }

  async job(actor: UserActor, jobId: string): Promise<JobRow> {
    const job = await this.prisma.studioPrintJob.findUnique({
      where: { publicId: jobId },
      include: JOB_INCLUDE,
    });
    if (!job || job.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    return job;
  }

  /** Signed URLs of a job's files (the owner's own files). */
  async urls(job: JobRow) {
    const url = async (f: JobRow['printFile']) => (f ? ((await this.files.signedUrl(f))?.url ?? null) : null);
    return {
      printFileUrl: await url(job.printFile),
      proofFileUrl: await url(job.proofFile),
      snapshotUrl: await url(job.snapshotFile),
    };
  }

  /** Checkout placed the order of a studio cart item: the job follows the order (attached when it is done). */
  async onOrderPlaced(tx: Tx, cartItemId: bigint, order: { id: bigint; publicId: string }): Promise<void> {
    const job = await tx.studioPrintJob.findUnique({ where: { cartItemId } });
    if (!job) return;
    const updated = await tx.studioPrintJob.update({ where: { id: job.id }, data: { orderId: order.id } });
    if (updated.status === 'succeeded') await this.attach(tx, updated.id);
  }

  // --- worker -----------------------------------------------------------------------------------------------

  @ScheduledJob({ name: 'studio.print', every: 10_000 })
  async runDue(now: Date = new Date()): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE studio_print_jobs SET status = 'running', locked_until = ${new Date(now.getTime() + LEASE_MS)},
             attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM studio_print_jobs
          WHERE (status = 'queued' OR (status = 'running' AND locked_until < ${now})) AND attempts < ${MAX_ATTEMPTS}
          ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      await this.processOne(id).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'print file failed';
        this.logger.warn(`studio print job ${id} failed: ${message}`);
        const job = await this.prisma.studioPrintJob.findUniqueOrThrow({ where: { id } });
        await this.prisma.studioPrintJob.update({
          where: { id },
          data:
            job.attempts >= MAX_ATTEMPTS
              ? { status: 'failed', error: message, lockedUntil: null, completedAt: new Date() }
              : { status: 'queued', error: message, lockedUntil: null },
        });
      });
    }
    return claimed.length;
  }

  async processOne(id: bigint): Promise<void> {
    const job = await this.prisma.studioPrintJob.findUniqueOrThrow({
      where: { id },
      include: { version: { include: { designDocument: true, renders: { include: { file: true } } } } },
    });
    const doc = job.version.designDocument;
    const request = await this.printable(doc);
    const bleed = Number(
      (await this.settings.at('studio.print_rules')).value.rules.find((r) => r.id === 'bleed')?.thresholds?.[
        'bleedMm'
      ] ?? 3,
    );
    const read = async (key: string) => {
      const chunks: Buffer[] = [];
      for await (const chunk of await this.storage.getStream(key)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    };
    const tilesOf = async (side: 'outside' | 'inside', mirrorWidth: number | null): Promise<PrintTile[]> =>
      Promise.all(
        job.version.renders
          .filter((r) => r.kind === 'tile' && r.side === side)
          .map(async (r) => ({
            jpeg: await read(r.file.storageKey),
            widthPx: r.file.widthPx ?? 1,
            heightPx: r.file.heightPx ?? 1,
            // The inside prints on the back of the sheet: mirrored across its width.
            x:
              mirrorWidth === null ? r.xMm.toNumber() : mirrorWidth - r.xMm.toNumber() - r.widthMm.toNumber(),
            y: r.yMm.toNumber(),
            width: r.widthMm.toNumber(),
            height: r.heightMm.toNumber(),
          })),
      );
    const title = `${doc.publicId} v${job.version.versionNo}`;
    const outside = await this.engine.printPdf(request, {
      bleedMm: bleed,
      tiles: needsOutside(doc.printSides) ? await tilesOf('outside', null) : [],
      title,
    });
    const print = await PDFDocument.load(outside.pdf);
    if (needsInside(doc.printSides)) {
      const inside = await this.engine.printPdf(request, {
        bleedMm: bleed,
        tiles: await tilesOf('inside', outside.sheetWidthMm),
        title: `${title} inside`,
      });
      const [page] = await print.copyPages(await PDFDocument.load(inside.pdf), [0]);
      print.addPage(page);
    }
    // One page per finish separation, placed like the artwork (ADR-0011).
    const separations = [
      ...new Set(job.version.renders.filter((r) => r.kind === 'finish_mask').map((r) => r.separation!)),
    ];
    const font = await print.embedFont(StandardFonts.Helvetica);
    const [first] = print.getPages();
    for (const separation of separations) {
      const page = print.addPage([first!.getWidth(), first!.getHeight()]);
      page.drawText(`SEPARATION ${separation}`, {
        x: 12,
        y: page.getHeight() - 20,
        size: 9,
        font,
        color: rgb(0, 0, 0),
      });
      for (const r of job.version.renders.filter((x) => x.separation === separation)) {
        const image = await print.embedPng(new Uint8Array(await read(r.file.storageKey)));
        page.drawImage(image, {
          x: (outside.marginMm + r.xMm.toNumber()) * PT_PER_MM,
          y: page.getHeight() - (outside.marginMm + r.yMm.toNumber() + r.heightMm.toNumber()) * PT_PER_MM,
          width: r.widthMm.toNumber() * PT_PER_MM,
          height: r.heightMm.toNumber() * PT_PER_MM,
        });
      }
    }
    const printPdf = await withoutMetadata(await print.save());
    const thumbs = await this.engine.thumbnails(request, SNAPSHOT_PX);
    const snapshot = thumbs.png3d ?? thumbs.png2d;
    const proof = await this.proofPdf(printPdf, snapshot, doc, job.version.versionNo, outside.engineVersion);

    const owner = { ownerUserId: job.customerUserId, retentionClass: 'customer_content' as const };
    const printFile = await this.files.storeSystem({
      ...owner,
      body: printPdf,
      fileName: `print-${doc.publicId}-v${job.version.versionNo}.pdf`,
      mimeType: 'application/pdf',
    });
    const proofFile = await this.files.storeSystem({
      ...owner,
      body: proof,
      fileName: `proof-${doc.publicId}-v${job.version.versionNo}.pdf`,
      mimeType: 'application/pdf',
    });
    const snapshotFile = await this.files.storeSystem({
      ...owner,
      body: snapshot,
      fileName: `snapshot-${doc.publicId}-v${job.version.versionNo}.png`,
      mimeType: 'image/png',
    });
    await this.prisma.withTx(async (tx) => {
      const done = await tx.studioPrintJob.update({
        where: { id },
        data: {
          status: 'succeeded',
          printFileId: printFile.id,
          proofFileId: proofFile.id,
          snapshotFileId: snapshotFile.id,
          engineVersion: outside.engineVersion,
          error: null,
          lockedUntil: null,
          completedAt: new Date(),
        },
      });
      await this.events.record(tx, {
        type: 'studio.print_ready',
        aggregateType: 'design_document',
        aggregateId: doc.publicId,
        payload: { designId: doc.publicId, jobId: done.publicId, versionNo: job.version.versionNo },
      });
      if (done.orderId) await this.attach(tx, id);
    });
  }

  /** The print PDF, the digital proof and the snapshot become the order line's artwork (source `designer`). */
  private async attach(tx: Tx, jobId: bigint): Promise<void> {
    const job = await tx.studioPrintJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { order: true, printFile: true, proofFile: true, snapshotFile: true, version: true },
    });
    if (job.submissionId || !job.order || !job.printFile || !job.proofFile) return;
    const submissionId = await this.artwork.submitIn(
      tx,
      systemActor('studio.print'),
      job.order.publicId,
      {
        note: `Studio print file, design version ${job.version.versionNo} (ADR-0011)`,
        files: [
          { fileId: job.printFile.publicId, role: 'artwork' },
          { fileId: job.proofFile.publicId, role: 'reference' },
          ...(job.snapshotFile ? [{ fileId: job.snapshotFile.publicId, role: 'reference' as const }] : []),
        ],
      },
      {
        customerUserId: job.order.customerUserId,
        channel: 'web',
        source: 'designer',
        designDocumentVersionId: job.versionId,
      },
    );
    await tx.studioPrintJob.update({ where: { id: jobId }, data: { submissionId } });
  }

  /**
   * D-278: the preflight of a studio print file is stored as the version's `pdf` check run, with the studio's rule ids
   * where the preflight check is one of them (the others keep their ADR-0009 ids).
   */
  @OnDomainEvent('artwork.preflight_completed', { consumer: 'studio.pdf_checks' })
  async onPreflight(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const submission = await tx.artworkSubmission.findUnique({
      where: { publicId: String(event.payload['submissionId']) },
      include: { studioPrintJob: true },
    });
    const job = submission?.studioPrintJob;
    if (!submission || !job) return;
    const rules = await this.settings.at('studio.print_rules', { tx });
    const exists = await tx.designCheckRun.findUnique({
      where: {
        versionId_rulesVersionId_source_contextKey: {
          versionId: job.versionId,
          rulesVersionId: rules.versionId,
          source: 'pdf',
          contextKey: '',
        },
      },
    });
    if (exists) return;
    const findings = await tx.preflightFinding.findMany({
      where: { submissionId: submission.id, run: Number(event.payload['run'] ?? 1) },
      orderBy: { id: 'asc' },
    });
    const count = (s: string) => findings.filter((f) => f.severity === s).length;
    await tx.designCheckRun.create({
      data: {
        versionId: job.versionId,
        rulesVersionId: rules.versionId,
        source: 'pdf',
        blockCount: count('block'),
        warnCount: count('warn'),
        infoCount: count('info'),
        findings: {
          create: findings.map((f) => ({
            ruleId: PREFLIGHT_RULE[f.checkKey] ?? f.checkKey,
            severity: f.severity,
            details: { preflightCheck: f.checkKey, page: f.page, ...(f.details as Record<string, unknown>) },
          })),
        },
      },
    });
  }

  // --- B2B approval view (D-281) ----------------------------------------------------------------------------

  /** What the company approver sees of a studio order waiting for approval: the version, price and checks. */
  async approvalView(actor: UserActor, orderPublicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: {
        orderGroup: { select: { status: true, company: { select: { publicId: true } } } },
        designDocumentVersion: { include: { designDocument: { select: { publicId: true, title: true } } } },
        lines: { select: { lineType: true, grossAmount: true } },
      },
    });
    const company = order?.orderGroup?.company;
    if (!order || !company || !order.designDocumentVersion) throw new DomainException('http.not_found');
    await this.companies.forMember(actor, company.publicId, 'company_orders.approve');
    const version = order.designDocumentVersion;
    const run = await this.checks.latest(version.id);
    return {
      orderId: order.publicId,
      orderCode: order.orderCode,
      groupStatus: order.orderGroup.status,
      designId: version.designDocument.publicId,
      title: version.designDocument.title,
      versionNo: version.versionNo,
      box: version.box as Record<string, unknown> | null,
      document: version.document as Record<string, unknown>,
      grossAmount: order.lines.reduce((n, l) => n + Number(l.grossAmount), 0).toFixed(2),
      checks: run ? await this.checks.view(run) : null,
    };
  }

  // --- helpers ----------------------------------------------------------------------------------------------

  /** The engine request of a design's box: a style variant with an approved recipe, drawable now. */
  private async printable(doc: {
    styleVariantId: bigint | null;
    lengthMm: Prisma.Decimal | null;
    widthMm: Prisma.Decimal | null;
    heightMm: Prisma.Decimal | null;
    measurementBasis: string;
    patternId: bigint | null;
  }): Promise<RecipeBuildRequest> {
    if (!doc.styleVariantId || !(await this.dielines.ready()))
      throw new DomainException('studio.print_unavailable');
    const variant = await this.prisma.styleVariant.findUniqueOrThrow({
      where: { id: doc.styleVariantId },
      include: {
        base: {
          include: {
            pattern: { select: { geometryFormula: true, corrugateFormula: true } },
            recipes: { where: { approvedAt: { not: null } }, orderBy: { version: 'desc' }, take: 1 },
          },
        },
      },
    });
    const recipe = variant.base.recipes[0];
    const ranges = Object.keys((recipe?.sizeRanges ?? {}) as Record<string, unknown>).sort();
    const cls = ranges.includes(variant.base.materialClass) ? variant.base.materialClass : ranges[0];
    const material = cls ? await this.engine.referenceMaterial(cls) : null;
    if (!recipe || !material || !doc.lengthMm || !doc.widthMm || !doc.heightMm)
      throw new DomainException('studio.print_unavailable');
    const size = { l: doc.lengthMm.toNumber(), w: doc.widthMm.toNumber(), d: doc.heightMm.toNumber() };
    let inside = size;
    if (doc.measurementBasis !== 'internal' && doc.measurementBasis !== 'product') {
      const family = constructionFamily(null, variant.base.pattern, size.d);
      const converted = convertSize(size, doc.measurementBasis as 'external', family, material.caliperMm)
        .sizes.internal;
      if (!converted) throw new DomainException('studio.print_unavailable');
      inside = converted;
    }
    return {
      recipe: recipe.recipe as unknown as StoredRecipe,
      options: variant.options as Record<string, unknown>,
      sizes: { length: inside.l, width: inside.w, height: inside.d },
      material,
    };
  }

  private async version(actor: UserActor, designId: string, versionNo?: number) {
    const doc = await this.prisma.designDocument.findFirst({
      where: { publicId: designId, ownerUserId: actor.userId, deletedAt: null },
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

  /** The digital proof: a cover with the 3D snapshot and the facts of the version, then the print file's pages. */
  private async proofPdf(
    printPdf: Buffer,
    snapshot: Buffer,
    doc: { publicId: string; printMethod: string | null; printSides: string | null; finishes: string[] },
    versionNo: number,
    engineVersion: string,
  ): Promise<Buffer> {
    const proof = await PDFDocument.create({ updateMetadata: false });
    const font = await proof.embedFont(StandardFonts.Helvetica);
    const cover = proof.addPage([595.28, 841.89]);
    const image = await proof.embedPng(new Uint8Array(snapshot));
    const side = 360;
    cover.drawImage(image, { x: (595.28 - side) / 2, y: 380, width: side, height: side });
    const lines = [
      'DIGITAL PROOF - what will be printed (ADR-0011)',
      `Design ${doc.publicId} - version ${versionNo}`,
      `Print: ${doc.printMethod ?? '-'} / sides: ${doc.printSides ?? '-'} / finishes: ${doc.finishes.join(', ') || '-'}`,
      `Engine: ${engineVersion}`,
      'Colours are an RGB preview, not a contract colour proof (D-215).',
    ];
    lines.forEach((text, i) =>
      cover.drawText(text, { x: 48, y: 330 - i * 18, size: 10, font, color: rgb(0, 0, 0) }),
    );
    const pages = await proof.copyPages(
      await PDFDocument.load(printPdf),
      (await PDFDocument.load(printPdf)).getPageIndices(),
    );
    pages.forEach((p) => proof.addPage(p));
    return withoutMetadata(await proof.save());
  }

  private async event(
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

/** D-442: generated PDFs carry no Title / Author / Creator / Producer / XMP (GLOBAL-RULES §1). */
async function withoutMetadata(pdf: Uint8Array): Promise<Buffer> {
  const scrubbed = await scrubMetadata(Buffer.from(pdf));
  if (!scrubbed.ok) throw new Error(`print PDF metadata scrub failed: ${scrubbed.reason}`);
  return scrubbed.body;
}
