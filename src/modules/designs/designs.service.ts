import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';

import { type DesignDocumentDto, type DesignVersionDto } from './designs.dto';

/** Technical bound of one design document (JSON). */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export const DESIGN_INCLUDE = {
  catalogProduct: { select: { publicId: true } },
  pattern: { select: { publicId: true } },
  material: { select: { publicId: true } },
  semiDesignTemplate: { select: { publicId: true } },
  thumbnailFile: { select: { publicId: true } },
  currentVersion: true,
  assets: { include: { fileObject: { select: { publicId: true } } }, orderBy: { id: 'asc' } },
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
}

/**
 * Online designs (B4.1): a design document belongs to its author (a customer, or staff for semi-design
 * templates); every save is a new immutable version (schema version + SHA-256 of the canonical JSON) and
 * the document's `row_version` is its ETag (`If-Match` on save, 412 `concurrency.stale`). A design can
 * start from a semi-design template (its design becomes version 1), be put in the cart (online designer)
 * and be submitted as the order's artwork (source `designer`).
 */
@Injectable()
export class DesignsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly files: FilesService,
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

  async list(ownerUserId: bigint, page: number, perPage: number) {
    const where: Prisma.DesignDocumentWhereInput = { ownerUserId, deletedAt: null };
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

  async versions(publicId: string, ownerUserId?: bigint) {
    const doc = await this.get(publicId, ownerUserId);
    return this.prisma.designDocumentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNo: 'desc' },
    });
  }

  async version(publicId: string, versionNo: number, ownerUserId?: bigint) {
    const doc = await this.get(publicId, ownerUserId);
    const row = await this.prisma.designDocumentVersion.findUnique({
      where: { documentId_versionNo: { documentId: doc.id, versionNo } },
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
      const pattern = input.patternId
        ? await tx.pattern.findUnique({ where: { publicId: input.patternId } })
        : null;
      const material = input.materialId
        ? await tx.material.findUnique({ where: { publicId: input.materialId } })
        : null;
      if ((input.patternId && !pattern) || (input.materialId && !material))
        throw new DomainException('http.not_found');
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
      if (document) await this.addVersion(tx, doc.id, schemaVersion, document, actor);
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
      const { count } = await tx.designDocument.updateMany({
        where: { id: doc.id, rowVersion: doc.rowVersion },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(thumbnailFileId !== undefined && { thumbnailFileId }),
          rowVersion: { increment: 1 },
        },
      });
      if (count === 0) throw new DomainException('concurrency.stale');
      const version = await this.addVersion(tx, doc.id, input.schemaVersion, input.document, actor);
      await this.record(tx, doc.publicId, 'design.saved', { versionNo: version.versionNo }, actor);
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

  private async addVersion(
    tx: Tx,
    documentId: bigint,
    schemaVersion: number,
    document: Record<string, unknown>,
    actor: UserActor,
  ) {
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

export function designDto(row: DesignRow, withDocument: boolean): DesignDocumentDto {
  return {
    id: row.publicId,
    title: row.title,
    catalogProductId: row.catalogProduct.publicId,
    patternId: row.pattern?.publicId ?? null,
    lengthMm: num(row.lengthMm),
    widthMm: num(row.widthMm),
    heightMm: num(row.heightMm),
    materialId: row.material?.publicId ?? null,
    semiDesignTemplateId: row.semiDesignTemplate?.publicId ?? null,
    thumbnailFileId: row.thumbnailFile?.publicId ?? null,
    versionNo: row.currentVersion?.versionNo ?? null,
    schemaVersion: row.currentVersion?.schemaVersion ?? null,
    document: withDocument
      ? ((row.currentVersion?.document as Record<string, unknown> | undefined) ?? null)
      : null,
    assets: row.assets.map((a) => ({ id: a.publicId, fileId: a.fileObject.publicId, kind: a.kind })),
    updatedAt: toBangkokIso(row.updatedAt),
  };
}

export function versionDto(
  v: {
    versionNo: number;
    schemaVersion: number;
    contentSha256: Uint8Array;
    document: Prisma.JsonValue;
    createdAt: Date;
  },
  withDocument: boolean,
): DesignVersionDto {
  return {
    versionNo: v.versionNo,
    schemaVersion: v.schemaVersion,
    contentSha256: Buffer.from(v.contentSha256).toString('hex'),
    document: withDocument ? (v.document as Record<string, unknown>) : null,
    createdAt: toBangkokIso(v.createdAt),
  };
}
