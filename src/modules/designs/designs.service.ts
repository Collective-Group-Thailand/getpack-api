import { createHash, randomBytes } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DesignVersionKind, type FileObject, Prisma } from '@generated/prisma/client';
import { type OrderRefDto } from '@modules/carts/carts.dto';
import { canonical } from '@modules/catalog/imports/import-engine';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

import {
  type DesignAssetDto,
  type DesignDocumentDto,
  type DesignProductRefDto,
  type DesignVersionDto,
  type ImportDesignRowDto,
  type ImportDesignsResultDto,
  type SharedDesignDto,
} from './designs.dto';

/** Technical bound of one design document (JSON). */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const DESIGN_INCLUDE = {
  catalogProduct: {
    select: { publicId: true, slug: true, nameTh: true, nameEn: true, productType: { select: { code: true } } },
  },
  pattern: { select: { publicId: true, dielineKey: true } },
  material: { select: { publicId: true } },
  semiDesignTemplate: { select: { publicId: true } },
  thumbnailFile: true,
  currentVersion: true,
  assets: { include: { fileObject: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.DesignDocumentInclude;
export type DesignRow = Prisma.DesignDocumentGetPayload<{ include: typeof DESIGN_INCLUDE }>;

export const designEtag = (d: { publicId: string; rowVersion: number }) => etagOf(d.publicId, d.rowVersion);

export interface CreateDesignInput {
  catalogProductId: string;
  patternId?: string;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  materialId?: string;
  semiDesignTemplateId?: string;
  title: string;
  schemaVersion?: number;
  document?: Record<string, unknown>;
}

export interface SaveDesignInput {
  title?: string;
  schemaVersion: number;
  document: Record<string, unknown>;
  thumbnailFileId?: string;
  kind?: 'manual' | 'autosave';
  label?: string;
  patternId?: string;
  materialId?: string;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
}

interface VersionInput {
  schemaVersion: number;
  document: Record<string, unknown>;
  kind?: DesignVersionKind;
  label?: string | null;
  thumbnailFileId?: bigint | null;
}

/**
 * Online designs (B4.1): a design document belongs to its author (a customer, or staff for semi-design
 * templates); every save is a new immutable version (schema version + SHA-256 of the canonical JSON) and
 * the document's `row_version` is its ETag (`If-Match` on save, 412 `concurrency.stale`). A design can
 * start from a semi-design template (its design becomes version 1), be put in the cart (online designer)
 * and be submitted as the order's artwork (source `designer`). U-B0.1 adds version kinds and labels, duplicate,
 * restore, the import of guest designs kept in the browser, and a view-only share link (D-226).
 */
@Injectable()
export class DesignsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    // Assets and thumbnails of a design are read by its author (they uploaded them) and staff; an order's
    // customer reads the assets of the design their order uses.
    this.files.registerFileReader('designs', async (actor, file) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const n = await this.prisma.designAsset.count({
        where: { fileObjectId: file.id, document: { ownerUserId: actor.userId, deletedAt: null } },
      });
      return n > 0;
    });
  }

  // --- reads ----------------------------------------------------------------------------------------

  async list(ownerUserId: bigint, page: number, perPage: number, linked: 'any' | 'linked' | 'unlinked' = 'any') {
    const used: Prisma.DesignDocumentWhereInput = {
      OR: [{ orders: { some: {} } }, { versions: { some: { submissions: { some: {} } } } }],
    };
    const where: Prisma.DesignDocumentWhereInput = {
      ownerUserId,
      deletedAt: null,
      ...(linked === 'linked' && used),
      ...(linked === 'unlinked' && { NOT: used }),
    };
    return Promise.all([
      this.prisma.designDocument.findMany({
        where,
        include: DESIGN_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.designDocument.count({ where }),
    ]);
  }

  async get(publicId: string, ownerUserId?: bigint, db: Tx = this.prisma): Promise<DesignRow> {
    const row = await db.designDocument.findUnique({ where: { publicId }, include: DESIGN_INCLUDE });
    if (!row || row.deletedAt || (ownerUserId !== undefined && row.ownerUserId !== ownerUserId))
      throw new DomainException('http.not_found');
    return row;
  }

  /** Newest first; `before` / `limit` page through a long history, `kind` filters (e.g. hide autosaves). */
  async versions(
    publicId: string,
    ownerUserId?: bigint,
    q: { before?: number; limit?: number; kind?: DesignVersionKind } = {},
  ) {
    const doc = await this.get(publicId, ownerUserId);
    return this.prisma.designDocumentVersion.findMany({
      where: {
        documentId: doc.id,
        ...(q.before !== undefined && { versionNo: { lt: q.before } }),
        ...(q.kind && { kind: q.kind }),
      },
      include: { thumbnailFile: true },
      orderBy: { versionNo: 'desc' },
      ...(q.limit !== undefined && { take: q.limit }),
    });
  }

  async version(publicId: string, versionNo: number, ownerUserId?: bigint) {
    const doc = await this.get(publicId, ownerUserId);
    const row = await this.prisma.designDocumentVersion.findUnique({
      where: { documentId_versionNo: { documentId: doc.id, versionNo } },
      include: { thumbnailFile: true },
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  // --- writes ---------------------------------------------------------------------------------------

  async create(
    actor: UserActor,
    input: CreateDesignInput,
    opts: { companyId?: bigint | null } = {},
  ): Promise<DesignRow> {
    return this.prisma.withTx(async (tx) => {
      const product = await tx.catalogProduct.findUnique({ where: { publicId: input.catalogProductId } });
      if (!product) throw new DomainException('http.not_found');
      const { pattern, material } = await this.refs(tx, input);
      let schemaVersion = input.schemaVersion ?? 1;
      let document = input.document ?? null;
      let templateId: bigint | null = null;
      if (input.semiDesignTemplateId) {
        const template = await tx.semiDesignTemplate.findUnique({
          where: { publicId: input.semiDesignTemplateId },
          include: { designVersion: true },
        });
        if (!template || template.status !== 'active') throw new DomainException('http.not_found');
        if (!template.designVersion) throw new DomainException('designs.template_without_design');
        templateId = template.id;
        schemaVersion = template.designVersion.schemaVersion;
        document = template.designVersion.document as Record<string, unknown>;
      }
      const doc = await tx.designDocument.create({
        data: {
          ownerUserId: actor.userId,
          companyId: opts.companyId ?? null,
          catalogProductId: product.id,
          patternId: pattern?.id ?? null,
          lengthMm: input.lengthMm ?? null,
          widthMm: input.widthMm ?? null,
          heightMm: input.heightMm ?? null,
          materialId: material?.id ?? null,
          semiDesignTemplateId: templateId,
          title: input.title,
        },
      });
      if (document) await this.addVersion(tx, doc.id, { schemaVersion, document }, actor);
      await this.record(tx, doc.publicId, 'design.created', { fromTemplate: templateId !== null }, actor);
      return this.get(doc.publicId, undefined, tx);
    });
  }

  /** Saves a new version (If-Match the document's ETag). */
  async save(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: SaveDesignInput,
    ownerUserId?: bigint,
  ) {
    return this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, ownerUserId, tx);
      assertIfMatch(ifMatch, designEtag(doc));
      let thumbnailFileId: bigint | undefined;
      if (input.thumbnailFileId) {
        const file = await tx.fileObject.findUnique({ where: { publicId: input.thumbnailFileId } });
        if (!file || file.ownerUserId !== actor.userId || file.uploadStatus !== 'uploaded')
          throw new DomainException('artwork.file_not_usable', { params: { fileId: input.thumbnailFileId } });
        thumbnailFileId = file.id;
      }
      const { pattern, material } = await this.refs(tx, input);
      const { count } = await tx.designDocument.updateMany({
        where: { id: doc.id, rowVersion: doc.rowVersion },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(thumbnailFileId !== undefined && { thumbnailFileId }),
          ...(pattern && { patternId: pattern.id }),
          ...(material && { materialId: material.id }),
          ...(input.lengthMm !== undefined && { lengthMm: input.lengthMm }),
          ...(input.widthMm !== undefined && { widthMm: input.widthMm }),
          ...(input.heightMm !== undefined && { heightMm: input.heightMm }),
          rowVersion: { increment: 1 },
        },
      });
      if (count === 0) throw new DomainException('concurrency.stale');
      const kind = input.kind ?? 'manual';
      const version = await this.addVersion(
        tx,
        doc.id,
        { ...input, kind, label: input.label ?? null, thumbnailFileId: thumbnailFileId ?? null },
        actor,
      );
      await this.record(tx, doc.publicId, 'design.saved', { versionNo: version.versionNo, kind }, actor);
      return this.get(doc.publicId, undefined, tx);
    });
  }

  async remove(actor: UserActor, publicId: string, ownerUserId: bigint): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, ownerUserId, tx);
      await tx.designDocument.update({
        where: { id: doc.id },
        data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.record(tx, doc.publicId, 'design.deleted', {}, actor);
    });
  }

  async addAsset(
    actor: UserActor,
    publicId: string,
    input: { fileId: string; kind: 'image' | 'font' | 'logo' | 'svg' },
    ownerUserId?: bigint,
  ) {
    return this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, ownerUserId, tx);
      const file = await tx.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (
        !file ||
        file.ownerUserId !== actor.userId ||
        file.uploadStatus !== 'uploaded' ||
        file.scanStatus === 'infected'
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId: input.fileId } });
      await tx.designAsset.upsert({
        where: { documentId_fileObjectId: { documentId: doc.id, fileObjectId: file.id } },
        create: { documentId: doc.id, fileObjectId: file.id, kind: input.kind },
        update: { kind: input.kind },
      });
      return this.get(doc.publicId, undefined, tx);
    });
  }

  async removeAsset(publicId: string, assetPublicId: string, ownerUserId?: bigint) {
    return this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, ownerUserId, tx);
      const asset = await tx.designAsset.findFirst({
        where: { publicId: assetPublicId, documentId: doc.id },
      });
      if (!asset) throw new DomainException('http.not_found');
      await tx.designAsset.delete({ where: { id: asset.id } });
      return this.get(doc.publicId, undefined, tx);
    });
  }

  /** A new design of mine from the current version and assets of one of mine (unlinked, not shared). */
  async duplicate(actor: UserActor, publicId: string, title: string): Promise<DesignRow> {
    return this.prisma.withTx(async (tx) => {
      const source = await this.get(publicId, actor.userId, tx);
      const doc = await tx.designDocument.create({
        data: {
          ownerUserId: source.ownerUserId,
          companyId: source.companyId,
          catalogProductId: source.catalogProductId,
          patternId: source.patternId,
          lengthMm: source.lengthMm,
          widthMm: source.widthMm,
          heightMm: source.heightMm,
          materialId: source.materialId,
          semiDesignTemplateId: source.semiDesignTemplateId,
          thumbnailFileId: source.thumbnailFileId,
          title,
        },
      });
      if (source.currentVersion)
        await this.addVersion(
          tx,
          doc.id,
          {
            schemaVersion: source.currentVersion.schemaVersion,
            document: source.currentVersion.document as Record<string, unknown>,
            thumbnailFileId: source.currentVersion.thumbnailFileId,
          },
          actor,
        );
      if (source.assets.length)
        await tx.designAsset.createMany({
          data: source.assets.map((a) => ({ documentId: doc.id, fileObjectId: a.fileObjectId, kind: a.kind })),
        });
      await this.record(tx, doc.publicId, 'design.duplicated', { fromDesignId: source.publicId }, actor);
      return this.get(doc.publicId, undefined, tx);
    });
  }

  /** A new version whose document is version `versionNo`'s (the history is never rewritten); If-Match the design. */
  async restore(
    actor: UserActor,
    publicId: string,
    versionNo: number,
    ifMatch: string | undefined,
  ): Promise<DesignRow> {
    return this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, actor.userId, tx);
      assertIfMatch(ifMatch, designEtag(doc));
      const from = await tx.designDocumentVersion.findUnique({
        where: { documentId_versionNo: { documentId: doc.id, versionNo } },
      });
      if (!from) throw new DomainException('http.not_found');
      const { count } = await tx.designDocument.updateMany({
        where: { id: doc.id, rowVersion: doc.rowVersion },
        data: { rowVersion: { increment: 1 } },
      });
      if (count === 0) throw new DomainException('concurrency.stale');
      const version = await this.addVersion(
        tx,
        doc.id,
        {
          schemaVersion: from.schemaVersion,
          document: from.document as Record<string, unknown>,
          kind: 'restore',
          label: from.label,
          thumbnailFileId: from.thumbnailFileId,
        },
        actor,
      );
      await this.record(
        tx,
        doc.publicId,
        'design.restored',
        { versionNo: version.versionNo, fromVersionNo: versionNo },
        actor,
      );
      return this.get(doc.publicId, undefined, tx);
    });
  }

  /**
   * Imports guest designs the browser kept before sign-in, one transaction per row. A local id imported before
   * answers its design again (a replay is a no-op); a row without an active catalogue product is skipped.
   */
  async importGuest(actor: UserActor, rows: ImportDesignRowDto[]): Promise<ImportDesignsResultDto> {
    const result: ImportDesignsResultDto = { imported: [], skipped: [] };
    for (const row of rows) {
      const prior = await this.prisma.designDocument.findFirst({
        where: { ownerUserId: actor.userId, importLocalId: row.localId },
      });
      if (prior) {
        if (prior.deletedAt) result.skipped.push({ localId: row.localId, reason: 'deleted' });
        else result.imported.push({ localId: row.localId, designId: prior.publicId });
        continue;
      }
      const product = row.catalogProductId
        ? await this.prisma.catalogProduct.findFirst({ where: { publicId: row.catalogProductId, status: 'active' } })
        : null;
      if (!product) {
        result.skipped.push({ localId: row.localId, reason: 'product_not_found' });
        continue;
      }
      if (Buffer.byteLength(JSON.stringify(canonical(row.document))) > MAX_DOCUMENT_BYTES) {
        result.skipped.push({ localId: row.localId, reason: 'document_too_large' });
        continue;
      }
      try {
        const designId = await this.prisma.withTx(async (tx) => {
          // A box style or material no longer in the catalogue is left out; the document keeps the design.
          const pattern = row.patternId
            ? await tx.pattern.findUnique({ where: { publicId: row.patternId } })
            : null;
          const material = row.materialId
            ? await tx.material.findUnique({ where: { publicId: row.materialId } })
            : null;
          const doc = await tx.designDocument.create({
            data: {
              ownerUserId: actor.userId,
              catalogProductId: product.id,
              patternId: pattern?.id ?? null,
              materialId: material?.id ?? null,
              lengthMm: row.lengthMm ?? null,
              widthMm: row.widthMm ?? null,
              heightMm: row.heightMm ?? null,
              title: row.title,
              importLocalId: row.localId,
            },
          });
          await this.addVersion(tx, doc.id, { ...row, kind: 'import' }, actor);
          await this.record(tx, doc.publicId, 'design.imported', {}, actor);
          return doc.publicId;
        });
        result.imported.push({ localId: row.localId, designId });
      } catch (error) {
        // A concurrent call imported the same local id first: answer its design.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        const winner = await this.prisma.designDocument.findFirstOrThrow({
          where: { ownerUserId: actor.userId, importLocalId: row.localId },
        });
        result.imported.push({ localId: row.localId, designId: winner.publicId });
      }
    }
    return result;
  }

  /**
   * A new view-only share link (D-226): the token is returned once and only its hash kept; sharing again replaces
   * the previous link. It expires after `configurations.share_link_days` (D-185).
   */
  async share(actor: UserActor, publicId: string) {
    return this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, actor.userId, tx);
      const now = new Date();
      const days = Number((await this.settings.at('configurations.share_link_days', { at: now })).value);
      const expiresAt = new Date(now.getTime() + days * 86_400_000);
      const token = randomBytes(32).toString('base64url');
      await tx.designDocument.update({
        where: { id: doc.id },
        // Not the document: the editor's ETag stays valid.
        data: { shareTokenHash: sha256(token), sharedAt: now, shareExpiresAt: expiresAt },
      });
      await this.record(tx, doc.publicId, 'design.shared', { expiresAt: toBangkokIso(expiresAt) }, actor);
      return { token, sharedAt: now, expiresAt };
    });
  }

  /** Revokes the live link; its token stops resolving at once. */
  async unshare(actor: UserActor, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const doc = await this.get(publicId, actor.userId, tx);
      if (!doc.shareTokenHash) throw new DomainException('http.not_found');
      await tx.designDocument.update({
        where: { id: doc.id },
        data: { shareTokenHash: null, sharedAt: null, shareExpiresAt: null },
      });
      await this.record(tx, doc.publicId, 'design.share_revoked', {}, actor);
    });
  }

  /** The design behind a live share link; revoked, expired or deleted answers 404. */
  async shared(token: string): Promise<DesignRow> {
    if (!SHARE_TOKEN.test(token)) throw new DomainException('http.not_found');
    const row = await this.prisma.designDocument.findUnique({
      where: { shareTokenHash: sha256(token) },
      include: DESIGN_INCLUDE,
    });
    if (!row || row.deletedAt || !row.shareExpiresAt || row.shareExpiresAt <= new Date())
      throw new DomainException('http.not_found');
    return row;
  }

  // --- views ----------------------------------------------------------------------------------------

  /** Designs as returned to their author or staff: product, signed URLs of the assets and preview, order links. */
  async views(rows: DesignRow[], withDocument: boolean): Promise<DesignDocumentDto[]> {
    const links = await this.orderLinks(rows.map((r) => r.id));
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.base(row, withDocument)),
        id: row.publicId,
        catalogProductId: row.catalogProduct.publicId,
        patternId: row.pattern?.publicId ?? null,
        materialId: row.material?.publicId ?? null,
        semiDesignTemplateId: row.semiDesignTemplate?.publicId ?? null,
        thumbnailFileId: row.thumbnailFile?.publicId ?? null,
        orders: links.get(row.id) ?? [],
        share:
          row.sharedAt && row.shareExpiresAt && row.shareExpiresAt > new Date()
            ? { sharedAt: toBangkokIso(row.sharedAt), expiresAt: toBangkokIso(row.shareExpiresAt) }
            : null,
        createdAt: toBangkokIso(row.createdAt),
        updatedAt: toBangkokIso(row.updatedAt),
      })),
    );
  }

  async view(row: DesignRow, withDocument = true): Promise<DesignDocumentDto> {
    return (await this.views([row], withDocument))[0]!;
  }

  /** What a share link shows: the current version, never the owner (D-226). */
  async sharedView(row: DesignRow): Promise<SharedDesignDto> {
    return {
      ...(await this.base(row, true)),
      dielineKey: row.pattern?.dielineKey ?? null,
      sharedAt: toBangkokIso(row.sharedAt!),
      expiresAt: toBangkokIso(row.shareExpiresAt!),
    };
  }

  async versionView(
    v: Parameters<typeof versionDto>[0] & { thumbnailFile: FileObject | null },
    withDocument: boolean,
  ): Promise<DesignVersionDto> {
    return {
      ...versionDto(v, withDocument),
      thumbnailUrl: v.thumbnailFile ? ((await this.files.signedUrl(v.thumbnailFile))?.url ?? null) : null,
    };
  }

  private async base(row: DesignRow, withDocument: boolean) {
    const product: DesignProductRefDto = {
      id: row.catalogProduct.publicId,
      slug: row.catalogProduct.slug,
      nameTh: row.catalogProduct.nameTh,
      nameEn: row.catalogProduct.nameEn,
      productTypeCode: row.catalogProduct.productType.code,
    };
    return {
      title: row.title,
      product,
      lengthMm: num(row.lengthMm),
      widthMm: num(row.widthMm),
      heightMm: num(row.heightMm),
      versionNo: row.currentVersion?.versionNo ?? null,
      schemaVersion: row.currentVersion?.schemaVersion ?? null,
      document: withDocument
        ? ((row.currentVersion?.document as Record<string, unknown> | undefined) ?? null)
        : null,
      assets: await Promise.all(row.assets.map((a) => this.assetView(a))),
      thumbnailUrl: row.thumbnailFile ? ((await this.files.signedUrl(row.thumbnailFile))?.url ?? null) : null,
    };
  }

  private async assetView(a: DesignRow['assets'][number]): Promise<DesignAssetDto> {
    const signed = await this.files.signedUrl(a.fileObject);
    return {
      id: a.publicId,
      fileId: a.fileObject.publicId,
      kind: a.kind,
      mimeType: a.fileObject.mimeType,
      sizeBytes: Number(a.fileObject.sizeBytes),
      widthPx: a.fileObject.widthPx,
      heightPx: a.fileObject.heightPx,
      url: signed?.url ?? null,
      urlExpiresAt: signed ? toBangkokIso(signed.expiresAt) : null,
      createdAt: toBangkokIso(a.createdAt),
    };
  }

  /** Orders placed with each design or whose artwork was submitted from one of its versions, newest first. */
  private async orderLinks(documentIds: bigint[]): Promise<Map<bigint, OrderRefDto[]>> {
    const map = new Map<bigint, OrderRefDto[]>();
    if (!documentIds.length) return map;
    const rows = await this.prisma.$queryRaw<{ document_id: bigint; public_id: string; order_code: string }[]>`
      SELECT l.document_id, o.public_id::text AS public_id, o.order_code
        FROM (
          SELECT design_document_id AS document_id, id AS order_id FROM orders
           WHERE design_document_id = ANY(${documentIds}::bigint[])
          UNION
          SELECT v.document_id, s.order_id FROM artwork_submissions s
            JOIN design_document_versions v ON v.id = s.design_document_version_id
           WHERE v.document_id = ANY(${documentIds}::bigint[])
        ) l
        JOIN orders o ON o.id = l.order_id
       ORDER BY l.document_id, o.id DESC`;
    for (const r of rows) {
      const list = map.get(r.document_id) ?? [];
      list.push({ orderId: r.public_id, orderCode: r.order_code });
      map.set(r.document_id, list);
    }
    return map;
  }

  /** Staff point a semi-design template at a design they authored (its current version). */
  async setTemplateDesign(actor: UserActor, templatePublicId: string, designPublicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const template = await tx.semiDesignTemplate.findUnique({ where: { publicId: templatePublicId } });
      const doc = await this.get(designPublicId, undefined, tx);
      if (!template) throw new DomainException('http.not_found');
      if (!doc.currentVersionId) throw new DomainException('designs.template_without_design');
      await tx.semiDesignTemplate.update({
        where: { id: template.id },
        data: {
          designDocumentVersionId: doc.currentVersionId,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, doc.publicId, 'design.template_linked', { templateId: template.publicId }, actor);
    });
  }

  // --- helpers --------------------------------------------------------------------------------------

  private async refs(tx: Tx, input: { patternId?: string; materialId?: string }) {
    const pattern = input.patternId
      ? await tx.pattern.findUnique({ where: { publicId: input.patternId } })
      : null;
    const material = input.materialId
      ? await tx.material.findUnique({ where: { publicId: input.materialId } })
      : null;
    if ((input.patternId && !pattern) || (input.materialId && !material))
      throw new DomainException('http.not_found');
    return { pattern, material };
  }

  private async addVersion(tx: Tx, documentId: bigint, input: VersionInput, actor: UserActor) {
    const { schemaVersion, document } = input;
    const json = JSON.stringify(canonical(document));
    if (Buffer.byteLength(json) > MAX_DOCUMENT_BYTES)
      throw new DomainException('designs.document_too_large', {
        params: { maxMb: MAX_DOCUMENT_BYTES / 1024 / 1024 },
      });
    const last = await tx.designDocumentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNo: 'desc' },
    });
    const version = await tx.designDocumentVersion.create({
      data: {
        documentId,
        versionNo: (last?.versionNo ?? 0) + 1,
        schemaVersion,
        document: document as Prisma.InputJsonValue,
        contentSha256: createHash('sha256').update(json).digest(),
        kind: input.kind ?? 'manual',
        label: input.label ?? null,
        thumbnailFileId: input.thumbnailFileId ?? null,
        createdById: actor.userId,
      },
    });
    await tx.designDocument.update({ where: { id: documentId }, data: { currentVersionId: version.id } });
    return version;
  }

  private async record(
    tx: Tx,
    publicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: UserActor,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'design_document',
        aggregateId: publicId,
        payload: { designId: publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'design_document',
      aggregatePublicId: publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

export function versionDto(
  v: {
    versionNo: number;
    schemaVersion: number;
    contentSha256: Uint8Array;
    document: Prisma.JsonValue;
    kind: DesignVersionKind;
    label: string | null;
    thumbnailFile: { publicId: string } | null;
    createdAt: Date;
  },
  withDocument: boolean,
): Omit<DesignVersionDto, 'thumbnailUrl'> {
  return {
    versionNo: v.versionNo,
    schemaVersion: v.schemaVersion,
    contentSha256: Buffer.from(v.contentSha256).toString('hex'),
    document: withDocument ? (v.document as Record<string, unknown>) : null,
    kind: v.kind,
    label: v.label,
    thumbnailFileId: v.thumbnailFile?.publicId ?? null,
    createdAt: toBangkokIso(v.createdAt),
  };
}
