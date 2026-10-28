import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type FileObject, type Prisma } from '@generated/prisma/client';
import { DIELINE_ENGINE, type DielineEngine } from '@integrations/dieline/dieline-engine.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { type DestinationInputDto } from '@modules/carts/carts.dto';
import { CartsService } from '@modules/carts/carts.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { ArtworkService } from '../artwork.service';
import { type FileFacts } from '../preflight/facts';
import { pdfFacts } from '../preflight/pdf-facts';
import { MAX_PREFLIGHT_BYTES } from '../preflight/preflight.service';
import { type PrintMethodContext } from '../preflight/rules';
import { detect, type DetectionCandidate, type DetectionMatch, sheetOf, type SheetOfFile } from './detection';
import { UPLOAD_CHECKS, type UploadReport, uploadReport } from './report';

/** Files one check holds at once (variants), and versions per variant (technical bounds). */
export const MAX_VARIANTS = 20;
export const MAX_VERSIONS = 50;
/** The pipeline's stages: read · die lines · match · checks · ready (the page's progress). */
export const STAGE_COUNT = 5;
const BATCH = 4;
/** A claimed version is retried by another worker after this long (crash safety). */
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export const PRINT_METHODS = ['none', 'spot', 'cmyk'] as const;
export type PrintMethod = (typeof PRINT_METHODS)[number];

const CHECK_INCLUDE = {
  catalogProduct: { select: { id: true, slug: true, nameTh: true, nameEn: true } },
  versions: {
    orderBy: [{ variantNo: 'asc' }, { versionNo: 'asc' }],
    include: {
      fileObject: true,
      cartItem: { select: { publicId: true } },
    },
  },
} as const satisfies Prisma.FileCheckInclude;

export type FileCheckRow = Prisma.FileCheckGetPayload<{ include: typeof CHECK_INCLUDE }>;
export type FileCheckVersionRow = FileCheckRow['versions'][number];

export interface StoredDetection {
  sheet: SheetOfFile | null;
  match: Omit<DetectionMatch, 'catalogProductId'> | null;
  engineVersion: string | null;
}

export const fileCheckEtag = (check: { publicId: string; rowVersion: number }) =>
  etagOf(check.publicId, check.rowVersion);

/** The current (latest, not removed) version of each variant, in variant order. */
export function currentVersions(check: Pick<FileCheckRow, 'versions'>): FileCheckVersionRow[] {
  const byVariant = new Map<number, FileCheckVersionRow>();
  for (const v of check.versions) {
    if (v.removedAt) continue;
    const known = byVariant.get(v.variantNo);
    if (!known || v.versionNo > known.versionNo) byVariant.set(v.variantNo, v);
  }
  return [...byVariant.values()].sort((a, b) => a.variantNo - b.variantNo);
}

/** `%PDF-` within the first KiB (PDF, and Illustrator files saved PDF-compatible) — the file's own bytes decide. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

/**
 * C9 (D-457, GLOBAL-RULES §6, DECISIONS-STAGE-A §1 + §7): the own-file check before ordering. The customer uploads
 * PDF / AI files (each a variant of the same order, each with versions); a worker reads each version, finds its die
 * lines, matches them to a product and standard size, runs the 12 checks of the shared preflight engine (ADR-0009)
 * against the chosen spec and stores the report. With nothing to fix, a version goes in the cart with its file, and the
 * file becomes the order's artwork when the order is placed; Prepress still reviews it after payment (D-070).
 * Files keep their access rules: the customer's own, private, signed URLs; staff see them only once part of an order
 * (D-444). File names never reach logs or events (PDPA).
 */
@Injectable()
export class FileChecksService {
  private readonly logger = new Logger(FileChecksService.name);
  /** Blank sizes by pattern key and size (the engine is deterministic per version). */
  private readonly blanks = new Map<string, { widthMm: number; heightMm: number; engineVersion: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly carts: CartsService,
    private readonly artwork: ArtworkService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- reads ------------------------------------------------------------------------------------------------

  async get(actor: UserActor, checkId: string): Promise<FileCheckRow> {
    const check = await this.prisma.fileCheck.findUnique({
      where: { publicId: checkId },
      include: CHECK_INCLUDE,
    });
    if (!check || check.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    return check;
  }

  /** The rules the page shows: bleed and safe zone for the templates, accepted files, which checks run. */
  async rules(): Promise<{
    bleedMm: string;
    safeZoneMm: string;
    sizeToleranceMm: string;
    maxBytes: number;
    checks: { check: string; evaluated: boolean }[];
  }> {
    const rules = (await this.settings.at('artwork.preflight_rules')).value;
    const set = (v: string | null | undefined) => v !== null && v !== undefined && v !== '' && Number(v) > 0;
    const evaluated: Record<string, boolean> = {
      small_text: set(rules.minTextPt),
      small_text_black: set(rules.blackOnlyTextBelowPt),
      barcode: false,
    };
    return {
      bleedMm: rules.bleedMm,
      safeZoneMm: rules.safeZoneMm,
      sizeToleranceMm: rules.sizeToleranceMm,
      maxBytes: MAX_PREFLIGHT_BYTES,
      checks: UPLOAD_CHECKS.map((check) => ({ check, evaluated: evaluated[check] ?? true })),
    };
  }

  /** Signed download URL of a version's file (the owner's own file; 5 minutes). */
  async fileUrl(file: FileObject): Promise<string | null> {
    return (await this.files.signedUrl(file))?.url ?? null;
  }

  // --- writes -----------------------------------------------------------------------------------------------

  async create(
    actor: UserActor,
    input: { fileIds: string[]; productSlug?: string; sizeCode?: string },
  ): Promise<FileCheckRow> {
    if (input.fileIds.length === 0 || input.fileIds.length > MAX_VARIANTS)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'fileIds', code: 'size', message: `1–${MAX_VARIANTS} files` }],
      });
    const objects = await this.usableFiles(actor, input.fileIds);
    const product = input.productSlug ? await this.product(input.productSlug) : null;
    if (input.sizeCode && !product)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'sizeCode', code: 'requires', message: 'a size needs its product' }],
      });
    if (product && input.sizeCode) await this.size(product.id, input.sizeCode);
    const id = await this.prisma.withTx(async (tx) => {
      const check = await tx.fileCheck.create({
        data: {
          customerUserId: actor.userId,
          catalogProductId: product?.id ?? null,
          standardSizeCode: product ? (input.sizeCode ?? null) : null,
        },
      });
      await tx.fileCheckVersion.createMany({
        data: objects.map((o, index) => ({
          fileCheckId: check.id,
          variantNo: index + 1,
          versionNo: 1,
          fileObjectId: o.id,
        })),
      });
      await this.record(tx, actor, check.publicId, 'file_check.created', { files: objects.length });
      return check.id;
    });
    return this.prisma.fileCheck.findUniqueOrThrow({ where: { id }, include: CHECK_INCLUDE });
  }

  /** A new variant (no `variantNo`) or a new version of one (a corrected file, re-checked). */
  async addFile(
    actor: UserActor,
    checkId: string,
    input: { fileId: string; variantNo?: number },
  ): Promise<FileCheckRow> {
    const check = await this.get(actor, checkId);
    const [object] = await this.usableFiles(actor, [input.fileId]);
    const live = currentVersions(check);
    let variantNo: number;
    let versionNo: number;
    if (input.variantNo !== undefined) {
      const current = live.find((v) => v.variantNo === input.variantNo);
      if (!current) throw new DomainException('http.not_found');
      if (current.cartItemId !== null) throw new DomainException('file_checks.in_cart');
      variantNo = current.variantNo;
      versionNo =
        Math.max(...check.versions.filter((v) => v.variantNo === variantNo).map((v) => v.versionNo)) + 1;
      if (versionNo > MAX_VERSIONS)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'variantNo', code: 'max', message: `at most ${MAX_VERSIONS} versions` }],
        });
    } else {
      if (live.length >= MAX_VARIANTS)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'fileId', code: 'max', message: `at most ${MAX_VARIANTS} files` }],
        });
      variantNo = Math.max(0, ...check.versions.map((v) => v.variantNo)) + 1;
      versionNo = 1;
    }
    await this.prisma.withTx(async (tx) => {
      await tx.fileCheckVersion.create({
        data: { fileCheckId: check.id, variantNo, versionNo, fileObjectId: object!.id },
      });
      await tx.fileCheck.update({ where: { id: check.id }, data: { rowVersion: { increment: 1 } } });
      await this.record(tx, actor, check.publicId, 'file_check.file_added', { variantNo, versionNo });
    });
    return this.get(actor, checkId);
  }

  /** Takes a variant out of the check (its versions stay as history; the files are kept — D-005 retention). */
  async removeVariant(actor: UserActor, checkId: string, variantNo: number): Promise<FileCheckRow> {
    const check = await this.get(actor, checkId);
    const versions = check.versions.filter((v) => v.variantNo === variantNo && !v.removedAt);
    if (!versions.length) throw new DomainException('http.not_found');
    if (versions.some((v) => v.cartItemId !== null)) throw new DomainException('file_checks.in_cart');
    await this.prisma.withTx(async (tx) => {
      await tx.fileCheckVersion.updateMany({
        where: { id: { in: versions.map((v) => v.id) } },
        data: { removedAt: new Date() },
      });
      await tx.fileCheck.update({ where: { id: check.id }, data: { rowVersion: { increment: 1 } } });
      await this.record(tx, actor, check.publicId, 'file_check.file_removed', { variantNo });
    });
    return this.get(actor, checkId);
  }

  /**
   * The spec the customer orders: product, standard size, print method. Every finished version is re-evaluated at
   * once from its stored facts (the file is not read again), so a size that no longer matches the file shows as
   * "ไม่ตรงกับไฟล์" straight away.
   */
  async updateSpec(
    actor: UserActor,
    checkId: string,
    ifMatch: string | undefined,
    input: {
      productSlug?: string | null;
      sizeCode?: string | null;
      printMethod?: PrintMethod | null;
      printSpotColours?: number | null;
    },
  ): Promise<FileCheckRow> {
    const check = await this.get(actor, checkId);
    assertIfMatch(ifMatch, fileCheckEtag(check), { required: false });
    let catalogProductId = check.catalogProductId;
    let sizeCode = check.standardSizeCode;
    if (input.productSlug !== undefined) {
      const product = input.productSlug ? await this.product(input.productSlug) : null;
      if (product?.id !== catalogProductId) sizeCode = null;
      catalogProductId = product?.id ?? null;
    }
    if (input.sizeCode !== undefined) {
      if (input.sizeCode !== null && catalogProductId === null)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'sizeCode', code: 'requires', message: 'a size needs its product' }],
        });
      if (input.sizeCode !== null) await this.size(catalogProductId!, input.sizeCode);
      sizeCode = input.sizeCode;
    }
    const printMethod =
      input.printMethod !== undefined ? input.printMethod : (check.printMethod as PrintMethod | null);
    const printSpotColours =
      input.printSpotColours !== undefined ? input.printSpotColours : check.printSpotColours;
    if (live(check).some((v) => v.cartItemId !== null)) throw new DomainException('file_checks.in_cart');

    const spec = { catalogProductId, sizeCode, printMethod, printSpotColours };
    const expected = await this.expectedOf(catalogProductId, sizeCode);
    const resolved = await this.settings.at('artwork.preflight_rules');
    const rules = resolved.value;
    await this.prisma.withTx(async (tx) => {
      const updated = await tx.fileCheck.updateMany({
        where: { id: check.id, rowVersion: check.rowVersion },
        data: {
          catalogProductId,
          standardSizeCode: sizeCode,
          printMethod,
          printSpotColours,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new DomainException('concurrency.stale');
      for (const version of currentVersions(check).filter((v) => v.status === 'done' && v.facts)) {
        const report = uploadReport(version.facts as unknown as FileFacts, expected, rules, printOf(spec));
        await tx.fileCheckVersion.update({
          where: { id: version.id },
          data: { report: report as unknown as Prisma.InputJsonValue, refs: refsOf(resolved.versionId) },
        });
      }
      await this.record(tx, actor, check.publicId, 'file_check.spec_changed', {
        productChosen: catalogProductId !== null,
        sizeCode,
        printMethod,
      });
    });
    return this.get(actor, checkId);
  }

  /**
   * One variant into the cart with its checked file: its current version must be checked with nothing to fix, the
   * quotation the customer's own and of the check's product (priced by `store.quotes.save` like /configure, D-457 —
   * the same pricing service). The line is `own_file`; the file follows it to the order.
   */
  async addToCart(
    actor: UserActor,
    checkId: string,
    input: {
      variantNo: number;
      quoteId: string;
      quoteOptionId: string;
      destinations?: DestinationInputDto[];
    },
  ): Promise<{ check: FileCheckRow; cartItemId: string }> {
    const check = await this.get(actor, checkId);
    const version = currentVersions(check).find((v) => v.variantNo === input.variantNo);
    if (!version) throw new DomainException('http.not_found');
    if (version.cartItemId !== null) throw new DomainException('file_checks.in_cart');
    if (version.status !== 'done' || !version.report) throw new DomainException('file_checks.not_ready');
    if ((version.report as unknown as UploadReport).blocking)
      throw new DomainException('file_checks.blocking');
    if (check.catalogProductId === null || check.standardSizeCode === null)
      throw new DomainException('file_checks.spec_missing');
    const quote = await this.prisma.quote.findUnique({
      where: { publicId: input.quoteId },
      select: { customerUserId: true, catalogProductId: true },
    });
    if (!quote || quote.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    if (quote.catalogProductId !== check.catalogProductId)
      throw new DomainException('file_checks.quote_mismatch');

    const cart = await this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: input.quoteId,
        quoteOptionId: input.quoteOptionId,
        destinations: input.destinations,
        designOption: 'own_file',
      },
    );
    const item = cart.items.find((i) => i.quoteOption.publicId === input.quoteOptionId)!;
    await this.prisma.withTx(async (tx) => {
      await tx.fileCheckVersion.update({ where: { id: version.id }, data: { cartItemId: item.id } });
      await tx.fileCheck.update({ where: { id: check.id }, data: { rowVersion: { increment: 1 } } });
      await this.record(tx, actor, check.publicId, 'file_check.carted', {
        variantNo: version.variantNo,
        versionNo: version.versionNo,
        cartItemId: item.publicId,
      });
    });
    return { check: await this.get(actor, checkId), cartItemId: item.publicId };
  }

  /**
   * Checkout placed the order of a cart line carrying a checked file (extension `file-check`): the file becomes the
   * order's artwork submission (source `upload`, channel `web`) in the same transaction. The order's own preflight then
   * runs on it as on any submission, and Prepress reviews it once the order is paid (DECISIONS-STAGE-A §7).
   */
  async onOrderPlaced(tx: Tx, cartItemId: bigint, order: { id: bigint; publicId: string }): Promise<void> {
    const version = await tx.fileCheckVersion.findUnique({
      where: { cartItemId },
      include: { fileObject: true, fileCheck: true },
    });
    if (!version) return;
    await this.artwork.submitIn(
      tx,
      systemActor('artwork.file_check'),
      order.publicId,
      {
        note: `Checked before ordering (file check ${version.fileCheck.publicId}, variant ${version.variantNo}, version ${version.versionNo})`,
        files: [{ fileId: version.fileObject.publicId, role: 'artwork' }],
      },
      { customerUserId: version.fileCheck.customerUserId, channel: 'web', source: 'upload' },
    );
    await this.events.record(
      tx,
      {
        type: 'file_check.ordered',
        aggregateType: 'file_check',
        aggregateId: version.fileCheck.publicId,
        payload: {
          fileCheckId: version.fileCheck.publicId,
          variantNo: version.variantNo,
          versionNo: version.versionNo,
          orderId: order.publicId,
        },
      },
      systemActor('artwork.file_check'),
    );
  }

  // --- reorder ----------------------------------------------------------------------------------------------

  /**
   * "สั่งซ้ำจากไฟล์เดิม": the customer's produced own-file orders (production started, not cancelled), newest first,
   * with the artwork file that was produced and its thumbnail. Reordering uses the existing reorder (D-153: the approved
   * file, no re-check, today's price).
   */
  async reorderable(actor: UserActor, limit = 6) {
    const orders = await this.prisma.order.findMany({
      where: {
        customerUserId: actor.userId,
        designOption: 'own_file',
        productionStartedAt: { not: null },
        status: { not: 'cancelled' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        publicId: true,
        orderCode: true,
        createdAt: true,
        quantityOrdered: true,
        unit: true,
        catalogProduct: { select: { slug: true, nameTh: true, nameEn: true } },
      },
    });
    const out = [];
    for (const order of orders) {
      const submission = await this.prisma.artworkSubmission.findFirst({
        where: { orderId: order.id, status: 'accepted_for_proof' },
        orderBy: { versionNo: 'desc' },
        include: {
          files: { where: { role: 'artwork' }, include: { fileObject: true }, orderBy: { sort: 'asc' } },
        },
      });
      const file = submission?.files.find((f) => f.fileObject)?.fileObject ?? null;
      const thumb = file
        ? await this.prisma.fileObject.findFirst({ where: { thumbnailOfFileId: file.id } })
        : null;
      out.push({
        orderId: order.publicId,
        orderCode: order.orderCode,
        orderedAt: order.createdAt,
        quantity: order.quantityOrdered,
        unit: order.unit,
        product: order.catalogProduct,
        fileName: file?.originalName ?? null,
        thumbnailUrl: thumb ? await this.fileUrl(thumb) : null,
      });
    }
    return out;
  }

  // --- worker -----------------------------------------------------------------------------------------------

  @ScheduledJob({ name: 'artwork.file_check', every: 3_000 })
  async runDue(now: Date = new Date()): Promise<number> {
    await this.prisma.$executeRaw`
      UPDATE file_check_versions
         SET status = 'failed', error = 'attempts', locked_until = NULL, completed_at = ${now}, updated_at = now()
       WHERE status = 'running' AND locked_until < ${now} AND attempts >= ${MAX_ATTEMPTS}`;
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE file_check_versions
         SET status = 'running', stage = 0, locked_until = ${new Date(now.getTime() + LEASE_MS)},
             attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT v.id FROM file_check_versions v JOIN file_objects o ON o.id = v.file_object_id
          WHERE (v.status = 'queued' OR (v.status = 'running' AND v.locked_until < ${now}))
            AND v.attempts < ${MAX_ATTEMPTS}
            AND v.removed_at IS NULL
            AND o.scan_status <> 'pending'
          ORDER BY v.created_at
          LIMIT ${BATCH}
          FOR UPDATE OF v SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      await this.processOne(id).catch((error: unknown) => {
        this.logger.warn(
          `file check version ${id} failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      });
    }
    return claimed.length;
  }

  /** read → die lines → match → 12 checks → ready; each stage is stored so the page can show it. */
  async processOne(id: bigint): Promise<void> {
    const version = await this.prisma.fileCheckVersion.findUniqueOrThrow({
      where: { id },
      include: { fileObject: true, fileCheck: true },
    });
    const stage = (n: number) =>
      this.prisma.fileCheckVersion.updateMany({ where: { id, status: 'running' }, data: { stage: n } });

    const facts = await this.factsOf(version.fileObject);
    await stage(1);
    const sheet = sheetOf(facts);
    await stage(2);
    const resolved = await this.settings.at('artwork.preflight_rules');
    const rules = resolved.value;
    const { match, engineVersion } = await this.detectOf(sheet, Number(rules.sizeToleranceMm));
    await stage(3);

    const check = version.fileCheck;
    // A check with no product chosen takes the detected one (the customer can change it).
    let catalogProductId = check.catalogProductId;
    let sizeCode = check.standardSizeCode;
    if (catalogProductId === null && match) {
      catalogProductId = match.catalogProductId;
      sizeCode = match.sizeCode;
    }
    const expected = await this.expectedOf(catalogProductId, sizeCode);
    const spec = {
      catalogProductId,
      sizeCode,
      printMethod: check.printMethod as PrintMethod | null,
      printSpotColours: check.printSpotColours,
    };
    const report = uploadReport(facts, expected, rules, printOf(spec));
    await stage(4);
    const detection: StoredDetection = {
      sheet,
      match: match ? withoutId(match) : null,
      engineVersion,
    };

    await this.prisma.withTx(async (tx) => {
      const current = await tx.fileCheckVersion.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'running') return; // removed or re-queued meanwhile
      if (check.catalogProductId === null && catalogProductId !== null)
        await tx.fileCheck.updateMany({
          where: { id: check.id, catalogProductId: null },
          data: { catalogProductId, standardSizeCode: sizeCode, rowVersion: { increment: 1 } },
        });
      await tx.fileCheckVersion.update({
        where: { id },
        data: {
          status: 'done',
          stage: STAGE_COUNT,
          facts: factsJson(facts),
          detection: detection as unknown as Prisma.InputJsonValue,
          report: report as unknown as Prisma.InputJsonValue,
          refs: refsOf(resolved.versionId),
          error: facts.kind === 'error' ? facts.reason : null,
          lockedUntil: null,
          completedAt: new Date(),
        },
      });
      await this.events.record(
        tx,
        {
          type: 'file_check.checked',
          aggregateType: 'file_check',
          aggregateId: check.publicId,
          payload: {
            fileCheckId: check.publicId,
            variantNo: version.variantNo,
            versionNo: version.versionNo,
            detected: match !== null,
            mustFix: report.counts.must_fix,
            review: report.counts.review,
            pass: report.counts.pass,
            notChecked: report.counts.not_checked,
          },
        },
        systemActor('artwork.file_check'),
      );
    });
  }

  /** Facts of a stored file: only scanned files, PDF bytes (PDF and PDF-compatible AI), within the technical bound. */
  async factsOf(file: FileObject): Promise<FileFacts> {
    if (file.scanStatus === 'infected') return { kind: 'error', reason: 'infected' };
    if (file.scanStatus !== 'clean' && file.scanStatus !== 'skipped')
      return { kind: 'error', reason: 'not_scanned' };
    if (file.sizeBytes > BigInt(MAX_PREFLIGHT_BYTES)) return { kind: 'unsupported', reason: 'too_large' };
    const bytes = await this.read(file.storageKey);
    if (!isPdfBytes(bytes)) return { kind: 'unsupported', reason: 'type' };
    return pdfFacts(bytes);
  }

  // --- helpers ----------------------------------------------------------------------------------------------

  /** The customer's own uploaded, not-infected artwork files, in the order asked. */
  private async usableFiles(actor: UserActor, fileIds: string[]): Promise<FileObject[]> {
    const objects = await this.prisma.fileObject.findMany({ where: { publicId: { in: fileIds } } });
    return fileIds.map((fileId) => {
      const object = objects.find((o) => o.publicId === fileId);
      if (
        !object ||
        object.ownerUserId !== actor.userId ||
        object.purpose !== 'artwork' ||
        object.uploadStatus !== 'uploaded' ||
        object.scanStatus === 'infected'
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId } });
      return object;
    });
  }

  private async product(slug: string) {
    const product = await this.prisma.catalogProduct.findFirst({
      where: { slug, status: 'active' },
      select: { id: true },
    });
    if (!product)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'productSlug', code: 'not_found', message: 'no such product' }],
      });
    return product;
  }

  private async size(catalogProductId: bigint, code: string) {
    const size = await this.prisma.standardSize.findFirst({
      where: { catalogProductId, code, status: 'active' },
    });
    if (!size)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'sizeCode', code: 'not_found', message: 'no such standard size for the product' }],
      });
    return size;
  }

  /** The finished (blank) size the checks compare with: the engine's blank of the product's pattern at the size. */
  async expectedOf(
    catalogProductId: bigint | null,
    sizeCode: string | null,
  ): Promise<{ widthMm: number; heightMm: number } | null> {
    if (catalogProductId === null || sizeCode === null) return null;
    const [candidate] = await this.candidates({ catalogProductId, sizeCode });
    return candidate ? { widthMm: candidate.blankWidthMm, heightMm: candidate.blankHeightMm } : null;
  }

  private async detectOf(sheet: SheetOfFile | null, toleranceMm: number) {
    if (!sheet) return { match: null, engineVersion: null };
    const candidates = await this.candidates();
    const engineVersion = candidates.length
      ? (this.blanks.values().next().value?.engineVersion ?? null)
      : null;
    return { match: detect(sheet, candidates, toleranceMm), engineVersion };
  }

  /**
   * Every active product × active standard size whose pattern has a dieline the engine draws, with its blank. A
   * pattern the engine cannot build is skipped (no detection for it — never a guessed size).
   */
  async candidates(only?: { catalogProductId: bigint; sizeCode: string }): Promise<DetectionCandidate[]> {
    if (!(await this.engine.available().catch(() => false))) return [];
    const products = await this.prisma.catalogProduct.findMany({
      where: { status: 'active', ...(only ? { id: only.catalogProductId } : {}) },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        nameTh: true,
        nameEn: true,
        patterns: {
          orderBy: { sort: 'asc' },
          take: 1,
          select: { pattern: { select: { dielineKey: true } } },
        },
        standardSizes: {
          where: { status: 'active', ...(only ? { code: only.sizeCode } : {}) },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const out: DetectionCandidate[] = [];
    for (const product of products) {
      const key = product.patterns[0]?.pattern.dielineKey;
      if (!key) continue;
      for (const size of product.standardSizes) {
        const l = Number(size.lengthMm);
        const w = Number(size.widthMm);
        const h = Number(size.heightMm);
        const blank = await this.blankOf(key, l, w, h);
        if (!blank) continue;
        out.push({
          catalogProductId: product.id,
          productSlug: product.slug,
          productNameTh: product.nameTh,
          productNameEn: product.nameEn,
          sizeCode: size.code,
          sizeName: size.name,
          lengthMm: l,
          widthMm: w,
          heightMm: h,
          blankWidthMm: Math.round(blank.widthMm * 10) / 10,
          blankHeightMm: Math.round(blank.heightMm * 10) / 10,
        });
      }
    }
    return out;
  }

  private async blankOf(key: string, l: number, w: number, h: number) {
    const cacheKey = `${key}|${l}|${w}|${h}`;
    const known = this.blanks.get(cacheKey);
    if (known) return known;
    try {
      const blank = await this.engine.blank({ dielineKey: key, lengthMm: l, widthMm: w, heightMm: h });
      this.blanks.set(cacheKey, blank);
      return blank;
    } catch {
      return null;
    }
  }

  private async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(key)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    checkPublicId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'file_check',
        aggregateId: checkPublicId,
        payload: { fileCheckId: checkPublicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'file_check',
      aggregatePublicId: checkPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}

function live(check: Pick<FileCheckRow, 'versions'>) {
  return check.versions.filter((v) => !v.removedAt);
}

/** The print method context of the ink-count check; null until the customer has chosen one. */
export function printOf(spec: {
  printMethod: PrintMethod | null;
  printSpotColours: number | null;
}): PrintMethodContext | null {
  if (!spec.printMethod) return null;
  return {
    method: spec.printMethod,
    spotColours: spec.printSpotColours ?? (spec.printMethod === 'spot' ? 1 : 0),
  };
}

function refsOf(versionId: bigint | string | number): Prisma.InputJsonValue {
  return { settingVersionIds: { 'artwork.preflight_rules': String(versionId) } };
}

function withoutId(match: DetectionMatch): Omit<DetectionMatch, 'catalogProductId'> {
  const { catalogProductId: _id, ...rest } = match;
  return rest;
}

/** Facts as JSON (the die names set is already an array; nothing else needs converting). */
function factsJson(facts: FileFacts): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(facts)) as Prisma.InputJsonValue;
}
